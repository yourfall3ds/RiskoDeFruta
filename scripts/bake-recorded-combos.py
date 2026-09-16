"""Bake curated Transformice motion onto the actual gunslinger in Blender.

The source provides rotations only. This pass retimes one strike per step, returns every
strike to the same guard and plants the boots using evaluated, skinned mesh vertices.
No source mesh, bone length or scale is exported into the game.
"""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.fps=60
bpy.ops.import_scene.gltf(filepath=str(ROOT/'art/processed/recorded-combos-candidate.glb'),bone_heuristic='BLENDER')
rig=next(o for o in scene.objects if o.type=='ARMATURE');rig.animation_data.use_nla=False
for track in rig.animation_data.nla_tracks:track.mute=True
manifest=json.loads((ROOT/'docs/combo-clip-manifest.json').read_text())
mapping={
 'ComboRightCross':('SourcePunch',43,53,85,'LeftToeBase'),
 'ComboLeftHook':('SourceHook',0,20,40,'LeftToeBase'),
 'ComboRightKick':('SourceSpartan',0,36,88,'LeftToeBase'),
 'ComboUppercut':('SourceUppercut',0,24,84,'LeftToeBase'),
 'ComboLeftKick':('SourceHighKick',0,34,80,'RightToeBase'),
 'ComboSpinKick':('SourceRoundhouse',32,92,155,'LeftToeBase'),
}
meshes=[o for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
foot_vertices=[]
for ob in meshes:
 for side in ['Left','Right']:
  groups={g.index for g in ob.vertex_groups if g.name in [side+'Foot',side+'ToeBase']}
  foot_vertices.append((ob,side,[v.index for v in ob.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.5]))
def action(a,frame):
 rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0]
 scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()
def soles():
 deps=bpy.context.evaluated_depsgraph_get();result={'Left':1000,'Right':1000}
 for ob,side,indices in foot_vertices:
  evaluated=ob.evaluated_get(deps);mesh=evaluated.to_mesh()
  for i in indices:result[side]=min(result[side],(ob.matrix_world@mesh.vertices[i].co).z)
  evaluated.to_mesh_clear()
 return result
def head(name):return rig.matrix_world@rig.pose.bones[name].head
def aim(name,child,direction):
 current=head(child)-head(name)
 if current.length<1e-6 or direction.length<1e-6:return
 turn=current.normalized().rotation_difference(direction.normalized()).to_matrix().to_4x4()
 bone=rig.pose.bones[name];world=rig.matrix_world@bone.matrix;pivot=world.translation.copy()
 world=turn@world;world.translation=pivot;bone.matrix=rig.matrix_world.inverted()@world;bpy.context.view_layer.update()
def solve_ankle(side,target):
 root,mid,end=side+'UpLeg',side+'Leg',side+'Foot';origin=head(root);pole=head(mid)
 upper=(pole-origin).length;lower=(head(end)-pole).length;offset=target-origin
 reach=max(abs(upper-lower)+.001,min(upper+lower-.004,offset.length));unit=offset.normalized()
 along=(upper*upper-lower*lower+reach*reach)/(2*reach);height=math.sqrt(max(0,upper*upper-along*along))
 hint=pole-origin;hint-=unit*hint.dot(unit)
 if hint.length<1e-5:hint=Vector((0,-1,0))
 footworld=(rig.matrix_world@rig.pose.bones[end].matrix).copy()
 joint=origin+unit*along+hint.normalized()*height
 aim(root,mid,joint-origin);aim(mid,end,origin+unit*reach-head(mid))
 footworld.translation=head(end);rig.pose.bones[end].matrix=rig.matrix_world.inverted()@footworld;bpy.context.view_layer.update()
def lift_hips(delta):
 hip=rig.pose.bones['Hips'];matrix=hip.matrix.copy();matrix.translation+=rig.matrix_world.inverted().to_3x3()@delta;hip.matrix=matrix;bpy.context.view_layer.update()
action(bpy.data.actions['SourcePunch'],0)
# Both feet settle into the same neutral guard before any recorded strike begins.
floor=soles();lift_hips(Vector((0,0,.012-min(floor.values()))))
for side in ['Left','Right']:
 floor=soles();target=head(side+'Foot');target.z+=.012-floor[side];solve_ankle(side,target)
guard={b.name:b.rotation_quaternion.copy() for b in rig.pose.bones}
guard_hip=rig.pose.bones['Hips'].location.copy()
anchors={n:rig.matrix_world@rig.pose.bones[n].head for n in ['LeftToeBase','RightToeBase']}
for entry in manifest['clips']:
 name=entry['clip'];src,start,contact,end,foot=mapping[name]
 source=bpy.data.actions[src];frames=entry['frames'];hit=entry['contactFrame']
 active_end=min(frames-8,hit+round(entry['active']*60))
 if name in bpy.data.actions:bpy.data.actions.remove(bpy.data.actions[name])
 samples=[]
 for f in range(1,frames+1):
  if f<=hit:t=start+(contact-start)*(f-1)/(hit-1)
  elif f<=active_end:t=contact+(min(end,contact+8)-contact)*(f-hit)/(active_end-hit)
  else:t=min(end,contact+8)+(end-min(end,contact+8))*(f-active_end)/(frames-active_end)
  action(source,t)
  # A fixed guard at both ends prevents the six unrelated source clips snapping between stances.
  weight=min(1,(f-1)/max(1,hit*.42),(frames-f)/max(1,(frames-active_end)*.65))
  weight=max(0,weight);weight=weight*weight*(3-2*weight)
  for b in rig.pose.bones:
   # The rat's broad shoulders and short neck over-rotate the human shoulder armour.
   retarget=.2 if b.name.endswith('Shoulder') else .8 if b.name.startswith('Spine') else .35 if b.name in ['neck','Head'] else 1
   b.rotation_quaternion=guard[b.name].slerp(b.rotation_quaternion,weight*retarget)
  rig.pose.bones['Hips'].location=guard_hip.copy()
  bpy.context.view_layer.update()
  plant=rig.matrix_world@rig.pose.bones[foot].head
  delta=Vector((anchors[foot].x-plant.x,anchors[foot].y-plant.y,0))
  # Controlled local pivot, never allowing the visual body to leave its capsule by a large stride.
  if delta.length>.85:delta*=.85/delta.length
  lift_hips(delta)
  # Near the floor the other foot keeps its neutral footprint; it can travel after lifting.
  support='Left' if foot.startswith('Left') else 'Right';other='Right' if support=='Left' else 'Left'
  floor=soles();relative=floor[other]-floor[support];anchor=anchors[other+'ToeBase'];toe=head(other+'ToeBase');ankle=head(other+'Foot')
  planting=max(0,min(1,1-relative/.10));planting=planting*planting*(3-2*planting)
  ankle.x+=(anchor.x-toe.x)*planting;ankle.y+=(anchor.y-toe.y)*planting
  ankle.z+=max(0,-relative)
  hip_at=head(other+'UpLeg');knee_at=head(other+'Leg');length=(knee_at-hip_at).length+(head(other+'Foot')-knee_at).length
  # A foot cannot stay planted if the recorded weight shift exceeds this human leg's reach.
  # Lift before relocating it instead of dragging a straight, unreachable leg over the floor.
  if weight>.001 and (ankle-hip_at).length>length*.97:
   horizontal=Vector((ankle.x-hip_at.x,ankle.y-hip_at.y,0)).length
   ankle.z=max(ankle.z+.08,hip_at.z-math.sqrt(max(.001,(length*.965)**2-horizontal**2)))
  solve_ankle(other,ankle)
  height=min(soles().values());lift_hips(Vector((0,0,.012-height)))
  hip=rig.pose.bones['Hips']
  bpy.context.view_layer.update()
  samples.append(({b.name:b.rotation_quaternion.copy() for b in rig.pose.bones},hip.location.copy()))
 baked=bpy.data.actions.new(name);rig.animation_data.action=baked
 for f,(rotations,hip) in enumerate(samples,1):
  scene.frame_set(f)
  for b in rig.pose.bones:
   b.rotation_quaternion=rotations[b.name];b.keyframe_insert('rotation_quaternion',frame=f,group=b.name)
  rig.pose.bones['Hips'].location=hip;rig.pose.bones['Hips'].keyframe_insert('location',frame=f,group='Hips')
 baked.use_fake_user=True
 entry.update({'sourceMotion':src,'sourceFrames':[start,contact,end],'note':'Recorded source motion, one strike, shared guard and evaluated boot support; baked in Blender.'})
 for k in ['plantErrorMillimetres','plantErrorFrame','replayErrorDegrees']:entry.pop(k,None)
 print('BAKED',name,flush=True)
# Keep the unmodified Idle for round-trip parity in the animation-only merge.
for a in list(bpy.data.actions):
 if a.name not in mapping and a.name!='Idle':bpy.data.actions.remove(a)
rig.animation_data.action=bpy.data.actions['ComboRightCross'];rig.animation_data.action_slot=rig.animation_data.action.slots[0]
scene.frame_start=1;scene.frame_end=66;scene.frame_set(1)
(ROOT/'art/blender').mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Recorded_Combos.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'art/processed/gunslinger-combos.glb'),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_anim_single_armature=True,export_frame_range=False,export_optimize_animation_size=False)
manifest['blend']='art/blender/Gunslinger_Recorded_Combos.blend';manifest['source']='C:/Users/darck/transformice/assets/animations'
(ROOT/'docs/combo-clip-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('RECORDED COMBOS BAKED',flush=True)
