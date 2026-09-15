"""Fit sculpted, textured stone blocks where a cliff scan was unsuitable for masonry."""
import bpy, math, random
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'))
bpy.context.preferences.filepaths.save_version=0
material=bpy.data.objects['coast_land dressed.040'].data.materials[0]
assert material
for i in range(17):
    o=bpy.data.objects.get(f'coast_land dressed.{40+i:03}')
    assert o, f'Missing doorway block {i}'
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1)
    sculpt=bpy.context.object;random.seed(5300+i)
    for v in sculpt.data.vertices:
        v.co*=random.uniform(.91,1.08)
    o.data=sculpt.data;bpy.data.objects.remove(sculpt,do_unlink=True)
    o.data.materials.clear();o.data.materials.append(material)
    if i<13:
        a=i/12*math.pi
        o.location=(-math.cos(a)*2.95,-33,7.6+math.sin(a)*2.95)
        o.rotation_euler=(0,math.pi/2-a,0)
    else:
        o.location=((-1 if i<15 else 1)*2.95,-33,5.55+((i-13)%2)*1.05)
        o.rotation_euler=(0,0,(i-13)*.13)
    o.scale=(.66,.53,.63)
bpy.ops.object.select_all(action='DESELECT')
for i in range(17):bpy.data.objects[f'coast_land dressed.{40+i:03}'].select_set(True)
bpy.context.view_layer.objects.active=bpy.data.objects['coast_land dressed.040']
bpy.ops.object.join();bpy.context.object.name='Wormhole stone arch'
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
    if o.type=='MESH' and o.location.z>-1000 and not o.hide_render:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=88)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'),compress=True)
print('DOORWAY MASONRY READY',flush=True)
