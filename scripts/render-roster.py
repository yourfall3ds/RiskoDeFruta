import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent;bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene
for i,name in enumerate(['broccoli','banana','corn','watermelon','tomato','lettuce']):
    before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'))
    for obj in set(scene.objects)-before:
        if obj.parent is None:obj.location.x+=(i-2.5)*3.1
        if obj.type=='ARMATURE' and obj.animation_data:
            for track in obj.animation_data.nla_tracks:track.mute=True
scene.frame_set(1)
scene.world=bpy.data.worlds.new('Studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.22,.28,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
for loc,power,size in [((-5,-7,8),1600,8),((7,-4,6),1100,6),((0,5,7),2000,8)]:
    light=bpy.data.lights.new('Softbox','AREA');light.energy=power;light.size=size;o=bpy.data.objects.new('Softbox',light);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
cam=bpy.data.objects.new('Camera',bpy.data.cameras.new('Camera'));scene.collection.objects.link(cam);scene.camera=cam;cam.location=(0,-20,5);cam.rotation_euler=(Vector((0,0,1.4))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=19
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.render.resolution_x=1800;scene.render.resolution_y=540;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX';scene.render.filepath=str(ROOT/'art/blender/roster-lineup.png');bpy.ops.render.render(write_still=True)
