"""Blender (headless), stage 1 of the model build: import a Tripo part-segmented character GLB (static, ~2M tris),
classify its parts, decimate, rebuild light materials and cache the result.

  blender -b --factory-startup -P tools/models/prep.py -- <src.glb> <cache_dir> <id> [--tris 110000] [--overrides <json>]

Writes <cache_dir>/<id>.blend (decimated parts, each tagged with its class), <id>.npz (dense point samples of
every part, taken before decimation) and <id>.json (height, part classes, contact interfaces).
Stage 2 (rig.py) fits the skeleton, straightens the body into a neutral pose, skins and exports it.

All analysis is done in glTF space: +X = character's left, +Y = up, +Z = front (same as the game rig).
Overrides JSON (optional): {"parts": {"tripo_part_5": "armR"}}   classes: torso torso2 head headacc armL armR leg shoe acc
"""
import json
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, CACHE, NAME = argv[0], argv[1], argv[2]


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


TARGET_TRIS = int(opt('--tris', 110000))
OVR = {}
if opt('--overrides') and os.path.exists(opt('--overrides')):
    with open(opt('--overrides'), encoding='utf8') as f:
        OVR = json.load(f)


def log(*a):
    print('@@', *a, flush=True)


def to_gl(a):  # Blender (x, y, z) array -> glTF (x, z, -y)
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)


# ------------------------------------------------------------------ import
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC, merge_vertices=True)
scene = bpy.context.scene
parts = sorted([o for o in scene.objects if o.type == 'MESH'], key=lambda o: o.name)
for o in parts:  # bake transforms, drop the ROOT empty
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world.identity()
    o.data.transform(mw)
    # glTF stores a vertex once per UV island; left like that, decimating and smoothing open cracks along every
    # seam. Weld them (UVs live on the face corners in Blender, so the texture mapping survives).
    n0 = len(o.data.vertices)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-6)
    bm.to_mesh(o.data)
    bm.free()
    print('@@ weld', o.name, n0, '->', len(o.data.vertices), flush=True)
for o in [o for o in scene.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o)

# A "part" is not always one thing: parts edited by hand in Tripo (fingers cut loose so the hand can close) leave
# scraps in different places, and Tripo itself sometimes puts a shoe in the same part as the shirt. So every part
# is taken apart into its connected pieces, pieces that lie together stay together, and what lies somewhere else
# becomes a part of its own. Crumbs of a triangle or two are thrown away.
_tris = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
_height = max((o.matrix_world @ v.co).z for o in parts for v in o.data.vertices)


def _islands(o):
    """Label every vertex with its connected piece."""
    me = o.data
    n = len(me.vertices)
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', e)
    e = e.reshape(-1, 2)
    lab = np.arange(n)
    while True:  # every vertex takes the lowest label around it, then follows its label's label
        m = np.minimum(lab[e[:, 0]], lab[e[:, 1]])
        new = lab.copy()
        np.minimum.at(new, e[:, 0], m)
        np.minimum.at(new, e[:, 1], m)
        new = new[new]
        if (new == lab).all():
            return lab
        lab = new


for o in list(parts):
    name = o.name
    if _tris(o) < 40:
        print('@@ dropped crumb', name, _tris(o), flush=True)
        parts.remove(o)
        bpy.data.objects.remove(o)
        continue
    me = o.data
    lab = _islands(o)
    ids, inv, cnt = np.unique(lab, return_inverse=True, return_counts=True)
    if len(ids) == 1:
        continue
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    lo = np.full((len(ids), 3), 1e9)
    hi = np.full((len(ids), 3), -1e9)
    np.minimum.at(lo, inv, co)
    np.maximum.at(hi, inv, co)
    big = np.nonzero(cnt >= 20)[0]  # dust goes with whichever piece it lies in
    if len(big) < 1:
        continue
    dust_lo, dust_hi, dust_ids = lo, hi, np.nonzero(cnt < 20)[0]
    lo, hi, size = lo[big], hi[big], cnt[big]
    # pieces whose boxes come within a fiftieth of the body's height of each other lie together
    pad = 0.02 * _height
    grp = np.arange(len(big))
    changed = True
    while changed:
        changed = False
        for a in range(len(big)):
            near = ((lo <= hi[a] + pad) & (hi >= lo[a] - pad)).all(1)
            g = grp[near].min()
            if (grp[near] != g).any():
                grp[np.isin(grp, grp[near])] = g
                changed = True
        for g in np.unique(grp):  # the boxes of the groups, for the next round
            m = grp == g
            lo[m], hi[m] = lo[m].min(0), hi[m].max(0)
    groups = np.unique(grp)
    boxes = sorted(((int(size[grp == g].sum()), lo[grp == g][0], hi[grp == g][0]) for g in groups), key=lambda b: -b[0])
    # dust that lies in none of the pieces' boxes (a few stray triangles by a hand, in the part of the head) goes
    near = 0.45 * pad  # the boxes are further than `pad` apart, so this much around each belongs to it alone
    stray = [int(c) for c in dust_ids if not any(((dust_lo[c] >= b[1] - near) & (dust_hi[c] <= b[2] + near)).all() for b in boxes)]
    if stray:
        gone = np.isin(inv, stray)
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[int(i)] for i in np.nonzero(gone)[0]], context='VERTS')
        bm.to_mesh(me)
        bm.free()
        print('@@ dropped', int(gone.sum()), 'stray vertices of', name, flush=True)
    if len(groups) == 1:
        continue
    kept = 1
    for nv, glo, ghi in boxes[1:]:  # the largest group stays; the others leave one by one
        for q in scene.objects:
            q.select_set(q is o)
        bpy.context.view_layer.objects.active = o
        me = o.data
        cur = np.empty(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get('co', cur)
        cur = cur.reshape(-1, 3)
        vm = ((cur >= glo - near) & (cur <= ghi + near)).all(1)
        lv = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get('vertex_index', lv)
        ls = np.empty(len(me.polygons), dtype=np.int64)
        me.polygons.foreach_get('loop_start', ls)
        ev = np.empty(len(me.edges) * 2, dtype=np.int64)
        me.edges.foreach_get('vertices', ev)
        me.vertices.foreach_set('select', vm)
        me.edges.foreach_set('select', vm[ev.reshape(-1, 2)].all(1))
        me.polygons.foreach_set('select', vm[lv[ls]])
        me.update()
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        piece = next((q for q in scene.objects if q.select_get() and q is not o), None)
        if piece is None:
            continue
        if nv < 30:
            bpy.data.objects.remove(piece)
            continue
        piece.name = f'{name}_{chr(96 + kept)}'
        parts.append(piece)
        kept += 1
    o.name = name
    if kept > 1:
        print('@@ split scattered part', name, 'into', kept, flush=True)
parts.sort(key=lambda o: o.name)


def verts_gl(o):
    n = len(o.data.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    o.data.vertices.foreach_get('co', co)
    return to_gl(co.reshape(-1, 3)).astype(np.float64)


def tri_count(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


class Part:
    def __init__(self, o):
        self.o = o
        self.name = o.name
        v = verts_gl(o)
        self.tris = tri_count(o)
        self.s = v[:: max(1, len(v) // 30000)]  # sample for analysis
        self.lo, self.hi, self.c = v.min(0), v.max(0), v.mean(0)
        self.diag = float(np.linalg.norm(self.hi - self.lo))
        self.cls = None
        self.side = None
        t = KDTree(len(self.s))
        for k, p in enumerate(self.s):
            t.insert(Vector(p), k)
        t.balance()
        self.tree = t


P = [Part(o) for o in parts]
byname = {p.name: p for p in P}
H = max(p.hi[1] for p in P)
total_tris = sum(p.tris for p in P)
log(f'{NAME}: {len(P)} parts, {total_tris} tris, height {H:.3f}')

# ------------------------------------------------------------------ contact interfaces
EPS = 0.006 * H
IF = {}
for i in range(len(P)):
    for j in range(i + 1, len(P)):
        A, B = P[i], P[j]
        if (A.lo > B.hi + EPS).any() or (B.lo > A.hi + EPS).any():
            continue
        hit = [p for p in A.s if B.tree.find(Vector(p))[2] < EPS] + [p for p in B.s if A.tree.find(Vector(p))[2] < EPS]
        if len(hit) < 24:
            continue
        h = np.array(hit)
        c = h.mean(0)
        r = float(np.sqrt(((h - c) ** 2).sum(1)).mean())
        IF[(A.name, B.name)] = IF[(B.name, A.name)] = {'c': c, 'r': r, 'n': len(hit)}


def iface(a, b):
    return IF.get((a.name, b.name))


def strong(a, b):
    f = iface(a, b)
    return f is not None and f['n'] >= 80 and f['r'] >= 0.015 * H


# ------------------------------------------------------------------ classify parts
# head: what sits above the collar *on the centre line* (in a T-pose the arms are up at that height too)
mid_x = float(np.median([p.c[0] for p in P]))
head_group = [p for p in P if p.c[1] > 0.74 * H and abs(p.c[0] - mid_x) < 0.12 * H and p.hi[0] - p.lo[0] < 0.4 * H]
# skin of the neck that runs out over a shoulder (bare shoulders under a sleeveless shirt) is no part of the head:
# it would turn with it. It is body, and the rig lets only what lies up by the skull follow the head.
for p in list(head_group):
    if p.lo[1] < 0.76 * H and max(abs(p.hi[0] - mid_x), abs(p.lo[0] - mid_x)) > 0.1 * H:
        head_group.remove(p)
        p.cls = 'torso2'
head = max(head_group, key=lambda p: p.tris)
head.cls = 'head'
# torso: the chest-height part the neck goes into (a wide trouser leg can have a bigger bounding box)
band = [p for p in P if p.cls is None and 0.42 * H < p.c[1] < 0.76 * H]
torso = max(band, key=lambda p: ((iface(head, p) or {'n': 0})['n'], p.tris))
torso.cls = 'torso'
touch = lambda a, b: (iface(a, b) or {'n': 0})['n']
for p in head_group:
    # a pendant or a collar up there belongs to the chest if that is what it lies on
    if p is not head and p is not torso and touch(p, head) >= touch(p, torso):
        p.cls = 'headacc'
# shoes: the biggest low part on each side; soles and laces split off from them ride along
low = [p for p in P if p.cls is None and p.hi[1] < 0.17 * H]
shoeR = max([p for p in low if p.c[0] < mid_x], key=lambda p: p.tris, default=None)
shoeL = max([p for p in low if p.c[0] >= mid_x], key=lambda p: p.tris, default=None)
assert shoeR is not None and shoeL is not None, 'expected two shoe parts'
shoeR.cls, shoeR.side, shoeL.cls, shoeL.side = 'shoe', 'R', 'shoe', 'L'
for extra in low:
    if extra.cls is None:
        extra.cls = 'acc'
for p in P:  # tiny bits (pendants, buckles) ride rigidly on the nearest bone
    if p.cls is None and (p.diag < 0.14 * H or p.tris < 0.006 * total_tris):
        p.cls = 'acc'
rest = [p for p in P if p.cls is None]
# legs: reachable from the shoes through low parts
legs, front = set(), [shoeL, shoeR]
while front:
    cur = front.pop()
    for p in rest:
        if p.name not in legs and p.c[1] < 0.5 * H and strong(cur, p):
            legs.add(p.name)
            front.append(p)
for p in rest:
    if p.name in legs or (p.c[1] < 0.4 * H and p.hi[1] < 0.58 * H):
        p.cls = 'leg'
# arms: chains hanging off the torso. One arm per side — the chain that reaches farthest; anything else
# (belts, vest flaps) is treated as more torso.
loose = [p for p in rest if p.cls is None]
seen, comps = set(), []
for root in sorted(loose, key=lambda p: -(iface(torso, p) or {'n': 0})['n']):
    if root.name in seen:
        continue
    comp, front = [root], [root]
    seen.add(root.name)
    while front:
        cur = front.pop()
        for p in loose:
            if p.name not in seen and strong(cur, p):
                seen.add(p.name)
                comp.append(p)
                front.append(p)
    f0 = iface(torso, root)
    origin = f0['c'] if f0 else root.c
    reach = max(float(np.linalg.norm(q.s - origin, axis=1).max()) for q in comp)
    comps.append({'parts': comp, 'side': 'L' if origin[0] > torso.c[0] else 'R', 'reach': reach})
for side in ('L', 'R'):
    mine = sorted([c for c in comps if c['side'] == side], key=lambda c: -c['reach'])
    for i, c in enumerate(mine):
        for p in c['parts']:
            if i == 0:
                p.cls, p.side = 'arm', side
            else:
                p.cls = 'torso2'
# Standing with the arms straight out to the sides, nothing but arm is out past the shoulders: a forearm or a hand
# that does not quite touch the rest of its arm (a gap at a cuff, a watch in between) still belongs to it.
far = lambda p: max(abs(p.hi[0] - mid_x), abs(p.lo[0] - mid_x))
if any(p.cls in ('arm', 'torso2', 'acc') and p.c[1] > 0.62 * H and far(p) > 0.33 * H for p in P):
    half = max(torso.hi[0] - mid_x, mid_x - torso.lo[0])
    for p in P:
        if p.cls in ('arm', 'torso2', 'acc') and abs(p.c[0] - mid_x) > half and p.c[1] > 0.6 * H:
            p.cls, p.side = 'arm', 'L' if p.c[0] > mid_x else 'R'
# a hand cut into palm and fingers is a string of small parts: whatever hangs on an arm is arm
front = [p for p in P if p.cls == 'arm']
while front:
    cur = front.pop()
    for p in P:
        if p.cls == 'acc' and iface(cur, p):
            p.cls, p.side = 'arm', cur.side
            front.append(p)
for name, cls in OVR.get('parts', {}).items():  # manual fixes
    p = byname[name]
    if cls in ('armL', 'armR'):
        p.cls, p.side = 'arm', cls[-1]
    else:
        p.cls, p.side = cls, None
for p in P:
    log(f'part {p.name:20s} {p.cls:8s}{p.side or " "} tris={p.tris:7d} c=({p.c[0]:+.3f},{p.c[1]:.3f},{p.c[2]:+.3f})')

# ------------------------------------------------------------------ hands with fingers cut loose
# Fingers that are parts of their own tell where each finger is, which is what closing the hand needs. But cut
# apart they would each be simplified on their own and no longer meet the palm; so the pieces are remembered (a
# cloud of points each) and welded back onto the palm: one hand, one skin.
FINGERS, finger_pts = {}, {}
for side in ('L', 'R'):
    arm = [p for p in P if p.cls == 'arm' and p.side == side]
    if not arm:
        continue
    # The hand is at the end of the arm: the part that reaches farthest out, and the small parts joined to it (a
    # finger cut in two hangs on its other half, not on the palm). Cuffs and sleeves further up are not hand.
    out = lambda p: float(np.linalg.norm(p.s - torso.c, axis=1).max())
    tip = max(arm, key=out)
    if tip.diag >= 0.2 * H:  # hand and forearm are one part: nothing to put together
        continue
    near = [p for p in arm if p.diag < 0.2 * H and out(p) > out(tip) - 0.16 * H]
    hand, front = [tip], [tip]
    while front:
        cur = front.pop()
        for p in near:
            if p not in hand and iface(cur, p):
                hand.append(p)
                front.append(p)
    palm = max(hand, key=lambda p: p.tris)
    palm.fingers = True  # a hand keeps enough triangles for its fingers to bend, cut loose or not
    pieces = [p for p in hand if p is not palm]
    if not pieces:
        continue
    FINGERS[palm.name] = []
    for k, q in enumerate(pieces):
        key = f'finger_{side}{k}'
        finger_pts[key] = q.s.astype(np.float32)
        FINGERS[palm.name].append(key)
    for o in scene.objects:
        o.select_set(o is palm.o or any(o is q.o for q in pieces))
    bpy.context.view_layer.objects.active = palm.o
    bpy.ops.object.join()
    bm = bmesh.new()
    bm.from_mesh(palm.o.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if v.is_boundary], dist=1e-5)
    left = sum(1 for e in bm.edges if e.is_boundary)
    bm.to_mesh(palm.o.data)
    bm.free()
    for q in pieces:
        P.remove(q)
        del byname[q.name]
    v = verts_gl(palm.o)
    palm.tris = tri_count(palm.o)
    palm.s = v[:: max(1, len(v) // 30000)]
    palm.lo, palm.hi, palm.c = v.min(0), v.max(0), v.mean(0)
    palm.fingers = True
    log(f'hand {side}: {len(pieces)} finger pieces welded onto {palm.name} ({n0 - len(palm.o.data.vertices)} vertices merged, {left} rim edges left)')

# ------------------------------------------------------------------ decimate
budget_w = {p.name: (p.tris ** 0.8) * (2.6 if p.cls == 'head' else 2.4 if getattr(p, 'fingers', False) else 1.25 if p.cls == 'arm' else 1.0) for p in P}
bw = sum(budget_w.values())
for p in P:
    want = max(6500 if getattr(p, 'fingers', False) else 1200, TARGET_TRIS * budget_w[p.name] / bw)  # fingers need the triangles
    ratio = min(1.0, want / max(1, p.tris))
    o = p.o
    bpy.context.view_layer.objects.active = o
    for q in scene.objects:
        q.select_set(q is o)
    if ratio < 0.98:
        m = o.modifiers.new('dec', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = ratio
        m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception:
        pass
    o.data.shade_smooth()
log('decimated to', sum(tri_count(p.o) for p in P), 'tris')


# ------------------------------------------------------------------ materials
def find_image(sock, depth=0):
    if depth > 6 or not sock.is_linked:
        return None
    n = sock.links[0].from_node
    if n.type == 'TEX_IMAGE':
        return n.image
    for i in n.inputs:
        img = find_image(i, depth + 1)
        if img:
            return img
    return None


def shrink(img, size):
    if img and max(img.size) > size:
        k = size / max(img.size)
        img.scale(max(4, int(img.size[0] * k)), max(4, int(img.size[1] * k)))


def mean_channels(img):
    tmp = img.copy()
    tmp.scale(48, 48)
    a = np.empty(48 * 48 * 4, dtype=np.float32)
    tmp.pixels.foreach_get(a)
    bpy.data.images.remove(tmp)
    return a.reshape(-1, 4).mean(0)


used = set()


def light_material(old, name, big):
    """The same material with its textures scaled down for the game."""
    base = nrm = rm = None
    if old and old.use_nodes:
        bsdf = next((n for n in old.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            base = find_image(bsdf.inputs['Base Color'])
            nrm = find_image(bsdf.inputs['Normal'])
            rm = find_image(bsdf.inputs['Roughness'])
    rough = 0.6
    if rm:
        rough = float(np.clip(mean_channels(rm)[1], 0.3, 0.95))
    shrink(base, 1024 if big else 512)
    shrink(nrm, 512 if big else 256)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    if base:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = base
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        used.add(base)
    if nrm:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = nrm
        nrm.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        used.add(nrm)
    log(f'material {name:20s} base={tuple(base.size) if base else None} normal={tuple(nrm.size) if nrm else None} rough={rough:.2f}')
    return mat


for p in P:
    o = p.o
    stem = 'm_' + p.name.replace('tripo_part_', '')
    olds = list(o.data.materials) or [None]
    for i, old in enumerate(olds):
        mat = light_material(old, stem if i == 0 else f'{stem}_{i}', p.cls in ('head', 'torso'))
        if i < len(o.data.materials):
            o.data.materials[i] = mat
        else:
            o.data.materials.append(mat)
    o['cls'] = p.cls
    o['side'] = p.side or ''

# ------------------------------------------------------------------ cache
os.makedirs(CACHE, exist_ok=True)
for img in list(bpy.data.images):
    if img not in used:
        bpy.data.images.remove(img)
for img in used:  # the scaled-down pixels only exist in memory until they are packed
    img.pack()
for block in (bpy.data.materials, bpy.data.meshes):
    for item in list(block):
        if item.users == 0:
            block.remove(item)
np.savez_compressed(os.path.join(CACHE, NAME + '.npz'), **{p.name: p.s.astype(np.float32) for p in P}, **finger_pts)
meta = {
    'height': float(H),
    'parts': {p.name: {'cls': p.cls, 'side': p.side, 'tris': p.tris, 'lo': p.lo.tolist(), 'hi': p.hi.tolist()} for p in P},
    'fingers': FINGERS,  # hand part -> the point clouds (in the .npz) of the finger pieces welded onto it
    'interfaces': [{'a': a, 'b': b, 'c': f['c'].tolist(), 'r': f['r'], 'n': f['n']} for (a, b), f in IF.items() if a < b],
}
with open(os.path.join(CACHE, NAME + '.json'), 'w', encoding='utf8') as f:
    json.dump(meta, f, indent=1)
blend = os.path.abspath(os.path.join(CACHE, NAME + '.blend'))
bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
log(f'cached {blend} {os.path.getsize(blend) / 1e6:.1f} MB')
