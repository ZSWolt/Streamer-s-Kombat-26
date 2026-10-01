"""Render the reference sheet for new character models: the pose and the part split the pipeline wants.

  blender -b --factory-startup -P tools/models/reference_pose.py -- <out_dir>

Writes front / side / three-quarter renders of a mannequin in A-pose, each body part its own colour, plus
labels.json (where each part lands in each picture) for tools/models/reference_sheet.py to annotate.
"""
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

out = sys.argv[sys.argv.index('--') + 1]
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

A = math.radians(40)  # arms this far from hanging straight down
SH, HIP = 0.20, 0.10  # half shoulder / hip width

J = {
    'head': Vector((0, 0, 1.60)), 'neck': Vector((0, 0, 1.47)), 'chest': Vector((0, 0, 1.30)), 'waist': Vector((0, 0, 1.08)),
    'pelvis': Vector((0, 0, 0.97)),
}
for s, sx in (('L', 1), ('R', -1)):
    sh = Vector((sx * SH, 0, 1.42))
    d = Vector((sx * math.sin(A), 0, -math.cos(A)))
    J['sh' + s] = sh
    J['el' + s] = sh + d * 0.29
    J['wr' + s] = sh + d * 0.55
    J['ha' + s] = sh + d * 0.64
    J['hip' + s] = Vector((sx * HIP, 0, 0.93))
    J['kn' + s] = Vector((sx * 0.125, -0.005, 0.50))
    J['an' + s] = Vector((sx * 0.145, 0.01, 0.085))

PARTS = {}  # name -> (colour, label anchor)
COL = {
    'head': '#f2c230', 'torso': '#2f6fdb', 'pelvis': '#8a4fd8',
    'upper arm L': '#1fa34a', 'upper arm R': '#63d07f', 'forearm L': '#e0661f', 'forearm R': '#f2a45e',
    'hand L': '#c81e4a', 'hand R': '#f06a8c', 'thigh L': '#0f9aa8', 'thigh R': '#5fd0d8',
    'shin L': '#7a8b1f', 'shin R': '#b9c94f', 'foot L': '#5b3a1c', 'foot R': '#a17446',
}


def material(name):
    h = COL[name].lstrip('#')
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*lin, 1)
    m.roughness = 0.6
    return m


def finish(o, part):
    if part not in PARTS:
        PARTS[part] = material(part)
    o.data.materials.append(PARTS[part])
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth()
    o['part'] = part
    return o


def ball(c, r, part, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=c, segments=48, ring_count=24)
    o = bpy.context.object
    o.scale = scale
    return finish(o, part)


def limb(a, b, ra, rb, part):
    """A tapered segment from a to b with rounded ends."""
    d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=ra, radius2=rb, depth=d.length, location=(a + b) / 2)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    finish(o, part)
    ball(a, ra, part)
    ball(b, rb, part)


# ---- body
ball(J['head'] + Vector((0, 0, 0.02)), 0.125, 'head', (0.92, 1.0, 1.1))
ball(J['head'] + Vector((0, -0.118, -0.005)), 0.022, 'head')  # nose: which way is forward
limb(J['neck'] + Vector((0, 0, -0.02)), J['neck'] + Vector((0, 0, 0.07)), 0.055, 0.05, 'head')
ball(Vector((0, 0, 1.30)), 0.19, 'torso', (1.12, 0.66, 0.95))  # chest
ball(Vector((0, 0, 1.14)), 0.16, 'torso', (1.08, 0.7, 0.75))  # belly
for s in 'LR':
    ball(J['sh' + s] + Vector((0, 0, -0.005)), 0.075, 'torso')  # shoulder caps belong to the torso
ball(J['pelvis'], 0.165, 'pelvis', (1.1, 0.72, 0.62))
for s in 'LR':
    limb(J['sh' + s] + (J['el' + s] - J['sh' + s]) * 0.2, J['el' + s], 0.058, 0.046, 'upper arm ' + s)
    limb(J['el' + s], J['wr' + s], 0.045, 0.034, 'forearm ' + s)
    ball(J['ha' + s], 0.052, 'hand ' + s, (0.9, 1.0, 1.15))
    limb(J['hip' + s], J['kn' + s], 0.088, 0.062, 'thigh ' + s)
    limb(J['kn' + s], J['an' + s], 0.06, 0.042, 'shin ' + s)
    bpy.ops.mesh.primitive_cube_add(size=1, location=J['an' + s] + Vector((0, -0.07, -0.04)))
    f = bpy.context.object
    f.scale = (0.1, 0.26, 0.085)
    bpy.ops.object.transform_apply(scale=True)
    m = f.modifiers.new('b', 'BEVEL')
    m.width = 0.035
    m.segments = 6
    finish(f, 'foot ' + s)

# ---- floor line and lighting-free render
scene.render.engine = 'BLENDER_WORKBENCH'
sh = scene.display.shading
sh.light = 'STUDIO'
sh.color_type = 'MATERIAL'
sh.show_shadows = False
sh.show_cavity = True
sh.cavity_type = 'WORLD'
sh.show_object_outline = True
sh.object_outline_color = (0.05, 0.05, 0.07)
sh.background_type = 'VIEWPORT'
sh.background_color = (0.93, 0.94, 0.96)
scene.display.render_aa = '16'
scene.view_settings.view_transform = 'Standard'
scene.render.film_transparent = False

cam_d = bpy.data.cameras.new('cam')
cam_d.type = 'ORTHO'
cam_d.ortho_scale = 2.0
cam = bpy.data.objects.new('cam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam

anchors = {
    'head': J['head'] + Vector((0, 0, 0.04)), 'torso': Vector((0, 0, 1.27)), 'pelvis': J['pelvis'],
}
for s in 'LR':
    anchors['upper arm ' + s] = (J['sh' + s] + J['el' + s]) / 2 + (J['el' + s] - J['sh' + s]) * 0.1
    anchors['forearm ' + s] = (J['el' + s] + J['wr' + s]) / 2
    anchors['hand ' + s] = J['ha' + s]
    anchors['thigh ' + s] = (J['hip' + s] + J['kn' + s]) / 2
    anchors['shin ' + s] = (J['kn' + s] + J['an' + s]) / 2
    anchors['foot ' + s] = J['an' + s] + Vector((0, -0.09, -0.04))
joints = {k: v for k, v in J.items() if k[:2] in ('sh', 'el', 'wr', 'hi', 'kn', 'an') or k == 'neck'}

VIEWS = {'front': (0, 900, 1260), 'side': (90, 620, 1260), 'quarter': (35, 900, 1260)}
labels = {}
for name, (yaw, w, h) in VIEWS.items():
    a = math.radians(yaw)
    target = Vector((0, 0, 0.9))
    cam.location = target + Vector((math.sin(a) * 6, -math.cos(a) * 6, 0))
    cam.rotation_euler = (math.pi / 2, 0, a)
    cam_d.ortho_scale = 2.0 if w >= h else 2.0 * w / h * (h / w)
    scene.render.resolution_x, scene.render.resolution_y = w, h
    cam_d.sensor_fit = 'VERTICAL'
    scene.render.filepath = os.path.join(out, f'ref_{name}.png')
    bpy.ops.render.render(write_still=True)
    bpy.context.view_layer.update()

    def px(p):
        c = world_to_camera_view(scene, cam, p)
        return [round(c.x * w, 1), round((1 - c.y) * h, 1)]

    labels[name] = {'size': [w, h], 'parts': {k: px(v) for k, v in anchors.items()}, 'joints': {k: px(v) for k, v in joints.items()},
                    'floor': px(Vector((0, 0, 0)))[1]}

json.dump({'views': labels, 'colors': COL, 'arm_angle': 40}, open(os.path.join(out, 'labels.json'), 'w'), indent=1)
print('@@ ok', out)
