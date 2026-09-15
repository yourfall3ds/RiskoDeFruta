"""Authored timber stair dressing over the existing collision ramp; run after canopies."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'))
bpy.context.preferences.filepaths.save_version=0
for obj in list(bpy.data.objects):
    if obj.name.startswith('Barn approach timber stairs'):
        bpy.data.objects.remove(obj,do_unlink=True)
wood=bpy.data.materials['Weathered timber']
parts=[]
def box(location,scale):
    bpy.ops.mesh.primitive_cube_add(size=1,location=location)
    obj=bpy.context.object;obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(wood)
    bevel=obj.modifiers.new('Worn timber edges','BEVEL');bevel.width=.025;bevel.segments=1
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=bevel.name)
    parts.append(obj)
    return obj
def beam(a,b,width):
    av,bv=Vector(a),Vector(b);d=bv-av
    obj=box((av+bv)*.5,(width,width,d.length))
    obj.rotation_euler=d.to_track_quat('Z','Y').to_euler()
for i in range(32):
    t=(i+.5)/32
    box((0,-(10+t*10),t*5-.055),(7.96,.3075,.17))
for side in [-1,1]:
    x=side*4.08
    for j in range(6):
        z=10+j*2;y=j
        box((x,-z,y+.52),(.2,.2,1.12))
        box((x,-z,y+1.105),(.26,.26,.1))
    for y in [.5,1.0]:beam((x,-10,y),(x,-20,5+y),.13)
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join();bpy.context.object.name='Barn approach timber stairs'
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects:
    if obj.type=='MESH' and obj.location.z>-1000 and not obj.hide_render:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='AUTO',export_jpeg_quality=88)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Polished.blend'),compress=True)
print('TEXTURED TIMBER STAIRS READY',flush=True)
