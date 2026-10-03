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
   "parts": {"tripo_part_5": "armR"},  part classes (torso torso2 head headacc armL armR leg shoe cape acc)
   "capeRows": 9, "capeCols": 7,       the cloth a cape hangs as in the game (see rig_cape),
   "capeHold": [1, 0.55, 0.18, 0.06],  and how firmly each row from the top is held to its place on the back
   "headYaw": 0, "headPitch": 0,       how the sculpted head is turned (radians)
   "hipWidth": 0.13, "upperArm": 0.9,  anatomical priors (see fit)
   "headScale": 1.15,                  tailoring (see there): a bigger head,
   "armLength": 1.1, "armThick": 1.04, longer (and a little thicker) arms; by default arms are let out to a span
                                       of 0.97 of the height when they came out shorter than 0.94,
   "slim": 0.85}                       a narrower trunk
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
from mathutils.bvhtree import BVHTree
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
        self.s = SAMP[o.name]
        self.lo, self.hi, self.c = self.s.min(0), self.s.max(0), self.s.mean(0)


def texture_pixels(o):
    """The colour texture of a part as an array (rows, columns, rgb), or None."""
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
    return px.reshape(h, w, 4)[:, :, :3]


def dominant_uv(o, bm, uv, faces):
    """UV of a texel showing the part's most common colour."""
    px = texture_pixels(o)
    if px is None:
        return None
    h, w = px.shape[:2]
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
    o['domcol'] = [float(c) for c in col[best]]
    from mathutils import Vector as V2
    return V2((float(uvs[best, 0]), float(uvs[best, 1])))


DEBUG_HOLES = bool(opt('--dbgholes'))


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
    lidc = bm.faces.layers.int.new('lidc')  # ... and which patch each of them is part of
    uv = bm.loops.layers.uv.active
    n_rim = sum(1 for e in bm.edges if e.is_boundary)
    if not n_rim:
        bm.free()
        return 0
    hand = o.name in meta.get('fingers', {})
    leg = meta['parts'][o.name]['cls'] == 'leg'
    # crumbs: a few triangles on their own, left over where the sculpt was cut or thinned out, are no part of
    # anything - they hang in the air by a hand or a hem - and cannot be closed either
    seen_c, crumbs = set(), []
    for f0 in bm.faces:
        if f0 in seen_c:
            continue
        piece, front = [], [f0]
        seen_c.add(f0)
        while front:
            f = front.pop()
            piece.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g not in seen_c:
                        seen_c.add(g)
                        front.append(g)
        if len(piece) < 24 and len(piece) < 0.01 * len(bm.faces):
            crumbs += piece
    if crumbs and len(crumbs) < len(bm.faces):
        bmesh.ops.delete(bm, geom=crumbs, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context='VERTS')
        print('@@ crumbs', o.name, len(crumbs), 'faces dropped', flush=True)
    # A rim can only be walked if the faces around it agree which side is out. Making them agree is a guess for an
    # open shell, and the guess is often "inside out" (a face, a trouser leg); so every connected piece is then
    # turned back the way most of its faces were, which is the way the sculpt was made.
    bm.faces.ensure_lookup_table()
    was = [f.normal.copy() for f in bm.faces]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    seen_f, turned = set(), 0
    for f0 in bm.faces:
        if f0.index in seen_f:
            continue
        piece, front = [], [f0]
        seen_f.add(f0.index)
        while front:
            f = front.pop()
            piece.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen_f:
                        seen_f.add(g.index)
                        front.append(g)
        if sum((1.0 if f.normal.dot(was[f.index]) > 0 else -1.0) * f.calc_area() for f in piece) < 0:
            bmesh.ops.reverse_faces(bm, faces=piece)
            turned += len(piece)
    if turned:
        bm.normal_update()
        print('@@ turned', o.name, turned, 'faces of', len(bm.faces), 'back the right way out', flush=True)
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
            except ValueError as err:
                if DEBUG_HOLES:
                    print('@@ could not close a ring of', len(ring), 'in', o.name, ':', err, flush=True)
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
    # A rim that could not be walked (its faces do not agree which side is out: a hand whose finger welds were
    # closed above, a part folded onto itself) is left to Blender's own hole filler.
    rest_ = [e for e in bm.edges if e.is_boundary]
    if len(rest_) >= 3:
        try:
            got = bmesh.ops.holes_fill(bm, edges=rest_, sides=0)['faces']
            if got:
                bmesh.ops.triangulate(bm, faces=got)
                print('@@ holes', o.name, 'rim edges that could not be walked:', len(rest_), '->', sum(1 for e in bm.edges if e.is_boundary), flush=True)
        except Exception as err:
            print('@@ warn: holes_fill failed on', o.name, err, flush=True)
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
    # Two kinds of patch. One closes an opening - a sleeve, a hem, a collar, the end of an arm inside its sleeve: the
    # cloth ends at its rim, and the surface there faces across the patch. What shows of it is the inside of a
    # garment, and it is drawn dark (see inside_materials). The other mends a gap in a surface that carries on
    # across it; the surface at its rim faces the way the patch does, and it is drawn as that surface.
    bm.normal_update()
    todo = {f for f in capset if f.is_valid}
    n_open = 0
    comps_ = []
    while todo:
        comp, front = [], [todo.pop()]
        while front:
            f = front.pop()
            comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g in todo:
                        todo.discard(g)
                        front.append(g)
        nc = Vector((0.0, 0.0, 0.0))
        for f in comp:
            nc += f.normal * f.calc_area()
        kind = 1
        rims = {v for f in comp for v in f.verts if v[rimn].length > 0.5}
        # (a hole smaller than a thumbnail is a crack in a surface - between two fingers, behind an ear - and no
        # opening of anything)
        if nc.length > 1e-12 and rims and sum(f.calc_area() for f in comp) > (0.012 * H) ** 2:
            nc.normalize()
            if sum(abs(v[rimn].normalized().dot(nc)) for v in rims) / len(rims) < 0.8:
                kind = 2
                # (trousers open upwards, at the waist, and downwards, at the cuffs. A hole in the side of a leg -
                # the whole inside of a thigh, where it lay against the other one - is cloth that was never
                # sculpted, and is mended as cloth)
                if leg and abs(nc.z) < 0.6:
                    kind = 1
                else:
                    n_open += len(comp)
        for f in comp:
            f[lid] = kind
            f[lidc] = len(comps_) + 1
        comps_.append((sum(f.calc_area() for f in comp), comp, kind))
    if hand:
        # a hand has no openings: it ends at a cut through the wrist or the palm (skin on both sides), and every
        # other hole in it is a tear where a finger was welded back on
        for area_, comp, kind in comps_:
            if kind == 2:
                for f in comp:
                    f[lid] = 1
                n_open -= len(comp)
    # The edge between a patch and the surface it closes is a hard one: the surface is shaded as if it went on (it
    # does, into the next part), not as if it turned the corner into its own lid.
    for e in bm.edges:
        lf_ = e.link_faces
        if len(lf_) == 2 and (lf_[0] in capset) != (lf_[1] in capset):
            e.smooth = False
    n = len(capset)
    left = sum(1 for e in bm.edges if e.is_boundary)
    print('@@ holes', o.name, 'rim edges', n_rim, '->', left, 'patch faces', n, 'of them closing openings', n_open,
          'colour', [round(float(x), 2) for x in o.get('domcol', [])], flush=True)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()
    return n


# ------------------------------------------------------------------ tailoring
# A sculpt is taken as it comes, except for what a tailor would do before the fitting: a head made too small for
# its body is scaled up about the collar, arms that came out short are let out, a shirt cut for someone half as
# wide again is taken in. Each is one smooth move of space applied to every part alike (the meshes, their samples,
# the places where parts meet), so nothing comes apart at a seam.
SAMP = {n: SAMPLES[n].astype(np.float64) for n in meta['parts']}
PCLS = {n: m['cls'] for n, m in meta['parts'].items()}


def warp(fn):
    """Move every point of the sculpt: fn(points, class of their part) -> points."""
    for o in scene.objects:
        if o.type == 'MESH':
            set_verts_gl(o, fn(verts_gl(o), PCLS[o.name]))
            SAMP[o.name] = fn(SAMP[o.name], PCLS[o.name])
    for f in meta['interfaces']:
        if f['a'] not in PCLS or f['b'] not in PCLS:  # (a finger piece that was welded onto its hand)
            continue
        both = PCLS[f['a']] in ('head', 'headacc') and PCLS[f['b']] in ('head', 'headacc')
        f['c'] = fn(np.array([f['c']], dtype=np.float64), 'head' if both else 'torso')[0].tolist()


def neck_of(col, cx):
    """The neck in a cloud of the head, the neck and the top of the trunk: the level at which the column over the
    collar is narrowest (about half way up the neck), and the middle of the neck, front to back, at that level."""
    col = col[np.abs(col[:, 0] - cx) < 0.16 * H]
    top = float(col[:, 1].max())
    best = None
    for y in np.arange(0.76 * H, top - 0.08 * H, 0.004 * H):
        b = col[(col[:, 1] >= y) & (col[:, 1] < y + 0.008 * H)]
        if len(b) < 15:
            continue
        w = float(np.percentile(b[:, 0], 98) - np.percentile(b[:, 0], 2))
        if best is None or w < best[0]:
            best = (w, y + 0.004 * H, float((np.percentile(b[:, 2], 5) + np.percentile(b[:, 2], 95)) / 2))
    return (best[1], best[2]) if best else (0.85 * H, float(np.median(col[:, 2])))


NECK_DOWN, NECK_UP = 0.02, 0.03  # the neck turns between this far below its narrowest level and this far above it


def tailor():
    cat = lambda *cls: np.concatenate([SAMP[n] for n, c in PCLS.items() if c in cls])
    trunk = cat('torso')
    cx = float(np.median(trunk[:, 0]))
    arms = {s: np.concatenate([SAMP[n] for n, m in meta['parts'].items() if m['cls'] == 'arm' and m['side'] == s] or [np.zeros((0, 3))]) for s in 'LR'}
    if not len(arms['L']) or not len(arms['R']):
        return
    both = np.concatenate([arms['L'], arms['R']])
    t_pose = float(np.abs(both[:, 0] - cx).max()) > 0.33 * H and float(both[:, 1].mean()) > 0.62 * H
    if not t_pose and (OVR.get('slim') or OVR.get('armLength')):
        log('warn: slim / armLength are for sculpts that stand with their arms out; ignored')
    x0 = OVR.get('shoulderX', 0.108) * H
    # ---- a narrower trunk. The middle (collar, neck, the print on the chest) stays as it is; from there out to
    # the side seams the shirt is taken in, and the arms come in with the seams. Below the hem nothing changes.
    k = float(OVR.get('slim', 1.0))
    if t_pose and k < 0.999:
        band = trunk[(trunk[:, 1] > 0.6 * H) & (trunk[:, 1] < 0.74 * H)]
        xs = float(np.percentile(np.abs(band[:, 0] - cx), 97))
        hem = float(np.percentile(trunk[:, 1], 1))
        b_ = 0.06 * H  # the taking-in grows from nothing at the middle to its full rate this far out
        rate = (1 - k) * xs / (xs - b_ / 2)

        def slim(pts, cls):
            if cls in ('head', 'headacc'):
                return pts
            u = np.abs(pts[:, 0] - cx)
            v_ = np.minimum(u, xs)
            f = u - rate * np.where(v_ < b_, v_ * v_ / (2 * b_), v_ - b_ / 2)
            g = smooth(hem - 0.06 * H, hem - 0.01 * H, pts[:, 1])
            out = np.array(pts, dtype=np.float64)
            out[:, 0] = pts[:, 0] + np.sign(pts[:, 0] - cx) * (f - u) * g
            return out

        warp(slim)
        log(f'tailoring: trunk taken in to {k:.2f} of its width (side seams at {xs / H:.3f}H -> {k * xs / H:.3f}H)')
    # ---- longer arms: everything beyond the shoulder joints is let out along the arm, and thickened a little
    # about the arm's own middle so that a longer arm is not a thinner-looking one. An arm's length is measured
    # along the arm (one held half way down reaches less far sideways and is no shorter for it).
    geo = {}
    for s, sg in (('L', 1.0), ('R', -1.0)):
        a = np.concatenate([SAMP[n] for n, m in meta['parts'].items() if m['cls'] == 'arm' and m['side'] == s])
        a = a[sg * (a[:, 0] - cx) > x0]
        if len(a) < 50:
            break
        c = a.mean(0)
        d = np.linalg.svd(a - c, full_matrices=False)[2][0]
        d = d * (sg if d[0] > 0 else -sg)  # outwards along the arm
        p0 = c + d * ((cx + sg * x0 - c[0]) / d[0])  # where the arm's line passes the shoulder joint
        geo[s] = (p0, d, float(((a - p0) @ d).max()))
    reach = 2 * x0 + geo['L'][2] + geo['R'][2] if len(geo) == 2 else H  # the span these arms would have held straight out
    log(f'tailoring: arms reach {reach / H:.3f}H' + (f' ({geo["L"][2] / H:.3f} / {geo["R"][2] / H:.3f} from the shoulder joints)' if len(geo) == 2 else ''))
    k = OVR.get('armLength')
    if k is None:
        k = float(np.clip((0.97 * H - 2 * x0) / max(reach - 2 * x0, 1e-6), 1.0, 1.22)) if t_pose and reach < 0.94 * H else 1.0
    if t_pose and len(geo) == 2 and abs(k - 1) > 0.005:
        kr = float(OVR.get('armThick', 1 + 0.35 * (k - 1)))

        def let_out(pts, cls):
            if cls in ('head', 'headacc', 'leg', 'shoe', 'cape'):  # (a cape hangs behind the shoulders, not on the arms)
                return pts
            out = np.array(pts, dtype=np.float64)
            for s, sg in (('L', 1.0), ('R', -1.0)):
                p0, d, _ = geo[s]
                t = (pts - p0) @ d
                sel = (t > 0) & (sg * (pts[:, 0] - cx) > 0)
                if not sel.any():
                    continue
                q = pts[sel] - p0 - np.outer(t[sel], d)  # from the arm's line to the point
                # (only what lies about the arm: the side of a wide shirt out here is not arm)
                near = 1 - smooth(0.1 * H, 0.16 * H, np.linalg.norm(q, axis=1))
                thick = 1 + (kr - 1) * smooth(0.02 * H, 0.1 * H, t[sel]) * near
                out[sel] = p0 + np.outer(t[sel] * (1 + (k - 1) * near), d) + q * thick[:, None]
            return out

        warp(let_out)
        log(f'tailoring: arms let out x{k:.3f} (they reached {reach / H:.3f}H), thickness x{kr:.3f}')
    # ---- a bigger head: the whole head group about the base of the neck
    k = float(OVR.get('headScale', 1.0))
    if abs(k - 1) > 0.005:
        yn, zn = neck_of(cat('head', 'headacc', 'torso', 'torso2'), cx)
        c0 = np.array([cx, yn - NECK_DOWN * H, zn])

        def bigger(pts, cls):
            if cls in ('head', 'headacc'):
                return c0 + (pts - c0) * k
            if cls == 'torso2':  # skin that runs on up the neck into the face is part of the head it belongs to
                h = smooth(c0[1], c0[1] + (NECK_DOWN + NECK_UP) * H, pts[:, 1]) * (1 - smooth(0.08 * H, 0.12 * H, np.abs(pts[:, 0] - c0[0])))
                return pts + (pts - c0) * ((k - 1) * h)[:, None]
            return pts

        warp(bigger)
        log(f'tailoring: head x{k:.3f} about the base of the neck ({c0[0] / H:+.3f}, {c0[1] / H:.3f}, {c0[2] / H:+.3f})')


def drop_cords(o):
    """The cords of a waistband: thin, long, hanging things sculpted standing a little way off the cloth, and grown
    into it wherever they touch it. There is no good way to skin them. Skinned like the cloth behind them they arch
    from the waist over a lifted thigh like the handle of a basket and stretch between two legs; given whole to
    the thigh they lie on, they stand out of a kick like rods; hung from the pelvis, they pull spikes out of the
    cloth they are grown into. A cord needs a simulation, and this game has none: so they are taken off, and the
    cloth is mended where they were (fill_holes). They are found by what they are: a finger's breadth through, many
    times longer than wide, round, and hanging down. -> how many, or 'all' if the part is nothing but a cord."""
    me = o.data
    n = len(me.vertices)
    if n < 50:
        return 0
    bvh = BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get())
    thick, nor = np.full(n, np.inf), np.zeros((n, 3))
    for v in me.vertices:
        d = -v.normal
        nor[v.index] = v.normal
        hit = bvh.ray_cast(v.co + d * (0.0005 * H), d, 0.05 * H)
        if hit[0] is not None and hit[1].dot(d) > 0.2:  # out through the far side
            thick[v.index] = hit[3]
    thin = thick < 0.015 * H
    if thin.sum() < 60:
        return 0
    e = np.zeros(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get('vertices', e)
    e = e.reshape(-1, 2)
    e = e[thin[e[:, 0]] & thin[e[:, 1]]]
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in e.tolist():
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    groups = {}
    for i in np.nonzero(thin)[0]:
        groups.setdefault(find(int(i)), []).append(int(i))
    co = verts_gl(o)
    cord, k = np.zeros(n, dtype=bool), 0
    for g in groups.values():
        if len(g) < 60:
            continue
        g = np.array(g)
        c = co[g] - co[g].mean(0)
        ax = np.linalg.svd(c, full_matrices=False)[2]
        ext = [float(np.ptp(c @ a_)) for a_ in ax]
        if ext[0] >= 0.08 * H and ext[1] <= 0.35 * ext[0] and abs(ax[0][1]) > 0.7 and float(np.linalg.norm(nor[g].mean(0))) < 0.35:
            k += 1
            cord[g] = True
            log(f'cord taken off {o.name}: {len(g)} vertices, {ext[0] / H:.3f}H long, at x {co[g, 0].mean() / H:+.3f}, y {co[g, 1].min() / H:.3f}..{co[g, 1].max() / H:.3f}')
    if not k:
        return 0
    if cord.sum() > 0.6 * n:
        return 'all'
    tree = kd(co[cord])
    keep = np.array([tree.find(Vector(x))[2] > 0.012 * H for x in SAMP[o.name]])
    if keep.sum() > 50:
        SAMP[o.name] = SAMP[o.name][keep]
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if any(cord[v.index] for v in f.verts)], context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.update()
    return k


tailor()
for o in [o for o in scene.objects if o.type == 'MESH']:
    if meta['parts'][o.name]['cls'] == 'leg' and OVR.get('dropCords', True) and drop_cords(o) == 'all':
        for d_ in (meta['parts'], SAMP, PCLS):
            d_.pop(o.name, None)
        bpy.data.objects.remove(o)
        continue
    if meta['parts'][o.name]['cls'] == 'cape':
        # The panels of a cape are thin shells, open only where Tripo cut them apart, and every such rim lies on the
        # next panel's (snap_cuts closes the hair-lines between them). A lid across one would be a flat sheet through
        # the folds of the cloth.
        continue
    fill_holes(o)
P = [Part(o) for o in sorted([o for o in scene.objects if o.type == 'MESH'], key=lambda o: o.name)]
byname = {p.name: p for p in P}
IF = {}
for f in meta['interfaces']:
    IF[(f['a'], f['b'])] = IF[(f['b'], f['a'])] = {'c': np.array(f['c']), 'r': f['r'], 'n': f['n']}


def seams_of():
    """Where the sculpt was cut: rim vertices of one part lying on rim vertices of another. They were one point
    before the cut and must stay one in every pose; the model check (client/src/dev/qa.ts) holds the rig to it."""
    out = []
    rims = {q.name: rim_of(q)[0] for q in P}
    pos = {q.name: verts_gl(q.o) for q in P}
    for i_, a_ in enumerate(P):
        for b_ in P[i_ + 1:]:
            if not IF.get((a_.name, b_.name)) or not len(rims[a_.name]) or not len(rims[b_.name]):
                continue
            if 'shoe' in (a_.cls, b_.cls) and 'leg' in (a_.cls, b_.cls):
                continue  # a cuff over a shoe is no cut: the ankle between them was never sculpted
            tb = kd(pos[b_.name][rims[b_.name]])
            for u in rims[a_.name]:
                _, j, dd = tb.find(Vector(pos[a_.name][u]))
                if dd < 0.006 * H:
                    out.append((a_.name, int(u), b_.name, int(rims[b_.name][j])))
    return out


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
    on = np.linalg.norm(n, axis=1) > 0.5
    if 'patch' in me.attributes and len(me.attributes['patch'].data) == len(on):
        # (where two holes touched, the rim vertex was split in two, and the half that only patches hang on is patch)
        flag = np.zeros(len(on), dtype=np.int32)
        me.attributes['patch'].data.foreach_get('value', flag)
        on &= flag == 0
    idx = np.nonzero(on)[0]
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


def snap_cuts():
    """Where the sculpt was cut into parts the two rims were one line. Each part was then thinned out on its own, and
    the two rims are now two different zigzags along that line, with hair-line gaps and overlaps between them. Put
    every rim vertex onto the other part's rim (first one side, then the other, onto what the first has become):
    the two zigzags become one again, to within what the eye can see."""
    moved = 0
    rims = {q.name: rim_of(q)[0] for q in P}
    for i_, a_ in enumerate(P):
        for b_ in P[i_ + 1:]:
            if not IF.get((a_.name, b_.name)) or not len(rims[a_.name]) or not len(rims[b_.name]):
                continue
            if 'shoe' in (a_.cls, b_.cls) and 'leg' in (a_.cls, b_.cls):
                continue
            for src, dst in ((a_, b_), (b_, a_)):
                vs, vd = verts_gl(src.o), verts_gl(dst.o)
                rd = rims[dst.name]
                on_rim = np.zeros(len(vd), dtype=bool)
                on_rim[rd] = True
                e = np.zeros(len(dst.o.data.edges) * 2, dtype=np.int32)
                dst.o.data.edges.foreach_get('vertices', e)
                e = e.reshape(-1, 2)
                e = e[on_rim[e[:, 0]] & on_rim[e[:, 1]]]
                at = {}
                for k_, (p0, p1) in enumerate(e.tolist()):
                    at.setdefault(p0, []).append(k_)
                    at.setdefault(p1, []).append(k_)
                tree = kd(vd[rd])
                hit = False
                for u in rims[src.name]:
                    _, j, dd = tree.find(Vector(vs[u]))
                    if dd > 0.006 * H:
                        continue
                    w = int(rd[j])
                    best, to = dd, vd[w]
                    for k_ in at.get(w, []):
                        p0, p1 = vd[e[k_, 0]], vd[e[k_, 1]]
                        ab = p1 - p0
                        q = p0 + ab * float(np.clip(((vs[u] - p0) @ ab) / max(float(ab @ ab), 1e-18), 0.0, 1.0))
                        d2 = float(np.linalg.norm(vs[u] - q))
                        if d2 < best:
                            best, to = d2, q
                    vs[u] = to
                    moved += 1
                    hit = True
                if hit:
                    set_verts_gl(src.o, vs)
    return moved


log('rim vertices put onto the rim of the part they were cut from:', snap_cuts())
SEAMS = seams_of()


def lids_at_cuts():
    """A patch that closes a part where it was cut from the next part is no opening: the surface goes on there, in
    the other part. The two never meet quite point for point (each part was thinned out on its own), and what shows
    through the hair-line gaps between them should be more of the same surface, not the dark of an inside. Only a
    rim with nothing against it - a hem, a cuff, a collar, the end of a sleeve - is an opening."""
    at_cut = {}
    for a_, u_, b_, w_ in SEAMS:
        at_cut.setdefault(a_, set()).add(u_)
        at_cut.setdefault(b_, set()).add(w_)
    turned = 0
    for p in P:
        me = p.o.data
        nf = len(me.polygons)
        if 'lidc' not in me.attributes or len(me.attributes['lidc'].data) != nf:
            continue
        lid_, comp_ = np.zeros(nf, dtype=np.int32), np.zeros(nf, dtype=np.int32)
        me.attributes['lid'].data.foreach_get('value', lid_)
        me.attributes['lidc'].data.foreach_get('value', comp_)
        if p.cls == 'leg':
            # Half a pair of trousers has one rim: round the waist and down the middle, and one patch closes it. The
            # part of the patch that lies across the waist is the opening; the part that stands in the middle, the
            # whole inside of the thigh where it lay against the other one, is cloth that was never sculpted, and
            # is drawn as cloth - it is what shows of the leg from the other side in every kick.
            pn = np.zeros(nf * 3, dtype=np.float32)
            me.polygons.foreach_get('normal', pn)
            wall = (lid_ == 2) & (np.abs(pn.reshape(-1, 3)[:, 2]) < 0.6)
            lid_[wall] = 1
            turned += int(wall.sum())
            me.attributes['lid'].data.foreach_set('value', lid_)
        if p.name not in at_cut:
            continue
        lv = np.zeros(len(me.loops), dtype=np.int32)
        me.loops.foreach_get('vertex_index', lv)
        lt = np.zeros(nf, dtype=np.int32)
        me.polygons.foreach_get('loop_total', lt)
        face_of = np.repeat(np.arange(nf), lt)
        rim = np.zeros(len(me.vertices), dtype=bool)
        rim[rim_of(p)[0]] = True
        cut = np.zeros(len(me.vertices), dtype=bool)
        cut[list(at_cut[p.name])] = True
        for c in np.unique(comp_[lid_ == 2]):
            faces = (comp_ == c) & (lid_ == 2)
            vs = np.unique(lv[faces[face_of]])
            vs = vs[rim[vs]]
            if len(vs) and cut[vs].mean() > 0.6:
                lid_[faces] = 1
                turned += int(faces.sum())
        me.attributes['lid'].data.foreach_set('value', lid_)
    return turned


log('patches at cuts between parts, drawn as the surface they close:', lids_at_cuts(), 'faces')

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
    shaft = sh.s[np.abs(sh.s[:, 1] - (sh.lo[1] + (OVR.get('ankleHeight', 0.05) + 0.05) * H)) < 0.012 * H]  # (above the instep)
    if sh.hi[1] - sh.lo[1] > 0.14 * H and len(shaft) >= 10:
        # a boot: where it meets the trousers is half way up the calf, nowhere near the ankle. The ankle is where a
        # body has it, in the middle of the boot's shaft just above it.
        J['foot' + s] = np.array([shaft[:, 0].mean(), sh.lo[1] + OVR.get('ankleHeight', 0.05) * H, shaft[:, 2].mean()])
        log(f'boot {s}: {(sh.hi[1] - sh.lo[1]) / H:.3f}H tall, ankle by proportion')
    elif cands:
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


def arms_out():
    """A sculpt made with its arms held out to the sides is a standing one, whatever its trousers hide."""
    a = [p.s for p in P if p.cls == 'arm']
    if not a:
        return False
    a = np.concatenate(a)
    return float(np.abs(a[:, 0] - tp[:, 0].mean()).max()) > 0.33 * H and float(a[:, 1].mean()) > 0.62 * H


STANDING = OVR['standing'] if 'standing' in OVR else (all(leg_is_straight(s) for s in 'LR') or arms_out())
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
            if crotch is None:
                continue  # (the ragged top edge of a waistband says nothing: the search starts below it)
            break
        crotch = yb * H
    if crotch is None:
        crotch = 0.4 * H
        log('warn: could not find the fork of the legs; assumed 0.40')
    side = {}
    for s in 'LR':
        up = [r[1] for r in leg_line[s] if crotch - 0.1 * H < r[1][1] < crotch - 0.02 * H]
        side[s] = np.mean(up, axis=0) if up else J['foot' + s]
    # The hip joints are where a body has them: a little over half its height up, a hand's breadth either side of
    # the middle. The fork of the trousers says little about it (a low crotch is cloth, not leg): hips put just
    # above a baggy fork made the thighs half their length, the knees bend in the shins, and the seat swing out
    # sideways with every step.
    half = float(np.clip((side['L'][0] - side['R'][0]) / 2, 0.05 * H, 0.062 * H))
    hip_y = max(crotch + OVR.get('hipRise', 0.045) * H, OVR.get('hipHeight', 0.505) * H)
    pelvis = np.array([mx, hip_y, (side['L'][2] + side['R'][2]) / 2])
    pelvis_up, lat, HIP_W = np.array([0, 1.0, 0]), np.array([1.0, 0, 0]), 2 * half
    J['thighL'], J['thighR'] = pelvis + lat * half, pelvis - lat * half
    log(f'standing model: neck was {(J["neck"][0] - mx) / H:+.3f} off the centre line')
    # The neck of a body standing square is on its centre line. It turns over its own length: the neck joint at its
    # base, the head joint where the skull sits on it (see up_the_neck for what turns with which).
    yn_, zn_ = neck_of(np.concatenate([p.s for p in P if p.cls in ('head', 'headacc', 'torso', 'torso2')]), mx)
    log(f'standing model: neck narrowest at {yn_ / H:.3f}H, {zn_ / H:+.3f} front to back')
    # A hood worn up round the neck (or a high collar) hides the neck, and the narrowest place over the collar is then
    # up in the face, between the headphones: a head turning there tears the face in two, the mouth left with the chest
    # and the brow gone with the head. The head turns below the face, always.
    fb_ = meta.get('face_box')
    if not fb_ and OVR.get('keepFace', True):  # (a cache from before prep wrote it down: the same window, measured here)
        fb_ = {'lo': max(float(p.hi[1]) for p in P if p.cls in ('head', 'headacc', 'torso2')) - 0.16 * H}
    if fb_ and yn_ + NECK_UP * H > fb_['lo'] - 0.01 * H:
        yn_ = fb_['lo'] - 0.01 * H - NECK_UP * H
        log(f'standing model: the narrowest place was in the face (a hood or a high collar); the head turns below it, at {(yn_ + NECK_UP * H) / H:.3f}H')
    J['neck'] = np.array([mx, yn_ - NECK_DOWN * H, zn_])
    J['head'] = np.array([mx, yn_ + NECK_UP * H, zn_])
    log(f'standing model: fork of the legs at {crotch / H:.3f}, hips at {pelvis[1] / H:.3f}, {half / H:.3f} either side')
    FORK_DROP = float(pelvis[1] - crotch)  # how far below the hip joints the trousers fork
    # Two legs of a pair of trousers (or of wide shorts) that touch below the fork were never one surface, however
    # the sculpt was cut: each is its own tube, and the two part company with every step. They are not welded.
    _n = len(SEAMS)
    _pos = {}
    _keep = []
    for a_, u_, b_, w_ in SEAMS:
        pa, pb = byname[a_], byname[b_]
        if pa.cls == 'leg' and pb.cls == 'leg' and (pa.c[0] - mx) * (pb.c[0] - mx) < 0 and min(abs(pa.c[0] - mx), abs(pb.c[0] - mx)) > 0.02 * H:
            if a_ not in _pos:
                _pos[a_] = verts_gl(pa.o)
            if float(_pos[a_][u_][1]) < crotch - 0.01 * H:
                continue
        _keep.append((a_, u_, b_, w_))
    SEAMS = _keep
    if _n != len(SEAMS):
        log(f'legs that touch below the fork are two tubes: {_n - len(SEAMS)} seam pairs between them let go')
for _ in range(1):
    for s in 'LR':
        rows = leg_line[s]
        a = J['foot' + s]
        ab = J['thigh' + s] - a
        if STANDING:  # a straight leg: the knee is where a body's knee is, 0.285 of its height up
            t_k = float(np.clip((OVR.get('kneeHeight', 0.285) * H - a[1]) / max(ab[1], 1e-6), 0.42, 0.6))
            cuts = [c for c in leg_cuts[s] if abs(((c - a) @ ab) / (ab @ ab) - t_k) < 0.045]
            how[s] = 'standing leg, by proportion'
            if cuts:  # trousers cut into parts right at the knee
                t_k = float(((min(cuts, key=lambda c: abs(((c - a) @ ab) / (ab @ ab) - t_k)) - a) @ ab) / (ab @ ab))
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
    # (a thick sleeve pulls the centre line about; a model standing with its arms out still has straight arms)
    arm_straight[s] = dev < (0.09 if STANDING else 0.05) * H and abs(ax[0]) > 0.35 and OVR.get('straightArms', True)
    log(f'arm {s}: centre line strays {dev / H:.3f}H from straight')
    if arm_straight[s]:
        sg = 1.0 if s == 'L' else -1.0
        up_ax = norm(line[max(2, len(line) // 3)] - first)  # the way the upper arm runs
        if abs(up_ax[0]) < 0.3:
            up_ax = ax
        S = first + up_ax * ((J['neck'][0] + sg * OVR.get('shoulderX', 0.108) * H - first[0]) / up_ax[0])  # the joint, inside the shoulder
        # A wide sleeve hangs below the arm it is on, so the middle of the sleeve is lower than the joint. The
        # joint lies a fixed depth under the top of the shoulder; turning about the sleeve's middle instead, an
        # arm brought down carries the top of the sleeve out sideways into a ball the size of the head.
        over = arm.pos[np.abs(arm.pos[:, 0] - S[0]) < 0.02 * H]
        if len(over) >= 8:
            y_top = float(np.percentile(over[:, 1], 97))
            S = S + np.array([0.0, float(np.clip(y_top - OVR.get('shoulderDepth', 0.045) * H - S[1], 0.0, 0.035 * H)), 0.0])
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
if STANDING and all(arm_straight.values()) and OVR.get('shoulderDrop', 0.025) > 0:
    # Arms held straight out lift the shoulders: the line from the neck to the arm is level, up by the chin. With
    # the arms down a body's shoulders slope. The sculpt itself is reshaped: the arms come down a little, and the
    # top of the trunk slopes down to them from the sides of the neck.
    drop_ = OVR.get('shoulderDrop', 0.025) * H
    cx_, sx_, sy_ = float(J['neck'][0]), float(abs(J['armL'][0] - J['neck'][0])), float(J['armL'][1])

    def slope(pts):
        """The same for every part (a sleeve and the shirt it grows out of must not come apart): nothing at the
        middle, all of the drop from the shoulder joints outwards; and only down to the armpits, except out past
        the joints, where everything is arm."""
        u_ = np.abs(pts[:, 0] - cx_)
        g_ = smooth(0.04 * H, sx_, u_)
        f_ = np.maximum(smooth(sy_ - 0.16 * H, sy_ - 0.04 * H, pts[:, 1]), smooth(sx_, sx_ + 0.05 * H, u_))
        out_ = np.array(pts, dtype=np.float64)
        out_[:, 1] -= drop_ * g_ * f_
        return out_

    for p in P:
        if p.cls in ('head', 'headacc', 'leg', 'shoe'):
            continue
        set_verts_gl(p.o, slope(verts_gl(p.o)))
        p.s = slope(p.s)
    for s in 'LR':
        for b in ('arm', 'fore', 'hand', 'tip'):
            J[b + s] = J[b + s] - np.array([0.0, drop_, 0.0])
        hole[s]['c'] = hole[s]['c'] - np.array([0.0, drop_, 0.0])
        arm_geo[s][0].pos = slope(arm_geo[s][0].pos)
    log(f'shoulders sloped: arms {drop_ / H:.3f}H lower, joints at {J["armL"][1] / H:.3f}H')

# ---- shoulders of a standing sculpt: one rule for every part
# Around a shoulder there are a shirt, its sleeve, the arm inside it, bare skin, the patches that close them - cut
# into parts wherever Tripo happened to cut. If each part decides for itself how much it follows the arm, they
# come apart where they meet (a sleeve that half-follows stands out like a wing; a bare shoulder tears out of its
# armhole). So how much of a point goes with the arm is a matter of where the point is, and nothing else:
#   * along the arm: nothing inside the shoulder joint, everything outside it, turning over within a few
#     centimetres of the joint - a whole ring of the sleeve turns together, top and bottom;
#   * except under the arm, inside the trunk's side: the armpit and the side below it stay with the trunk, and the
#     underside of the sleeve is stretched between them like the web of a hand.
UNIFIED = bool(STANDING and all(arm_straight.values()) and OVR.get('unifiedShoulders', True))
SH = {}
if UNIFIED:
    cx_ = float(J['neck'][0])
    trunk_ = np.concatenate([p.s for p in P if p.cls in ('torso', 'torso2')])
    for s, sg in (('L', 1.0), ('R', -1.0)):
        S = J['arm' + s]
        ax = norm(J['fore' + s] - S)
        dn = norm(np.array([0.0, -1.0, 0.0]) + ax * ax[1])  # straight down from the arm
        # the trunk's side under the arm: its half-width a little below the armpit (the narrowest of three levels:
        # one that still catches a sleeve reads wide)
        wid = []
        for dy in (0.12, 0.16, 0.2):
            b_ = trunk_[(np.abs(trunk_[:, 1] - (S[1] - dy * H)) < 0.02 * H) & (sg * (trunk_[:, 0] - cx_) > 0)]
            if len(b_) >= 20:
                wid.append(float(np.percentile(sg * (b_[:, 0] - cx_), 97)))
        side_ = min(wid) if wid else abs(S[0] - cx_) + 0.02 * H
        # the armpit: the underside of the arm (or of its sleeve) just outside the trunk's side
        pit = None
        for src_ in (('arm',), ('torso', 'torso2', 'arm')):
            q_ = np.concatenate([p.s for p in P if p.cls in src_ and (p.cls != 'arm' or p.side == s)])
            rel = q_ - S
            t_ = rel @ ax
            depth = (rel - np.outer(t_, ax)) @ dn
            out_ = sg * (q_[:, 0] - cx_) - side_
            sel = (out_ > 0.005 * H) & (out_ < 0.035 * H) & (depth > 0) & (depth < 0.2 * H) & (t_ > -0.05 * H)
            if sel.sum() >= 8:
                pit = float(np.clip(np.percentile(depth[sel], 97), 0.035 * H, 0.12 * H))
                break
        if pit is None:
            pit = 0.07 * H
        pit = OVR.get('armpit', pit / H) * H
        SH[s] = {'S': S, 'ax': ax, 'dn': dn, 'sg': sg, 'cx': cx_, 'side': side_, 'm': OVR.get('shoulderBlend', 0.03) * H,
                 'd0': 0.35 * pit, 'd1': 0.9 * pit, 'deep0': 1.4 * pit, 'deep1': 2.2 * pit, 'web': OVR.get('armpitWeb', 0.05) * H}
        log(f'shoulder {s}: trunk side {side_ / H:.3f}H from the middle (joint {abs(S[0] - cx_) / H:.3f}H), armpit {pit / H:.3f}H under the arm')


def arm_share(v, sh):
    """How much of each point goes with the arm rather than the trunk (0..1); see above."""
    rel = v - sh['S']
    t = rel @ sh['ax']
    depth = (rel - np.outer(t, sh['ax'])) @ sh['dn']
    inside = sh['side'] - sh['sg'] * (v[:, 0] - sh['cx'])  # how far inside the trunk's side
    # (what hangs far below the arm is trunk wherever it is: the hem of a shirt that flares wider than its waist
    # would fly up with the arm otherwise)
    pit = smooth(sh['d0'], sh['d1'], depth) * np.maximum(smooth(-sh['web'], 0.0, inside), smooth(sh['deep0'], sh['deep1'], depth))
    return smooth(-sh['m'], sh['m'], t) * (1 - pit)


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


def drop_shoulders(NP):
    """Arms held straight out lift the shoulders (the collar bones swing up); brought down for the rest pose they
    come back down. There is no collar bone in the rig, so the arms are simply set this much lower, and the skin
    between the neck and the shoulder, shared between chest and arm, slopes down to them instead of standing
    square like a shoulder pad."""
    if STANDING:
        for s in 'LR':
            for b in ('arm', 'fore', 'hand'):
                NP[b + s] = NP[b + s] - np.array([0.0, OVR.get('armDrop', 0.0) * H, 0.0])


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
drop_shoulders(NP)
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
        # the part of a shirt that lies over the upper arm goes with the arm: at least a third of the way to the
        # elbow, however short the sleeve (the shoulder of a sleeveless shirt would otherwise stay up like a wing)
        ua = JJ['fore' + s] - JJ['arm' + s]
        ul = float(np.linalg.norm(ua))
        reach = max(float((holes[s]['c'] - JJ['arm' + s]) @ ua) / max(ul, 1e-6), OVR.get('sleeveReach', 0.0) * ul) if STANDING else None
        caps['sleeve' + s] = [(JJ['arm' + s], JJ['arm' + s] + ua / max(ul, 1e-6) * reach if STANDING else holes[s]['c'], holes[s]['r'] * 1.15)]
        caps['fore' + s] = [(JJ['fore' + s], JJ['hand' + s], radii['fore' + s])]
        caps['hand' + s] = [(JJ['hand' + s], JJ['tip' + s], radii['hand' + s])]
        caps['thigh' + s] = [(JJ['thigh' + s], JJ['shin' + s], radii['thigh'])]
        caps['shin' + s] = [(JJ['shin' + s], JJ['foot' + s], radii['shin'])]
        caps['foot' + s] = [(JJ['foot' + s], JJ['toe' + s], 0.05 * H)]
    return {'caps': caps, 'hips': JJ['hips'], 'up': up, 'neck': JJ['neck'], 'head': JJ['head']}


# which bone each capsule belongs to
CAP_BONE = {'clavL': 'chest', 'clavR': 'chest', 'sleeveL': 'armL', 'sleeveR': 'armR', 'pelvis': 'hips'}


def candidates(p):
    if p.cls == 'torso':
        # a shirt with sleeves follows the arms around the seam; a sleeveless one has nothing out there that should
        return ['hips', 'spine', 'chest', 'clavL', 'clavR'] + ['sleeve' + s for s in 'LR' if not SLEEVELESS[s]] + ['thighL', 'thighR']
    if p.cls == 'torso2':
        return ['hips', 'spine', 'chest', 'clavL', 'clavR', 'sleeveL', 'sleeveR', 'thighL', 'thighR']
    if p.cls == 'arm':
        return ['clav' + p.side, 'arm' + p.side, 'fore' + p.side, 'hand' + p.side]
    if p.cls == 'leg':
        return ['pelvis', 'thighL', 'shinL', 'thighR', 'shinR']
    if p.cls == 'shoe':
        return ['foot' + p.side]
    if p.cls in ('head', 'headacc'):
        return ['head']
    if p.cls == 'cape':
        return ['chest']  # (only while the sculpt is straightened: the game hangs it from bones of its own, rig_cape)
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


def up_the_neck(p, v, W, body, patch=None):
    """Skin that belongs to the body but runs up the neck (and, on some sculpts, on up the cheek): from the base of
    the skull up it is head and nothing else, so a face never comes apart; the neck below turns from one to the
    other. The membranes that close such a part's openings go the same way.

    On a standing sculpt the head's own parts do the same from the other end: whatever of them reaches down the
    neck (a neck that came as a part of its own, a neck stub under the jaw, hair down the nape) stays with the
    chest at the base of the neck, inside the collar, and turns over the length of the neck. A head that is rigid
    all the way down swings its neck out of the collar whenever it tilts."""
    hg = p.cls in ('head', 'headacc')
    if p.cls != 'torso2' and not (hg and STANDING):
        return W
    ny, hy, cx = float(body['neck'][1]), float(body['head'][1]), float(body['neck'][0])
    if STANDING:
        # the chin hangs lower than the nape, and so do ears, headphones and whatever else is wider than a neck: the
        # further forward or out to the side, the lower the head reaches
        fwd = 0.9 * np.clip(v[:, 2] - float(body['neck'][2]) - 0.045 * H, 0.0, 0.06 * H)
        out = 0.9 * np.clip(np.abs(v[:, 0] - cx) - 0.05 * H, 0.0, 0.06 * H) if hg else 0.0
        low = np.maximum(fwd, out)
        k = smooth(ny - low, hy - low, v[:, 1])
        if not hg:
            k = k * (1 - smooth(0.08 * H, 0.12 * H, np.abs(v[:, 0] - cx)))
        if hg:  # all head so far: what is not head is the chest's
            W = np.zeros_like(W)
            W[:, BI['chest']] = 1 - k
            W[:, BI['head']] = k
            return W
    else:
        # (the neck joint is about level with the chin: the turn happens in the three centimetres below it)
        col = 1 - smooth(0.08 * H, 0.12 * H, np.abs(v[:, 0] - cx))
        # ... and the chin hangs lower than the nape: the further forward, the lower the head reaches
        jaw = 0.9 * np.clip(v[:, 2] - float(body['neck'][2]) - 0.045 * H, 0.0, 0.06 * H)
        k = smooth(ny - 0.025 * H - jaw, ny + 0.005 * H - jaw, v[:, 1]) * col
    W = W * (1 - k)[:, None]
    W[:, BI['head']] += k
    return W


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
        near = names[int(np.argmin(dn))]
        if UNIFIED and near[-1] in 'LR' and near[:-1] in ('clav', 'sleeve', 'arm'):
            # something worn at the shoulder rides on the arm or on the chest, whichever the place it is at does
            near = ('arm' if float(arm_share(v.mean(0)[None, :], SH[near[-1]])[0]) > 0.5 else 'clav') + near[-1]
        W[:, BI[CAP_BONE.get(near, near)]] = 1
        return W
    if len(cand) == 1:
        W[:, BI[cand[0]]] = 1
        if STANDING and p.cls == 'shoe':
            # A shoe is the foot's up to the ankle; the collar of a high shoe is on the shin, as the trouser cuff over
            # it is. Rigid all the way up, the collar gapes open behind the ankle every time the foot bends.
            ya = float(body['caps']['foot' + p.side][0][0][1])
            k = smooth(ya - 0.005 * H, ya + 0.03 * H, v[:, 1])
            W[:, BI['foot' + p.side]] = 1 - k
            W[:, BI['shin' + p.side]] = k
        return up_the_neck(p, v, W, body)
    if p.name in GATE and p.cls == 'arm':
        s = p.side
        arc = np.where(np.isfinite(GATE[p.name][1]), GATE[p.name][1], 1e3)
        _, _, ge, gw, gt = arm_geo[s]
        if UNIFIED:
            # A straight arm needs no walk over its surface to know how far along it a point is (and the walk
            # goes wrong where a sleeve lies against the body, or starts from a cut that is not round the arm):
            # the distance along the line from the shoulder to the fingertips says it, the same for every part.
            a_ = norm(J['tip' + s] - J['arm' + s])
            arc = (v - J['arm' + s]) @ a_
            ge, gw, gt = [float((J[k_ + s] - J['arm' + s]) @ a_) for k_ in ('fore', 'hand', 'tip')]
        lf, lh = gw - ge, gt - gw
        lu = max(ge, 0.05 * H)
        fore = smooth(ge - 0.3 * min(lu, lf), ge + 0.3 * min(lu, lf), arc)  # 0 above the elbow .. 1 below it
        hand = smooth(gw - 0.25 * min(lf, lh), gw + 0.25 * min(lf, lh), arc)
        W[:, BI['hand' + s]] = hand
        W[:, BI['fore' + s]] = fore * (1 - hand)
        if UNIFIED:
            # what is not arm is trunk, shared out between the trunk's bones the way the trunk's own parts are
            ws = arm_share(v, SH[s])
            tr = {c: capsule_term(v, caps, c) for c in ('hips', 'spine', 'chest', 'clav' + s)}
            tot = sum(tr.values())
            W[:, BI['arm' + s]] = (1 - fore) * ws
            for c, w in tr.items():
                W[:, BI[CAP_BONE.get(c, c)]] += (1 - fore) * (1 - ws) * w / tot
        else:
            ca, cc = capsule_term(v, caps, 'arm' + s), capsule_term(v, caps, 'clav' + s)
            cc = cc * (1 - smooth(ge - 0.6 * lu, ge - 0.1 * lu, arc))  # the shoulder's pull ends well above the elbow
            W[:, BI['arm' + s]] = (1 - fore) * ca / (ca + cc)
            W[:, BI['chest']] = (1 - fore) * cc / (ca + cc)
    elif p.name in GATE and p.cls == 'leg':
        isL, arc = GATE[p.name]
        arc = np.where(np.isfinite(arc), arc, 1e3)
        dk = 0.035 * H
        up = np.ones(len(v))  # how much of the vertex lies above its own knee
        if STANDING:  # straight legs, side by side: which leg, and how far up it, is a matter of where a point is
            isL = v[:, 0] > float(body['hips'][0])
            if isL.mean() > 0.9 or isL.mean() < 0.1:  # (one leg of a pair cut down the middle: all of it is that leg)
                isL = np.full(len(v), bool(isL.mean() > 0.5))
        for s in 'LR':
            mine = isL if s == 'L' else ~isL
            ka = knee_arc[s]
            if STANDING:
                foot_, knee_, hip_ = caps['shin' + s][0][1], caps['shin' + s][0][0], caps['thigh' + s][0][0]
                l_ = norm(hip_ - foot_)
                arc, ka = (v - foot_) @ l_, float((knee_ - foot_) @ l_)
            a_ = smooth(ka - dk, ka + dk, arc)
            W[:, BI['shin' + s]] = np.where(mine, 1 - a_, 0.0)
            up = np.where(mine, a_, up)
        if STANDING:
            # What is pelvis and what is thigh is told by a crease: the line that runs from the hip joint at the
            # side down to the fork in the middle - the groin in front, the fold of the seat behind. Above it cloth
            # stays with the pelvis, below it goes with its own leg, and it turns from one to the other over a
            # hand's breadth. (Nearness to the bones gave the gusset to the thighs, half to each: lifted by a kick it
            # came up with the leg, turned inside out. And it shared the inside of each thigh with the other leg all
            # the way down, so whatever hung there - the cords of a waistband - was pulled apart between the two.)
            hl_, hr_ = caps['thighL'][0][0], caps['thighR'][0][0]
            half_, hy_, rt_ = 0.5 * abs(float(hl_[0] - hr_[0])), 0.5 * float(hl_[1] + hr_[1]), float(caps['thighL'][0][2])
            fork_ = hy_ - max(FORK_DROP, 0.03 * H)
            yc_ = fork_ + (hy_ - fork_) * np.clip(np.abs(v[:, 0] - float(body['hips'][0])) / (half_ + 0.6 * rt_), 0.0, 1.0)
            th_ = smooth(yc_ + 0.02 * H, yc_ - 0.06 * H, v[:, 1])
            W[:, BI['hips']] += up * (1 - th_)
            W[:, BI['thighL']] += up * th_ * isL
            W[:, BI['thighR']] += up * th_ * ~isL
        else:
            terms = {c: capsule_term(v, caps, c) for c in ('pelvis', 'thighL', 'thighR')}
            tot = sum(terms.values())
            for c, w in terms.items():
                W[:, BI[CAP_BONE.get(c, c)]] += up * w / tot
    else:
        # a shirt's hem may follow the thighs, but only the part hanging below the hip joints
        below = smooth(0.03 * H, -0.05 * H, (v - body['hips']) @ body['up'])
        for c in cand:
            if UNIFIED and c.startswith('sleeve'):
                continue
            w = capsule_term(v, caps, c)
            if c.startswith('thigh'):
                w = w * below
            W[:, BI[CAP_BONE.get(c, c)]] += w
        if UNIFIED:
            W /= W.sum(1, keepdims=True)
            wl, wr = arm_share(v, SH['L']), arm_share(v, SH['R'])
            W *= (1 - wl - wr)[:, None]
            W[:, BI['armL']] += wl
            W[:, BI['armR']] += wr
    W /= W.sum(1, keepdims=True)
    W = up_the_neck(p, v, W, body)
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
                if not STANDING:
                    W = up_the_neck(p, get_verts(p), W, body, mask.astype(np.float64))
        out[p.name] = W
    if STANDING:
        # Small things (laces, a tag on a shoe, a pendant, a buckle) ride on what they lie on: the bone that the
        # surface under them mostly follows - or, where that surface is shared between two bones (the collar of a
        # shoe, a wrist), its weights point for point, so that they bend with it and never come away from it.
        hv = [get_verts(q)[::2] for q in P if q.cls != 'acc']
        hw = [out[q.name][::2] for q in P if q.cls != 'acc']
        if hv:
            hv, hw = np.concatenate(hv), np.concatenate(hw)
            tree = kd(hv)
            for p in P:
                if p.cls != 'acc':
                    continue
                v = get_verts(p)
                near = np.array([tree.find(Vector(x))[1] for x in v])
                Wn = hw[near]
                mean = Wn.mean(0)
                if mean.max() >= 0.9:
                    Wn = np.zeros_like(Wn)
                    Wn[:, int(mean.argmax())] = 1
                out[p.name] = Wn
    if STANDING and SEAMS:
        # The two sides of a cut were one point of the sculpt. They get one set of weights (the mean of what each
        # side worked out for itself: a few millimetres apart, in a place where the weights change fast, the two
        # can differ by a third), and so they stay one point in every pose.
        key = {}
        parent = []

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for a_, u_, b_, w_ in SEAMS:
            for k_ in ((a_, u_), (b_, w_)):
                if k_ not in key:
                    key[k_] = len(parent)
                    parent.append(len(parent))
            ra, rb = find(key[(a_, u_)]), find(key[(b_, w_)])
            if ra != rb:
                parent[ra] = rb
        groups = {}
        for k_, i_ in key.items():
            groups.setdefault(find(i_), []).append(k_)
        for members in groups.values():
            mean = sum(out[n_][i_] for n_, i_ in members) / len(members)
            for n_, i_ in members:
                out[n_][i_] = mean
    if STANDING and not UNIFIED and OVR.get('seamShoulders', True):
        # A sleeve (or a bare arm) grows out of the body: where it meets the trunk it takes the trunk's own weights,
        # so the two sides of the seam move as one, and nothing opens between them or swings out of the armhole.
        # A few fingers' breadth along the arm it is all arm again.
        tv = [get_verts(q) for q in P if q.cls in ('torso', 'torso2')]
        tw = [out[q.name] for q in P if q.cls in ('torso', 'torso2')]
        if tv:
            tv, tw = np.concatenate(tv), np.concatenate(tw)
            tree = kd(tv)
            for p in P:
                if p.cls != 'arm':
                    continue
                v, W = get_verts(p), out[p.name]
                S = body['caps']['arm' + p.side][0][0]
                for i in np.nonzero(np.linalg.norm(v - S, axis=1) < 0.1 * H)[0]:
                    _, j, dist = tree.find(Vector(v[i]))
                    k = 1 - float(smooth(0.004 * H, 0.03 * H, dist))
                    if k > 0:
                        W[i] = (1 - k) * W[i] + k * tw[j]
    return out


RIM_RING = {}


def rim_ring(p):
    """How many edges each vertex is from a cut of its part (0 on the cut; 9 = far)."""
    if p.name not in RIM_RING:
        me = p.o.data
        ring = np.full(len(me.vertices), 9, dtype=np.int32)
        idx = rim_of(p)[0]
        if len(idx):
            e = np.zeros(len(me.edges) * 2, dtype=np.int32)
            me.edges.foreach_get('vertices', e)
            e = e.reshape(-1, 2)
            ring[idx] = 0
            for k in (1, 2):
                near = (ring[e[:, 0]] == k - 1) | (ring[e[:, 1]] == k - 1)
                for col in (0, 1):
                    sel = e[near, col]
                    ring[sel] = np.minimum(ring[sel], k)
        RIM_RING[p.name] = ring
    return RIM_RING[p.name]


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
        if STANDING:
            # (the smoothing that follows a bend is done part by part: at a cut each side would be drawn in on its
            # own and a crack would open along it, so the cut and the ring or two beside it are left as they are)
            m = m * np.array([0.0, 0.4, 0.75] + [1.0] * 7)[rim_ring(p)]
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


SLEEVELESS = {'L': False, 'R': False}
if STANDING:
    for s_, sg_ in (('L', 1.0), ('R', -1.0)):
        S_ = J['arm' + s_]
        tv_ = np.concatenate([verts_gl(p.o) for p in P if p.cls == 'torso'])
        band = tv_[np.abs(tv_[:, 1] - S_[1]) < 0.05 * H]
        out_ = float(((band[:, 0] - J['neck'][0]) * sg_).max()) if len(band) else 0.0
        SLEEVELESS[s_] = out_ < abs(S_[0] - J['neck'][0]) + 0.02 * H
    both_ = bool(SLEEVELESS['L'] and SLEEVELESS['R'])  # a shirt has two sleeves or none
    SLEEVELESS = {'L': both_, 'R': both_}
    if both_:
        log('sleeveless shirt (or one whose sleeves start at the shoulder joint)')
    # The membrane that closes a shirt's armhole is hidden inside the arm while the arm is held straight out; with
    # the arm down it would stand above the shoulder like a wing. Push it into the body, out of sight.
    for p in P:
        me_ = p.o.data
        if UNIFIED or p.cls != 'torso' or 'patch' not in me_.attributes:
            continue
        v_ = verts_gl(p.o)
        flag_ = np.zeros(len(v_), dtype=np.int32)
        me_.attributes['patch'].data.foreach_get('value', flag_)
        mask_ = flag_ > 0
        if not mask_.any() or mask_.all():
            continue
        tree_ = kd(v_[~mask_])
        moved_ = 0
        for s_, sg_ in (('L', 1.0), ('R', -1.0)):
            sel_ = np.nonzero(mask_ & (np.linalg.norm(v_ - J['arm' + s_], axis=1) < 0.1 * H))[0]
            for i_ in sel_:
                d_ = tree_.find(Vector(v_[i_]))[2]
                v_[i_, 0] -= sg_ * 0.045 * H * float(smooth(0.0, 0.025 * H, d_))
            moved_ += len(sel_)
        if moved_:
            set_verts_gl(p.o, v_)
            log(f'armhole membranes pushed in: {moved_} vertices of {p.name}')
radii = measure_radii(J, pts_sculpt)
log('radii (sculpt)', {k: round(v / H, 3) for k, v in radii.items()})
W0 = compute_weights(lambda p: verts_gl(p.o), capsules(J, head_top, radii, hole, pelvis_up))
verts0 = {p.name: verts_gl(p.o) for p in P}
if SEAMS:
    # two sides of a cut that do not have the same weights will come apart in some pose
    dw = np.array([float(np.abs(W0[a_][u_] - W0[b_][w_]).max()) for a_, u_, b_, w_ in SEAMS])
    log(f'seams: {len(SEAMS)} vertex pairs across cuts; weights differ by more than 0.15 at {int((dw > 0.15).sum())}, worst {dw.max():.2f}')
    cls_ = {q.name: q.cls + (q.side or '') for q in P}
    for i_ in np.argsort(-dw)[:6]:
        if dw[i_] < 0.15:
            break
        a_, u_, b_, w_ = SEAMS[int(i_)]
        x_ = verts_gl(byname[a_].o)[u_] / H
        top_ = lambda W_: ' '.join(f'{BONES[k]}:{W_[k]:.2f}' for k in np.argsort(-W_)[:3] if W_[k] > 0.02)
        log(f'  seam {cls_[a_]} {a_} / {cls_[b_]} {b_} at ({x_[0]:+.3f},{x_[1]:.3f},{x_[2]:+.3f}): {top_(W0[a_][u_])}  |  {top_(W0[b_][w_])}')
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
        rounded = np.zeros(len(v), dtype=bool)
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
                    rounded[c_] = True
        set_verts_gl(p.o, v)
        # a patch that was rounded out is the limb's own surface, whatever it looked like flat: not an inside
        if rounded.any() and 'lid' in me.attributes and len(me.attributes['lid'].data) == len(me.polygons):
            lid_ = np.zeros(len(me.polygons), dtype=np.int32)
            me.attributes['lid'].data.foreach_get('value', lid_)
            lv_ = np.zeros(len(me.loops), dtype=np.int32)
            me.loops.foreach_get('vertex_index', lv_)
            ls_ = np.zeros(len(me.polygons), dtype=np.int32)
            me.polygons.foreach_get('loop_start', ls_)
            lt_ = np.zeros(len(me.polygons), dtype=np.int32)
            me.polygons.foreach_get('loop_total', lt_)
            hit_ = np.add.reduceat(rounded[lv_].astype(np.int32), ls_) > 0
            lid_[(lid_ == 2) & hit_] = 1
            me.attributes['lid'].data.foreach_set('value', lid_)
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
drop_shoulders(NP)
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
if not OVR.get('noColumns', STANDING):  # (a sculpt that stood straight has its legs as they hang: nothing to undo)
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


if SEAMS:
    g0 = np.array([float(np.linalg.norm(verts0[a_][u_] - verts0[b_][w_])) for a_, u_, b_, w_ in SEAMS])
    g1 = np.array([float(np.linalg.norm(cur[a_][u_] - cur[b_][w_])) for a_, u_, b_, w_ in SEAMS])
    log(f'seams in the rest pose: opened by {(g1 - g0).max() / H * 1750:.1f} mm at worst, more than 2 mm at {int(((g1 - g0) > 0.002 / 1.75 * H).sum())} of {len(SEAMS)}')
    cls_ = {q.name: q.cls + (q.side or '') for q in P}
    for i_ in np.argsort(-(g1 - g0))[:5]:
        if g1[i_] - g0[i_] < 0.002 / 1.75 * H:
            break
        a_, u_, b_, w_ = SEAMS[int(i_)]
        x_ = verts0[a_][u_] / H
        log(f'  open {cls_[a_]} {a_} / {cls_[b_]} {b_}: {(g1[i_] - g0[i_]) / H * 1750:.1f} mm, was at ({x_[0]:+.3f},{x_[1]:.3f},{x_[2]:+.3f})')
        if opt('--dbgseam'):
            top_ = lambda W_: ' '.join(f'{BONES[k]}:{W_[k]:.3f}' for k in np.argsort(-W_)[:4] if W_[k] > 0.001)
            log(f'     a: sculpt {np.round(verts0[a_][u_] / H, 4)} rest {np.round(cur[a_][u_] / H, 4)} W {top_(W0[a_][u_])} ring {rim_ring(byname[a_])[u_]}')
            log(f'     b: sculpt {np.round(verts0[b_][w_] / H, 4)} rest {np.round(cur[b_][w_] / H, 4)} W {top_(W0[b_][w_])} ring {rim_ring(byname[b_])[w_]}')
radii_n = measure_radii(NP, pts_rest)
log('radii (rest)', {k: round(v / H, 3) for k, v in radii_n.items()})
body1 = capsules(NP, NP['headTop'], radii_n, hole_n, np.array([0.0, 1.0, 0.0]))
# (a sculpt that stood with its arms out was skinned as it stood, and that is the skin the game gets: every point
# keeps the bones it was given where the shoulder was laid out flat)
WFIN = W0 if UNIFIED else compute_weights(lambda p: cur[p.name], body1)
stats = write_groups(WFIN, 'bone' if DEBUG else None)
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


def finger_branches(e, v, wrist, ax):
    """The fingers of a hand, found on the mesh itself (however the sculpt was cut into parts): `v` are the vertices
    of everything on the arm from the wrist on, `e` the edges between them (the parts' own, and stitches across the
    cuts between parts).

    Walking over the skin from the wrist, the fingertips are the places farthest away. Coming back down from them,
    each finger is a patch of skin of its own until it meets its neighbour at the web between them: what a patch
    holds at that moment is the finger. Returns the hand's length and the vertices of every finger.
    """
    n = len(v)
    t = (v - wrist) @ ax
    hl = float(t.max())
    live = t > 0
    adj = [[] for _ in range(n)]
    for (a, b), l in zip(e.tolist(), np.linalg.norm(v[e[:, 0]] - v[e[:, 1]], axis=1).tolist()):
        if live[a] and live[b]:
            adj[a].append((b, l))
            adj[b].append((a, l))
    g = np.full(n, np.inf)  # how far over the skin from the wrist
    heap = []
    t0 = float(t[live].min())  # where the hand's skin begins (its part may start a little past the wrist joint)
    for i in np.nonzero(live & (t < t0 + 0.08 * (hl - t0)))[0].tolist():
        g[i] = float(t[i])
        heap.append((g[i], i))
    heapq.heapify(heap)
    while heap:
        d, i = heapq.heappop(heap)
        if d > g[i]:
            continue
        for j, l in adj[i]:
            if d + l < g[j]:
                g[j] = d + l
                heapq.heappush(heap, (d + l, j))
    parent = np.full(n, -1)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    born, members, shut, found = {}, {}, {}, []
    keep = 0.13 * hl  # a finger stands at least this far out of the hand

    def close(r, level):
        if not shut[r] and born[r] - level >= keep and len(members[r]) >= 20:
            found.append(np.array(members[r]))
            return True
        return False

    for i in [int(k) for k in np.argsort(-np.where(np.isfinite(g), g, -1.0)) if np.isfinite(g[k])]:
        roots = sorted({find(j) for j, _ in adj[i] if parent[j] >= 0}, key=lambda r: -born[r])
        if not roots:
            parent[i] = i
            born[i], members[i], shut[i] = float(g[i]), [i], False
            continue
        main = roots[0]
        for r in roots[1:]:
            if close(r, g[i]) or shut[r]:  # a finger (or several, already told apart) meets this one: both end here
                close(main, g[i])
                shut[main] = True
            parent[r] = main
            members[main] += members.pop(r)
        parent[i] = main
        members[main].append(i)
    log(f'hand skin: {int(live.sum())} vertices past the wrist, {int(np.isfinite(g).sum())} reached from it, {len(born)} tips, '
        f'{len(found)} fingers; hand {hl / H:.3f}H')
    if not found:  # a mitten, or a hand modelled as one lump: everything past the knuckles bends as one finger
        lump = np.nonzero(live & (t > 0.56 * hl))[0]
        if len(lump) >= 20:
            found.append(lump)
    return hl, found


def rig_fingers():
    for s, sg in (('L', 1.0), ('R', -1.0)):
        wrist, tip = NP['hand' + s], NP['tip' + s]
        ax = norm(tip - wrist)
        arm_parts = [q for q in P if q.cls == 'arm' and q.side == s]
        if not arm_parts:
            continue
        # The hand is everything on the arm past the wrist, whatever parts it came in (a cut across the palm, a
        # thumb left on the forearm's part): one skin, stitched together where the parts were cut.
        hand_parts = [q for q in arm_parts if float(((cur[q.name] - wrist) @ ax).max()) > 0.01 * H]
        at_, n_ = {}, 0
        for q in hand_parts:
            at_[q.name] = n_
            n_ += len(cur[q.name])
        v = np.concatenate([cur[q.name] for q in hand_parts])
        edges = []
        for q in hand_parts:
            e_ = np.empty(len(q.o.data.edges) * 2, dtype=np.int64)
            q.o.data.edges.foreach_get('vertices', e_)
            edges.append(e_.reshape(-1, 2) + at_[q.name])
        stitch = np.array([(at_[a_] + u_, at_[b_] + w_) for a_, u_, b_, w_ in SEAMS if a_ in at_ and b_ in at_], dtype=np.int64).reshape(-1, 2)
        edges = np.concatenate(edges + [stitch])
        hl, branches = finger_branches(edges, v, wrist, ax)
        if not branches or hl < 0.04 * H:
            log(f'fingers {s}: none found (hand {hl / H:.3f}H)')
            continue
        live = (v - wrist) @ ax > 0
        clouds = [v[b] for b in branches]
        # which finger each vertex of the hand belongs to (-1 = the palm), and how far it is from every finger
        member = np.full(len(v), -1)
        dist = []
        for k, b in enumerate(branches):
            member[b] = k
            tr = kd(clouds[k])
            dist.append(np.array([tr.find(Vector(x))[2] for x in v]))
        palm_v = v[(member < 0) & live]
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
            pieces.append({'k': k, 'pts': c, 'd': d, 'base': cc + d * t.min(), 'len': float(t.max() - t.min()), 'off': float(math.acos(np.clip(d @ ax, -1, 1))),
                           'low': float((cc + d * t.min() - wrist) @ ax)})
        log(f'finger pieces {s}: ' + '  '.join(f"starts {f['low'] / hl:.2f} long {f['len'] / hl:.2f} off {f['off']:.2f}" for f in sorted(pieces, key=lambda f: float(f['base'] @ norm(np.cross(ax, n))))) + '  (in hand lengths)')
        # the thumb: the one that points away from the others and leaves the hand low down, by the wrist (a finger
        # that leans away is still a finger); failing that the one that starts nearest the wrist
        thumb = max(pieces, key=lambda f: f['off'])
        if thumb['off'] < 0.4 or thumb['low'] > 0.5 * hl or len(pieces) < 2:
            lowest = min(pieces, key=lambda f: f['low'])
            thumb = lowest if len(pieces) >= 4 and lowest['low'] < 0.45 * hl else None
        # A finger is a finger from its knuckle on, however the sculpt has it. Fingers held together are often one
        # mass that parts only near the tips: the walk over the skin finds just the ends, and a fist made of those
        # is a claw. The rest of each finger is the strip of the hand behind its end, half way to the next finger
        # on either side, down to the line of the knuckles. And a hand that came as one lump (a mitten) is a
        # finger only from that line on, not from the heel of the hand.
        across = norm(np.cross(ax, n))  # from one side of the hand to the other, along the knuckles
        fing = sorted([f for f in pieces if f is not thumb], key=lambda f: float(f['pts'].mean(0) @ across))
        line = 0.56 * hl
        uv, tv_ = v @ across, (v - wrist) @ ax
        mids = [float(f['pts'].mean(0) @ across) for f in fing]
        gap_ = float(np.median(np.diff(mids))) if len(mids) > 1 else 0.3 * hl
        changed = []
        for i_, f in enumerate(fing):
            if f['low'] > line + 0.02 * hl:
                lo_ = (mids[i_ - 1] + mids[i_]) / 2 if i_ else mids[i_] - 0.7 * gap_
                hi_ = (mids[i_] + mids[i_ + 1]) / 2 if i_ + 1 < len(fing) else mids[i_] + 0.7 * gap_
                grow = (member < 0) & live & (uv >= lo_) & (uv < hi_) & (tv_ > line)
                if grow.any():
                    member[grow] = f['k']
                    changed.append(f)
            elif f['low'] < 0.45 * hl:
                cut = (member == f['k']) & (tv_ < line)
                if cut.any() and (~cut & (member == f['k'])).sum() >= 20:
                    member[cut] = -1
                    changed.append(f)
        for f in changed:
            c = v[member == f['k']]
            cc = c.mean(0)
            d = np.linalg.svd(c - cc, full_matrices=False)[2][0]
            if d @ ax < 0:
                d = -d
            t = (c - cc) @ d
            f.update(pts=c, d=d, base=cc + d * t.min(), len=float(t.max() - t.min()), low=float((cc + d * t.min() - wrist) @ ax))
            tr = kd(c)
            dist[f['k']] = np.array([tr.find(Vector(x))[2] for x in v])
        if changed:
            log(f'finger pieces {s}, from the knuckles: ' + '  '.join(f"starts {f['low'] / hl:.2f} long {f['len'] / hl:.2f}" for f in fing))
        W = np.zeros((len(v), 0))
        names_all, knuckles = [], []
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
        W[~live] = 0
        # nothing of a finger reaches the wrist: there the hand is hand and nothing else, as the forearm is
        W *= smooth(0.0, 0.1 * hl, (v - wrist) @ ax)[:, None]
        # ... and the two sides of every cut through the hand bend as one
        for a_, b_ in stitch:
            W[a_] = W[b_] = (W[a_] + W[b_]) / 2
        share = np.clip(W.sum(1), 0, 1)
        for q in hand_parts:
            o, i0 = q.o, at_[q.name]
            gname = {g.index: g.name for g in o.vertex_groups}
            groups = {}
            for i in np.nonzero(share[i0:i0 + len(cur[q.name])] > 0.02)[0]:
                i = int(i)
                sh_ = float(share[i0 + i])
                for ge in list(o.data.vertices[i].groups):
                    if sh_ > 0.98:
                        o.vertex_groups[gname[ge.group]].remove([i])
                    else:
                        o.vertex_groups[gname[ge.group]].add([i], ge.weight * (1 - sh_), 'REPLACE')
                for j in np.nonzero(W[i0 + i] > 0.01)[0]:
                    nm = names_all[int(j)]
                    if nm not in groups:
                        groups[nm] = o.vertex_groups.new(name=nm)
                    groups[nm].add([i], float(W[i0 + i, j]), 'REPLACE')
        log(f'fingers {s}: {len(pieces)} pieces' + (', thumb is one of them' if thumb else ', thumb is part of the palm') +
            f'; {int((member >= 0).sum())} finger and {int((palm_m & (share > 0.02)).sum())} knuckle vertices of {len(v)} in {len(hand_parts)} parts')
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


# ------------------------------------------------------------------ cape
# A cape swings: in the game it is a cloth of rows x columns of points (client/src/render/model.ts), each carrying a
# bone that the cape's vertices follow, bilinear in where they lie on the cloth - across it, as a share of its width
# at that height, and down it. The top row is fastened to the body where the cape lies on it, with that place's
# own skin weights (so it rises and falls with the shoulders as the cloth under it does); the rows below hang from
# it, each held to its place on the back a little less than the one above, the rest free.
CAPE = None


def rig_cape():
    global CAPE
    parts = [p for p in P if p.cls == 'cape']
    if not parts:
        return
    R, C = int(OVR.get('capeRows', 9)), int(OVR.get('capeCols', 7))
    hold_rows = list(OVR.get('capeHold', [1.0, 0.55, 0.18, 0.06]))
    va = np.concatenate([cur[p.name] for p in parts])
    y_top, y_bot = float(va[:, 1].max()), float(va[:, 1].min())
    L = y_top - y_bot
    # Where a vertex is on the cloth. Across: its share of the cape's width at that height (a smooth run from the
    # shoulders down; the hem curls and dips, so below the last sixth the width stays what it was above). Down: how
    # far it is from the top edge to the hem at that place across, so the corners of a hem that dips in the middle
    # are bottom row too.
    bands = np.linspace(y_top, y_bot + L / 6, 33)
    xl, xh = [], []
    for y in bands:
        b = va[np.abs(va[:, 1] - y) < 0.6 * (bands[0] - bands[1])]
        xl.append(float(np.percentile(b[:, 0], 1)) if len(b) >= 10 else np.nan)
        xh.append(float(np.percentile(b[:, 0], 99)) if len(b) >= 10 else np.nan)
    xl, xh = np.array(xl), np.array(xh)
    ok = np.isfinite(xl) & np.isfinite(xh)
    xl, xh = np.interp(bands, bands[ok][::-1], xl[ok][::-1]), np.interp(bands, bands[ok][::-1], xh[ok][::-1])
    xl = np.convolve(np.pad(xl, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    xh = np.convolve(np.pad(xh, 2, mode='edge'), np.ones(5) / 5, mode='valid')

    def across(v):
        y = v[:, 1]
        lo_, hi_ = np.interp(-y, -bands, xl), np.interp(-y, -bands, xh)
        return np.clip((v[:, 0] - lo_) / np.maximum(hi_ - lo_, 1e-6), 0, 1)

    ua0 = across(va)
    ub = np.linspace(0, 1, 25)
    tops, hems = [], []
    for u in ub:
        b = va[np.abs(ua0 - u) < 0.05, 1]
        tops.append(float(np.percentile(b, 99.5)) if len(b) >= 10 else np.nan)
        hems.append(float(np.percentile(b, 0.5)) if len(b) >= 10 else np.nan)
    tops, hems = np.array(tops), np.array(hems)
    ok = np.isfinite(tops) & np.isfinite(hems)
    tops, hems = np.interp(ub, ub[ok], tops[ok]), np.interp(ub, ub[ok], hems[ok])
    tops = np.convolve(np.pad(tops, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    hems = np.convolve(np.pad(hems, 2, mode='edge'), np.ones(5) / 5, mode='valid')

    def uv(v):
        u = across(v)
        t_, b_ = np.interp(u, ub, tops), np.interp(u, ub, hems)
        return u, np.clip((t_ - v[:, 1]) / np.maximum(t_ - b_, 1e-6), 0, 1)

    # the points of the cloth: the middle of the cape (both faces of it, and its folds) around each one - a plane
    # fitted to what lies around it, so that the points of the outer rows and columns are on the edges of the cape and
    # not a third of the way in from them (the cape would hang below its lowest row, into the floor)
    ua, wa = uv(va)
    pts = np.zeros((R, C, 3))
    for r in range(R):
        for c in range(C):
            du, dv = ua - c / (C - 1), wa - r / (R - 1)
            k = np.maximum(0, 1 - np.abs(du) * (C - 1) / 1.5) * np.maximum(0, 1 - np.abs(dv) * (R - 1) / 1.5)
            if (k > 0).sum() < 12:
                k = 1.0 / (1e-4 + du ** 2 + dv ** 2)
            A = np.stack([np.ones(len(va)), du, dv], axis=1) * np.sqrt(k)[:, None]
            pts[r, c] = np.linalg.lstsq(A, va * np.sqrt(k)[:, None], rcond=None)[0][0]
    # what fastens each point: the top rows to the body beneath (the skin weights of the nearest body vertices),
    # the rest to the chest (their place on the back)
    body = [q for q in P if q.cls not in ('cape', 'head', 'headacc')]
    bv = np.concatenate([cur[q.name] for q in body])
    bw = np.concatenate([WFIN[q.name] for q in body])
    tree = kd(bv)
    anchor, hold = [], []
    for r in range(R):
        for c in range(C):
            h = float(hold_rows[r]) if r < len(hold_rows) else 0.0
            hold.append(round(h, 3))
            if r < 2:
                near = [i for _, i, _ in tree.find_n(Vector(pts[r, c]), 16)]
                w = bw[near].mean(0)
                # (the back and the shoulders: a cape does not turn with the head, nor reach down an arm)
                w[[BI[b] for b in BONES if b not in ('hips', 'spine', 'chest', 'armL', 'armR')]] = 0
                if w.sum() < 1e-6:
                    w[BI['chest']] = 1
            else:
                w = np.zeros(len(BONES))
                w[BI['chest']] = 1
            top = np.argsort(-w)[:4]
            top = [int(b) for b in top if w[b] > 0.02]
            s = float(sum(w[b] for b in top))
            anchor.append([[BONES[b], round(float(w[b] / s), 3)] for b in top])
    names = [f'cp{r}_{c}' for r in range(R) for c in range(C)]
    # every cape vertex: bilinear between the four points around its place on the cloth
    n_v = 0
    for p in parts:
        o = p.o
        v = cur[p.name]
        u_, w_ = uv(v)
        fc, fr = u_ * (C - 1), w_ * (R - 1)
        c0, r0 = np.minimum(fc.astype(int), C - 2), np.minimum(fr.astype(int), R - 2)
        tc, tr = fc - c0, fr - r0
        for vg in list(o.vertex_groups):
            o.vertex_groups.remove(vg)
        groups = {}
        for i in range(len(v)):
            for dr, dc, w in ((0, 0, (1 - tr[i]) * (1 - tc[i])), (0, 1, (1 - tr[i]) * tc[i]), (1, 0, tr[i] * (1 - tc[i])), (1, 1, tr[i] * tc[i])):
                if w > 0.005:
                    nm = names[(r0[i] + dr) * C + c0[i] + dc]
                    g = groups.get(nm)
                    if g is None:
                        g = groups[nm] = o.vertex_groups.new(name=nm)
                    g.add([i], float(w), 'REPLACE')
        n_v += len(v)
    bpy.context.view_layer.objects.active = ao
    for q in scene.objects:
        q.select_set(q is ao)
    bpy.ops.object.mode_set(mode='EDIT')
    for r in range(R):
        for c in range(C):
            e = ao.data.edit_bones.new(names[r * C + c])
            e.head = to_bl(pts[r, c])
            e.tail = to_bl(pts[r, c] - np.array([0.0, 0.03 * H, 0.0]))
            e.parent = ao.data.edit_bones['chest']
            e.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    CAPE = {'rows': R, 'cols': C, 'bones': names, 'hold': hold, 'anchor': anchor,
            'rest': [[round(float(x), 4) for x in pts[r, c]] for r in range(R) for c in range(C)]}
    width = [float(np.linalg.norm(pts[r, -1] - pts[r, 0])) / H for r in (0, R // 2, R - 1)]
    log(f'cape: {len(parts)} parts, {n_v} vertices on a cloth of {R} x {C} points, {L / H:.3f}H long, '
        f'{width[0]:.3f} / {width[1]:.3f} / {width[2]:.3f}H wide at the top / middle / hem; top row fastened to ' +
        ', '.join(sorted({a[0] for row in anchor[:C] for a in row})))


rig_cape()
for p in P:
    p.o.parent = ao
    m = p.o.modifiers.new('rig', 'ARMATURE')
    m.object = ao
r4 = lambda a: [round(float(x), 4) for x in a]
NECK_BASE = 'neck' if STANDING else 'head'
ao['skrig'] = json.dumps({
    'rest': 'neutral',  # the armature's rest pose is a standing A-pose (see client/src/render/model.ts)
    'armA': round(A_POSE, 4),
    'height': round(height, 4),
    'joints': {b: r4(NP[b]) for b in BONES},
    'tips': {k: r4(NP[k]) for k in ('tipL', 'tipR', 'toeL', 'toeR')},
    'headTop': r4(NP['headTop']),
    'sole': 0,
    # the middle of the face and half the head's height, for portraits (measured from the base of the neck, which
    # is where the head joint of a crouching sculpt is and the neck joint of a standing one)
    'face': r4([NP['head'][0], NP[NECK_BASE][1] + 0.55 * (NP['headTop'][1] - NP[NECK_BASE][1]), NP['head'][2] + 0.07 * height]),
    'headR': round(float(0.5 * (NP['headTop'][1] - NP[NECK_BASE][1])), 4),
    'radii': {k: round(float(v), 4) for k, v in radii_n.items()},
    # finger bones (children of the hand bones): turn each about `axis` (model space, rest pose) by angle x grip
    'fingers': [{'bone': f['bone'], 'axis': r4(f['axis']), 'angle': f['angle']} for f in FINGERS],
    # a cape's cloth (rig_cape): its points row by row from the top, how firmly each is held to its place, and the
    # body bones that place moves with
    **({'cape': CAPE} if CAPE else {}),
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
def inside_materials():
    """Patches that close an opening (see fill_holes) are the inside of a garment: a material of their own, dark and
    flat, so that a glimpse up a sleeve or under a hem reads as shadow."""
    n = 0
    for p in P:
        me = p.o.data
        if 'lid' not in me.attributes or len(me.attributes['lid'].data) != len(me.polygons):
            continue
        flag = np.zeros(len(me.polygons), dtype=np.int32)
        me.attributes['lid'].data.foreach_get('value', flag)
        if not (flag == 2).any():
            continue
        c = [float(x) ** 2.2 * 0.3 for x in p.o.get('domcol', [0.4, 0.4, 0.4])]
        mat = bpy.data.materials.new('inside_' + p.name)
        mat.use_nodes = True
        bsdf = next(nd for nd in mat.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1.0)
        bsdf.inputs['Roughness'].default_value = 1.0
        bsdf.inputs['Metallic'].default_value = 0.0
        me.materials.append(mat)
        mi = np.zeros(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get('material_index', mi)
        mi[flag == 2] = len(me.materials) - 1
        me.polygons.foreach_set('material_index', mi)
        me.update()
        n += int((flag == 2).sum())
    return n


def patch_colours():
    """A patch that mends a surface was painted in its part's commonest colour (see fill_holes). That is right for a
    part of one colour; but an arm is skin below its sleeve, and the sliver of patch that shows at a shoulder seam
    should be sleeve. So every mending patch is painted again, face by face, in whichever of the part's main colours
    the surface beside it has. Beside it, not at it: a part is cut where the sculpt has a seam, a seam lies in a
    crease, and the texture of a crease is the shadow baked into it - a patch painted that colour is a dark fleck
    when it shows. So the colour is looked up a hand's breadth around the rim, and it is the colour of the lit
    cloth there (the brighter of what is found), not of its folds."""
    n = 0
    for p in P:
        me = p.o.data
        nv, nf, nl = len(me.vertices), len(me.polygons), len(me.loops)
        if 'lid' not in me.attributes or len(me.attributes['lid'].data) != nf or not me.uv_layers.active:
            continue
        lid = np.zeros(nf, dtype=np.int32)
        me.attributes['lid'].data.foreach_get('value', lid)
        if not (lid == 1).any() or not (lid == 0).any():
            continue
        px = texture_pixels(p.o)
        if px is None:
            continue
        h, w = px.shape[:2]
        lv = np.zeros(nl, dtype=np.int32)
        me.loops.foreach_get('vertex_index', lv)
        lt = np.zeros(nf, dtype=np.int32)
        me.polygons.foreach_get('loop_total', lt)
        face_of = np.repeat(np.arange(nf), lt)
        uvs = np.zeros(nl * 2, dtype=np.float32)
        me.uv_layers.active.data.foreach_get('uv', uvs)
        uvs = uvs.reshape(-1, 2)
        col = px[np.clip((uvs[:, 1] % 1 * h).astype(int), 0, h - 1), np.clip((uvs[:, 0] % 1 * w).astype(int), 0, w - 1)].astype(np.float64)
        del px
        on_s, on_p = lid[face_of] == 0, lid[face_of] == 1
        # the part's main colours (each at least a fortieth of its surface), and a texel that shows each
        sc, su = col[on_s], uvs[on_s]
        q = (sc * 7.999).astype(int)
        key = q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2]
        cnt = np.bincount(key, minlength=512)
        bins = [int(b) for b in np.argsort(-cnt) if cnt[b] >= max(1.0, 0.025 * len(key))] or [int(cnt.argmax())]
        cand_c, cand_uv = [], []
        for b in bins:
            pick = np.nonzero(key == b)[0]
            best = pick[int(np.argmin(np.linalg.norm(sc[pick] - sc[pick].mean(0), axis=1)))]
            cand_c.append(sc[best])
            cand_uv.append(su[best])
        cand_c, cand_uv = np.array(cand_c), np.array(cand_uv)
        if len(cand_c) < 2:
            continue  # a part of one colour is painted already
        vcol, has = np.zeros((nv, 3)), np.zeros(nv, dtype=bool)
        vcol[lv[on_s]] = col[on_s]
        has[lv[on_s]] = True
        pv = np.zeros(nv, dtype=bool)
        pv[lv[on_p]] = True
        rim = has & pv
        if not rim.any():
            continue
        e = np.zeros(len(me.edges) * 2, dtype=np.int32)
        me.edges.foreach_get('vertices', e)
        e = e.reshape(-1, 2)
        # out over the surface from the rim: which rim vertex each vertex is nearest to, and how many edges away
        src, ring = np.full(nv, -1, dtype=np.int64), np.full(nv, 99, dtype=np.int64)
        src[rim] = np.nonzero(rim)[0]
        ring[rim] = 0
        se = e[has[e[:, 0]] & has[e[:, 1]]]
        for k in range(1, 11):
            for a_, b_ in ((se[:, 0], se[:, 1]), (se[:, 1], se[:, 0])):
                go = (ring[a_] == k - 1) & (ring[b_] > k)
                ring[b_[go]] = k
                src[b_[go]] = src[a_[go]]
        local = vcol.copy()
        lum = vcol @ np.array([0.3, 0.6, 0.1])
        for lo_ in (1, 4):  # (well away from the rim if there is that much surface, else whatever there is)
            sel = np.nonzero(has & (ring >= lo_) & (ring <= 10))[0]
            if not len(sel):
                continue
            order = sel[np.lexsort((lum[sel], src[sel]))]  # grouped by rim vertex, darkest first within each
            owner, first, count = np.unique(src[order], return_index=True, return_counts=True)
            ok = count >= (1 if lo_ == 1 else 4)
            pick = order[first + ((count - 1) * 3) // 4]  # three quarters of the way up: lit cloth, not a highlight
            local[owner[ok]] = vcol[pick[ok]]
        # in over the patches from the rim: the rim vertex every patch vertex is nearest to
        lab = np.full(nv, -1, dtype=np.int64)
        lab[rim] = np.nonzero(rim)[0]
        pe = e[pv[e[:, 0]] & pv[e[:, 1]]]
        for _ in range(600):
            moved = False
            for a_, b_ in ((pe[:, 0], pe[:, 1]), (pe[:, 1], pe[:, 0])):
                go = (lab[a_] >= 0) & (lab[b_] < 0)
                if go.any():
                    lab[b_[go]] = lab[a_[go]]
                    moved = True
            if not moved:
                break
        fl = np.full(nf, -1, dtype=np.int64)
        np.maximum.at(fl, face_of[on_p], lab[lv[on_p]])
        faces = np.nonzero((lid == 1) & (fl >= 0))[0]
        if not len(faces):
            continue
        want = local[fl[faces]]
        fc = np.full(nf, -1, dtype=np.int64)
        for i0 in range(0, len(faces), 4096):
            d = ((want[i0:i0 + 4096, None, :] - cand_c[None]) ** 2).sum(2)
            fc[faces[i0:i0 + 4096]] = d.argmin(1)
        m = fc[face_of] >= 0
        uvs[m] = cand_uv[fc[face_of[m]]]
        me.uv_layers.active.data.foreach_set('uv', uvs.astype(np.float32).ravel())
        me.update()
        n += int((fc[faces] > 0).sum())
    return n


def seam_normals():
    """Every part is shaded by its own normals, and at a cut each side only knows its own half of the surface: the
    light breaks along the cut, and on bare skin that is a line drawn round the arm. So the two sides of every cut
    get one normal, the mean of theirs (taken from the surface alone: the patch that closes a part behind its rim
    has no say in how the rim is lit).

    The patches themselves are lit as the surface they mend: the surface's normals are carried across a patch from
    its rim, and a patch faces whichever way those say. Where the two rims of a cut do not quite meet, the sliver
    of patch that shows between them is then one more piece of the surface - not the back of a membrane, lit from
    the wrong side, a dark fleck on the seam."""
    nor, turned = {}, 0
    for p in P:
        me = p.o.data
        nv, nf = len(me.vertices), len(me.polygons)
        pn = np.zeros(nf * 3, dtype=np.float32)
        me.polygons.foreach_get('normal', pn)
        pn = pn.reshape(-1, 3).astype(np.float64)
        pa = np.zeros(nf, dtype=np.float32)
        me.polygons.foreach_get('area', pa)
        lid = np.zeros(nf, dtype=np.int32)
        if 'lid' in me.attributes and len(me.attributes['lid'].data) == nf:
            me.attributes['lid'].data.foreach_get('value', lid)
        lv = np.zeros(len(me.loops), dtype=np.int32)
        me.loops.foreach_get('vertex_index', lv)
        ls = np.zeros(nf, dtype=np.int32)
        me.polygons.foreach_get('loop_start', ls)
        lt = np.zeros(nf, dtype=np.int32)
        me.polygons.foreach_get('loop_total', lt)
        face_of = np.repeat(np.arange(nf), lt)  # (loops are stored face by face)
        surf, every = np.zeros((nv, 3)), np.zeros((nv, 3))
        wgt = pn * pa[:, None]
        np.add.at(every, lv, wgt[face_of])
        np.add.at(surf, lv, wgt[face_of] * (lid[face_of] == 0)[:, None])
        has = np.linalg.norm(surf, axis=1) > 1e-12
        own = every / np.maximum(np.linalg.norm(every, axis=1), 1e-12)[:, None]
        n_ = np.zeros((nv, 3))
        n_[has] = surf[has] / np.linalg.norm(surf[has], axis=1)[:, None]
        free = ~has
        if free.any():
            # (each vertex inside a patch the mean of its neighbours, over and over: near a rim that is the rim's
            # normal; in the middle of the disc that closes a limb where it was cut the rim's normals cancel out,
            # and what is left over is made up with the patch's own)
            e = np.zeros(len(me.edges) * 2, dtype=np.int32)
            me.edges.foreach_get('vertices', e)
            e = e.reshape(-1, 2)
            e = e[free[e[:, 0]] | free[e[:, 1]]]
            ea, eb = np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]])
            keep = free[ea]
            ea, eb = ea[keep], eb[keep]
            deg = np.maximum(np.bincount(ea, minlength=nv), 1)[:, None]
            for _ in range(80):
                acc = np.zeros((nv, 3))
                for c_ in range(3):
                    acc[:, c_] = np.bincount(ea, weights=n_[eb, c_], minlength=nv)
                n_[free] = (acc / deg)[free]
            k_ = np.linalg.norm(n_[free], axis=1)
            mix = n_[free] + np.maximum(0.0, 1.0 - k_)[:, None] * own[free]
            n_[free] = mix / np.maximum(np.linalg.norm(mix, axis=1), 1e-12)[:, None]
        nor[p.name] = n_
    key, parent = {}, []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a_, u_, b_, w_ in SEAMS:
        for k_ in ((a_, u_), (b_, w_)):
            if k_ not in key:
                key[k_] = len(parent)
                parent.append(len(parent))
        ra, rb = find(key[(a_, u_)]), find(key[(b_, w_)])
        if ra != rb:
            parent[ra] = rb
    groups = {}
    for k_, i_ in key.items():
        groups.setdefault(find(i_), []).append(k_)
    for members in groups.values():
        m = sum(nor[n_][i_] for n_, i_ in members)
        ln = float(np.linalg.norm(m))
        if ln > 1e-9:
            for n_, i_ in members:
                nor[n_][i_] = m / ln
    for p in P:
        me = p.o.data
        nf = len(me.polygons)
        if 'lid' in me.attributes and len(me.attributes['lid'].data) == nf:
            lid = np.zeros(nf, dtype=np.int32)
            me.attributes['lid'].data.foreach_get('value', lid)
            if (lid == 1).any():
                pn = np.zeros(nf * 3, dtype=np.float32)
                me.polygons.foreach_get('normal', pn)
                pn = pn.reshape(-1, 3).astype(np.float64)
                lv = np.zeros(len(me.loops), dtype=np.int32)
                me.loops.foreach_get('vertex_index', lv)
                lt = np.zeros(nf, dtype=np.int32)
                me.polygons.foreach_get('loop_total', lt)
                face_of = np.repeat(np.arange(nf), lt)
                fm = np.zeros((nf, 3))
                for c_ in range(3):
                    fm[:, c_] = np.bincount(face_of, weights=nor[p.name][lv, c_], minlength=nf)
                flip = np.nonzero((lid == 1) & ((fm * pn).sum(1) < 0))[0]
                for i_ in flip:
                    me.polygons[int(i_)].flip()
                if len(flip):
                    me.update()
                    turned += len(flip)
        me.normals_split_custom_set_from_vertices([Vector((float(x), float(y), float(z))) for x, y, z in nor[p.name]])
    return len(groups), turned


# (a patch can fold back onto a triangle of the surface it mends, the same three corners: one of the two is enough,
# and the exporter would drop the other anyway, with a warning for every part)
log('parts with patch faces lying on a face of the surface (dropped):', sum(1 for p in P if p.o.data.validate(verbose=False)))
log('patch faces painted in the colour of the surface beside them (not their part\'s commonest):', patch_colours())
log('seam normals joined at %d places; %d patch faces turned to face the way they are lit' % seam_normals())
# (a sculpt that crouched has holes of every kind where it was folded onto itself, and they are all mended with
# surface: only a standing one has openings that can be told from mends)
log('inside faces:', inside_materials() if STANDING else 0)
for p in P:  # names that say what a part is (tools and the model check read them)
    p.o.name = p.o.data.name = f'{p.cls}{p.side or ""}_{p.name.replace("tripo_part_", "")}'
if opt('--seams'):
    rest = {p.name: verts_gl(p.o) for p in P}
    named = {p.name: p.o.name for p in P}
    os.makedirs(opt('--seams'), exist_ok=True)
    with open(os.path.join(opt('--seams'), NAME + '.seams.json'), 'w', encoding='utf8') as f:
        json.dump({'pairs': [[named[a_], [round(float(x), 5) for x in rest[a_][u]], named[b_], [round(float(x), 5) for x in rest[b_][w]]] for a_, u, b_, w in SEAMS]}, f)
    log(f'seams written down: {len(SEAMS)} pairs')
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
