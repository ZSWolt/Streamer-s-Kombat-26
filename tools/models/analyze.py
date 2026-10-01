"""Blender (headless): print part bounds + contact interfaces of a Tripo part-segmented GLB and render labelled views.

Usage: blender -b --factory-startup -P tools/models/analyze.py -- <glb> <outdir>
Coordinates printed are glTF space (x = character's left, y = up, z = front).
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
glb, outdir = argv[0], argv[1]
name = os.path.splitext(os.path.basename(glb))[0].replace(' ', '_')
os.makedirs(outdir, exist_ok=True)

PALETTE = [
    ('red', (0.9, 0.1, 0.1)), ('green', (0.1, 0.75, 0.15)), ('blue', (0.15, 0.3, 0.95)), ('yellow', (0.95, 0.9, 0.1)),
    ('cyan', (0.1, 0.85, 0.9)), ('magenta', (0.9, 0.15, 0.85)), ('orange', (1.0, 0.5, 0.05)), ('purple', (0.45, 0.15, 0.75)),
    ('white', (0.95, 0.95, 0.95)), ('black', (0.06, 0.06, 0.06)), ('brown', (0.4, 0.22, 0.08)), ('pink', (1.0, 0.6, 0.75)),
    ('lime', (0.6, 1.0, 0.3)), ('teal', (0.0, 0.45, 0.45)), ('grey', (0.5, 0.5, 0.5)), ('navy', (0.05, 0.08, 0.4)),
]


def gl(v):  # Blender (x, y, z) -> glTF (x, z, -y)
    return (round(v[0], 3), round(v[2], 3), round(-v[1], 3))


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
parts = sorted([o for o in bpy.context.scene.objects if o.type == 'MESH'], key=lambda o: o.name)

pts = {}
for i, o in enumerate(parts):
    n = len(o.data.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    o.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    mw = np.array(o.matrix_world, dtype=np.float32)
    co = co @ mw[:3, :3].T + mw[:3, 3]
    step = max(1, n // 30000)
    pts[o.name] = co[::step]
    cname, col = PALETTE[i % len(PALETTE)]
    o.color = (*col, 1.0)
    lo, hi = co.min(0), co.max(0)
    print(f'@@ part {o.name:18s} {cname:8s} verts={n:7d} lo={gl(lo)} hi={gl(hi)} centroid={gl(co.mean(0))}')

# contact interfaces: sampled vertices of A within eps of B
EPS = 0.006
names = [o.name for o in parts]
trees = {}
for n_ in names:
    t = KDTree(len(pts[n_]))
    for k, p in enumerate(pts[n_]):
        t.insert(Vector(p), k)
    t.balance()
    trees[n_] = t
for a in range(len(names)):
    for b in range(a + 1, len(names)):
        A, B = pts[names[a]], pts[names[b]]
        # quick bbox reject
        if (A.min(0) > B.max(0) + EPS).any() or (B.min(0) > A.max(0) + EPS).any():
            continue
        hit = [p for p in A if trees[names[b]].find(Vector(p))[2] < EPS]
        if len(hit) < 12:
            continue
        h = np.array(hit)
        c = h.mean(0)
        rad = float(np.sqrt(((h - c) ** 2).sum(1)).mean())
        print(f'@@ iface {names[a]} | {names[b]}  n={len(hit):5d} centre={gl(c)} radius={rad:.3f}')

# labelled colour renders
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = 900
scene.render.resolution_y = 1100
scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.25, 0.25, 0.28)
sh = scene.display.shading
sh.light = 'FLAT'
sh.color_type = 'OBJECT'
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 1.3
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
for vn, (dx, dy) in {'front': (0, -1), 'left': (1, 0), 'back': (0, 1), 'right': (-1, 0)}.items():
    cam.location = Vector((dx * 4, dy * 4, 0.5))
    cam.rotation_euler = (Vector((0, 0, 0.5)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(outdir, f'{name}_parts_{vn}.png')
    bpy.ops.render.render(write_still=True)
print('@@ done')
