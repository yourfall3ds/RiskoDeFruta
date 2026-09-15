import bpy,math
from pathlib import Path
R=Path('D:/Riskodefruta2');bpy.ops.wm.open_mainfile(filepath=str(R/'art/blender/Independent_Cosmic_Loading.blend'));s=bpy.context.scene
# Keep the farms upright; orient the falling performer instead of rolling the whole world.
s.camera.rotation_mode='XYZ';from mathutils import Vector
s.camera.rotation_euler=(Vector((0,-.65,0))-s.camera.location).to_track_quat('-Z','Y').to_euler()
root=bpy.data.objects['Headfirst_Dive'];root.animation_data_clear()
for f in range(1,122,5):
 t=(f-1)/120*math.tau;root.rotation_euler=(-math.pi/2+.055*math.sin(t),.055*math.cos(t),.10*math.sin(t));root.location=(.055*math.sin(t),-1.4,.06*math.cos(t));root.keyframe_insert('rotation_euler',frame=f);root.keyframe_insert('location',frame=f)
s.frame_set(1);s.render.resolution_x=960;s.render.resolution_y=540;s.render.filepath=str(R/'art/loading-loop/cinematic-preview.png');s.render.image_settings.file_format='PNG';s.cycles.samples=8;bpy.ops.wm.save_as_mainfile(filepath=str(R/'art/blender/Independent_Cosmic_Loading.blend'),compress=True);bpy.ops.render.render(write_still=True)
