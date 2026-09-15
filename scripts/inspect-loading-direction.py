import bpy,json
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath='D:/Riskodefruta2/art/blender/Headfirst_Loading_Review.blend');s=bpy.context.scene;s.frame_set(1);s.view_layers.update()
rig=next(o for o in s.objects if o.type=='ARMATURE')
for n in ['Head','Hips','LeftFoot','RightFoot']:
 b=rig.pose.bones.get(n)
 if b:print(n,list(rig.matrix_world@b.head))
for o in [rig,s.camera,s.objects.get('Headfirst_Dive'),s.objects.get('Distant agricultural islands')]:
 if o:print(o.name,'parent',o.parent.name if o.parent else None,'loc',list(o.location),'world',list(o.matrix_world.translation),'rot',list(o.rotation_euler),'constraints',[x.type for x in o.constraints])
