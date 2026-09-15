import bpy,math
from pathlib import Path
from mathutils import Vector,Quaternion
R=Path('D:/Riskodefruta2');bpy.ops.wm.open_mainfile(filepath=str(R/'art/blender/Independent_Cosmic_Loading.blend'));s=bpy.context.scene
before=set(s.objects);bpy.ops.import_scene.gltf(filepath=str(R/'public/models/farm-city.glb'));city=bpy.data.objects.new('Distant agricultural islands',None);s.collection.objects.link(city)
for o in set(s.objects)-before:
 if o!=city and o.parent is None:o.parent=city
city.scale=(.055,)*3;city.location=(6.5,-5,-1.0)
# Camera roll makes the head point down toward the destination, feet trailing above.
s.camera.rotation_mode='QUATERNION';s.camera.rotation_quaternion=s.camera.rotation_euler.to_quaternion()@Quaternion((0,0,1),math.pi)
bpy.ops.object.light_add(type='AREA',location=(0,-6,7));o=bpy.context.object;o.data.energy=1800;o.data.size=9;o.rotation_euler=(Vector((0,-7,-1))-o.location).to_track_quat('-Z','Y').to_euler()
rig=next(o for o in s.objects if o.type=='ARMATURE')
for name,axis,amount in [('LeftLeg',(1,0,0),.10),('RightLeg',(1,0,0),.14),('LeftArm',(0,1,0),.07),('RightArm',(0,1,0),.07)]:
 b=rig.pose.bones.get(name)
 if not b:continue
 base=b.rotation_quaternion.copy()
 for f in range(1,122,5):b.rotation_quaternion=base@Quaternion(axis,math.sin((f-1)/120*math.tau)*amount);b.keyframe_insert('rotation_quaternion',frame=f)
s.render.engine='CYCLES';s.cycles.samples=12;s.render.resolution_x=1280;s.render.resolution_y=720;s.frame_set(1);s.render.filepath=str(R/'art/loading-loop/cinematic-preview.png');bpy.ops.render.render(write_still=True)
s.render.engine='CYCLES';s.cycles.samples=6;s.render.resolution_x=960;s.render.resolution_y=540
# CPU render remains separate from browser UI. Store the editable scene and encode a loop.
bpy.ops.wm.save_as_mainfile(filepath=str(R/'art/blender/Independent_Cosmic_Loading.blend'),compress=True)
s.render.engine='CYCLES';s.render.image_settings.file_format='FFMPEG';s.render.ffmpeg.format='MPEG4';s.render.ffmpeg.codec='H264';s.render.ffmpeg.constant_rate_factor='MEDIUM';s.render.ffmpeg.ffmpeg_preset='GOOD';s.render.filepath=str(R/'public/ui/cosmic-descent.mp4');s.frame_end=120
bpy.ops.render.render(animation=True)
print('CINEMATIC LOOP COMPLETE',flush=True)
