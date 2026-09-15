import bpy,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Rootwood_Region_Trees.blend'))
art=list(bpy.context.selected_objects);scene=bpy.context.scene
for o in scene.objects:o.hide_render=o not in art or '_medium_' in o.name
def pos(x,y,z):return Vector((-x,-z,y))
w=bpy.data.worlds.new('Rootwood review sky');scene.world=w;w.use_nodes=True
bg=next(n for n in w.node_tree.nodes if n.type=='BACKGROUND');bg.inputs[0].default_value=(.15,.21,.3,1);bg.inputs[1].default_value=.7
l=bpy.data.lights.new('Rootwood review sun','SUN');l.energy=3;o=bpy.data.objects.new('Review sun',l);scene.collection.objects.link(o);o.rotation_euler=(.5,-.4,.7)
c=bpy.data.cameras.new('Rootwood review camera');o=bpy.data.objects.new('Review camera',c);scene.collection.objects.link(o);o.location=pos(1040,480,90);o.rotation_euler=(pos(1040,24,480)-o.location).to_track_quat('-Z','Y').to_euler();c.type='ORTHO';c.ortho_scale=600;scene.camera=o
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=1440;scene.render.resolution_y=1080;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'art/rootwood-overview.png');bpy.ops.render.render(write_still=True)
