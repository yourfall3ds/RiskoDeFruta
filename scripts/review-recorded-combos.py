"""Retargeted source clips, contact sheets and foot measurements in Blender."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.fps=60
bpy.ops.import_scene.gltf(filepath=str(ROOT/'art/processed/recorded-combos-candidate.glb'),bone_heuristic='BLENDER')
rig=next(o for o in scene.objects if o.type=='ARMATURE')
rig.animation_data.use_nla=False
for track in rig.animation_data.nla_tracks:track.mute=True
out=ROOT/'art/recorded-combo-review';out.mkdir(parents=True,exist_ok=True)
bpy.ops.mesh.primitive_plane_add(size=200)
mat=bpy.data.materials.new('Offline studio only');mat.diffuse_color=(.07,.09,.12,1);bpy.context.object.data.materials.append(mat)
bpy.ops.object.camera_add(location=(3,-5,2))
camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=2.6
camera.rotation_euler=(Vector((0,0,.95))-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera
for loc,power in [((2,-4,5),650),((-3,-1,3),450),((1,3,4),700)]:
 bpy.ops.object.light_add(type='AREA',location=loc);lamp=bpy.context.object;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=4;lamp.rotation_euler=(Vector((0,0,1))-lamp.location).to_track_quat('-Z','Y').to_euler()
scene.world=bpy.data.worlds.new('Studio');scene.world.color=(.18,.18,.18)
scene.render.engine='CYCLES';scene.cycles.samples=4;scene.cycles.use_denoising=True
scene.render.resolution_x=320;scene.render.resolution_y=360;scene.render.resolution_percentage=100
report=[]
for action in [a for a in bpy.data.actions if a.name.startswith('Source')]:
 rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 end=action.frame_range[1]
 for i,p in enumerate([0,.15,.3,.45,.6,.75,.9]):
  scene.frame_set(round(end*p));bpy.context.view_layer.update()
  bones={n:list(rig.matrix_world@rig.pose.bones[n].head) for n in ['Hips','LeftFoot','RightFoot','LeftHand','RightHand']}
  report.append({'clip':action.name,'frame':scene.frame_current,'bones':bones})
  scene.render.filepath=str(out/f'{action.name}-{i}.png');bpy.ops.render.render(write_still=True)
(out/'measurements.json').write_text(json.dumps(report,indent=2))
print('RECORDED COMBO REVIEW READY',flush=True)
