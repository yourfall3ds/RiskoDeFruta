import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps=60
bpy.ops.import_scene.gltf(filepath=str(ROOT/'art/processed/gunslinger-arrival-candidate.glb'))
scene=bpy.context.scene
rig=next(o for o in scene.objects if o.type=='ARMATURE')
for o in list(scene.objects):
 if o.animation_data:
  for track in o.animation_data.nla_tracks:track.mute=True
rig.animation_data.action=bpy.data.actions['ArrivalRecovery'];rig.animation_data.action_slot=rig.animation_data.action.slots[0]
root=bpy.data.objects.new('Runtime arrival rotation',None);scene.collection.objects.link(root)
for o in list(scene.objects):
 if o!=root and o.parent is None:o.parent=root
bpy.ops.mesh.primitive_plane_add(size=200)
floor=bpy.context.object;mat=bpy.data.materials.new('Ground');mat.diffuse_color=(.12,.14,.16,1);floor.data.materials.append(mat)
bpy.ops.object.camera_add(location=(4,-6,2.4));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,1))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=3.4;scene.camera=camera
for loc,energy,size in [((1,-4,6),1300,5),((-4,1,3),900,4)]:
 bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=energy;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
scene.world=bpy.data.worlds.new('Review world');scene.world.color=(.3,.3,.3);scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True;scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.fps=60
smooth=lambda x:(lambda t:t*t*(3-2*t))(max(0,min(1,x)))
a=rig.animation_data.action
start,end=a.frame_range
expected=json.loads((ROOT/'docs/arrival-pose-candidate.json').read_text())['report']
audit=[]
for i,p in enumerate([0,.2,.4,.6,.8,1]):
 scene.frame_set(round(start+(end-start)*p));dive=1-smooth((p-.18)/.67);root.rotation_euler.x=math.pi*dive;root.location.z=max(0,-math.cos(math.pi*dive))*1.7;bpy.context.view_layer.update()
 row=next(r for r in expected if abs(r['p']-p)<1e-6)
 for name in ['Head','LeftHand','RightHand']:
  actual=rig.matrix_world @ rig.pose.bones[name].head;point=row['points'][name];target=Vector((-point[0],-point[2],point[1]));error=(actual-target).length
  assert error<.001, (p,name,error)
  audit.append({'progress':p,'joint':name,'errorMeters':error})
 scene.render.filepath=str(ROOT/f'art/arrival-review-{i}.png');bpy.ops.render.render(write_still=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Arrival_Review.blend'),compress=True)
(ROOT/'docs/arrival-blender-parity.json').write_text(json.dumps({'fps':60,'rotationX':'positive','samples':audit,'maximumErrorMeters':max(r['errorMeters'] for r in audit)},indent=2))
print('ARRIVAL REVIEW READY',flush=True)


