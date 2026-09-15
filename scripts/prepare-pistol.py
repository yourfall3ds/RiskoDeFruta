"""Prepare a local copy of the supplied high-resolution pistol; originals stay intact."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
SOURCE=Path('C:/Users/lucas/Downloads/Meshy_AI_gunslinger_pistol_0906182618_image-to-3d-texture.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
scene=bpy.context.scene
mesh=next(o for o in scene.objects if o.type=='MESH')
before=len(mesh.data.polygons)
bpy.context.view_layer.objects.active=mesh
mesh.select_set(True)
modifier=mesh.modifiers.new('Runtime triangle budget','DECIMATE');modifier.ratio=min(1,40000/before)
bpy.ops.object.modifier_apply(modifier=modifier.name)
for image in bpy.data.images:
    if max(image.size)>2048:
        factor=2048/max(image.size);image.scale(round(image.size[0]*factor),round(image.size[1]*factor))
for poly in mesh.data.polygons:poly.use_smooth=True
mesh.name='Gunslinger_Pistol'
# Keep source coordinates in this inspection file for precise grip and muzzle calibration.
def point_at(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
scene.world=bpy.data.worlds.new('Inspection world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.16,.22,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
for name,loc,power,size in [('Key',(0,-3,4),500,4),('Fill',(-3,0,2),350,3),('Rim',(2,2,2),600,2)]:
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.size=size
    obj=bpy.data.objects.new(name,light);scene.collection.objects.link(obj);obj.location=loc;point_at(obj,(0,0,0))
cam=bpy.data.objects.new('Inspection camera',bpy.data.cameras.new('Inspection camera'));scene.collection.objects.link(cam);scene.camera=cam
cam.data.type='ORTHO';cam.data.ortho_scale=2.5;cam.location=(0,-4,1.1);point_at(cam,(0,0,0))
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.render.resolution_x=1100;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
(ROOT/'art/blender').mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Pistol_Inspection.blend'))
scene.render.filepath=str(ROOT/'art/blender/pistol-inspection.png');bpy.ops.render.render(write_still=True)
(ROOT/'docs/pistol-inspection.json').write_text(json.dumps({'sourcePolygons':before,'runtimePolygons':len(mesh.data.polygons),'dimensions':list(mesh.dimensions),'bounds':[list(v) for v in mesh.bound_box]},indent=2))
