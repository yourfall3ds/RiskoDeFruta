"""Bake jump silhouettes and the MP-II backflip without changing fitted palm sockets."""
import bpy,math
from mathutils import Quaternion
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/gunslinger.glb'))
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE');rig.animation_data_create()
for track in rig.animation_data.nla_tracks:track.mute=True
aim=bpy.data.actions['Aim'];rig.animation_data.action=aim;rig.animation_data.action_slot=aim.slots[0];scene.frame_set(1)
base={b.name:b.matrix_basis.copy() for b in rig.pose.bones}
for name in ['JumpRise','JumpFall','Backflip']:
    if name in bpy.data.actions:bpy.data.actions.remove(bpy.data.actions[name])
    rig.animation_data.action=None
    for frame in range(1,36):
        t=(frame-1)/34;scene.frame_set(frame)
        for bone in rig.pose.bones:bone.matrix_basis=base[bone.name];bone.rotation_mode='QUATERNION'
        bends={'LeftUpLeg':-.62,'RightUpLeg':-.24,'LeftLeg':1.02,'RightLeg':.6} if name=='JumpRise' else {'LeftUpLeg':-.2,'RightUpLeg':-.14,'LeftLeg':.38,'RightLeg':.3}
        if name=='Backflip':
            tuck=math.sin(t*math.pi)**2
            bends={'LeftUpLeg':-1.15*tuck,'RightUpLeg':-1.05*tuck,'LeftLeg':1.6*tuck,'RightLeg':1.55*tuck,'Spine':.25*tuck,'Hips':-t*math.tau}
        for boneName,angle in bends.items():
            bone=rig.pose.bones.get(boneName)
            if bone:bone.rotation_quaternion=Quaternion((1,0,0),angle)@bone.rotation_quaternion
        for bone in rig.pose.bones:
            bone.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=bone.name);bone.keyframe_insert(data_path='location',frame=frame,group=bone.name)
    action=rig.animation_data.action;action.name=name;action.use_fake_user=True
for action in bpy.data.actions:action.use_fake_user=True
rig.animation_data.action=aim;rig.animation_data.action_slot=aim.slots[0];scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    if not o.hide_render and not o.hide_get():o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/gunslinger.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=93)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Final.blend'),compress=True)
print('PLAYER AIR ACTIONS READY',flush=True)
