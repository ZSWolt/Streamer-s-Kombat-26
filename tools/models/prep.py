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
head_group = [p for p in P if p.c[1] > 0.74 * H]
head = max(head_group, key=lambda p: p.tris)
head.cls = 'head'
for p in head_group:
    if p is not head:
        p.cls = 'headacc'
# torso: the chest-height part the neck goes into (a wide trouser leg can have a bigger bounding box)
band = [p for p in P if p.cls is None and 0.42 * H < p.c[1] < 0.76 * H]
torso = max(band, key=lambda p: ((iface(head, p) or {'n': 0})['n'], p.tris))
torso.cls = 'torso'
shoes = sorted([p for p in P if p.cls is None and p.hi[1] < 0.17 * H], key=lambda p: p.c[0])
assert len(shoes) >= 2, 'expected two shoe parts'
shoeR, shoeL = shoes[0], shoes[-1]
shoeR.cls, shoeR.side, shoeL.cls, shoeL.side = 'shoe', 'R', 'shoe', 'L'
for extra in shoes[1:-1]:
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
for name, cls in OVR.get('parts', {}).items():  # manual fixes
    p = byname[name]
    if cls in ('armL', 'armR'):
        p.cls, p.side = 'arm', cls[-1]
    else:
        p.cls, p.side = cls, None
for p in P:
    log(f'part {p.name:20s} {p.cls:8s}{p.side or " "} tris={p.tris:7d} c=({p.c[0]:+.3f},{p.c[1]:.3f},{p.c[2]:+.3f})')

# ------------------------------------------------------------------ decimate
budget_w = {p.name: (p.tris ** 0.8) * (2.6 if p.cls == 'head' else 1.25 if p.cls == 'arm' else 1.0) for p in P}
bw = sum(budget_w.values())
for p in P:
    want = max(1200, TARGET_TRIS * budget_w[p.name] / bw)
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
for p in P:
    o = p.o
    old = o.data.materials[0] if o.data.materials else None
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
    big = p.cls in ('head', 'torso')
    shrink(base, 1024 if big else 512)
    shrink(nrm, 512 if big else 256)
    mat = bpy.data.materials.new('m_' + p.name.replace('tripo_part_', ''))
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
    o.data.materials.clear()
    o.data.materials.append(mat)
    o['cls'] = p.cls
    o['side'] = p.side or ''
    log(f'material {p.name:20s} base={tuple(base.size) if base else None} normal={tuple(nrm.size) if nrm else None} rough={rough:.2f}')

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
np.savez_compressed(os.path.join(CACHE, NAME + '.npz'), **{p.name: p.s.astype(np.float32) for p in P})
meta = {
    'height': float(H),
    'parts': {p.name: {'cls': p.cls, 'side': p.side, 'tris': p.tris, 'lo': p.lo.tolist(), 'hi': p.hi.tolist()} for p in P},
    'interfaces': [{'a': a, 'b': b, 'c': f['c'].tolist(), 'r': f['r'], 'n': f['n']} for (a, b), f in IF.items() if a < b],
}
with open(os.path.join(CACHE, NAME + '.json'), 'w', encoding='utf8') as f:
    json.dump(meta, f, indent=1)
blend = os.path.abspath(os.path.join(CACHE, NAME + '.blend'))
bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
log(f'cached {blend} {os.path.getsize(blend) / 1e6:.1f} MB')
