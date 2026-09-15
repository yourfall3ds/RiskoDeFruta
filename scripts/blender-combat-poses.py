"""Author upper-body actions for the dual-pistol kit; keep only useful source locomotion."""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Inspection.blend'))
scene=bpy.context.scene
rig=bpy.data.objects['Gunslinger_Rig']
rig.animation_data_clear()
for action in list(bpy.data.actions):
    if action.name not in ('Idle','Run','Walk','Dodge'): bpy.data.actions.remove(action)
for bone in rig.pose.bones: bone.matrix_basis.identity()
bpy.context.view_layer.update()
for image in bpy.data.images:
    if image.size[0]>2048 or image.size[1]>2048:
        factor=2048/max(image.size);image.scale(round(image.size[0]*factor),round(image.size[1]*factor))
targets=[]
for side,sign in [('Right',-1),('Left',1)]:
    # glTF rig names and world locations are preserved from the source character.
    hand=rig.pose.bones[side+'Hand']
    shoulder=rig.matrix_world@rig.pose.bones[side+'Arm'].head
    target=bpy.data.objects.new(side+'AimTarget',None);scene.collection.objects.link(target)
    target.location=(shoulder.x,-.51,1.30)
    pole=bpy.data.objects.new(side+'ElbowPole',None);scene.collection.objects.link(pole)
    pole.location=(shoulder.x*2.7,-.05,1.05)
    constraint=rig.pose.bones[side+'ForeArm'].constraints.new('IK');constraint.target=target;constraint.pole_target=pole;constraint.chain_count=2;constraint.use_stretch=False
    # A short forward muzzle line is independent of the hand bone's inherited roll.
    targets.append((side,target,pole))
custom=[('Aim',24),('Fire_R',14),('Fire_L',14),('Charge',40),('Release',18)]
for name,frames in custom:
    rig.animation_data_clear()
    for bone in rig.pose.bones: bone.matrix_basis.identity()
    for side,target,pole in targets:
        target.animation_data_clear()
        shoulder=rig.matrix_world@rig.pose.bones[side+'Arm'].head
        base=Vector((shoulder.x,-.51,1.30))
        keys=[(1,base),(frames,base)]
        if name.startswith('Fire') and ((name=='Fire_R' and side=='Right')or(name=='Fire_L' and side=='Left')):
            keys=[(1,base),(3,base+Vector((0,.11,.035))),(7,base+Vector((0,.035,.015))),(frames,base)]
        elif name=='Charge':
            end=base+Vector((shoulder.x*.45,.13,.07));keys=[(1,base),(frames,end)]
        elif name=='Release':
            keys=[(1,base+Vector((0,.13,.07))),(4,base+Vector((0,-.035,.02))),(8,base+Vector((0,.12,.07))),(frames,base)]
        for frame,position in keys:target.location=position;target.keyframe_insert(data_path='location',frame=frame)
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.nla.bake(frame_start=1,frame_end=frames,step=1,only_selected=False,visual_keying=True,clear_constraints=False,use_current_action=False,bake_types={'POSE'})
    action=rig.animation_data.action;action.name=name;action.use_fake_user=True
    bpy.ops.object.mode_set(mode='OBJECT')
for side,target,pole in targets:
    for constraint in list(rig.pose.bones[side+'ForeArm'].constraints):rig.pose.bones[side+'ForeArm'].constraints.remove(constraint)
    bpy.data.objects.remove(target,do_unlink=True);bpy.data.objects.remove(pole,do_unlink=True)
rig.animation_data.action=bpy.data.actions['Aim']
rig.animation_data.action_slot=bpy.data.actions['Aim'].slots[0]
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for obj in rig.children_recursive:
    if obj.type=='MESH':obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/gunslinger.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=93,export_image_quality=93)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Combat.blend'))
scene.render.filepath=str(ROOT/'art/blender/gunslinger-combat.png')
if '--render' in sys.argv:bpy.ops.render.render(write_still=True)
