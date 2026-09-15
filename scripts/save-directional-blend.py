import bpy
from pathlib import Path
root=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'public/models/gunslinger.glb'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
for t in rig.animation_data.nla_tracks:t.mute=True
for a in bpy.data.actions:a.use_fake_user=True
rig.animation_data.action=bpy.data.actions['PrepareStorm'];rig.animation_data.action_slot=rig.animation_data.action.slots[0]
bpy.context.scene.render.fps=60;bpy.context.scene.frame_set(50)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(root/'art/blender/Gunslinger_Directional_And_Skills.blend'),compress=True)
print('EDITABLE DIRECTIONAL AND SKILL ANIMATIONS SAVED',flush=True)
