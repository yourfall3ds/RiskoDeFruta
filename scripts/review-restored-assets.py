import bpy, math
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/gunslinger.glb'))
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
for track in rig.animation_data.nla_tracks:track.mute=True
rig.animation_data.action=bpy.data.actions['Aim'];rig.animation_data.action_slot=bpy.data.actions['Aim'].slots[0];scene.frame_set(1)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Final.blend'),compress=True)
for side in ['Right','Left']:
    socket=bpy.data.objects[side+'WeaponGrip'];before=set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/pistol.glb'))
    for obj in set(scene.objects)-before:
        if obj.parent is None:obj.parent=socket;obj.matrix_basis=Matrix.Identity(4)
scene.world=bpy.data.worlds.new('Review world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.16,.2,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
for loc,power in [((-3,-4,5),450),((3,-2,4),650),((0,3,5),650)]:
    data=bpy.data.lights.new('Review softbox','AREA');data.energy=power;data.shape='DISK';data.size=4
    o=bpy.data.objects.new('Review softbox',data);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
camera=bpy.data.objects.new('Review camera',bpy.data.cameras.new('Review camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.data.lens=65
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True;scene.render.resolution_x=1100;scene.render.resolution_y=850;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
for name,pos,target in [('hands-front',(0,-1.6,1.95),(0,-.42,1.29)),('hands-back',(-.8,.55,2.2),(0,-.4,1.28))]:
    camera.location=pos;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(ROOT/f'art/blender/{name}.png');bpy.ops.render.render(write_still=True)
print('HAND REVIEWS READY',flush=True)
