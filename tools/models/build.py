"""Blender (headless): turn a Tripo part-segmented character GLB (static, ~2M tris, fighting-stance pose)
into a light, rigged GLB the game can animate.

  blender -b --factory-startup -P tools/models/build.py -- <src.glb> <out.glb> [--tris 75000] [--debug <dir>] [--overrides <json>]

Pipeline: import -> classify parts (torso / head / arms / legs / shoes / accessories) from their contact
interfaces -> fit the 17-joint game skeleton to the pose -> decimate -> rebuild light materials (base colour +
normal, scalar roughness) -> skin weights (rigid per bone, smooth blend across each joint) -> export Draco GLB.

All analysis is done in glTF space: +X = character's left, +Y = up, +Z = front (same as the game rig).
Overrides JSON (optional): {"joints": {"kneeR": [x, y, z]}, "parts": {"tripo_part_5": "armR"}, "headYaw": 0}
"""
import heapq
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


TARGET_TRIS = int(opt('--tris', 110000))
DEBUG = opt('--debug')
OVR = {}
if opt('--overrides') and os.path.exists(opt('--overrides')):
    with open(opt('--overrides'), encoding='utf8') as f:
        OVR = json.load(f)
NAME = os.path.splitext(os.path.basename(OUT))[0]

BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
         'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
PARENT = {'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
          'armL': 'chest', 'foreL': 'armL', 'handL': 'foreL', 'armR': 'chest', 'foreR': 'armR', 'handR': 'foreR',
          'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL', 'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR'}


def log(*a):
    print('@@', *a, flush=True)


def to_gl(a):  # Blender (x, y, z) array -> glTF (x, z, -y)
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)


def to_bl(p):  # glTF point -> Blender Vector
    return Vector((float(p[0]), float(-p[2]), float(p[1])))


def norm(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ import
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene
parts = sorted([o for o in scene.objects if o.type == 'MESH'], key=lambda o: o.name)
for o in parts:  # bake transforms, drop the ROOT empty
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world.identity()
    o.data.transform(mw)
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
        self.vol = float(np.prod(self.hi - self.lo))
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

# ------------------------------------------------------------------ fit the skeleton
J = {}
fn = iface(torso, head)
head_c = (head.lo + head.hi) / 2
# The whole head (skull, jaw, chin, beard, hair) is rigid: it turns about the centre of the collar opening, so
# the neck stub stays tucked inside the shirt and the face is never stretched between two bones.
collar = fn['c'] if fn else np.array([head_c[0], head.lo[1] + 0.03 * H, head_c[2] - 0.05 * H])
J['head'] = collar
J['neck'] = collar + np.array([0, -0.035 * H, -0.012 * H])
head_top = np.array([head_c[0], max(p.hi[1] for p in head_group), head_c[2]])  # caps and headphones count


def geodesic_line(pts, start, radius, nbins=14):
    """Centre line of a limb point cloud: bin the points by graph distance from `start`."""
    n = len(pts)
    tree = KDTree(n)
    for k, p in enumerate(pts):
        tree.insert(Vector(p), k)
    tree.balance()
    dist = np.full(n, np.inf)
    heap = []
    for _, k, d in tree.find_range(Vector(start), radius * 2.5):
        dist[k] = d
        heapq.heappush(heap, (d, k))
    if not heap:
        _, k, d = tree.find(Vector(start))
        dist[k] = d
        heapq.heappush(heap, (d, k))
    while heap:
        d, k = heapq.heappop(heap)
        if d > dist[k]:
            continue
        for _, m, e in tree.find_range(Vector(pts[k]), radius):
            nd = d + e
            if nd < dist[m]:
                dist[m] = nd
                heapq.heappush(heap, (nd, m))
    ok = np.isfinite(dist)
    gmax = dist[ok].max()
    line = []
    for b in range(nbins):
        sel = ok & (dist >= gmax * b / nbins) & (dist < gmax * (b + 1) / nbins + 1e-9)
        if sel.sum() >= 3:
            line.append(pts[sel].mean(0))
    return np.array(line)


def bend_point(line, a, b, default_t):
    """Point of the polyline `line` farthest from the chord a-b (the elbow / knee)."""
    ab = b - a
    L = np.linalg.norm(ab)
    best, bd = None, 0.02 * H
    for p in line:
        t = np.dot(p - a, ab) / (L * L)
        if 0.15 < t < 0.85:
            d = np.linalg.norm(p - (a + ab * t))
            if d > bd:
                best, bd = p, d
    return best if best is not None else a + ab * default_t


def along(line, t):
    seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    x = t * cum[-1]
    i = int(np.clip(np.searchsorted(cum, x) - 1, 0, len(seg) - 1))
    f = (x - cum[i]) / max(seg[i], 1e-9)
    return line[i] + (line[i + 1] - line[i]) * f


for s in ('L', 'R'):
    comp = [p for p in P if p.cls == 'arm' and p.side == s]
    assert comp, f'no arm parts on side {s}'
    sleeve = max(comp, key=lambda p: (iface(torso, p) or {'n': 0})['n'])
    hole = iface(torso, sleeve)
    start = hole['c'] if hole else sleeve.c
    rad = hole['r'] if hole else 0.07 * H
    J['arm' + s] = start + 0.35 * rad * norm(J['neck'] - start)
    cloud = np.concatenate([p.s[:: max(1, len(p.s) // 5000)] for p in comp])
    line = geodesic_line(cloud, start, 0.028 * H, nbins=26)
    tip = line[-1] + 0.6 * (line[-1] - line[-2])
    line = np.vstack([J['arm' + s], line[1:], tip])
    elbow = bend_point(line, J['arm' + s], tip, 0.42)
    J['fore' + s] = elbow
    k = int(np.argmin(np.linalg.norm(line - elbow, axis=1)))
    lower = np.vstack([elbow, line[k + 1:]]) if k + 1 < len(line) else np.vstack([elbow, tip])
    J['hand' + s] = along(lower, 0.72)
    J['tip' + s] = tip

leg_parts = [p for p in P if p.cls == 'leg']
TEMPLATE_KNEE = {'L': np.array([0.196, 0.26, 0.097]) * H, 'R': np.array([-0.204, 0.273, -0.15]) * H}
TEMPLATE_HIP = {'L': np.array([0.105, 0.44, -0.05]) * H, 'R': np.array([-0.077, 0.44, -0.133]) * H}
for s, shoe in (('L', shoeL), ('R', shoeR)):
    cands = [(iface(shoe, p), p) for p in leg_parts if iface(shoe, p)]
    if cands:
        f, shin_part = max(cands, key=lambda x: x[0]['n'])
        J['foot' + s] = f['c'] + np.array([0, -0.022 * H, 0])
    else:
        top = shoe.s[shoe.s[:, 1] > shoe.hi[1] - 0.02 * H]
        J['foot' + s] = top.mean(0) + np.array([0, -0.03 * H, 0])
    # toe: far end of the shoe's footprint
    d = shoe.s[:, [0, 2]] - J['foot' + s][[0, 2]]
    far = shoe.s[np.argsort((d ** 2).sum(1))[-max(8, len(d) // 60):]]
    J['toe' + s] = np.array([far[:, 0].mean(), shoe.lo[1] + 0.03 * H, far[:, 2].mean()])
    # knee: a thigh|shin cut near the template, else the bend of the leg's centre line
    best = None
    for a in range(len(leg_parts)):
        for b in range(a + 1, len(leg_parts)):
            f = iface(leg_parts[a], leg_parts[b])
            if f and f['r'] > 0.03 * H and f['n'] >= 80:
                d = np.linalg.norm(f['c'] - TEMPLATE_KNEE[s])
                if d < 0.11 * H and (best is None or d < best[0]):
                    best = (d, f['c'])
    J['shin' + s] = best[1] if best else None

# hips from the torso|leg cuts
cuts = [(iface(torso, p), p) for p in leg_parts if iface(torso, p) and iface(torso, p)['n'] >= 80]
for s in ('L', 'R'):
    near = [(np.linalg.norm(f['c'] - TEMPLATE_HIP[s]), f) for f, _ in cuts]
    near = [x for x in near if x[0] < 0.13 * H]
    J['thigh' + s] = min(near, key=lambda x: x[0])[1]['c'].copy() if near else None
if J['thighL'] is not None and J['thighR'] is not None and np.linalg.norm(J['thighL'] - J['thighR']) > 0.09 * H:
    mid = (J['thighL'] + J['thighR']) / 2
    for s in ('L', 'R'):
        c = J['thigh' + s]
        J['thigh' + s] = c + np.array([0, 0.04 * H, 0]) + 0.22 * (mid - c) * np.array([1, 0, 1])
else:  # merged pants: one waist ring (or nothing usable) -> place the hip joints from the template pelvis
    ring = cuts[0][0]['c'] if cuts else (TEMPLATE_HIP['L'] + TEMPLATE_HIP['R']) / 2 + np.array([0, 0.03 * H, 0])
    pel = np.array([ring[0], min(ring[1] - 0.03 * H, 0.445 * H), ring[2]])
    half = (TEMPLATE_HIP['L'] - TEMPLATE_HIP['R']) / 2
    J['thighL'], J['thighR'] = pel + half, pel - half
for s in ('L', 'R'):
    if J['shin' + s] is None:
        cloud = np.concatenate([p.s[:: max(1, len(p.s) // 3000)] for p in leg_parts])
        midx = (J['thighL'][0] + J['thighR'][0]) / 2
        side = cloud[(cloud[:, 0] > midx) == (s == 'L')]
        line = geodesic_line(side, J['foot' + s], 0.03 * H)
        J['shin' + s] = bend_point(line, J['foot' + s], J['thigh' + s], 0.45)
J['hips'] = (J['thighL'] + J['thighR']) / 2 + np.array([0, 0.015 * H, 0])
J['spine'] = J['hips'] + 0.11 * (J['neck'] - J['hips'])
J['chest'] = J['hips'] + 0.44 * (J['neck'] - J['hips'])
for k, v in OVR.get('joints', {}).items():
    J[k] = np.array(v, dtype=np.float64)
for k in BONES + ['tipL', 'tipR', 'toeL', 'toeR']:
    log(f'joint {k:7s} ({J[k][0]:+.3f}, {J[k][1]:.3f}, {J[k][2]:+.3f})')

END = {'hips': J['spine'], 'spine': J['chest'], 'chest': J['neck'], 'neck': J['head'], 'head': head_top,
       'armL': J['foreL'], 'foreL': J['handL'], 'handL': J['tipL'], 'armR': J['foreR'], 'foreR': J['handR'], 'handR': J['tipR'],
       'thighL': J['shinL'], 'shinL': J['footL'], 'footL': J['toeL'], 'thighR': J['shinR'], 'shinR': J['footR'], 'footR': J['toeR']}
chest_top = J['chest'] + 0.8 * (J['neck'] - J['chest'])
SEGS = {b: [(J[b], END[b])] for b in BONES}
SEGS['hips'].append((J['thighR'], J['thighL']))
SEGS['chest'] += [(chest_top, J['armL']), (chest_top, J['armR'])]

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
    if nrm:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = nrm
        nrm.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    o.data.materials.clear()
    o.data.materials.append(mat)
    log(f'material {p.name:20s} base={tuple(base.size) if base else None} normal={tuple(nrm.size) if nrm else None} rough={rough:.2f}')

# ------------------------------------------------------------------ skin weights
BI = {b: i for i, b in enumerate(BONES)}


def seg_dist(v, a, b):
    ab = b - a
    t = np.clip(((v - a) @ ab) / max(float(ab @ ab), 1e-12), 0, 1)
    return np.linalg.norm(v - (a + np.outer(t, ab)), axis=1)


def bone_dist(v, bone):
    return np.min([seg_dist(v, a, b) for a, b in SEGS[bone]], axis=0)


# (parent, child, radius): weights blend across the joint between the two bones
JOINTS = [('hips', 'spine', 0.06), ('spine', 'chest', 0.07)]
for s in ('L', 'R'):
    JOINTS += [('chest', 'arm' + s, 0.045), ('arm' + s, 'fore' + s, 0.026), ('fore' + s, 'hand' + s, 0.018),
               ('hips', 'thigh' + s, 0.055), ('thigh' + s, 'shin' + s, 0.032), ('shin' + s, 'foot' + s, 0.022)]
HUB = {('chest', 'armL'), ('chest', 'armR'), ('hips', 'thighL'), ('hips', 'thighR')}
TRUNK = {('hips', 'spine'), ('spine', 'chest')}


def owners_for(p, v):
    if p.cls in ('torso', 'torso2'):
        cand = ['hips', 'spine', 'chest', 'thighL', 'thighR']
    elif p.cls in ('head', 'headacc'):
        return ['head']
    elif p.cls == 'arm':
        cand = ['arm' + p.side, 'fore' + p.side, 'hand' + p.side]
    elif p.cls == 'leg':
        cand = ['hips', 'thighL', 'shinL', 'thighR', 'shinR']
    elif p.cls == 'shoe':
        return ['foot' + p.side]
    else:  # small accessory: ride on the single nearest bone
        d = [float(bone_dist(p.c[None, :], b)[0]) for b in BONES]
        return [BONES[int(np.argmin(d))]]
    d = np.stack([bone_dist(v, b) for b in cand], axis=1)
    near = d.argmin(1)
    share = np.bincount(near, minlength=len(cand)) / len(v)
    keep = [c for c, sh in zip(cand, share) if sh >= 0.04]
    return keep or [cand[int(share.argmax())]]


stats = np.zeros(len(BONES))
for p in P:
    o = p.o
    v = verts_gl(o)
    own = owners_for(p, v)
    d = np.stack([bone_dist(v, b) for b in own], axis=1)
    prim = np.array([BI[b] for b in own])[d.argmin(1)]
    W = np.zeros((len(v), len(BONES)))
    W[np.arange(len(v)), prim] = 1.0
    rigid = p.cls in ('head', 'headacc', 'acc')
    if not rigid:
        for A, B, R in JOINTS:
            a, b = BI[A], BI[B]
            sel = (prim == a) | (prim == b)
            if not sel.any():
                continue
            R = R * H
            c = J[B]
            dB = norm(END[B] - c)
            axis = dB if (A, B) in HUB else norm(norm(c - J[A]) + dB)
            if np.linalg.norm(axis) < 0.5:
                axis = dB
            x = v[sel] - c
            sB = smooth(-1, 1, (x @ axis) / R)
            fall = 1.0 if (A, B) in TRUNK else 1 - smooth(2.4 * R, 4.0 * R, np.linalg.norm(x, axis=1))
            pa = prim[sel] == a
            idx = np.where(sel)[0]
            # vertices owned by the parent hand part of their weight to the child, and vice versa
            give = np.where(pa, sB * fall, (1 - sB) * fall)
            tgt = np.where(pa, b, a)
            src = np.where(pa, a, b)
            take = np.minimum(give, W[idx, src])
            W[idx, src] -= take
            W[idx, tgt] += take
    W /= W.sum(1, keepdims=True)
    # at most 4 influences
    order = np.argsort(-W, axis=1)[:, :4]
    top = np.take_along_axis(W, order, axis=1)
    top /= top.sum(1, keepdims=True)
    for vg in list(o.vertex_groups):
        o.vertex_groups.remove(vg)
    groups = {}
    for i in range(len(v)):
        for k in range(4):
            w = float(top[i, k])
            if w > 0.01:
                bi = int(order[i, k])
                g = groups.get(bi)
                if g is None:
                    g = groups[bi] = o.vertex_groups.new(name=BONES[bi])
                g.add([i], w, 'REPLACE')
                stats[bi] += w
    log(f'weights {p.name:20s} owners={own} verts={len(v)}')
    if DEBUG:  # colour by primary bone for the debug render
        col = o.data.color_attributes.new('bone', 'FLOAT_COLOR', 'POINT')
        pal = np.array([[(i * 0.37) % 1, (i * 0.61 + 0.3) % 1, (i * 0.83 + 0.6) % 1, 1] for i in range(len(BONES))])
        col.data.foreach_set('color', (W @ pal).astype(np.float32).ravel())
        o.data.color_attributes.active_color = col
log('bone weight totals', {b: int(stats[i]) for i, b in enumerate(BONES)})

# ------------------------------------------------------------------ armature
arm = bpy.data.armatures.new(NAME + '_rig')
ao = bpy.data.objects.new(NAME + '_rig', arm)
scene.collection.objects.link(ao)
bpy.context.view_layer.objects.active = ao
for q in scene.objects:
    q.select_set(q is ao)
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for b in BONES:
    e = arm.edit_bones.new(b)
    e.head = to_bl(J[b])
    tail = to_bl(END[b])
    if (tail - e.head).length < 0.02:
        tail = e.head + Vector((0, 0, 0.03))
    e.tail = tail
    eb[b] = e
for b, par in PARENT.items():
    eb[b].parent = eb[par]
    eb[b].use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
for p in P:
    p.o.parent = ao
    m = p.o.modifiers.new('rig', 'ARMATURE')
    m.object = ao
# everything the game needs to retarget its poses onto this skeleton
ao['skrig'] = json.dumps({
    'height': round(float(H), 4),
    'joints': {b: [round(float(x), 4) for x in J[b]] for b in BONES},
    'tips': {k: [round(float(x), 4) for x in J[k]] for k in ('tipL', 'tipR', 'toeL', 'toeR')},
    'headTop': [round(float(x), 4) for x in head_top],
    'headYaw': OVR.get('headYaw', 0),
    'sole': round(float(min(shoeL.lo[1], shoeR.lo[1])), 4),
})

# ------------------------------------------------------------------ debug renders
if DEBUG:
    os.makedirs(DEBUG, exist_ok=True)
    mk = bpy.data.materials.new('mk')
    markers = []
    for b in BONES:
        a, c = to_bl(J[b]), to_bl(END[b])
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.012, location=a, segments=10, ring_count=6)
        s = bpy.context.active_object
        s.color = (1, 1, 0, 1)
        markers.append(s)
        d = c - a
        if d.length > 1e-4:
            bpy.ops.mesh.primitive_cylinder_add(radius=0.004, depth=d.length, location=(a + c) / 2, vertices=6)
            cy = bpy.context.active_object
            cy.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
            cy.color = (1, 0.1, 0.1, 1)
            markers.append(cy)
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = 760, 900
    scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.2, 0.2, 0.23)
    sh = scene.display.shading
    sh.light = 'STUDIO'
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = 1.22
    cam = bpy.data.objects.new('cam', cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    ao.hide_render = True
    for mode in ('skel', 'bone'):
        if mode == 'skel':
            sh.color_type = 'OBJECT'
            sh.show_xray = True
            sh.xray_alpha = 0.35
            for p in P:
                p.o.color = (0.75, 0.75, 0.8, 1)
        else:
            sh.show_xray = False
            sh.color_type = 'VERTEX'
            for s in markers:
                s.hide_render = True
        for vn, (dx, dy) in {'front': (0, -1), 'left': (1, 0), 'back': (0, 1), 'right': (-1, 0)}.items():
            cam.location = Vector((dx * 4, dy * 4, 0.5))
            cam.rotation_euler = (Vector((0, 0, 0.5)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = os.path.join(DEBUG, f'{NAME}_{mode}_{vn}.png')
            bpy.ops.render.render(write_still=True)
    for s in markers:
        bpy.data.objects.remove(s)
    bpy.data.objects.remove(cam)
    for p in P:
        p.o.data.color_attributes.remove(p.o.data.color_attributes['bone'])

# ------------------------------------------------------------------ export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
kw = dict(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=82,
          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
          export_draco_position_quantization=14, export_draco_normal_quantization=10,
          export_draco_texcoord_quantization=12, export_draco_generic_quantization=12,
          export_skins=True, export_animations=False, export_extras=True, export_yup=True, export_apply=False,
          export_tangents=False, export_cameras=False, export_lights=False, export_morph=False,
          export_influence_nb=4, export_all_influences=False, export_vertex_color='NONE', export_materials='EXPORT')
bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})
log(f'exported {OUT} {os.path.getsize(OUT) / 1e6:.2f} MB')
