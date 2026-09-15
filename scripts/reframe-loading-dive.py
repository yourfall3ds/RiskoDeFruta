import bpy,math
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(R/'art/blender/Independent_Cosmic_Loading.blend'))
s=bpy.context.scene;s.frame_set(1)
root=s.objects['Headfirst_Dive'];root.animation_data_clear();root.rotation_mode='XYZ'
for frame in range(1,122,5):
 t=(frame-1)/120*math.tau;root.rotation_euler=(math.pi/2+.035*math.sin(t),.035*math.cos(t),.045*math.sin(t));root.location=(.035*math.sin(t),0,.035*math.cos(t));root.keyframe_insert('rotation_euler',frame=frame);root.keyframe_insert('location',frame=frame)
s.frame_set(1)
# The camera follows the feet toward the head and the destination, with world-up intact.
s.camera.animation_data_clear();s.camera.rotation_mode='XYZ';s.camera.location=(1.6,2.1,2.1)
s.camera.rotation_euler=(Vector((.15,-1.8,-.2))-s.camera.location).to_track_quat('-Z','Y').to_euler();s.camera.data.lens=37
city=s.objects.get('Distant agricultural islands')
if city:
 city.scale=(.032,)*3;s.view_layers.update()
 points=[o.matrix_world@Vector(v) for o in city.children_recursive if o.type=='MESH' for v in o.bound_box]
 low=Vector(tuple(min(p[i] for p in points) for i in range(3)));high=Vector(tuple(max(p[i] for p in points) for i in range(3)))
 city.location+=(s.camera.matrix_world@Vector((1.2,2.4,-16)))-(low+high)*.5
 s.view_layers.update()
for node in s.world.node_tree.nodes:
 if node.type=='TEX_ENVIRONMENT':node.image=bpy.data.images.load(str(R/'public/environment/cosmic-sky-v3.png'),check_existing=True)
s.render.engine='BLENDER_EEVEE';s.eevee.taa_render_samples=24;s.render.resolution_x=1280;s.render.resolution_y=720;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG'
s.render.filepath=str(R/'art/loading-loop/dive-reframed-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(R/'art/blender/Headfirst_Loading_Review.blend'),compress=True)
bpy.ops.render.render(write_still=True)
