import bpy
from pathlib import Path
root=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'public/models/gunslinger.glb'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
for t in rig.animation_data.nla_tracks:t.mute=True
rig.animation_data.action=bpy.data.actions['Aim'];rig.animation_data.action_slot=bpy.data.actions['Aim'].slots[0];bpy.context.scene.frame_set(1)
for n in ['Hips','Spine','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','RightFoot','RightArm']:
 b=rig.pose.bones.get(n)
 if b:print(n,'head',tuple(rig.matrix_world@b.head),'tail',tuple(rig.matrix_world@b.tail),flush=True)
