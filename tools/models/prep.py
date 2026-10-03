"""Blender (headless), stage 1 of the model build: import a Tripo part-segmented character GLB (static, ~2M tris),
classify its parts, decimate, rebuild light materials and cache the result.

  blender -b --factory-startup -P tools/models/prep.py -- <src.glb> <cache_dir> <id> [--tris 110000] [--overrides <json>]

Writes <cache_dir>/<id>.blend (decimated parts, each tagged with its class), <id>.npz (dense point samples of
every part, taken before decimation) and <id>.json (height, part classes, contact interfaces).
Stage 2 (rig.py) fits the skeleton, straightens the body into a neutral pose, skins and exports it.

All analysis is done in glTF space: +X = character's left, +Y = up, +Z = front (same as the game rig).
Overrides JSON (optional): {"parts": {"tripo_part_5": "armR"}}   classes: torso torso2 head headacc armL armR leg shoe cape acc
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
# a cape: tall, thin sheets hanging from the shoulders down the back, behind the trunk and the legs (the panels of
# the cape, and the slivers Tripo cut between them). They have no place on the skeleton; the game hangs them from
# the shoulders and lets them swing (see rig.py rig_cape and client/src/render/model.ts).
body_z = float(np.median([p.c[2] for p in P if p.cls is None and 0.2 * H < p.c[1] < 0.75 * H]))
for p in P:
    # (from the shoulders to below the seat: the back of a jacket ends at the hips)
    if p.cls is None and p.hi[1] > 0.6 * H and 0.04 * H < p.lo[1] < 0.4 * H and p.c[2] < body_z - 0.05 * H:
        p.cls = 'cape'
# torso: the chest-height part the neck goes into (a wide trouser leg can have a bigger bounding box)
band = [p for p in P if p.cls is None and 0.42 * H < p.c[1] < 0.76 * H]
torso = max(band, key=lambda p: ((iface(head, p) or {'n': 0})['n'], p.tris))
torso.cls = 'torso'
touch = lambda a, b: (iface(a, b) or {'n': 0})['n']
for p in sorted(head_group, key=lambda p: -p.c[1]):
    # a pendant or a collar up there belongs to the chest if that is what it lies on; a head that came in halves,
    # with the neck and chin as a third part, is all head
    face = p.hi[1] > head.lo[1] + 0.02 * H and max(abs(p.hi[0] - mid_x), abs(p.lo[0] - mid_x)) < 0.08 * H  # chin, beard
    if p is not head and p is not torso and (face or sum(touch(p, q) for q in P if q.cls in ('head', 'headacc')) >= touch(p, torso)):
        p.cls = 'headacc'
# shoes: the biggest low part on each side; soles and laces split off from them ride along
low = [p for p in P if p.cls is None and p.hi[1] < 0.17 * H]
# (boots reach higher: the biggest part on the floor on that side that ends below the knee)
boots = [p for p in P if p.cls is None and p.lo[1] < 0.03 * H and p.hi[1] < 0.32 * H]
shoeR = max([p for p in low if p.c[0] < mid_x] or [p for p in boots if p.c[0] < mid_x], key=lambda p: p.tris, default=None)
shoeL = max([p for p in low if p.c[0] >= mid_x] or [p for p in boots if p.c[0] >= mid_x], key=lambda p: p.tris, default=None)
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
for p in [p for p in P if p.cls == 'cape']:
    log(f'cape {p.name}: meets ' + ', '.join(f'{q.name} ({q.cls}, {iface(p, q)["n"]})' for q in P if q is not p and iface(p, q)))

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

# ------------------------------------------------------------------ the face
# A face is what a fighter is known by, and thinning ruins it first: the sculpt's texture is cut into small islands,
# and collapsing edges across them turns eyes, brows and a hairline into shards. Tripo does not always put the face
# in the part that is the head (the skull and the hair can be one part, the skin of the face and the neck another,
# and that one is small enough to be taken for an accessory). So the face is found by looking: the part that is in
# front, most of the way across the window where a face is - from the chin to the brow, either side of the nose.
def face_parts():
    hg = [p for p in P if p.cls in ('head', 'headacc', 'torso2')]
    hd = [p for p in P if p.cls == 'head']
    if not hg or not hd:
        return []
    top = max(p.hi[1] for p in hg)
    cx = float(np.mean([(p.lo[0] + p.hi[0]) / 2 for p in hd]))
    y0, y1, hw, n = top - 0.14 * H, top - 0.055 * H, 0.032 * H, 16
    front = np.full((n, n), -np.inf)
    owner = np.full((n, n), -1)
    for k, p in enumerate(hg):
        v = verts_gl(p.o)
        m = (np.abs(v[:, 0] - cx) < hw) & (v[:, 1] > y0) & (v[:, 1] < y1)
        if not m.any():
            continue
        v = v[m]
        i = np.clip(((v[:, 0] - cx + hw) / (2 * hw) * n).astype(int), 0, n - 1)
        j = np.clip(((v[:, 1] - y0) / (y1 - y0) * n).astype(int), 0, n - 1)
        for a, b, z in zip(i, j, v[:, 2]):
            if z > front[a, b]:
                front[a, b], owner[a, b] = z, k
    seen = (owner >= 0).sum()
    out = [p for k, p in enumerate(hg) if seen and (owner == k).sum() >= 0.25 * seen]
    if seen:
        # what is kept whole: from under the beard to the hairline, a face's width, as deep as the ears begin
        FACE_BOX.update(cx=cx, lo=top - 0.16 * H, hi=top - 0.03 * H, hw=0.052 * H, back=float(front[owner >= 0].max()) - 0.065 * H)
    log('face: ' + ', '.join(f'{p.name} ({p.cls}, {int((owner == hg.index(p)).sum() * 100 / max(1, seen))}% of the window)' for p in out))
    return out


FACE_BOX = {}
FACE = face_parts() if OVR.get('keepFace', True) else []

# ------------------------------------------------------------------ decimate
budget_w = {p.name: (p.tris ** 0.8) * (2.6 if p.cls == 'head' else 2.4 if getattr(p, 'fingers', False) else 1.25 if p.cls == 'arm' else 0.6 if p.cls == 'cape' else 1.0) for p in P}
bw = sum(budget_w.values())
for p in P:
    want = max(6500 if getattr(p, 'fingers', False) else 1200, TARGET_TRIS * budget_w[p.name] / bw)  # fingers need the triangles
    ratio = min(1.0, want / max(1, p.tris))
    o = p.o
    bpy.context.view_layer.objects.active = o
    for q in scene.objects:
        q.select_set(q is o)
    if p in FACE and ratio < 0.98:
        # the face itself keeps every triangle it was sculpted with; the rest of its part (the neck, the ears, the
        # scalp, the back of the head) is thinned like anything else
        me = o.data
        co = verts_gl(o)
        B = FACE_BOX
        keep = (np.abs(co[:, 0] - B['cx']) < B['hw']) & (co[:, 1] > B['lo']) & (co[:, 1] < B['hi']) & (co[:, 2] > B['back'])
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_mode(type='FACE')
        bpy.ops.mesh.select_all(action='DESELECT')
        bm = bmesh.from_edit_mesh(me)
        rest = 0
        for f in bm.faces:
            if not all(keep[v.index] for v in f.verts):
                f.select_set(True)
                rest += 1
        bmesh.update_edit_mesh(me)
        bpy.ops.mesh.decimate(ratio=max(0.08, ratio))
        bpy.ops.object.mode_set(mode='OBJECT')
        log(f'face kept: {p.name} {p.tris} -> {tri_count(o)} triangles ({p.tris - rest} of them the face, untouched)')
    elif ratio < 0.98:
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

# ------------------------------------------------------------------ the colours of a face
def iris_texels(o, img):
    """Which texels of a face's texture are its eyes' irises. Colour alone cannot say (half a beard is the grey-green
    of a hazel iris), and place alone cannot either (the sculpt's eyes are where they are). Both together can: in the
    band of the face where eyes are, the vertices of that colour gather in two small clumps, one either side of the
    nose. What the triangles around each clump are painted with is the eye."""
    if not FACE_BOX:
        return None
    me = o.data
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3].astype(np.float64)
    co = verts_gl(o)
    nl = len(me.loops)
    lv = np.zeros(nl, dtype=np.int32)
    me.loops.foreach_get('vertex_index', lv)
    uv = np.zeros(nl * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    vuv = np.zeros((len(co), 2))
    vuv[lv] = uv
    col = px[np.clip((vuv[:, 1] % 1 * h).astype(int), 0, h - 1), np.clip((vuv[:, 0] % 1 * w).astype(int), 0, w - 1)]
    lum = col @ np.array([0.3, 0.6, 0.1])
    B = FACE_BOX
    top = B['hi'] + 0.03 * H
    dx = co[:, 0] - B['cx']
    band = (co[:, 1] > top - 0.115 * H) & (co[:, 1] < top - 0.05 * H) & (np.abs(dx) > 0.006 * H) & (np.abs(dx) < 0.035 * H) & (co[:, 2] > B['back'] + 0.03 * H)
    like = band & (col[:, 1] > 0.84 * col[:, 0]) & (lum > 0.22) & (lum < 0.62)
    centres = {}
    for side in (-1, 1):
        idx = np.nonzero(like & (dx * side > 0))[0]
        if len(idx) < 6:
            continue
        # the densest clump: the vertex with most of the others within an iris' width of it
        pts = co[idx]
        d = np.linalg.norm(pts[:, None, :2] - pts[None, :, :2], axis=2)
        near = d < 0.006 * H
        best = int(near.sum(1).argmax())
        if near[best].sum() >= 6:
            centres[side] = pts[near[best]].mean(0)
    if len(centres) == 1:  # the other eye is where this one is, the other side of the nose
        (side, c), = centres.items()
        centres[-side] = np.array([2 * B['cx'] - c[0], c[1], c[2]])
    if not centres:
        return None
    R = 0.0037 * H  # an iris is about 12 mm across
    rad = np.full((h, w), np.inf)  # how far from the middle of its iris each texel is, in iris radii
    polys = [tuple(pl.loop_indices) for pl in me.polygons if len(pl.loop_indices) == 3]
    tri_v = lv[np.array(polys)]
    for c in centres.values():
        dv = np.linalg.norm(co[:, :2] - c[None, :2], axis=1)
        inv = (dv < 1.6 * R) & (np.abs(co[:, 2] - c[2]) < 0.02 * H)
        for t in np.nonzero(inv[tri_v].any(1))[0]:
            pa, pb, pc = (co[lv[i]] for i in polys[t])
            a, b_, c_ = (uv[i] * np.array([w, h]) for i in polys[t])
            x0, x1 = int(np.floor(min(a[0], b_[0], c_[0]))), int(np.ceil(max(a[0], b_[0], c_[0])))
            y0, y1 = int(np.floor(min(a[1], b_[1], c_[1]))), int(np.ceil(max(a[1], b_[1], c_[1])))
            den = (b_[1] - c_[1]) * (a[0] - c_[0]) + (c_[0] - b_[0]) * (a[1] - c_[1])
            if abs(den) < 1e-12:
                continue
            for yy in range(max(0, y0), min(h, y1 + 1)):
                for xx in range(max(0, x0), min(w, x1 + 1)):
                    qx, qy = xx + 0.5, yy + 0.5
                    l1 = ((b_[1] - c_[1]) * (qx - c_[0]) + (c_[0] - b_[0]) * (qy - c_[1])) / den
                    l2 = ((c_[1] - a[1]) * (qx - c_[0]) + (a[0] - c_[0]) * (qy - c_[1])) / den
                    if l1 >= -0.35 and l2 >= -0.35 and 1 - l1 - l2 >= -0.35:  # (a little over the edge: texels are big)
                        q3 = l1 * pa + l2 * pb + (1 - l1 - l2) * pc
                        rad[yy, xx] = min(rad[yy, xx], float(np.linalg.norm(q3[:2] - c[:2])) / R)
    log('eyes at ' + '  '.join(f'({(c[0] - B["cx"]) / H:+.3f}, {(top - c[1]) / H:.3f} below the top)' for c in centres.values()) + f': {int((rad < 1).sum())} texels')
    return rad.ravel()


def face_tone(img, spec, o=None):
    """A sculpt made from one picture often gets a face's colouring wrong in ways that make it someone else: a black
    beard comes out brown and thin, heavy brows come out faint, blue eyes come out hazel. This repaints the face's
    texture in place, by colour alone (the texture is a jumble of small islands, so nothing can be said by place):
      hair   what is clearly darker than the skin (beard, brows, lashes) is made darker still - `depth` is how much -
             and turned to this colour;
      iris   what is neither skin nor hair but grey-green and of middling brightness is an iris, and gets this one.
    Values are the texture's own (sRGB, 0..1). Set per fighter in overrides/<id>.json as "faceTone"."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    rgb = px[:, :3].astype(np.float64)
    LUM = np.array([0.3, 0.6, 0.1])
    lum = rgb @ LUM
    used = lum > 0.03
    q = (rgb[used] * 15.999).astype(int)
    key = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
    skin = rgb[used][key == np.bincount(key).argmax()].mean(0)  # the commonest colour of a face is its skin
    ls = float(skin @ LUM)
    out = rgb.copy()
    n_hair = n_iris = 0
    eye = np.zeros(len(rgb), dtype=bool)
    if 'iris' in spec:
        iris = np.array(spec['iris'], dtype=np.float64)
        m = iris_texels(o, img) if o is not None else None
        if m is not None:
            # A disc the size of an iris, painted the colour as given: darker at its rim, a pupil in the middle, a
            # little of the sculpt's own shading kept; lashes that cross it (dark) stay lashes.
            disc = np.clip((1.0 - m) / 0.2, 0, 1) * used
            # (the lids that cover the top and the bottom of an iris are skin, and stay skin)
            lid = np.clip(((rgb[:, 0] - rgb[:, 1]) / np.maximum(rgb[:, 0], 1e-4) - 0.14) / 0.06, 0, 1) * (lum > 0.4)
            wgt = disc * (1 - lid) * np.clip((lum - 0.12) / 0.1, 0, 1) * float(spec.get('irisMix', 0.9))
            mid = float(np.median(lum[disc > 0.5])) if (disc > 0.5).any() else 0.4
            shade = np.clip(lum / max(mid, 1e-4), 0.8, 1.1) * (1 - 0.3 * np.clip((m - 0.7) / 0.3, 0, 1))
            out = out * (1 - wgt)[:, None] + iris[None, :] * shade[:, None] * wgt[:, None]
            out = out * (1 - 0.75 * np.clip((0.38 - m) / 0.12, 0, 1) * used)[:, None]
            n_iris = int((wgt > 0.4).sum())
            eye = m < 1.8  # ... and the eye is left out of the darkening below (lashes are dark enough as they are)
    if 'hair' in spec:
        hair = np.array(spec['hair'], dtype=np.float64)
        depth = float(spec.get('depth', 1.8))
        k = np.clip(lum / ls, 1e-4, 1.0)
        sm = np.clip((0.8 - k) / 0.3, 0.0, 1.0)
        sm = sm * sm * (3 - 2 * sm)  # 0 on skin and its shading, 1 on what is plainly hair
        sm[~used | eye] = 0
        tone = out * (1 - sm * (1 - k ** (depth - 1)))[:, None]
        l2 = tone @ LUM
        t = (sm * float(spec.get('hairMix', 0.8)))[:, None]
        out = tone * (1 - t) + (hair[None, :] / float(hair @ LUM)) * l2[:, None] * t
        n_hair = int((sm > 0.5).sum())
    px[:, :3] = np.clip(out, 0, 1).astype(np.float32)
    img.pixels.foreach_set(px.ravel())
    img.update()
    log(f'face tone: {img.name} skin {[round(float(x), 2) for x in skin]}, {n_hair} hair texels, {n_iris} iris texels of {int(used.sum())}')


if OVR.get('faceTone') and FACE:
    for p in FACE:
        for mat in p.o.data.materials:
            bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if mat and mat.use_nodes else None
            img = find_image(bsdf.inputs['Base Color']) if bsdf else None
            if img:
                face_tone(img, OVR['faceTone'], p.o)

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
