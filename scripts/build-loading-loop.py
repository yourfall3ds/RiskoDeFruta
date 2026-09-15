"""Independent cinematic loading loop. No farm map is loaded at playback time."""
import bpy,math,random,json
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=12;s.cycles.use_denoising=True
s.render.resolution_x=960;s.render.resolution_y=540;s.render.resolution_percentage=100;s.render.fps=30
s.frame_start=1;s.frame_end=120
bpy.ops.import_scene.gltf(filepath=str(R/'public/models/gunslinger.glb'))
rig=next(o for o in s.objects if o.type=='ARMATURE')
if rig.animation_data:
 for t in rig.animation_data.nla_tracks:t.mute=True
 action=bpy.data.actions.get('Aim')
 if action:rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
s.frame_set(1)
# Bake the preparation pose before applying independent falling motion.
for o in list(s.objects):
 if o.type=='ARMATURE':
  pose={b.name:b.matrix_basis.copy() for b in o.pose.bones};o.animation_data_clear()
  for b in o.pose.bones:b.matrix_basis=pose[b.name]
root=bpy.data.objects.new('Headfirst_Dive',None);s.collection.objects.link(root)
for o in list(s.objects):
 if o!=root and o.parent is None:o.parent=root
root.rotation_euler=(math.pi/2,0,0);root.location=(0,0,0)
for f in range(1,122,5):
 t=(f-1)/120*math.tau;root.rotation_euler=(math.pi/2+.055*math.sin(t),.055*math.cos(t),.10*math.sin(t));root.location=(.055*math.sin(t),0,.06*math.cos(t));root.keyframe_insert('rotation_euler',frame=f);root.keyframe_insert('location',frame=f)
# Cosmic panorama; only a tiny set of photographed rocks is rendered in this movie.
w=bpy.data.worlds.new('Cosmic descent');w.use_nodes=True;s.world=w;n=w.node_tree.nodes;l=w.node_tree.links;n.clear();out=n.new('ShaderNodeOutputWorld');bg=n.new('ShaderNodeBackground');bg.inputs['Strength'].default_value=.55;tex=n.new('ShaderNodeTexEnvironment');tex.image=bpy.data.images.load(str(R/'public/environment/cosmic-sky-v2.png'));l.new(tex.outputs[0],bg.inputs[0]);l.new(bg.outputs[0],out.inputs[0])
mat=bpy.data.materials.new('Scanned stone');mat.use_nodes=True;b=mat.node_tree.nodes.get('Principled BSDF');b.inputs['Roughness'].default_value=.9;tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(R/'public/textures/rock_face_03/Diffuse.jpg'));mat.node_tree.links.new(tex.outputs[0],b.inputs['Base Color'])
random.seed(93)
for i in range(18):
 a=i*2.399;r=2.1+i%4*.6;bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.11+(i%4)*.065);o=bpy.context.object;o.name='Passing textured debris';o.data.materials.append(mat)
 for v in o.data.vertices:v.co*=random.uniform(.8,1.2)
 for f in [1,121]:
  o.location=(math.cos(a)*r,-8+(i/18)*16+(f-1)/120*16,math.sin(a)*r);o.rotation_euler=(i+f*.01,i*.4,f*.007);o.keyframe_insert('location',frame=f);o.keyframe_insert('rotation_euler',frame=f)
 # Seamless copies crossing outside the camera view at the wrap.
 copy=o.copy();copy.data=o.data;s.collection.objects.link(copy);copy.animation_data_clear()
 for f in [1,121]:
  copy.location=(math.cos(a)*r,-24+(i/18)*16+(f-1)/120*16,math.sin(a)*r);copy.rotation_euler=(i+f*.01,i*.4,f*.007);copy.keyframe_insert('location',frame=f);copy.keyframe_insert('rotation_euler',frame=f)
for loc,power,color,size in [((1,2,5),500,(.65,.82,1),4),((-3,-2,2),700,(.12,.65,1),3),((2,-3,-1),600,(.65,.15,1),3)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,-.7,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(1.5,2.7,1.6));cam=bpy.context.object;cam.rotation_euler=(Vector((0,-.65,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=43;s.camera=cam
s.view_settings.view_transform='AgX';s.render.image_settings.file_format='PNG';s.render.filepath=str(R/'art/loading-loop/frame-');(R/'art/loading-loop').mkdir(exist_ok=True)
s.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(R/'art/blender/Independent_Cosmic_Loading.blend'),compress=True)
s.render.filepath=str(R/'art/loading-loop/preview.png');bpy.ops.render.render(write_still=True)
print('LOADING PREVIEW READY',flush=True)
