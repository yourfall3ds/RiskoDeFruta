import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene
for index,name in enumerate(['Meshy_AI_Character_output.glb','melancia-Meshy_AI_Character_output (1).glb']):
    previous=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets'/name));objects=set(scene.objects)-previous
    for obj in objects:
        if obj.parent is None:obj.location.x+=(index-.5)*2.8
for image in bpy.data.images:
    if max(image.size)>1024:
        factor=1024/max(image.size);image.scale(round(image.size[0]*factor),round(image.size[1]*factor))
scene.world=bpy.data.worlds.new('Review');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.15,.19,.25,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
for name,loc,power in [('Key',(-3,-4,5),900),('Fill',(3,-2,3),650)]:
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.size=4;obj=bpy.data.objects.new(name,light);scene.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=(Vector((0,0,1))-obj.location).to_track_quat('-Z','Y').to_euler()
cam=bpy.data.objects.new('Camera',bpy.data.cameras.new('Camera'));scene.collection.objects.link(cam);scene.camera=cam;cam.location=(0,-9,2.8);cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=6
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.render.resolution_x=1200;scene.render.resolution_y=700;scene.render.resolution_percentage=100
scene.render.filepath=str(ROOT/'art/blender/enemy-extra-review.png');bpy.ops.render.render(write_still=True)
