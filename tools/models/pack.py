"""Blender (headless): build the Concards booster pack as a real model file and render a preview.

  blender -b --factory-startup -P tools/models/pack.py -- <front.jpg> <back.jpg> <out.glb> <preview_dir>

Same shape as the in-game prop (client/src/render/props.ts `cardPack`): a sealed foil pouch — flat crimped ends
with a serrated edge, pillowed in the middle where the cards sit. Here the serration is real geometry, so the
file looks right in any viewer. Real size: 6.6 x 10 cm.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

front_img, back_img, out, preview = sys.argv[sys.argv.index('--') + 1:][:4]

W, H = 0.066, 0.100
BULGE, CRIMP, TEETH, DEPTH = 0.0055, 0.085, 26, 0.0013
NX, NY = TEETH * 2, 64


def pillow(xn, yn):
    """xn, yn in -1..1 -> thickness of one side"""
    body = max(0.0, 1.0 - abs(yn) / (1.0 - CRIMP * 2))
    return BULGE * (1 - xn * xn) * min(1.0, body * 3) ** 0.6 + 0.00015


bpy.ops.wm.read_factory_settings(use_empty=True)
verts, faces, uvs = [], [], []
for side in (1, -1):  # 1 = front (faces -Y in Blender = +Z in glTF), -1 = back
    base = len(verts)
    for j in range(NY + 1):
        for i in range(NX + 1):
            xn, yn = i / NX * 2 - 1, j / NY * 2 - 1
            z = yn * H / 2
            if j == NY and i % 2:
                z -= DEPTH  # serrated seal: every other vertex of the end rows is pulled in
            if j == 0 and i % 2:
                z += DEPTH
            verts.append((xn * W / 2, -side * pillow(xn, yn), z))
            u = i / NX
            uvs.append((u if side == 1 else 1 - u, j / NY))
    for j in range(NY):
        for i in range(NX):
            a = base + j * (NX + 1) + i
            quad = (a, a + 1, a + NX + 2, a + NX + 1)
            faces.append(quad if side == 1 else quad[::-1])

mesh = bpy.data.meshes.new('ConcardsPack')
mesh.from_pydata(verts, [], faces)
uv = mesh.uv_layers.new(name='UVMap')
for poly in mesh.polygons:
    for li in poly.loop_indices:
        uv.data[li].uv = uvs[mesh.loops[li].vertex_index]
half = len(faces) // 2
for k, poly in enumerate(mesh.polygons):
    poly.material_index = 0 if k < half else 1
mesh.shade_smooth()
obj = bpy.data.objects.new('ConcardsPack', mesh)
bpy.context.scene.collection.objects.link(obj)

for name, path in (('pack_front', front_img), ('pack_back', back_img)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Metallic'].default_value = 0.55
    bsdf.inputs['Roughness'].default_value = 0.32
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(path)
    m.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    mesh.materials.append(m)

os.makedirs(os.path.dirname(out), exist_ok=True)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
kw = dict(filepath=out, export_format='GLB', export_image_format='JPEG', export_image_quality=90, export_yup=True,
          export_apply=True, export_animations=False, export_skins=False, export_cameras=False, export_lights=False)
bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})
print(f'@@ exported {out} {os.path.getsize(out) / 1024:.0f} KB, {len(mesh.polygons) * 2} tris')

# ---- preview renders
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x, scene.render.resolution_y = 520, 720
scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.05, 0.05, 0.07)
sh = scene.display.shading
sh.light = 'STUDIO'
sh.color_type = 'TEXTURE'
sh.show_specular_highlight = True
cd = bpy.data.cameras.new('cam')
cd.lens = 85
cam = bpy.data.objects.new('cam', cd)
scene.collection.objects.link(cam)
scene.camera = cam
os.makedirs(preview, exist_ok=True)
for name, ang, tilt in (('front', 0, 0.05), ('threeq', 0.75, 0.18), ('side', 1.45, 0.1), ('back', math.pi - 0.6, 0.15)):
    d = 0.42
    cam.location = Vector((math.sin(ang) * d, -math.cos(ang) * d, d * tilt))
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(preview, f'pack_{name}.png')
    bpy.ops.render.render(write_still=True)
print('@@ previews done')
