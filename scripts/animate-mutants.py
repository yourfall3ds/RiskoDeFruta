"""Bake clear anticipation/cast/recovery poses into the reusable humanoid rigs."""
import bpy,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
for name in ['broccoli','banana','corn','lettuce','carrot','boss']:
    bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;bpy.context.preferences.filepaths.save_version=0
    bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'))
    rig=next((o for o in scene.objects if o.type=='ARMATURE'),None)
    if not rig:continue
    rig.animation_data_create()
    for track in rig.animation_data.nla_tracks:track.mute=True
    walk=bpy.data.actions.get('Walk')
    if walk:rig.animation_data.action=walk;rig.animation_data.action_slot=walk.slots[0]
    scene.frame_set(1);base={bone.name:bone.matrix_basis.copy() for bone in rig.pose.bones}
    targets=[]
    for side in ['Left','Right']:
        fore=rig.pose.bones.get(side+'ForeArm');arm=rig.pose.bones.get(side+'Arm')
        if not fore or not arm:continue
        shoulder=rig.matrix_world@arm.head;target=bpy.data.objects.new(side+'CastTarget',None);scene.collection.objects.link(target)
        pole=bpy.data.objects.new(side+'ElbowPole',None);scene.collection.objects.link(pole);pole.location=shoulder+Vector((-.5 if side=='Left' else .5,0,-.3))
        ik=fore.constraints.new('IK');ik.target=target;ik.pole_target=pole;ik.chain_count=2;ik.use_stretch=False
        targets.append((target,pole,shoulder,fore))
    for actionName,frames in [('Cast',64),('Attack',38)]:
        rig.animation_data.action=None
        for bone in rig.pose.bones:bone.matrix_basis=base[bone.name]
        for target,pole,shoulder,fore in targets:
            target.animation_data_clear();unit=2.5 if name=='boss' else 1
            neutral=shoulder+Vector((0,-.15,-.4))*unit
            prepare=shoulder+Vector((0,-.35,.15))*unit
            strike=shoulder+Vector((0,-.75,-.04))*unit
            keys=[(1,neutral),(frames,prepare)] if actionName=='Cast' else [(1,prepare),(8,strike),(16,strike),(frames,neutral)]
            for frame,at in keys:target.location=at;target.keyframe_insert(data_path='location',frame=frame)
        bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='POSE')
        bpy.ops.nla.bake(frame_start=1,frame_end=frames,step=2,only_selected=False,visual_keying=True,clear_constraints=False,use_current_action=False,bake_types={'POSE'})
        action=rig.animation_data.action;action.name=actionName;action.use_fake_user=True;bpy.ops.object.mode_set(mode='OBJECT')
    for target,pole,shoulder,fore in targets:
        for constraint in list(fore.constraints):fore.constraints.remove(constraint)
        bpy.data.objects.remove(target,do_unlink=True);bpy.data.objects.remove(pole,do_unlink=True)
    for action in bpy.data.actions:action.use_fake_user=True
    if walk:rig.animation_data.action=walk;rig.animation_data.action_slot=walk.slots[0]
    scene.frame_set(1);bpy.ops.object.select_all(action='DESELECT')
    for obj in scene.objects:
        if not obj.hide_render and not obj.hide_get():obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=88)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'art/blender/Mutant_{name}.blend'),compress=True)
    print('ANIMATED',name,flush=True)
