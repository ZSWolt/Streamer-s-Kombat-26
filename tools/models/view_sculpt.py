"""Blender (headless): look at a prepared sculpt (the stage-1 cache) as it came: textured and by part class.

  blender -b --factory-startup -P tools/models/view_sculpt.py -- <cache_dir> <id> <out_dir> [--views front,back,left,top] [--res 700x900]

Writes <out_dir>/<id>_src_<view>.png (texture) and <id>_cls_<view>.png (one colour per part class).
"""
import json
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
CACHE, NAME, OUT = argv[0], argv[1], argv[2]
opt = lambda n, d=None: argv[argv.index(n) + 1] if n in argv else d
views = opt('--views', 'front,back,left,top').split(',')
res = tuple(int(x) for x in opt('--res', '700x900').split('x'))

bpy.ops.wm.open_mainfile(filepath=os.path.abspath(os.path.join(CACHE, NAME + '.blend')))
scene = bpy.context.scene
with open(os.path.join(CACHE, NAME + '.json'), encoding='utf8') as f:
    meta = json.load(f)
H = meta['height']
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x, scene.render.resolution_y = res
if not scene.world:
    scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.45, 0.47, 0.5)
sh = scene.display.shading
sh.light = 'STUDIO'
sh.show_backface_culling = False
cd = bpy.data.cameras.new('cam')
cd.type = 'ORTHO'
cam = bpy.data.objects.new('cam', cd)
scene.collection.objects.link(cam)
scene.camera = cam
VIEWS = {'front': (0, -1, 0), 'left': (1, 0, 0), 'back': (0, 1, 0), 'right': (-1, 0, 0), 'fl': (0.7, -0.7, 0), 'top': (0, -0.001, 1)}
PAL = {'torso': (0.2, 0.45, 0.9, 1), 'torso2': (0.1, 0.8, 0.8, 1), 'head': (0.95, 0.8, 0.3, 1), 'headacc': (0.95, 0.55, 0.15, 1), 'arm': (0.9, 0.25, 0.25, 1),
       'leg': (0.3, 0.75, 0.3, 1), 'shoe': (0.55, 0.3, 0.75, 1), 'acc': (0.95, 0.95, 0.95, 1)}
os.makedirs(OUT, exist_ok=True)
for mode in ('src', 'cls'):
    sh.color_type = 'TEXTURE' if mode == 'src' else 'OBJECT'
    for i, o in enumerate(o for o in scene.objects if o.type == 'MESH'):
        c = PAL.get(meta['parts'][o.name]['cls'], (0.5, 0.5, 0.5, 1))
        k = 0.75 + 0.25 * ((i * 37) % 5) / 4  # parts of one class in slightly different shades
        o.color = (c[0] * k, c[1] * k, c[2] * k, 1)
    for vn in views:
        dx, dy, dz = VIEWS[vn]
        cam.data.ortho_scale = 1.15 * H if vn != 'top' else 1.0 * H
        target = Vector((0, 0, 0.5 * H if vn != 'top' else 0.8 * H))
        cam.location = target + Vector((dx, dy, dz)) * 4
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.abspath(os.path.join(OUT, f'{NAME}_{mode}_{vn}.png'))
        bpy.ops.render.render(write_still=True)
print('@@ ok', NAME)
