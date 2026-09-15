import bpy,math
from mathutils import Vector,Quaternion
from pathlib import Path
R=Path('D:/Riskodefruta2');bpy.ops.wm.open_mainfile(filepath=str(R/'art/blender/Independent_Cosmic_Loading.blend'));s=bpy.context.scene;rig=next(o for o in s.objects if o.type=='ARMATURE')
for name,angle in [('LeftArm',-.9),('RightArm',.9)]:
 b=rig.pose.bones.get(name)
 if b:b.rotation_quaternion=Quaternion((0,0,1),angle)@b.rotation_quaternion
for name,angle in [('LeftUpLeg',.12),('RightUpLeg',-.12),('LeftLeg',.22),('RightLeg',.35)]:
 b=rig.pose.bones.get(name)
 if b:b.rotation_quaternion=Quaternion((1,0,0),angle)@b.rotation_quaternion
n=s.world.node_tree.nodes;l=s.world.node_tree.links;tex=next(x for x in n if x.type=='TEX_ENVIRONMENT');coord=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeMapping');mapping.inputs['Rotation'].default_value=(0,1.15,1.8);l.new(coord.outputs['Generated'],mapping.inputs['Vector']);l.new(mapping.outputs[0],tex.inputs['Vector'])
s.render.engine='CYCLES';s.cycles.samples=12;s.render.filepath=str(R/'art/loading-loop/preview.png');s.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(R/'art/blender/Independent_Cosmic_Loading.blend'),compress=True);bpy.ops.render.render(write_still=True)
