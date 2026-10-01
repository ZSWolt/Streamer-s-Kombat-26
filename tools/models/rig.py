"""Blender (headless), stage 2 of the model build: skeleton, neutral pose, skin, export.

  blender -b --factory-startup -P tools/models/rig.py -- <cache_dir> <id> <out.glb> [--debug <dir>] [--overrides <json>] [--stage fit|all]

The sculpts come in a deep fighting crouch. A character that can only ever be shown in that crouch looks wrong
the moment it stands, kicks or celebrates, so this stage:
  1. fits the game's 17 joints to the sculpt (anatomical priors + the part geometry),
  2. skins the sculpt and straightens it into a neutral standing A-pose (dual-quaternion skinning + corrective
     smoothing), which becomes the model's rest pose,
  3. skins the neutral body again for the game (linear blend skinning, 4 influences),
  4. exports a Draco GLB whose armature carries `skrig` (joints of the rest pose, tips, proportions).

All analysis is done in glTF space: +X = character's left, +Y = up, +Z = front (same as the game rig).
Overrides JSON (optional):
  {"joints": {"armL": [x, y, z]},      joint positions on the sculpt (glTF space, model height = 1)
   "parts": {"tripo_part_5": "armR"},  part classes (torso torso2 head headacc armL armR leg shoe acc)
   "headYaw": 0, "headPitch": 0,       how the sculpted head is turned (radians)
   "hipWidth": 0.13, "upperArm": 0.9}  anatomical priors (see fit)
"""
import heapq
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
CACHE, NAME, OUT = argv[0], argv[1], argv[2]


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


DEBUG = opt('--debug')
STAGE = opt('--stage', 'all')
OVR = {}
if opt('--overrides') and os.path.exists(opt('--overrides')):
    with open(opt('--overrides'), encoding='utf8') as f:
        OVR = json.load(f)

BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
         'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
PARENT = {'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
          'armL': 'chest', 'foreL': 'armL', 'handL': 'foreL', 'armR': 'chest', 'foreR': 'armR', 'handR': 'foreR',
          'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL', 'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR'}
BI = {b: i for i, b in enumerate(BONES)}
A_POSE = math.radians(40)  # rest pose: arms this far from hanging straight down


def log(*a):
    print('@@', *a, flush=True)


def to_gl(a):  # Blender (x, y, z) array -> glTF (x, z, -y)
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)


def to_bl_arr(a):  # glTF array -> Blender
    return np.stack([a[:, 0], -a[:, 2], a[:, 1]], axis=1)


def to_bl(p):  # glTF point -> Blender Vector
    return Vector((float(p[0]), float(-p[2]), float(p[1])))


def norm(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def kd(pts):
    t = KDTree(len(pts))
    for k, p in enumerate(pts):
        t.insert(Vector(p), k)
    t.balance()
    return t


# ------------------------------------------------------------------ load the cache
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(os.path.join(CACHE, NAME + '.blend')))
scene = bpy.context.scene
with open(os.path.join(CACHE, NAME + '.json'), encoding='utf8') as f:
    meta = json.load(f)
SAMPLES = np.load(os.path.join(CACHE, NAME + '.npz'))
H = meta['height']
for name, cls in OVR.get('parts', {}).items():
    m = meta['parts'][name]
    m['cls'], m['side'] = ('arm', cls[-1]) if cls in ('armL', 'armR') else (cls, None)


def verts_gl(o):
    n = len(o.data.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    o.data.vertices.foreach_get('co', co)
    return to_gl(co.reshape(-1, 3)).astype(np.float64)


def set_verts_gl(o, v):
    o.data.vertices.foreach_set('co', to_bl_arr(v).astype(np.float32).ravel())
    o.data.update()


class Part:
    def __init__(self, o):
        m = meta['parts'][o.name]
        self.o, self.name = o, o.name
        self.cls, self.side = m['cls'], m['side']
        self.s = SAMPLES[o.name].astype(np.float64)
        self.lo, self.hi, self.c = self.s.min(0), self.s.max(0), self.s.mean(0)


def dominant_uv(o, bm, uv, faces):
    """UV of a texel showing the part's most common colour."""
    mat = o.data.materials[0] if o.data.materials else None
    img = None
    if mat and mat.use_nodes:
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf and bsdf.inputs['Base Color'].is_linked:
            n = bsdf.inputs['Base Color'].links[0].from_node
            img = n.image if n.type == 'TEX_IMAGE' else None
    if img is None or not img.size[0]:
        return None
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    uvs = np.array([l[uv].uv[:] for f in list(faces)[::7] for l in f.loops])
    if len(uvs) < 10:
        return None
    col = px[np.clip((uvs[:, 1] % 1 * h).astype(int), 0, h - 1), np.clip((uvs[:, 0] % 1 * w).astype(int), 0, w - 1)]
    # the densest colour: the texel whose colour has most neighbours in colour space
    q = (col * 7.999).astype(int)
    key = q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2]
    mode = np.bincount(key, minlength=512).argmax()
    pick = np.nonzero(key == mode)[0]
    best = pick[int(np.argmin(np.linalg.norm(col[pick] - col[pick].mean(0), axis=1)))]
    from mathutils import Vector as V2
    return V2((float(uvs[best, 0]), float(uvs[best, 1])))


def fill_holes(o):
    """Tripo's parts are only the surfaces that were visible in the sculpt: wherever an arm lay against the ribs
    or the belly on the thighs there is a hole, and every sleeve, hem and cuff is open. Posed any other way the
    holes show. Close them all; a patch takes the colour of the rim it grows from."""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    mark = bm.verts.layers.int.new('patch')  # (a new layer invalidates element references: make it first)
    rimn = bm.verts.layers.float_vector.new('rimn')
    lid = bm.faces.layers.int.new('lid')  # the faces made here, so a later stage can take some away again
    uv = bm.loops.layers.uv.active
    n_rim = sum(1 for e in bm.edges if e.is_boundary)
    if not n_rim:
        bm.free()
        return 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # a rim can only be walked if the faces around it agree
    bm.normal_update()
    for e in bm.edges:  # the open rims, and which way the surface faces there (see Surface.rim_pairs)
        if e.is_boundary:
            for v in e.verts:
                v[rimn] = v.normal
    old = set(bm.faces)
    rim_uv = {}
    for _ in range(4):
        # a vertex where two holes touch has four rim edges: split it so every rim is a simple ring
        for v in list(bm.verts):
            be = [e for e in v.link_edges if e.is_boundary]
            if len(be) > 2:
                bmesh.utils.vert_separate(v, be)
        nxt = {}
        for e in bm.edges:
            if not e.is_boundary:
                continue
            l = e.link_loops[0]
            a, b = l.vert, l.link_loop_next.vert  # the face runs a -> b here, so the patch must run b -> a
            nxt.setdefault(b, []).append(a)
            if uv:
                rim_uv.setdefault(a, l[uv].uv.copy())
                rim_uv.setdefault(b, l.link_loop_next[uv].uv.copy())
        if not nxt:
            break
        made, caps = 0, []

        def close(ring):
            if len(ring) < 3:
                return 0
            try:
                caps.append(bm.faces.new(ring))
                return 1
            except ValueError:
                return 0

        for start in list(nxt):
            while nxt.get(start):
                ring, pos = [start], {start: 0}
                cur = nxt[start].pop()
                while True:
                    if cur in pos:  # came back onto the walk: everything since is one closed ring
                        i = pos[cur]
                        made += close(ring[i:])
                        for v in ring[i + 1:]:
                            del pos[v]
                        ring = ring[:i + 1]
                        if i == 0:
                            break
                    else:
                        pos[cur] = len(ring)
                        ring.append(cur)
                    if not nxt.get(cur):
                        break
                    cur = nxt[cur].pop()
        if not made:
            break
        bmesh.ops.triangulate(bm, faces=caps)
    capset = {f for f in bm.faces if f not in old}
    if uv:
        # the rim itself is no guide to colour (it lay in a crease, so its texture is baked shadow):
        # paint the patches in the part's dominant colour instead
        c = dominant_uv(o, bm, uv, old)
        for f in capset:
            for l in f.loops:
                l[uv].uv = c if c is not None else next((rim_uv[v] for v in f.verts if v in rim_uv), l[uv].uv)
    # long patch triangles would deform as flat shards: cut them up so they bend with the body
    for _ in range(3):
        inner = [e for e in bm.edges if len(e.link_faces) == 2 and all(f in capset for f in e.link_faces) and e.calc_length() > 0.04 * H]
        if not inner:
            break
        before = set(bm.faces)
        bmesh.ops.subdivide_edges(bm, edges=inner, cuts=1)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
        capset = {f for f in (capset | (set(bm.faces) - before)) if f.is_valid}
    # relax the patches into taut membranes between their rims (limbs are rounded out later: round_limb_patches)
    inside = [v for v in bm.verts if v.link_faces and all(f in capset for f in v.link_faces)]
    for _ in range(12):
        if inside:
            bmesh.ops.smooth_vert(bm, verts=inside, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in inside:  # patch vertices take their skin weights from the rim (see compute_weights)
        v[mark] = 1
    for f in capset:
        if f.is_valid:
            f[lid] = 1
    n = len(capset)
    left = sum(1 for e in bm.edges if e.is_boundary)
    print('@@ holes', o.name, 'rim edges', n_rim, '->', left, 'patch faces', n, flush=True)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()
    return n


for o in [o for o in scene.objects if o.type == 'MESH']:
    fill_holes(o)
P = [Part(o) for o in sorted([o for o in scene.objects if o.type == 'MESH'], key=lambda o: o.name)]
byname = {p.name: p for p in P}
IF = {}
for f in meta['interfaces']:
    IF[(f['a'], f['b'])] = IF[(f['b'], f['a'])] = {'c': np.array(f['c']), 'r': f['r'], 'n': f['n']}


def iface(a, b):
    return IF.get((a.name, b.name))


head = next(p for p in P if p.cls == 'head')
head_group = [p for p in P if p.cls in ('head', 'headacc')]
torso = next(p for p in P if p.cls == 'torso')
shoe = {p.side: p for p in P if p.cls == 'shoe'}
leg_parts = [p for p in P if p.cls == 'leg']
log(f'{NAME}: {len(P)} parts, height {H:.3f}')


# ------------------------------------------------------------------ geometry helpers
def geodesic(pts, tree, start, radius, bridge=False, seed=None):
    """Graph distance over a point cloud (points closer than `radius` are neighbours) from the points around `start`
    (everything within `seed` of it: the whole rim of a wide opening, not one spot on it)."""
    dist = np.full(len(pts), np.inf)
    heap = []
    reach = max(radius * 2.5, seed or 0)
    for _, k, d in tree.find_range(Vector(start), reach):
        dist[k] = max(0.0, d - (seed or 0)) if seed else d
        heapq.heappush(heap, (dist[k], k))
    if not heap:
        _, k, d = tree.find(Vector(start))
        dist[k] = d
        heapq.heappush(heap, (d, k))
    while True:
        while heap:
            d, k = heapq.heappop(heap)
            if d > dist[k]:
                continue
            for _, m, e in tree.find_range(Vector(pts[k]), radius):
                nd = d + e
                if nd < dist[m]:
                    dist[m] = nd
                    heapq.heappush(heap, (nd, m))
        if not bridge:
            break
        lost = np.nonzero(~np.isfinite(dist))[0]
        if not len(lost):
            break
        # parts of one limb do not always touch (a cuff sits a little way off the sleeve): hop the smallest gap
        got = np.nonzero(np.isfinite(dist))[0]
        gt = kd(pts[got])
        best = None
        for m in lost[:: max(1, len(lost) // 400)]:
            _, j, e = gt.find(Vector(pts[m]))
            if best is None or e < best[0]:
                best = (e, m, got[j])
        e, m, j = best
        if e > 0.12 * H:
            break
        dist[m] = dist[j] + e
        heapq.heappush(heap, (dist[m], m))
    return dist


def rim_of(part):
    """Vertices that lay on an open rim of the part before its holes were patched, and the surface normal there."""
    me = part.o.data
    n = np.zeros(len(me.vertices) * 3, dtype=np.float32)
    if 'rimn' in me.attributes:
        me.attributes['rimn'].data.foreach_get('vector', n)
    n = to_gl(n.reshape(-1, 3)).astype(np.float64)
    idx = np.nonzero(np.linalg.norm(n, axis=1) > 0.5)[0]
    return idx, n[idx]


def rim_pairs(a, b):
    """Where part a continues into part b: rim vertices of a lying against a rim of b. Two parts can also merely
    touch somewhere else (a fist against a shoulder leaves a hole, with a rim, in both); the cut is the place
    where most rim lies against rim, so only the largest such patch counts. -> [(vertex of a, vertex of b, distance)]"""
    ia, _ = rim_of(a)
    ib, _ = rim_of(b)
    if not len(ia) or not len(ib):
        return []
    va, vb = verts_gl(a.o), verts_gl(b.o)
    tb = kd(vb[ib])
    pairs = []
    for i in ia:
        _, j, dd = tb.find(Vector(va[i]))
        if dd < 0.02 * H:
            pairs.append((int(i), int(ib[j]), float(dd)))
    if len(pairs) < 2:
        return pairs
    pos = np.array([va[u] for u, _, _ in pairs])
    tp_ = kd(pos)
    label = -np.ones(len(pairs), dtype=int)
    groups = 0
    for k in range(len(pairs)):
        if label[k] >= 0:
            continue
        label[k] = groups
        front = [k]
        while front:
            c = front.pop()
            for _, m, _ in tp_.find_range(Vector(pos[c]), 0.035 * H):
                if label[m] < 0:
                    label[m] = groups
                    front.append(m)
        groups += 1
    keep = np.bincount(label).argmax()
    return [q for q, g in zip(pairs, label) if g == keep]


class Surface:
    """The vertices of a few parts as one graph: the parts' own mesh edges, plus stitches where two parts meet.
    Distances are measured along the surface, so a fist resting against a shoulder is still a whole arm away
    from it (a cloud of points would let the path jump across wherever two surfaces touch)."""

    def __init__(self, parts):
        self.parts = parts
        self.off, pos = {}, []
        n = 0
        for q in parts:
            v = verts_gl(q.o)
            self.off[q.name] = (n, n + len(v))
            pos.append(v)
            n += len(v)
        self.pos = np.concatenate(pos)
        self.adj = [[] for _ in range(n)]
        for q in parts:
            a0 = self.off[q.name][0]
            e = np.zeros(len(q.o.data.edges) * 2, dtype=np.int32)
            q.o.data.edges.foreach_get('vertices', e)
            e = e.reshape(-1, 2) + a0
            ln = np.linalg.norm(self.pos[e[:, 0]] - self.pos[e[:, 1]], axis=1)
            for (i, j), w in zip(e, ln):
                self.adj[i].append((j, float(w)))
                self.adj[j].append((i, float(w)))
        self.tree = kd(self.pos)
        for i in range(len(parts)):
            for j in range(i + 1, len(parts)):
                if iface(parts[i], parts[j]):
                    a0, b0 = self.off[parts[i].name][0], self.off[parts[j].name][0]
                    for u, w, dd in rim_pairs(parts[i], parts[j]):
                        self.adj[a0 + u].append((b0 + w, dd))
                        self.adj[b0 + w].append((a0 + u, dd))

    def near(self, part, centre, reach):
        a0, a1 = self.off[part.name]
        return a0 + np.nonzero(np.linalg.norm(self.pos[a0:a1] - centre, axis=1) < reach)[0]

    def distances(self, sources):
        dist = np.full(len(self.pos), np.inf)
        heap = []
        for k in sources:
            dist[k] = 0.0
            heap.append((0.0, int(k)))
        heapq.heapify(heap)
        while True:
            while heap:
                d, k = heapq.heappop(heap)
                if d > dist[k]:
                    continue
                for m, w in self.adj[k]:
                    nd = d + w
                    if nd < dist[m]:
                        dist[m] = nd
                        heapq.heappush(heap, (nd, m))
            # a part that touches no other (a cuff sitting a little way off the sleeve): hop the smallest gap
            lost = np.nonzero(~np.isfinite(dist))[0]
            got = np.nonzero(np.isfinite(dist))[0]
            if not len(lost) or not len(got):
                break
            gt = kd(self.pos[got])
            best = None
            for m in lost[:: max(1, len(lost) // 300)]:
                _, j, e = gt.find(Vector(self.pos[m]))
                if best is None or e < best[0]:
                    best = (e, m, got[j])
            e, m, j = best
            if e > 0.06 * H:
                break
            dist[m] = dist[j] + e
            heapq.heappush(heap, (dist[m], int(m)))
        return dist

    def of(self, part, values):
        a0, a1 = self.off[part.name]
        return values[a0:a1]


def centre_line(pts, dist, sel, nbins):
    """Centroids of `pts[sel]` binned by graph distance -> (arc position, point, mean radius) rows."""
    ok = sel & np.isfinite(dist)
    gmax = dist[ok].max()
    rows = []
    for b in range(nbins):
        m = ok & (dist >= gmax * b / nbins) & (dist < gmax * (b + 1) / nbins + 1e-9)
        if m.sum() >= 3:
            c = pts[m].mean(0)
            rows.append((float(dist[m].mean()), c, float(np.linalg.norm(pts[m] - c, axis=1).mean())))
    return rows


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


def seg_dist(v, a, b):
    ab = b - a
    t = np.clip(((v - a) @ ab) / max(float(ab @ ab), 1e-12), 0, 1)
    return np.linalg.norm(v - (a + np.outer(t, ab)), axis=1)


def tube_radius(pts, a, b, default, t0=0.25, t1=0.85):
    """Typical distance of `pts` from the axis a-b (ignoring anything farther than a limb could be)."""
    ab = b - a
    t = ((pts - a) @ ab) / max(float(ab @ ab), 1e-12)
    sel = (t > t0) & (t < t1)
    if sel.sum() < 30:
        return default
    d = np.linalg.norm(pts[sel] - (a + np.outer(t[sel], ab)), axis=1)
    d = d[d < 0.2 * H]
    return float(np.median(d)) if len(d) >= 30 else default


def frame_xy(x, y_approx):
    """Rotation whose columns are x (kept exact), y (orthogonalised) and x × y."""
    x = norm(x)
    z = norm(np.cross(x, y_approx))
    return np.stack([x, norm(np.cross(z, x)), z], axis=1)


def frame_yx(y, x_approx):
    """Same, keeping y exact (limbs: y runs up the bone, x is the hinge)."""
    y = norm(y)
    z = norm(np.cross(x_approx, y))
    return np.stack([norm(np.cross(y, z)), y, z], axis=1)


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def euler_xyz(x, y, z):  # three.js 'XYZ' order: R = Rx · Ry · Rz
    return rot_x(x) @ rot_y(y) @ rot_z(z)


# ------------------------------------------------------------------ fit the skeleton to the sculpt
J = {}
fn = iface(torso, head)
head_c = (head.lo + head.hi) / 2
# The whole head (skull, jaw, chin, beard, hair) is rigid: it turns about the centre of the collar opening, so
# the neck stub stays tucked inside the shirt and the face is never stretched between two bones.
collar = fn['c'] if fn else np.array([head_c[0], head.lo[1] + 0.03 * H, head_c[2] - 0.05 * H])
J['head'] = collar
J['neck'] = collar + np.array([0, -0.035 * H, -0.012 * H])
head_top = np.array([head_c[0], max(p.hi[1] for p in head_group), head_c[2]])  # caps and headphones count

# ---- legs: ankles and toes from the shoes
for s in 'LR':
    sh = shoe[s]
    cands = [(iface(sh, p), p) for p in leg_parts if iface(sh, p)]
    if cands:
        f, _ = max(cands, key=lambda x: x[0]['n'])
        J['foot' + s] = f['c'] + np.array([0, -0.022 * H, 0])
    else:
        top = sh.s[sh.s[:, 1] > sh.hi[1] - 0.02 * H]
        J['foot' + s] = top.mean(0) + np.array([0, -0.03 * H, 0])
    d = sh.s[:, [0, 2]] - J['foot' + s][[0, 2]]
    far = sh.s[np.argsort((d ** 2).sum(1))[-max(8, len(d) // 60):]]
    J['toe' + s] = np.array([far[:, 0].mean(), sh.lo[1] + 0.03 * H, far[:, 2].mean()])

# ---- legs: every point belongs to the leg whose ankle it is closer to along the surface
leg_cloud = np.concatenate([p.s[:: max(1, len(p.s) // 4500)] for p in leg_parts])
leg_tree = kd(leg_cloud)
gd = {s: geodesic(leg_cloud, leg_tree, J['foot' + s], 0.03 * H, bridge=True) for s in 'LR'}
own = {'L': np.isfinite(gd['L']) & (gd['L'] <= gd['R']), 'R': np.isfinite(gd['R']) & (gd['R'] < gd['L'])}
leg_line = {s: centre_line(leg_cloud, gd[s], own[s], 26) for s in 'LR'}


def line_at(rows, g):
    """Point of a centre line at arc position g."""
    arcs = [r[0] for r in rows]
    pts = np.array([r[1] for r in rows])
    return np.array([np.interp(g, arcs, pts[:, k]) for k in range(3)])


def arc_of(rows, p):
    return rows[int(np.argmin([np.linalg.norm(r[1] - p) for r in rows]))][0]


def fit_line(q):
    c = q.mean(0)
    _, sv, vt = np.linalg.svd(q - c)
    return c, vt[0], float((sv[1:] ** 2).sum())


def knee_by_segments(rows):
    """A squatting leg's centre line is three straight runs: shin, thigh, then up through the pelvis. Find the
    two breaks that fit best; the knee is where the shin's line and the thigh's line meet."""
    pts = np.array([r[1] for r in rows if r[0] > 0.035 * H])  # the cuff bunches at the ankle: skip it
    arcs = np.array([r[0] for r in rows if r[0] > 0.035 * H])
    n = len(pts)
    best = None
    for b1 in range(2, n - 3):
        if not 0.12 * H <= arcs[b1] <= 0.37 * H:
            continue
        e1 = fit_line(pts[:b1 + 1])[2]
        for b2 in range(b1 + 2, n):
            if arcs[b2] - arcs[b1] < 0.09 * H:
                continue
            e = e1 + fit_line(pts[b1:b2 + 1])[2] + (fit_line(pts[b2:])[2] if n - b2 >= 3 else 0.0)
            if best is None or e < best[0]:
                best = (e, b1, b2)
    if best is None:
        return None
    _, b1, b2 = best
    c1, d1, _ = fit_line(pts[:b1 + 1])
    c2, d2, _ = fit_line(pts[b1:b2 + 1])
    w = c1 - c2  # closest points of the two lines
    a, b, c = d1 @ d1, d1 @ d2, d2 @ d2
    den = a * c - b * b
    if den < 1e-6:
        return pts[b1]
    t1 = (b * (d2 @ w) - c * (d1 @ w)) / den
    t2 = (a * (d2 @ w) - b * (d1 @ w)) / den
    k = (c1 + d1 * t1 + c2 + d2 * t2) / 2
    return k if np.linalg.norm(k - pts[b1]) < 0.09 * H else pts[b1]


# ---- knees and pelvis, found together (each needs the other):
#  * The pelvis. In a deep squat the trousers hide where the thighs end, but the pelvis is where the trunk
#    comes down to the level of the thighs. The trunk bows forward towards the neck, so only its lowest stretch
#    counts: two slices of the torso just above the hips, carried on down to hip level. Getting this pivot
#    right is what lets the body straighten — too far forward and the standing figure keeps a lap in front and
#    a seat behind. The hip joints sit either side of it, as far apart as two thighs are wide.
#  * The knees. The bend of the leg: the kneecap is the patch of the leg farthest from the straight line
#    ankle -> hip, and the joint lies a leg's radius inside it. Tripo often cuts the trousers into parts at the knee; a cut lying at the bend is the more exact mark
#    (a cut anywhere else - hip crease, cuff - is just a seam).
tp = np.concatenate([p.s for p in P if p.cls in ('torso', 'torso2')])
leg_cuts = {'L': [], 'R': []}
for a in range(len(leg_parts)):
    for b in range(a + 1, len(leg_parts)):
        f = iface(leg_parts[a], leg_parts[b])
        if f and f['n'] >= 80 and f['r'] > 0.03 * H:
            _, k, _ = leg_tree.find(Vector(f['c']))
            leg_cuts['L' if own['L'][k] else 'R'].append(f['c'])


def place_pelvis():
    knee_arc, prox, thigh_r = {}, {}, {}
    for s in 'LR':
        rows = leg_line[s]
        knee_arc[s] = arc_of(rows, J['shin' + s])
        up = [r for r in rows if knee_arc[s] + 0.05 * H < r[0] < knee_arc[s] + 0.14 * H]
        prox[s] = np.mean([r[1] for r in up], axis=0) if up else J['shin' + s]
        mid = [r[2] for r in rows if knee_arc[s] + 0.02 * H < r[0] < knee_arc[s] + 0.1 * H]
        thigh_r[s] = min(mid) if mid else 0.075 * H
    hip_w = OVR.get('hipWidth', float(np.clip(2.3 * (thigh_r['L'] + thigh_r['R']) / 2 / H, 0.15, 0.2))) * H
    hip_y = (prox['L'][1] + prox['R'][1]) / 2 + OVR.get('hipRise', 0.02) * H

    def waist_slice(a, b):
        m = (tp[:, 1] >= hip_y + a * H) & (tp[:, 1] < hip_y + b * H)
        return tp[m].mean(0) if m.sum() >= 150 else None

    cA, cB = waist_slice(0.05, 0.13), waist_slice(0.13, 0.21)
    if cA is None:  # a short top: take what there is
        cA, cB = waist_slice(0.13, 0.21), waist_slice(0.21, 0.29)
    if cA is not None and cB is not None and cB[1] - cA[1] > 0.03 * H:
        run = (cA - cB) / (cA[1] - cB[1]) * (hip_y - cA[1])
        hz = float(np.linalg.norm(run[[0, 2]]))
        if hz > 0.08 * H:
            run[[0, 2]] *= 0.08 * H / hz
        pelvis = cA + run
    elif cA is not None:
        pelvis = np.array([cA[0], hip_y, cA[2]])
    else:
        pelvis = np.array([(prox['L'][0] + prox['R'][0]) / 2, hip_y, (prox['L'][2] + prox['R'][2]) / 2])
        log('warn: no torso above the hips; pelvis placed between the thighs')
    pelvis[1] = hip_y
    if 'pelvis' in OVR:
        pelvis = np.array(OVR['pelvis'], dtype=np.float64)
    up_axis = norm(J['neck'] - pelvis)
    if 'pelvisTilt' in OVR:  # radians forward of vertical, if the trunk's lean is not the pelvis' tilt
        f = norm(up_axis * np.array([1, 0, 1]))
        up_axis = norm(np.array([0, 1.0, 0]) * math.cos(OVR['pelvisTilt']) + f * math.sin(OVR['pelvisTilt']))
    lat = (prox['L'] - prox['R']) * np.array([1, 0, 1])
    lat = norm(lat) if np.linalg.norm(lat) > 0.04 * H and lat[0] > 0 else np.array([1.0, 0, 0])
    if 'pelvisYaw' in OVR:
        lat = np.array([math.cos(OVR['pelvisYaw']), 0, math.sin(OVR['pelvisYaw'])])
    up_axis = norm(up_axis - lat * (up_axis @ lat))  # the hip line stays level: the pelvis leans about it
    J['thighL'], J['thighR'] = pelvis + lat * hip_w / 2, pelvis - lat * hip_w / 2
    return pelvis, up_axis, lat, hip_w, thigh_r


how, bend, out_dir = {}, {}, {}
for s in 'LR':
    k = knee_by_segments(leg_line[s])
    J['shin' + s] = k if k is not None and 0.15 * H < np.linalg.norm(k - J['foot' + s]) < 0.36 * H else line_at(leg_line[s], 0.22 * H)
pelvis, pelvis_up, lat, HIP_W, thigh_r = place_pelvis()  # from here on the pelvis stays put


# ---- A model that already stands straight (made in a T- or A-pose, see docs/reference/model-reference.png).
# Nothing has to be found by the way it bends: the joints go where a standing body has them, the same on both
# sides, and the un-posing that follows barely moves anything.
def leg_is_straight(s):
    cen = np.array([r[1] for r in leg_line[s] if 0.08 * H < r[1][1] < 0.36 * H])
    if len(cen) < 4:
        return False
    a0, a1 = cen[np.argmin(cen[:, 1])], cen[np.argmax(cen[:, 1])]
    d = a1 - a0
    dev = max(float(np.linalg.norm((q - a0) - d * ((q - a0) @ d) / (d @ d))) for q in cen)
    return norm(d)[1] > 0.97 and dev < 0.02 * H


STANDING = OVR['standing'] if 'standing' in OVR else all(leg_is_straight(s) for s in 'LR')
if STANDING:
    mx = float((J['footL'][0] + J['footR'][0]) / 2)
    # The fork of the legs. Thighs that touch share the centre line well below it, but only at mid depth; from
    # the fork up the trousers are closed all the way from the fly to the seat.
    crotch = None
    for yb in np.arange(0.6, 0.18, -0.01):
        band = leg_cloud[(leg_cloud[:, 1] >= yb * H) & (leg_cloud[:, 1] < (yb + 0.02) * H)]
        mid_ = band[np.abs(band[:, 0] - mx) < 0.012 * H] if len(band) else band
        if len(band) < 20:
            continue
        if len(mid_) < 4 or np.ptp(mid_[:, 2]) < 0.85 * np.ptp(band[:, 2]):
            break
        crotch = yb * H
    if crotch is None:
        crotch = 0.4 * H
        log('warn: could not find the fork of the legs; assumed 0.40')
    side = {}
    for s in 'LR':
        up = [r[1] for r in leg_line[s] if crotch - 0.1 * H < r[1][1] < crotch - 0.02 * H]
        side[s] = np.mean(up, axis=0) if up else J['foot' + s]
    half = float(np.clip((side['L'][0] - side['R'][0]) / 2, 0.06 * H, 0.1 * H))
    # the hip joints sit a little above the fork of the legs, over the middle of each thigh
    pelvis = np.array([mx, crotch + OVR.get('hipRise', 0.045) * H, (side['L'][2] + side['R'][2]) / 2])
    pelvis_up, lat, HIP_W = np.array([0, 1.0, 0]), np.array([1.0, 0, 0]), 2 * half
    J['thighL'], J['thighR'] = pelvis + lat * half, pelvis - lat * half
    log(f'standing model: neck was {(J["neck"][0] - mx) / H:+.3f} off the centre line')
    for b_ in ('neck', 'head'):  # a body standing square has its neck on the centre line
        J[b_] = np.array([mx, J[b_][1], J[b_][2]])
    log(f'standing model: fork of the legs at {crotch / H:.3f}, hips at {pelvis[1] / H:.3f}, {half / H:.3f} either side')
for _ in range(1):
    for s in 'LR':
        rows = leg_line[s]
        a = J['foot' + s]
        ab = J['thigh' + s] - a
        if STANDING:  # a straight leg: thigh and shin are about the same length
            t_k = 0.5
            cuts = [c for c in leg_cuts[s] if 0.45 < ((c - a) @ ab) / (ab @ ab) < 0.56]
            how[s] = 'standing leg, half way up'
            if cuts:  # trousers cut into parts at the knee
                t_k = float(((min(cuts, key=lambda c: abs(((c - a) @ ab) / (ab @ ab) - 0.5)) - a) @ ab) / (ab @ ab))
                how[s] = 'standing leg, at the part cut'
            J['shin' + s] = a + ab * t_k
            bend[s], out_dir[s] = 0.0, np.array([0, 0, 1.0])
            continue
        pts = leg_cloud[own[s] & (gd[s] > 0.08 * H)]
        t = ((pts - a) @ ab) / (ab @ ab)
        mid = (t > 0.15) & (t < 0.85)  # between ankle and hip: the seat is not a knee
        pts, t = pts[mid], t[mid]
        foot = a + np.outer(t, ab)
        dq = np.linalg.norm(pts - foot, axis=1)
        out = np.argsort(dq)[-max(8, len(pts) // 50):]  # the kneecap: the patch of the leg farthest from that line
        cap, base = pts[out].mean(0), foot[out].mean(0)
        rr = [r[2] for r in rows if 0.1 * H < r[0] < 0.2 * H]
        rad = float(np.mean(rr)) if rr else 0.06 * H
        bend[s], out_dir[s] = float(np.linalg.norm(cap - base)) - rad, norm(cap - base)
        if np.linalg.norm(cap - base) > rad + 0.03 * H:
            knee, how[s] = cap + norm(base - cap) * rad, 'bend'  # the joint lies a leg's radius inside the kneecap
        else:  # a leg held almost straight has no bend to find: a shin is a little shorter than a thigh
            knee, how[s] = a + ab * 0.47, 'straight leg'
        near = [c for c in leg_cuts[s] if np.linalg.norm(c - knee) < 0.06 * H]
        if near:
            cut = min(near, key=lambda c: np.linalg.norm(c - knee))
            how[s] = f'part cut at the bend ({np.linalg.norm(cut - knee) / H:.3f} from the kneecap estimate)'
            knee = cut
        J['shin' + s] = knee
# A sculpt made from one picture keeps the picture's perspective: the far leg is smaller, and when it is held
# straighter its knee is a guess. Give it the nearer (more bent) leg's shin : thigh proportion.
ratio = {s: float(np.linalg.norm(J['shin' + s] - J['foot' + s]) /
                  (np.linalg.norm(J['shin' + s] - J['foot' + s]) + np.linalg.norm(J['thigh' + s] - J['shin' + s]))) for s in 'LR'}
ref = 'L' if bend['L'] >= bend['R'] else 'R'
oth = 'R' if ref == 'L' else 'L'
if abs(ratio[oth] - ratio[ref]) > 0.06 and not how[oth].startswith('part cut') and 0.38 < ratio[ref] < 0.62:
    a, b = J['foot' + oth], J['thigh' + oth]
    h = max(0.0, min(bend[oth], 0.5 * float(np.linalg.norm(b - a))))
    lo_t, hi_t = 0.2, 0.8
    for _ in range(30):  # where along the leg the knee gives the same proportion
        t = (lo_t + hi_t) / 2
        k = a + (b - a) * t + out_dir[oth] * h
        r = np.linalg.norm(k - a) / (np.linalg.norm(k - a) + np.linalg.norm(b - k))
        lo_t, hi_t = (t, hi_t) if r < ratio[ref] else (lo_t, t)
    J['shin' + oth] = a + (b - a) * t + out_dir[oth] * h
    how[oth] = f'proportion of the other leg ({ratio[oth]:.2f} -> {ratio[ref]:.2f})'
for k_, v_ in OVR.get('joints', {}).items():  # hand-placed knees move the pelvis with them
    if k_.startswith('shin'):
        J[k_] = np.array(v_, dtype=np.float64)
        how[k_[-1]] = 'override'
if STANDING:  # both knees at the same height
    ky = (J['shinL'][1] + J['shinR'][1]) / 2
    for s in 'LR':
        a, b = J['foot' + s], J['thigh' + s]
        J['shin' + s] = a + (b - a) * ((ky - a[1]) / (b[1] - a[1]))
knee_arc = {s: arc_of(leg_line[s], J['shin' + s]) for s in 'LR'}
for s in 'LR':
    k = J['shin' + s]
    log(f'knee {s}: {how[s]}  arc {arc_of(leg_line[s], k) / H:.3f}  ({k[0] / H:+.3f},{k[1] / H:.3f},{k[2] / H:+.3f})')
trunk_up = norm(J['neck'] - pelvis)
shin_len = {s: float(np.linalg.norm(J['shin' + s] - J['foot' + s])) for s in 'LR'}
shin_avg = (shin_len['L'] + shin_len['R']) / 2
thigh_len = {s: float(np.linalg.norm(J['thigh' + s] - J['shin' + s])) for s in 'LR'}
log(f'pelvis: ({pelvis[0] / H:+.3f},{pelvis[1] / H:.3f},{pelvis[2] / H:+.3f})  '
    f'tilt {math.degrees(math.acos(min(1.0, pelvis_up[1]))):.0f} deg  yaw {math.degrees(math.atan2(lat[2], lat[0])):+.0f} deg')
log(f'legs: hip gap {HIP_W / H:.3f}  thigh L/R {thigh_len["L"] / H:.3f}/{thigh_len["R"] / H:.3f}  '
    f'shin L/R {shin_len["L"] / H:.3f}/{shin_len["R"] / H:.3f}  thigh radius {thigh_r["L"] / H:.3f}/{thigh_r["R"] / H:.3f}')
if not 0.75 < (thigh_len['L'] + thigh_len['R']) / 2 / shin_avg < 1.6:
    log('warn: thighs are an odd length for these shins - check the knees and the pelvis')

# ---- arms: elbow = the bend of the arm's centre line; the shoulder joint lies up the upper arm's axis
UPPER_ARM = OVR.get('upperArm', 0.9)  # upper arm length / (elbow -> end of the fist)
hole, arm_geo, arm_straight = {}, {}, {}
for s in 'LR':
    comp = [p for p in P if p.cls == 'arm' and p.side == s]
    assert comp, f'no arm parts on side {s}'
    # the part the arm starts with: the one meeting the torso nearest the shoulder (a forearm held against the
    # chest touches the torso too, and often along more of its length)
    prior = J['neck'] + np.array([(0.14 if s == 'L' else -0.14) * H, -0.03 * H, 0])
    joined = [p for p in comp if iface(torso, p)]
    sleeve = min(joined, key=lambda p: np.linalg.norm(iface(torso, p)['c'] - prior)) if joined else max(comp, key=lambda p: p.hi[1])
    hl = iface(torso, sleeve)
    start = hl['c'] if hl else sleeve.c
    rad = hl['r'] if hl else 0.07 * H
    hole[s] = {'c': start, 'r': rad}
    arm = Surface(comp)
    src = [arm.off[sleeve.name][0] + u for u, _, _ in rim_pairs(sleeve, torso)]
    if len(src) < 6:
        src = arm.near(sleeve, start, rad * 1.5)
    if not len(src):
        src = [arm.off[sleeve.name][0] + int(np.argmin(np.linalg.norm(arm.of(sleeve, arm.pos) - start, axis=1)))]
    dist = arm.distances(src)
    arm_rows = centre_line(arm.pos, dist, np.ones(len(arm.pos), bool), 26)
    line = np.array([r[1] for r in arm_rows])
    tip = line[-1] + 0.6 * (line[-1] - line[-2])
    first = start + 0.35 * rad * norm(J['neck'] - start)
    line = np.vstack([first, line[1:], tip])
    elbow = bend_point(line, first, tip, 0.42)
    k = int(np.argmin(np.linalg.norm(line - elbow, axis=1)))
    lower = np.vstack([elbow, line[k + 1:]]) if k + 1 < len(line) else np.vstack([elbow, tip])
    lower_len = float(np.sum(np.linalg.norm(np.diff(lower, axis=0), axis=1)))
    J['fore' + s] = elbow
    J['hand' + s] = along(lower, 0.72)
    J['tip' + s] = tip
    # positions along the arm, read off the centre line itself (a folded arm passes close to itself, so the
    # nearest point of the line is no guide)
    e_arc = arm_rows[min(max(k, 0), len(arm_rows) - 1)][0]
    t_arc = arm_rows[-1][0] + 0.6 * (arm_rows[-1][0] - arm_rows[-2][0])
    arm_geo[s] = (arm, dist, e_arc, e_arc + 0.72 * (t_arc - e_arc), t_arc)
    # short sleeves: the arm part starts half-way down the upper arm, so the cut is not the shoulder
    axis = norm(start - elbow)
    want = UPPER_ARM * lower_len
    seen = float(np.linalg.norm(first - elbow))
    J['arm' + s] = first if seen >= 0.85 * want else elbow + axis * want
    # An arm held out straight (T- / A-pose) has no bend to read the elbow from, but it needs none: shoulder,
    # elbow and wrist lie along it in a body's proportions.
    chord = tip - first
    dev = max(float(np.linalg.norm((q - first) - chord * ((q - first) @ chord) / (chord @ chord))) for q in line)
    ax = norm(chord)
    arm_straight[s] = dev < 0.05 * H and abs(ax[0]) > 0.35 and OVR.get('straightArms', True)
    if arm_straight[s]:
        sg = 1.0 if s == 'L' else -1.0
        up_ax = norm(line[max(2, len(line) // 3)] - first)  # the way the upper arm runs
        if abs(up_ax[0]) < 0.3:
            up_ax = ax
        S = first + up_ax * ((J['neck'][0] + sg * OVR.get('shoulderX', 0.108) * H - first[0]) / up_ax[0])  # the joint, inside the shoulder
        T = S + ax * float(((arm.pos - S) @ ax).max())  # the fingertips
        # the arm's centre line from the joint to the fingertips, in order along the arm
        span = float((T - S) @ ax)
        inner = sorted([q for q in line if 0.03 * span < (q - S) @ ax < 0.97 * span], key=lambda q: float((q - S) @ ax))
        path = np.vstack([S] + inner + [T])
        t_w = 0.755
        # a cut between two parts near where the wrist should be is the wrist (hand as its own part); the cuts
        # further out are the fingers'
        cuts = [float(((f['c'] - S) @ ax) / ((T - S) @ ax)) for i_, q in enumerate(comp) for r_ in comp[i_ + 1:] for f in [iface(q, r_)] if f]
        cuts = [c for c in cuts if 0.62 < c < 0.82]
        if cuts:
            t_w = min(cuts, key=lambda c: abs(c - 0.74))
        W = along(path, t_w)
        E = along(path, t_w * 0.56)  # upper arm : forearm = 56 : 44
        J['arm' + s], J['fore' + s], J['hand' + s], J['tip' + s] = S, E, W, T
        e_arc, w_arc = arc_of(arm_rows, E), arc_of(arm_rows, W)
        arm_geo[s] = (arm, dist, e_arc, w_arc, max(t_arc, w_arc + 0.02 * H))
        lower_len = float(np.linalg.norm(T - E))
        seen = float(np.linalg.norm(first - E))
        elbow = E
    log(f'arm {s}: {"straight, " if arm_straight[s] else ""}lower {lower_len / H:.3f}  cut->elbow {seen / H:.3f}  upper {np.linalg.norm(J["arm" + s] - elbow) / H:.3f}  hole r {rad / H:.3f}  arcs elbow {arm_geo[s][2] / H:.3f} wrist {arm_geo[s][3] / H:.3f} end {t_arc / H:.3f}')
# a shoulder joint is never far from the base of the neck, and the two are the same distance from it
reach = {s: float(np.clip(np.linalg.norm(J['arm' + s] - J['neck']), 0.12 * H, 0.2 * H)) for s in 'LR'}
both = (reach['L'] + reach['R']) / 2
if all(arm_straight.values()):
    # straight arms were placed by proportion already; make the two sides mirror images
    cx = J['neck'][0]
    flip = np.array([-1.0, 1, 1])
    for b in ('arm', 'fore', 'hand', 'tip'):
        l, r = J[b + 'L'] - [cx, 0, 0], (J[b + 'R'] - [cx, 0, 0]) * flip
        m = (l + r) / 2
        J[b + 'L'], J[b + 'R'] = m + [cx, 0, 0], m * flip + [cx, 0, 0]
    for s in 'LR':
        a_, d_, _, _, t_ = arm_geo[s]
        rows_ = centre_line(a_.pos, d_, np.ones(len(a_.pos), bool), 26)
        arm_geo[s] = (a_, d_, arc_of(rows_, J['fore' + s]), arc_of(rows_, J['hand' + s]), t_)
else:
    for s in 'LR':
        J['arm' + s] = J['neck'] + norm(J['arm' + s] - J['neck']) * (0.5 * reach[s] + 0.5 * both)
log(f'shoulders: {np.linalg.norm(J["armL"] - J["neck"]) / H:.3f} / {np.linalg.norm(J["armR"] - J["neck"]) / H:.3f} from the neck')

# ---- trunk: pelvis -> neck, bowed the way the back is (a rounded back straightens when the body stands up)
J['hips'] = pelvis + pelvis_up * 0.015 * H
hipsX = lat
chestX = norm(J['armL'] - J['armR'])
axis = J['neck'] - J['hips']
trunk_len = float(np.linalg.norm(axis))
axis = axis / trunk_len
side = norm(hipsX + chestX)
front = norm(np.cross(side, axis))
tp = torso.s
tt = ((tp - J['hips']) @ axis) / trunk_len
lat_t = (tp - J['hips']) @ side
dep = (tp - J['hips']) @ front


def back_at(t, w=0.07):
    sel = (np.abs(tt - t) < w) & (np.abs(lat_t) < 0.07 * H)
    return float(np.percentile(dep[sel], 4)) if sel.sum() >= 40 else None


b0, b1 = back_at(0.12), back_at(0.92)


def bow(t):
    b = back_at(t)
    if b is None or b0 is None or b1 is None:
        return 0.0
    k = (t - 0.12) / 0.8
    return float(np.clip(b - ((1 - k) * b0 + k * b1), -0.05 * H, 0.03 * H))


J['spine'] = J['hips'] + axis * trunk_len * 0.2 + front * bow(0.2)
J['chest'] = J['hips'] + axis * trunk_len * 0.52 + front * bow(0.52)
log(f'trunk: length {trunk_len / H:.3f}  lean {math.degrees(math.acos(min(1.0, axis[1]))):.0f} deg  bow spine {bow(0.2) / H:+.3f} chest {bow(0.52) / H:+.3f}')

for k, v in OVR.get('joints', {}).items():
    J[k] = np.array(v, dtype=np.float64) * (H if OVR.get('jointsRelative') else 1)
for k in BONES + ['tipL', 'tipR', 'toeL', 'toeR']:
    log(f'joint {k:7s} ({J[k][0]:+.3f}, {J[k][1]:.3f}, {J[k][2]:+.3f})')


# ------------------------------------------------------------------ joint frames
def frames_of(J, head_rot, hips_up):
    """Orientation of every joint frame (x = left / hinge, y = up the bone, z = front) for joint positions J."""
    d = lambda a, b: norm(J[b] - J[a])
    F = {}
    hx, cx = norm(J['thighL'] - J['thighR']), norm(J['armL'] - J['armR'])
    F['hips'] = frame_xy(hx, hips_up)
    F['spine'] = frame_yx(d('spine', 'chest'), hx + cx)
    F['chest'] = frame_xy(cx, d('chest', 'neck'))
    F['neck'] = frame_yx(d('neck', 'head'), cx)
    F['head'] = head_rot
    for s in 'LR':
        for a, b, c, elbow, fb in (('arm', 'fore', 'hand', True, cx), ('thigh', 'shin', 'foot', False, hx)):
            u1, u2 = d(a + s, b + s), d(b + s, c + s)
            hinge = np.cross(u1, u2)
            hinge = fb.copy() if np.linalg.norm(hinge) < 0.12 else norm(hinge) * (-1 if elbow else 1)
            F[a + s] = frame_yx(-u1, hinge)
            F[b + s] = frame_yx(-u2, hinge)
            if elbow:
                F['hand' + s] = frame_yx(-d('hand' + s, 'tip' + s), hinge)
        fwd = J['toe' + s] - J['foot' + s]
        fwd[1] = 0
        fwd = norm(fwd)
        up = np.array([0.0, 1.0, 0.0])
        F['foot' + s] = np.stack([norm(np.cross(up, fwd)), up, fwd], axis=1)
    return F


star = frames_of(J, rot_y(OVR.get('headYaw', 0)) @ rot_x(OVR.get('headPitch', 0)), pelvis_up)
NEUTRAL = {b: np.eye(3) for b in BONES}
for s, sg in (('L', 1), ('R', -1)):
    for b in ('arm', 'fore', 'hand'):
        NEUTRAL[b + s] = rot_z(sg * A_POSE)
D = {b: NEUTRAL[b] @ star[b].T for b in BONES}  # world rotation taking each bone from the sculpt to the rest pose
leg_len = sum(np.linalg.norm(J['thigh' + s] - J['shin' + s]) + np.linalg.norm(J['shin' + s] - J['foot' + s]) for s in 'LR') / 2
NP = {'hips': np.array([0.0, leg_len + (J['footL'][1] + J['footR'][1]) / 2, 0.0])}
for b in BONES[1:]:
    NP[b] = NP[PARENT[b]] + D[PARENT[b]] @ (J[b] - J[PARENT[b]])
for k, b in (('tipL', 'handL'), ('tipR', 'handR'), ('toeL', 'footL'), ('toeR', 'footR')):
    NP[k] = NP[b] + D[b] @ (J[k] - J[b])
NP['headTop'] = NP['head'] + D['head'] @ (head_top - J['head'])


# ------------------------------------------------------------------ debug rendering
def setup_render(res=(560, 800)):
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = res
    if not scene.world:
        scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.2, 0.2, 0.23)
    scene.display.shading.light = 'STUDIO'
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cam = bpy.data.objects.new('cam', cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


VIEWS = {'front': (0, -1, 0), 'left': (1, 0, 0), 'back': (0, 1, 0), 'right': (-1, 0, 0), 'fl': (0.7, -0.7, 0), 'top': (0, -0.001, 1)}


def render(cam, tag, views, centre_z, scale):
    cam.data.ortho_scale = scale
    for vn in views:
        dx, dy, dz = VIEWS[vn]
        target = Vector((0, 0, centre_z))
        cam.location = target + Vector((dx, dy, dz)) * 4
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.abspath(os.path.join(DEBUG, f'{NAME}_{tag}_{vn}.png'))
        bpy.ops.render.render(write_still=True)


def skeleton_markers(JJ, ends):
    out = []
    for b in BONES:
        a, c = to_bl(JJ[b]), to_bl(ends[b])
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.012 * H, location=a, segments=10, ring_count=6)
        sph = bpy.context.active_object
        sph.color = (1, 1, 0, 1)
        out.append(sph)
        dd = c - a
        if dd.length > 1e-4:
            bpy.ops.mesh.primitive_cylinder_add(radius=0.004 * H, depth=dd.length, location=(a + c) / 2, vertices=6)
            cy = bpy.context.active_object
            cy.rotation_euler = dd.to_track_quat('Z', 'Y').to_euler()
            cy.color = (1, 0.1, 0.1, 1)
            out.append(cy)
    return out


def ends_of(JJ, top):
    return {'hips': JJ['spine'], 'spine': JJ['chest'], 'chest': JJ['neck'], 'neck': JJ['head'], 'head': top,
            'armL': JJ['foreL'], 'foreL': JJ['handL'], 'handL': JJ['tipL'], 'armR': JJ['foreR'], 'foreR': JJ['handR'], 'handR': JJ['tipR'],
            'thighL': JJ['shinL'], 'shinL': JJ['footL'], 'footL': JJ['toeL'], 'thighR': JJ['shinR'], 'shinR': JJ['footR'], 'footR': JJ['toeR']}


def xray(tag, JJ, top, views, centre_z, scale):
    sh = scene.display.shading
    sh.color_type = 'OBJECT'
    sh.show_xray = True
    sh.xray_alpha = 0.35
    for p in P:
        p.o.color = (0.75, 0.75, 0.8, 1)
    mk = skeleton_markers(JJ, ends_of(JJ, top))
    render(cam, tag, views, centre_z, scale)
    for o in mk:
        bpy.data.objects.remove(o)
    sh.show_xray = False


cam = None
if DEBUG:
    os.makedirs(DEBUG, exist_ok=True)
    cam = setup_render()
    xray('fit', J, head_top, ('front', 'left', 'back', 'right', 'top'), 0.5 * H, 1.22 * H)
if STAGE == 'fit':
    log('ok fit')
    sys.exit(0)


# ------------------------------------------------------------------ skin weights (capsules)
def capsules(JJ, top, radii, holes, up):
    """Every bone as one or more capsules (a, b, radius). `up` = the pelvis' up axis."""
    trunk = JJ['neck'] - JJ['hips']
    ctop = JJ['chest'] + 0.8 * (JJ['neck'] - JJ['chest'])
    rt = radii['thigh']
    bar = (JJ['thighR'], JJ['thighL'], rt * 1.1)
    crest = (JJ['thighR'] + up * 0.1 * H, JJ['thighL'] + up * 0.1 * H, rt)
    caps = {  # the pelvis is a slab: the bar between the hip joints, a second bar a hand above it, and a core
        # rising from the middle, all as thick as a thigh. In a squat the thighs lie right against the belly;
        # with equal thickness the crease between them splits half-way, so the waistband stays on the pelvis
        # (under the shirt) and the lap goes with the thigh instead of being left behind when the body stands.
        'hips': [bar, crest, (JJ['hips'] + up * 0.02 * H, JJ['hips'] + up * 0.14 * H, rt)],
        'pelvis': [bar, crest, (JJ['hips'], JJ['hips'] + up * 0.3 * H, rt)],  # trousers: all of the waistband
        'spine': [(JJ['spine'], JJ['chest'], radii['trunk'])],
        'chest': [(JJ['chest'], JJ['neck'], radii['trunk'])],
        'head': [(JJ['head'], top, 0.1 * H)]}
    for s in 'LR':
        caps['clav' + s] = [(ctop, JJ['arm' + s], radii['arm' + s] * 1.25)]
        caps['arm' + s] = [(JJ['arm' + s], JJ['fore' + s], radii['arm' + s])]
        caps['sleeve' + s] = [(JJ['arm' + s], holes[s]['c'], holes[s]['r'] * 1.15)]
        caps['fore' + s] = [(JJ['fore' + s], JJ['hand' + s], radii['fore' + s])]
        caps['hand' + s] = [(JJ['hand' + s], JJ['tip' + s], radii['hand' + s])]
        caps['thigh' + s] = [(JJ['thigh' + s], JJ['shin' + s], radii['thigh'])]
        caps['shin' + s] = [(JJ['shin' + s], JJ['foot' + s], radii['shin'])]
        caps['foot' + s] = [(JJ['foot' + s], JJ['toe' + s], 0.05 * H)]
    return {'caps': caps, 'hips': JJ['hips'], 'up': up}


# which bone each capsule belongs to
CAP_BONE = {'clavL': 'chest', 'clavR': 'chest', 'sleeveL': 'armL', 'sleeveR': 'armR', 'pelvis': 'hips'}


def candidates(p):
    if p.cls in ('torso', 'torso2'):
        return ['hips', 'spine', 'chest', 'clavL', 'clavR', 'sleeveL', 'sleeveR', 'thighL', 'thighR']
    if p.cls == 'arm':
        return ['clav' + p.side, 'arm' + p.side, 'fore' + p.side, 'hand' + p.side]
    if p.cls == 'leg':
        return ['pelvis', 'thighL', 'shinL', 'thighR', 'shinR']
    if p.cls == 'shoe':
        return ['foot' + p.side]
    if p.cls in ('head', 'headacc'):
        return ['head']
    return None  # accessory: rides on one bone


POWER = 8.0

# Where a limb is folded against itself (a fist by the shoulder, a calf under the thigh) nearness says nothing
# about which bone a vertex belongs to. How far along the limb it lies does: every vertex of an arm or a leg knows
# its distance over the surface from the limb's end, and may only take weight from the bones around that position.
legs = Surface(leg_parts)
sgd = {}
for s_ in 'LR':
    src = np.nonzero(np.linalg.norm(legs.pos - J['foot' + s_], axis=1) < 0.075 * H)[0]
    sgd[s_] = legs.distances(src if len(src) else [legs.tree.find(Vector(J['foot' + s_]))[1]])
sown = np.isfinite(sgd['L']) & (sgd['L'] <= sgd['R'])
for s_ in 'LR':  # where along that surface the knee is: the vertices around the joint say
    mine = sown if s_ == 'L' else ~sown
    dk_ = np.linalg.norm(legs.pos - J['shin' + s_], axis=1)
    ring = mine & np.isfinite(sgd[s_]) & (dk_ < max(0.08 * H, np.sort(dk_[mine])[min(40, mine.sum() - 1)]))
    knee_arc[s_] = float(np.median(sgd[s_][ring])) if ring.any() else knee_arc[s_]
log(f'knee arcs on the surface L/R {knee_arc["L"] / H:.3f}/{knee_arc["R"] / H:.3f}')
GATE = {}
for p_ in P:
    if p_.cls == 'leg':
        isL = legs.of(p_, sown)
        GATE[p_.name] = (isL, np.where(isL, legs.of(p_, sgd['L']), legs.of(p_, sgd['R'])))
    elif p_.cls == 'arm':
        arm_, dist_ = arm_geo[p_.side][:2]
        GATE[p_.name] = (None, arm_.of(p_, dist_))


def capsule_term(v, caps, name):
    return (np.min([seg_dist(v, a, b) / r for a, b, r in caps[name]], axis=0) + 0.05) ** -POWER


def weights_for(p, v, body):
    """(n, 17) skin weights of one part.

    Trunk, pelvis and the hubs (shoulder, hip): inverse power of the distance to each candidate bone's capsule,
    in units of its radius. Along a limb (elbow, wrist, knee) the weight depends only on how far along the limb
    the vertex lies, so a whole ring of the limb always turns together: nearness would give the inside of a
    folded elbow to the upper arm and the outside to the forearm, and the arm would come out of the fold as flat
    as a paddle."""
    caps = body['caps']
    cand = candidates(p)
    W = np.zeros((len(v), len(BONES)))
    if cand is None:
        names = [c for c in caps if c not in ('head', 'pelvis')]
        dn = [min(float(seg_dist(v.mean(0)[None, :], a, b)[0]) / r for a, b, r in caps[c]) for c in names]
        W[:, BI[CAP_BONE.get(names[int(np.argmin(dn))], names[int(np.argmin(dn))])]] = 1
        return W
    if len(cand) == 1:
        W[:, BI[cand[0]]] = 1
        return W
    if p.name in GATE and p.cls == 'arm':
        s = p.side
        arc = np.where(np.isfinite(GATE[p.name][1]), GATE[p.name][1], 1e3)
        _, _, ge, gw, gt = arm_geo[s]
        lf, lh = gw - ge, gt - gw
        lu = max(ge, 0.05 * H)
        fore = smooth(ge - 0.3 * min(lu, lf), ge + 0.3 * min(lu, lf), arc)  # 0 above the elbow .. 1 below it
        hand = smooth(gw - 0.25 * min(lf, lh), gw + 0.25 * min(lf, lh), arc)
        ca, cc = capsule_term(v, caps, 'arm' + s), capsule_term(v, caps, 'clav' + s)
        cc = cc * (1 - smooth(ge - 0.6 * lu, ge - 0.1 * lu, arc))  # the shoulder's pull ends well above the elbow
        W[:, BI['hand' + s]] = hand
        W[:, BI['fore' + s]] = fore * (1 - hand)
        W[:, BI['arm' + s]] = (1 - fore) * ca / (ca + cc)
        W[:, BI['chest']] = (1 - fore) * cc / (ca + cc)
    elif p.name in GATE and p.cls == 'leg':
        isL, arc = GATE[p.name]
        arc = np.where(np.isfinite(arc), arc, 1e3)
        dk = 0.035 * H
        up = np.ones(len(v))  # how much of the vertex lies above its own knee
        for s in 'LR':
            mine = isL if s == 'L' else ~isL
            a_ = smooth(knee_arc[s] - dk, knee_arc[s] + dk, arc)
            W[:, BI['shin' + s]] = np.where(mine, 1 - a_, 0.0)
            up = np.where(mine, a_, up)
        terms = {c: capsule_term(v, caps, c) for c in ('pelvis', 'thighL', 'thighR')}
        tot = sum(terms.values())
        for c, w in terms.items():
            W[:, BI[CAP_BONE.get(c, c)]] += up * w / tot
    else:
        # a shirt's hem may follow the thighs, but only the part hanging below the hip joints
        below = smooth(0.03 * H, -0.05 * H, (v - body['hips']) @ body['up'])
        for c in cand:
            w = capsule_term(v, caps, c)
            if c.startswith('thigh'):
                w = w * below
            W[:, BI[CAP_BONE.get(c, c)]] += w
    W /= W.sum(1, keepdims=True)
    W[W < 0.02] = 0
    W /= W.sum(1, keepdims=True)
    return W


def measure_radii(JJ, pts_of):
    """Limb thickness from the geometry (JJ = joints, pts_of(cls, side) = points of that body area)."""
    r = {}
    for s in 'LR':
        ap = pts_of('arm', s)
        r['arm' + s] = tube_radius(ap, JJ['arm' + s], JJ['fore' + s], 0.04 * H, 0.45, 0.95)
        r['fore' + s] = tube_radius(ap, JJ['fore' + s], JJ['hand' + s], 0.035 * H)
        r['hand' + s] = max(r['fore' + s], tube_radius(ap, JJ['hand' + s], JJ['tip' + s], 0.04 * H, 0.2, 1.2))
    lp = pts_of('leg', None)
    r['thigh'] = float(np.mean([tube_radius(lp, JJ['thigh' + s], JJ['shin' + s], 0.075 * H, 0.4, 0.9) for s in 'LR']))
    r['shin'] = float(np.mean([tube_radius(lp, JJ['shin' + s], JJ['foot' + s], 0.055 * H) for s in 'LR']))
    r['trunk'] = tube_radius(pts_of('torso', None), JJ['hips'], JJ['neck'], 0.11 * H, 0.15, 0.8)
    return r


def compute_weights(get_verts, body):
    out = {}
    for p in P:
        W = weights_for(p, get_verts(p), body)
        me = p.o.data
        if 'patch' in me.attributes and len(me.attributes['patch'].data) == len(W):
            # a patch closes a hole that was hidden in the sculpt; it has no place of its own on the body, so it
            # moves as its rim does: spread the rim's weights across it
            flag = np.zeros(len(W), dtype=np.int32)
            me.attributes['patch'].data.foreach_get('value', flag)
            mask = flag > 0
            if mask.any():
                e = np.zeros(len(me.edges) * 2, dtype=np.int32)
                me.edges.foreach_get('vertices', e)
                e = e.reshape(-1, 2)
                cnt = np.zeros(len(W))
                np.add.at(cnt, e[:, 0], 1)
                np.add.at(cnt, e[:, 1], 1)
                cnt = np.maximum(cnt, 1)[:, None]
                for _ in range(40):
                    acc = np.zeros_like(W)
                    np.add.at(acc, e[:, 0], W[e[:, 1]])
                    np.add.at(acc, e[:, 1], W[e[:, 0]])
                    W[mask] = (acc / cnt)[mask]
                W /= W.sum(1, keepdims=True)
        out[p.name] = W
    return out


def write_groups(WW, colour=None):
    """Store the weights as vertex groups (4 influences) + `_mix`, how much a vertex is shared between bones."""
    stats = np.zeros(len(BONES))
    for p in P:
        o, W = p.o, WW[p.name]
        order = np.argsort(-W, axis=1)[:, :4]
        top = np.take_along_axis(W, order, axis=1)
        top /= top.sum(1, keepdims=True)
        for vg in list(o.vertex_groups):
            o.vertex_groups.remove(vg)
        groups = {}
        for i in range(len(W)):
            for k in range(4):
                w = float(top[i, k])
                if w > 0.01:
                    bi = int(order[i, k])
                    g = groups.get(bi)
                    if g is None:
                        g = groups[bi] = o.vertex_groups.new(name=BONES[bi])
                    g.add([i], w, 'REPLACE')
                    stats[bi] += w
        mix = o.vertex_groups.new(name='_mix')
        m = 1 - top[:, 0]
        for i in np.nonzero(m > 0.02)[0]:
            mix.add([int(i)], float(min(1.0, m[i] * 2.5)), 'REPLACE')
        if colour:
            if colour in o.data.color_attributes:
                o.data.color_attributes.remove(o.data.color_attributes[colour])
            col = o.data.color_attributes.new(colour, 'FLOAT_COLOR', 'POINT')
            pal = np.array([[(i * 0.37) % 1, (i * 0.61 + 0.3) % 1, (i * 0.83 + 0.6) % 1, 1] for i in range(len(BONES))])
            col.data.foreach_set('color', (W @ pal).astype(np.float32).ravel())
    return stats


def pts_sculpt(cls, side):
    return np.concatenate([p.s for p in P if p.cls == cls and (side is None or p.side == side)])


radii = measure_radii(J, pts_sculpt)
log('radii (sculpt)', {k: round(v / H, 3) for k, v in radii.items()})
W0 = compute_weights(lambda p: verts_gl(p.o), capsules(J, head_top, radii, hole, pelvis_up))
scale_done = {}


def round_limb_patches():
    """A hole along a limb is the side that lay against the body in the sculpt, and the membrane patched across
    it leaves half a limb, flat as a paddle. Finish the tube: at every station along the bone, the patch is
    pushed out to the arc of the circle that the surviving side of the limb is part of."""
    ends = {'arm': 'fore', 'fore': 'hand', 'hand': 'tip', 'thigh': 'shin', 'shin': 'foot'}
    moved = 0
    for p in P:
        if p.cls not in ('arm', 'leg'):
            continue
        me = p.o.data
        if 'patch' not in me.attributes:
            continue
        flag = np.zeros(len(me.vertices), dtype=np.int32)
        me.attributes['patch'].data.foreach_get('value', flag)
        mask = flag > 0
        if not mask.any():
            continue
        v = verts_gl(p.o)
        W = W0[p.name]
        own_bone = W.argmax(1)
        for seg, nxt_ in ends.items():
            if seg == 'hand' and STANDING:
                continue  # an open hand is no tube, and the lids over its finger cuts must stay where they are
            for s in 'LR':
                bi = BI[seg + s]
                a, b = J[seg + s], J[nxt_ + s]
                ab = b - a
                L = float(np.linalg.norm(ab))
                if L < 1e-4:
                    continue
                ax = ab / L
                mine = (own_bone == bi) & (W[:, bi] > 0.55)
                sel, ref = mine & mask, mine & ~mask
                if sel.sum() < 3 or ref.sum() < 20:
                    continue
                t_all = (v - a) @ ax
                u1 = norm(np.cross(ax, np.array([0.0, 1.0, 0.0]) if abs(ax[1]) < 0.9 else np.array([1.0, 0.0, 0.0])))
                u2 = np.cross(ax, u1)
                xy = np.stack([(v - a) @ u1, (v - a) @ u2], axis=1)  # every vertex in the plane across the bone
                nb = max(3, int(L / (0.025 * H)))
                which = np.clip(((t_all / L) * nb).astype(int), 0, nb - 1)
                for k in range(nb):
                    r_ = ref & (np.abs(which - k) <= 1)
                    c_ = sel & (which == k)
                    if r_.sum() < 10 or not c_.any():
                        continue
                    # the circle the surviving surface lies on (the bone itself was fitted to what survives, so it
                    # runs off-centre exactly where a side is missing)
                    q = xy[r_]
                    A = np.stack([q[:, 0], q[:, 1], np.ones(len(q))], axis=1)
                    sol = np.linalg.lstsq(A, -(q ** 2).sum(1), rcond=None)[0]
                    c2 = np.array([-sol[0] / 2, -sol[1] / 2])
                    rr = c2 @ c2 - sol[2]
                    spread = float(np.median(np.linalg.norm(q - q.mean(0), axis=1)))
                    if rr <= 0 or not 0.6 * spread < math.sqrt(rr) < 2.2 * spread:
                        continue
                    # (a circle through a short arc comes out too big: never rounder than the limb is elsewhere)
                    rho = min(math.sqrt(rr), 1.15 * radii.get(seg + s, radii.get(seg, math.sqrt(rr))))
                    m = (q - c2).mean(0)
                    if np.linalg.norm(m) < 0.18 * rho:  # the surface goes all the way round here: nothing is missing
                        continue
                    e1 = -m / np.linalg.norm(m)  # towards the missing side
                    e2 = np.array([-e1[1], e1[0]])
                    x1, x2 = (xy[c_] - c2) @ e1, (xy[c_] - c2) @ e2
                    new1 = np.maximum(x1, 0.92 * np.sqrt(np.maximum(0.0, rho * rho - np.minimum(x2 * x2, rho * rho))))
                    q2 = c2 + np.outer(new1, e1) + np.outer(x2, e2)
                    v[c_] = a + np.outer(t_all[c_], ax) + np.outer(q2[:, 0], u1) + np.outer(q2[:, 1], u2)
                    moved += int(c_.sum())
        set_verts_gl(p.o, v)
    return moved


log('rounded limb patches:', round_limb_patches(), 'vertices')

# ---- both legs the same: a sculpt in a wide, twisted stance (seen in perspective) rarely has them equal, and a
# body with one leg longer cannot stand straight. Stretch / shrink each thigh along its own axis about the hip,
# each shin about the knee, and size the shoes to match.
for seg, joint, child, rest in (('thigh', 'thigh', 'shin', ('shin', 'foot')), ('shin', 'shin', 'foot', ('foot',))):
    length = {s: float(np.linalg.norm(J[child + s] - J[joint + s])) for s in 'LR'}
    target = (length['L'] + length['R']) / 2
    for s in 'LR':
        k = target / length[s]
        if abs(k - 1) < 0.02:
            continue
        pivot, L = J[joint + s], length[s]
        a = (J[child + s] - pivot) / L
        for p in P:
            W = W0[p.name]
            wt = W[:, BI[seg + s]]
            wd = sum(W[:, BI[r + s]] for r in rest)
            if wt.max() < 0.01 and wd.max() < 0.01:
                continue
            v = verts_gl(p.o)
            t = np.clip((v - pivot) @ a, 0, L)
            set_verts_gl(p.o, v + np.outer(wt * (k - 1) * t + wd * (k - 1) * L, a))
        for j in [r + s for r in rest] + ['toe' + s]:
            J[j] = J[j] + a * (k - 1) * L
        scale_done[s] = scale_done.get(s, 1.0) * k ** 0.5
        log(f'{seg} {s} x{k:.3f}')
for s in 'LR':  # a leg that was stretched by a fifth gets a shoe a fifth bigger
    k = scale_done.get(s, 1.0)
    if abs(k - 1) < 0.03:
        continue
    c = J['foot' + s]
    for p in P:
        w = W0[p.name][:, BI['foot' + s]]
        if w.max() < 0.01:
            continue
        v = verts_gl(p.o)
        set_verts_gl(p.o, v + (v - c) * ((k - 1) * w)[:, None])
    J['toe' + s] = c + (J['toe' + s] - c) * k
    J['foot' + s] = J['foot' + s] + np.array([0.0, (J['foot' + s][1] - min(float(verts_gl(shoe[s].o)[:, 1].min()), J['foot' + s][1])) * 0, 0.0])
    log(f'shoe {s} x{k:.3f}')
star = frames_of(J, star['head'], pelvis_up)
D = {b: NEUTRAL[b] @ star[b].T for b in BONES}
leg_len = sum(np.linalg.norm(J['thigh' + s] - J['shin' + s]) + np.linalg.norm(J['shin' + s] - J['foot' + s]) for s in 'LR') / 2
NP = {'hips': np.array([0.0, leg_len + (J['footL'][1] + J['footR'][1]) / 2, 0.0])}
for b in BONES[1:]:
    NP[b] = NP[PARENT[b]] + D[PARENT[b]] @ (J[b] - J[PARENT[b]])
for k, b in (('tipL', 'handL'), ('tipR', 'handR'), ('toeL', 'footL'), ('toeR', 'footR')):
    NP[k] = NP[b] + D[b] @ (J[k] - J[b])
NP['headTop'] = NP['head'] + D['head'] @ (head_top - J['head'])
write_groups(W0)


# ------------------------------------------------------------------ armature helpers
def build_armature(name, JJ, top):
    arm = bpy.data.armatures.new(name)
    ao = bpy.data.objects.new(name, arm)
    scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    for q in scene.objects:
        q.select_set(q is ao)
    bpy.ops.object.mode_set(mode='EDIT')
    eb, ends = {}, ends_of(JJ, top)
    for b in BONES:
        e = arm.edit_bones.new(b)
        e.head = to_bl(JJ[b])
        tail = to_bl(ends[b])
        if (tail - e.head).length < 0.02 * H:
            tail = e.head + Vector((0, 0, 0.03 * H))
        e.tail = tail
        eb[b] = e
    for b, par in PARENT.items():
        eb[b].parent = eb[par]
        eb[b].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return ao


CM = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)  # glTF -> Blender


def pose_armature(ao, rot, pos, JJ):
    """Move every bone b by the rigid transform x -> rot[b] (x - JJ[b]) + pos[b] (glTF space)."""
    bpy.context.view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode='POSE')
    for b in BONES:
        M = np.eye(4)
        M[:3, :3] = CM @ rot[b] @ CM.T
        M[:3, 3] = CM @ (pos[b] - rot[b] @ JJ[b])
        ao.pose.bones[b].matrix = Matrix(M.tolist()) @ ao.data.bones[b].matrix_local
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')


def evaluated_verts(o):
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    n = len(ev.data.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    ev.data.vertices.foreach_get('co', co)
    return co


# ------------------------------------------------------------------ straighten the sculpt into the rest pose
SMOOTH = float(opt('--smooth', 0.6))
ao0 = build_armature(NAME + '_sculpt', J, head_top)
for p in P:
    m = p.o.modifiers.new('rig', 'ARMATURE')
    m.object = ao0
    m.use_deform_preserve_volume = True
    if SMOOTH > 0 and p.cls not in ('head', 'headacc', 'shoe', 'acc'):
        cs = p.o.modifiers.new('cs', 'CORRECTIVE_SMOOTH')
        cs.factor = SMOOTH
        cs.iterations = 24
        cs.rest_source = 'ORCO'
        cs.smooth_type = 'LENGTH_WEIGHTED'
        cs.vertex_group = '_mix'
        cs.use_only_smooth = False
pose_armature(ao0, D, NP, J)
baked = {p.name: evaluated_verts(p.o) for p in P}
for p in P:
    for m in list(p.o.modifiers):
        p.o.modifiers.remove(m)
    p.o.data.vertices.foreach_set('co', baked[p.name])
    p.o.data.update()
bpy.data.objects.remove(ao0)

# stand on the floor, centred under the pelvis
sole = min(float(verts_gl(shoe[s].o)[:, 1].min()) for s in 'LR')
shift = np.array([0.0, -sole, 0.0])
for p in P:
    set_verts_gl(p.o, verts_gl(p.o) + shift)
for k in NP:
    NP[k] = NP[k] + shift
hole_n = {}
for s in 'LR':
    b = 'arm' + s
    hole_n[s] = {'c': NP[b] + D[b] @ (hole[s]['c'] - J[b]), 'r': hole[s]['r']}
height = float(NP['headTop'][1])
log(f'rest pose: height {height / H:.3f}  leg {leg_len / H:.3f}  hips y {NP["hips"][1] / H:.3f}')
for k in BONES:
    log(f'rest {k:7s} ({NP[k][0]:+.3f}, {NP[k][1]:.3f}, {NP[k][2]:+.3f})')

# ------------------------------------------------------------------ legs as straight columns
# Trousers sculpted around a bent leg keep their slack on one side when the leg is straightened: the standing
# figure gets a bulging lap in front and the shin seems to lean. Slide every slice of each trouser leg (and the
# seat above it) back onto the leg's axis, front-to-back; the cuffs stay where the shoes are.
if not OVR.get('noColumns'):
    for s, sgn in (('L', 1), ('R', -1)):
        sel, vv = {}, {}
        for p in leg_parts:
            v = verts_gl(p.o)
            vv[p.name] = v
            sel[p.name] = (v[:, 0] > 0) == (sgn > 0)
        allv = np.concatenate([vv[n][sel[n]] for n in vv])
        y0, y1 = NP['foot' + s][1], float(allv[:, 1].max())
        edges = np.linspace(y0, y1, 15)
        ys, off = [], []
        for k in range(14):
            m = (allv[:, 1] >= edges[k]) & (allv[:, 1] < edges[k + 1])
            if m.sum() >= 12:
                ys.append((edges[k] + edges[k + 1]) / 2)
                off.append((np.percentile(allv[m, 2], 5) + np.percentile(allv[m, 2], 95)) / 2 - NP['thigh' + s][2])
        if len(ys) < 4:
            continue
        off = np.array(off)
        off = np.convolve(np.pad(off, 1, mode='edge'), [0.25, 0.5, 0.25], mode='valid')
        log(f'column {s}: slack ' + ' '.join(f'{o / H:+.3f}' for o in off))
        for p in leg_parts:
            v, m = vv[p.name], sel[p.name]
            d = np.interp(v[:, 1], ys, off) * smooth(y0 + 0.01 * H, y0 + 0.09 * H, v[:, 1])
            # the two halves meet at the crotch: blend across the middle so the seam does not shear
            side_w = smooth(-0.02 * H, 0.02 * H, v[:, 0] * sgn)
            v[:, 2] -= d * side_w
            set_verts_gl(p.o, v)

# ------------------------------------------------------------------ skin the rest pose for the game
cur = {p.name: verts_gl(p.o) for p in P}


def pts_rest(cls, side):
    return np.concatenate([cur[p.name] for p in P if p.cls == cls and (side is None or p.side == side)])


radii_n = measure_radii(NP, pts_rest)
log('radii (rest)', {k: round(v / H, 3) for k, v in radii_n.items()})
body1 = capsules(NP, NP['headTop'], radii_n, hole_n, np.array([0.0, 1.0, 0.0]))
stats = write_groups(compute_weights(lambda p: cur[p.name], body1), 'bone' if DEBUG else None)
log('bone weight totals', {b: int(stats[i]) for i, b in enumerate(BONES)})
for p in P:
    p.o.vertex_groups.remove(p.o.vertex_groups['_mix'])

ao = build_armature(NAME + '_rig', NP, NP['headTop'])

# ------------------------------------------------------------------ fingers
# A hand whose fingers are parts of their own (cut loose in Tripo) can close into a fist. Each finger piece gets
# three bones of its own hanging off the hand bone, and its vertices bend with them by how far along the finger
# they lie. (The thumb's first bone is inside the hand: the ball of the thumb turns with it.) The game turns every finger bone about its hinge by `angle` x grip (0 open .. 1 fist).
FINGERS = []  # {'bone', 'parent', 'head', 'tail', 'axis', 'angle'}


def turn(k, a, x):
    """x turned about the unit axis k by the angle a."""
    return x * math.cos(a) + np.cross(k, x) * math.sin(a) + k * (k @ x) * (1 - math.cos(a))


def arc(a, b):
    """The shortest turn that takes direction a to direction b: (axis, angle)."""
    k = np.cross(a, b)
    sn = float(np.linalg.norm(k))
    if sn < 1e-6:
        return norm(np.cross(a, np.array([0.0, 1.0, 0.0]))), 0.0
    return k / sn, math.atan2(sn, float(a @ b))


def rig_fingers():
    for s, sg in (('L', 1.0), ('R', -1.0)):
        hand = next((q for q in P if q.cls == 'arm' and q.side == s and q.name in meta.get('fingers', {})), None)
        if hand is None:
            continue
        wrist, tip = NP['hand' + s], NP['tip' + s]
        ax = norm(tip - wrist)
        v = cur[hand.name]
        to_rest = lambda x: NP['hand' + s] + (x - J['hand' + s]) @ D['hand' + s].T  # the hand moved as one piece
        clouds = [to_rest(SAMPLES[k].astype(np.float64)) for k in meta['fingers'][hand.name]]
        # which finger each vertex of the hand belongs to (-1 = the palm): the cloud it lies on
        member = np.full(len(v), -1)
        near = np.full(len(v), 0.004 * H)
        dist = []
        for k, c in enumerate(clouds):
            tr = kd(c)
            dk = np.array([tr.find(Vector(x))[2] for x in v])
            dist.append(dk)
            member = np.where(dk < near, k, member)
            near = np.minimum(near, dk)
        palm_v = v[member < 0]
        pc = palm_v.mean(0)
        n = np.linalg.svd(palm_v - pc, full_matrices=False)[2][2]
        n = norm(n - ax * (n @ ax))
        if n @ np.array([-sg * 0.7, -0.7, 0.0]) < 0:  # the palm faces down and in towards the body
            n = -n
        pieces = []
        for k, c in enumerate(clouds):
            cc = c.mean(0)
            d = np.linalg.svd(c - cc, full_matrices=False)[2][0]
            if d @ (cc - pc) < 0:
                d = -d
            t = (c - cc) @ d
            pieces.append({'k': k, 'pts': c, 'd': d, 'base': cc + d * t.min(), 'len': float(t.max() - t.min()), 'off': float(math.acos(np.clip(d @ ax, -1, 1)))})
        thumb = max(pieces, key=lambda f: f['off'])
        if thumb['off'] < 0.4:
            thumb = None
        W = np.zeros((len(v), 0))
        names_all, knuckles = [], []
        across = norm(np.cross(ax, n))  # from one side of the hand to the other, along the knuckles
        for order, f in enumerate(sorted(pieces, key=lambda f: float(f['base'] @ across))):
            f['order'] = order
        for f in sorted(pieces, key=lambda f: f is thumb):
            order, c, d, L = f['order'], f['pts'], f['d'], f['len']
            tc = (c - f['base']) @ d

            def at(u0, u1):  # the middle of the finger between two stations along it
                m = (tc >= u0 * L) & (tc <= u1 * L)
                return c[m].mean(0) if m.sum() >= 3 else f['base'] + d * L * (u0 + u1) / 2

            def thick(u0, u1):  # and how thick it is there
                m = (tc >= u0 * L) & (tc <= u1 * L)
                q = c[m] - c[m].mean(0)
                return float(np.linalg.norm(q - np.outer(q @ d, d), axis=1).mean()) if m.sum() >= 3 else 0.008 * H

            base_c = at(0.0, 0.1)
            base_r = thick(0.0, 0.1)
            t = (v - f['base']) @ d
            e = 0.08 * L
            mine = member == f['k']
            w = np.zeros((len(v), 3))
            if f is not thumb:
                # The first joint is the knuckle, and the knuckle is in the hand, a little way back from where the
                # finger was cut off: the finger turns about it as one, and the skin of the hand around it stretches.
                back = 0.2 * L
                cuts = [0.42, 0.72]
                heads = [base_c - d * back] + [at(q - 0.05, q + 0.05) for q in cuts]
                ends = heads[1:] + [at(0.93, 1.0) + d * 0.03 * L]
                angles = OVR.get('fingerAngles', [1.45, 1.7, 0.95])
                hinges = [norm(np.cross(d, n))] * 3  # the fingers curl towards the palm
                f.update(heads=heads, hinge=hinges[0], angles=angles, r=thick(0.4, 0.75), base_c=base_c)
                # along the finger each stretch hands over to the next around its joint
                beyond = [smooth(q * L - e, q * L + e, t) for q in cuts]
                w[:, 2] = beyond[1]
                w[:, 1] = beyond[0] * (1 - beyond[1])
                w[:, 0] = 1 - w[:, 1:].sum(1)
                w[~mine] = 0
                knuckles.append({'col': W.shape[1], 'thumb': False, 'u': float(base_c @ across), 'k': f['k'], 'band': 0.5 * back,
                                 'along': smooth(-1.6 * back, -0.4 * back, t)})
            else:
                # The thumb has its first joint deep in the hand, near the wrist: the ball of the thumb turns about
                # it, carrying the thumb across the palm. Then the thumb bends where it leaves the hand and once
                # more half way along, and comes to rest on the curled fingers, on the back of their middle joints.
                # Where that is follows from how the fingers curl; the three turns are the ones that take it there.
                # The piece may have been cut off anywhere (with the whole ball of the thumb, or without), so the
                # joints are measured back from the tip, in hand lengths, and not from the cut.
                hl = float(np.linalg.norm(tip - wrist))
                free = min(OVR.get('thumbFree', 0.36) * hl, L)  # from where the thumb leaves the hand to its tip
                tm = L - free
                ti = tm + 0.53 * free
                M = at(max(tm / L - 0.04, 0.0), tm / L + 0.04)
                IP, T = at(ti / L - 0.05, ti / L + 0.05), at(0.93, 1.0) + d * 0.03 * L
                lm = 0.26 * hl
                C = M - d * lm
                low = float((C - wrist) @ ax)
                if low < 0.06 * hl:  # not behind the wrist
                    C = C + d * min((0.06 * hl - low) / max(float(d @ ax), 0.2), 0.7 * lm)
                heads, ends = [C, M, IP], [M, IP, T]

                def rest_on(g):
                    K, Pp, Dp = g['heads']
                    h, (a0, a1) = g['hinge'], g['angles'][:2]
                    P1 = K + turn(h, a0, Pp - K)
                    D1 = P1 + turn(h, a0 + a1, Dp - Pp)
                    return (P1 + D1) / 2 + turn(h, a0 + a1, -n) * (g['r'] + 0.9 * thick(0.6, 0.9))

                others = sorted((g for g in pieces if g is not thumb), key=lambda g: float(np.linalg.norm(g['base_c'] - base_c)))
                if others:
                    # 0 = onto the first finger, 1 = onto the second
                    onto = lambda r: rest_on(others[0]) if len(others) < 2 else rest_on(others[0]) * (1 - r) + rest_on(others[1]) * r
                    k1, full = arc(norm(M - C), norm(onto(0.5) - C))
                    a1 = min(OVR.get('thumbSwing', 0.5) * full, 0.6)
                    M1 = C + turn(k1, a1, M - C)
                    la, lb = float(np.linalg.norm(IP - M)), float(np.linalg.norm(T - IP))
                    # as far across the fingers as it reaches without straightening out
                    away = lambda r: float(np.linalg.norm(onto(r) - M1))
                    rs = [OVR['thumbReach']] if 'thumbReach' in OVR else list(np.linspace(0.3, 1.0, 8))
                    within = [r for r in rs if away(r) <= 0.95 * (la + lb)]
                    tgt = onto(max(within, key=away) if within else min(rs, key=away))
                    u = norm(tgt - M1)
                    far = min(float(np.linalg.norm(tgt - M1)), 0.985 * (la + lb))
                    x = (la * la - lb * lb + far * far) / (2 * far)
                    y = math.sqrt(max(la * la - x * x, 0.0))
                    inward = across * (1.0 if (pc - base_c) @ across > 0 else -1.0)
                    pole = norm(0.6 * ax - 0.7 * inward + 0.4 * n)  # the thumb's middle joint stands out, away from the fingers
                    Pb = M1 + u * x + norm(pole - u * (pole @ u)) * y
                    k2, a2 = arc(turn(k1, a1, norm(IP - M)), norm(Pb - M1))
                    k3, a3 = arc(turn(k2, a2, turn(k1, a1, norm(T - IP))), norm(M1 + u * far - Pb))
                    hinges = [k1, turn(k1, -a1, k2), turn(k1, -a1, turn(k2, -a2, k3))]
                    angles = [a1, a2, a3]
                    log(f'thumb {s}: {L / H:.3f}H long ({free / H:.3f}H of it free, hand {hl / H:.3f}H), turns {a1:.2f} {a2:.2f} {a3:.2f}, tip {float(np.linalg.norm(tgt - M1)) / (la + lb):.2f} of its reach away')
                else:
                    hinges, angles = [ax * (1.0 if np.cross(ax, d) @ n > 0 else -1.0)] * 2 + [n * (1.0 if np.cross(n, d) @ ax > 0 else -1.0)], [0.5, 0.6, 1.0]
                # everything by where it is along the thumb, the hand's own skin around it included: nothing opens
                # where the thumb was cut off
                e2 = 0.12 * free
                sb, sc = smooth(tm - e2, tm + e2, t), smooth(ti - e2, ti + e2, t)
                tC = float((C - f['base']) @ d)
                fade = smooth(tC - 0.1 * (tm - tC), tC + 0.5 * (tm - tC), t)  # nothing moves at the wrist
                w[:, 0], w[:, 1], w[:, 2] = (1 - sb) * fade, sb * (1 - sc) * fade, sb * sc * fade
                w[~mine] = 0
                seg = M - C
                q = np.clip(((v - C) @ seg) / (seg @ seg), 0.0, 1.0)
                far_ = np.linalg.norm(v - (C + np.outer(q, seg)), axis=1)
                r_m = thick(tm / L, tm / L + 0.1)
                knuckles.append({'col': W.shape[1], 'thumb': True, 'k': f['k'], 'band': 0.25 * free, 'sb': sb, 'sc': sc, 'fade': fade,
                                 'thenar': 1 - smooth(1.0 * r_m, 2.6 * r_m, far_)})
            names = [f'f{s}{order}{"abc"[i]}' for i in range(len(heads))]
            for i, nm in enumerate(names):
                FINGERS.append({'bone': nm, 'parent': names[i - 1] if i else 'hand' + s, 'head': heads[i], 'tail': ends[i],
                                'axis': hinges[i], 'angle': round(float(angles[i]), 4)})
            W = np.concatenate([W, w], axis=1)
            names_all += names
        # The skin of the hand right next to a finger goes wholly with that finger, wherever the finger was cut
        # off (so nothing opens along the cut). Further in, the four knuckles are one hinge line across the hand:
        # a vertex follows the finger it lies behind, shared between two neighbours by where it lies between them,
        # so the back of the hand bends as a sheet. The thumb takes the ball of the thumb, by nearness.
        palm_m = member < 0
        hold = np.stack([1 - smooth(0.004 * H, 0.004 * H + kn['band'], dist[kn['k']]) for kn in knuckles], axis=1)
        hold /= np.maximum(hold.sum(1), 1.0)[:, None]
        sheet = np.zeros_like(hold)
        row = sorted([j for j, kn in enumerate(knuckles) if not kn['thumb']], key=lambda j: knuckles[j]['u'])
        u = v @ across
        for i, j in enumerate(row):
            kn = knuckles[j]
            lo = knuckles[row[i - 1]]['u'] if i else -1e9
            hi = knuckles[row[i + 1]]['u'] if i + 1 < len(row) else 1e9
            lat = np.where(u < kn['u'], smooth(lo, kn['u'], u) if i else 1.0, 1 - smooth(kn['u'], hi, u) if i + 1 < len(row) else 1.0)
            sheet[:, j] = kn['along'] * lat
        for j, kn in enumerate(knuckles):
            if kn['thumb']:
                sheet[:, j] = np.minimum(kn['thenar'], 1 - sheet.sum(1))
        room = 1 - hold.sum(1)
        for j, kn in enumerate(knuckles):
            mine = (hold[:, j] + room * sheet[:, j]) * (kn['fade'] if kn['thumb'] else 1.0)
            parts = [1 - kn['sb'], kn['sb'] * (1 - kn['sc']), kn['sb'] * kn['sc']] if kn['thumb'] else [1.0]
            for i, part in enumerate(parts):
                W[:, kn['col'] + i] = np.where(palm_m, mine * part, W[:, kn['col'] + i])
        share = np.clip(W.sum(1), 0, 1)
        o = hand.o
        gname = {g.index: g.name for g in o.vertex_groups}
        groups = {}
        for i in np.nonzero(share > 0.02)[0]:
            i = int(i)
            for ge in list(o.data.vertices[i].groups):
                if share[i] > 0.98:
                    o.vertex_groups[gname[ge.group]].remove([i])
                else:
                    o.vertex_groups[gname[ge.group]].add([i], ge.weight * float(1 - share[i]), 'REPLACE')
            for j in np.nonzero(W[i] > 0.01)[0]:
                nm = names_all[int(j)]
                if nm not in groups:
                    groups[nm] = o.vertex_groups.new(name=nm)
                groups[nm].add([i], float(W[i, j]), 'REPLACE')
        log(f'fingers {s}: {len(pieces)} pieces' + (', thumb is one of them' if thumb else ', thumb is part of the palm') +
            f'; {int((member >= 0).sum())} finger and {int((palm_m & (share > 0.02)).sum())} knuckle vertices of {len(v)}')
    if not FINGERS:
        return
    bpy.context.view_layer.objects.active = ao
    for q in scene.objects:
        q.select_set(q is ao)
    bpy.ops.object.mode_set(mode='EDIT')
    for f in FINGERS:
        e = ao.data.edit_bones.new(f['bone'])
        e.head = to_bl(f['head'])
        tail = to_bl(f['tail'])
        e.tail = tail if (tail - e.head).length > 1e-4 else e.head + Vector((0, 0, 0.01 * H))
        e.parent = ao.data.edit_bones[f['parent']]
        e.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')


if OVR.get('fingers', True):
    rig_fingers()
for p in P:
    p.o.parent = ao
    m = p.o.modifiers.new('rig', 'ARMATURE')
    m.object = ao
r4 = lambda a: [round(float(x), 4) for x in a]
ao['skrig'] = json.dumps({
    'rest': 'neutral',  # the armature's rest pose is a standing A-pose (see client/src/render/model.ts)
    'armA': round(A_POSE, 4),
    'height': round(height, 4),
    'joints': {b: r4(NP[b]) for b in BONES},
    'tips': {k: r4(NP[k]) for k in ('tipL', 'tipR', 'toeL', 'toeR')},
    'headTop': r4(NP['headTop']),
    'sole': 0,
    'radii': {k: round(float(v), 4) for k, v in radii_n.items()},
    # finger bones (children of the hand bones): turn each about `axis` (model space, rest pose) by angle x grip
    'fingers': [{'bone': f['bone'], 'axis': r4(f['axis']), 'angle': f['angle']} for f in FINGERS],
})

# ------------------------------------------------------------------ debug renders
if DEBUG:
    sh = scene.display.shading
    ao.hide_render = True
    cz, sc = height * 0.5, height * 1.12
    xray('restx', NP, NP['headTop'], ('front', 'left'), cz, sc)
    sh.color_type = 'TEXTURE'
    render(cam, 'rest', ('front', 'left', 'back', 'fl'), cz, sc)
    sh.color_type = 'VERTEX'
    for p in P:
        p.o.data.color_attributes.active_color = p.o.data.color_attributes['bone']
    render(cam, 'restw', ('front', 'left', 'back'), cz, sc)

    # stress poses, skinned the way the game does it (linear blend): rig-convention local Euler angles per joint
    POSES = {
        'guard': {'spine': (0.1, 0.15, 0), 'armL': (-1.05, 0, 0.32 - A_POSE), 'foreL': (-1.75, 0, 0), 'armR': (-0.75, 0, -0.38 + A_POSE), 'foreR': (-2.05, 0, 0),
                  'thighL': (-0.42, 0, 0.12), 'shinL': (0.5, 0, 0), 'thighR': (0.28, 0, -0.14), 'shinR': (0.45, 0, 0)},
        'kick': {'spine': (-0.2, 0.2, 0), 'thighL': (-1.5, 0, 0.05), 'shinL': (0.1, 0, 0), 'armL': (-0.6, 0, 0.3 - A_POSE), 'foreL': (-1.9, 0, 0),
                 'armR': (-0.6, 0, -0.3 + A_POSE), 'foreR': (-1.9, 0, 0)},
        'armsup': {'armL': (-2.6, 0, 0.3 - A_POSE), 'foreL': (-0.4, 0, 0), 'armR': (-1.5, 0, -A_POSE + 0.0), 'foreR': (-0.1, 0, 0)},
        'squat': {'spine': (0.35, 0, 0), 'thighL': (-1.35, 0, 0.28), 'shinL': (2.05, 0, 0), 'footL': (-0.7, 0, 0), 'thighR': (-1.2, 0, -0.3), 'shinR': (2.1, 0, 0),
                  'footR': (-0.9, 0, 0), 'armL': (-1.3, 0, -A_POSE), 'foreL': (-2.2, 0, 0), 'armR': (-1.3, 0, A_POSE), 'foreR': (-2.2, 0, 0)},
    }
    sh.color_type = 'TEXTURE'
    for pname, spec in POSES.items():
        F, rot, pos = {}, {}, {}
        for b in BONES:
            e = spec.get(b, (0, 0, 0))
            base = NEUTRAL[b] if b not in PARENT else NEUTRAL[PARENT[b]].T @ NEUTRAL[b]  # rest orientation relative to the parent
            local = base @ euler_xyz(*e)
            F[b] = local if b not in PARENT else F[PARENT[b]] @ local
            rot[b] = F[b] @ NEUTRAL[b].T
            pos[b] = NP[b] if b not in PARENT else pos[PARENT[b]] + rot[PARENT[b]] @ (NP[b] - NP[PARENT[b]])
        low = min(pos['footL'][1], pos['footR'][1]) - min(NP['footL'][1], NP['footR'][1])
        for b in BONES:
            pos[b] = pos[b] - np.array([0, low, 0])
        pose_armature(ao, rot, pos, NP)
        render(cam, 'pose_' + pname, ('fl', 'left'), cz, sc * 1.1)
    pose_armature(ao, {b: np.eye(3) for b in BONES}, NP, NP)
    for p in P:
        p.o.data.color_attributes.remove(p.o.data.color_attributes['bone'])
    bpy.data.objects.remove(cam)

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
log('ok')
