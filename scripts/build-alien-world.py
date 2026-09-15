"""Textured floating islet and agricultural flying saucer, authored as separate reusable objects."""
import bpy,math,bmesh
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene

def mat(name,folder=None,color=(1,1,1,1),emission=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes['Principled BSDF'];b.inputs['Base Color'].default_value=color;b.inputs['Roughness'].default_value=.7
 if emission:b.inputs['Emission Color'].default_value=color;b.inputs['Emission Strength'].default_value=emission
 if folder:
  for texture,socket in [('Diffuse','Base Color'),('nor_gl','Normal')]:
   n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=bpy.data.images.load(str(ROOT/'public/textures'/folder/(texture+'.jpg')),check_existing=True)
   if texture=='nor_gl':n.image.colorspace_settings.name='Non-Color';normal=m.node_tree.nodes.new('ShaderNodeNormalMap');m.node_tree.links.new(n.outputs[0],normal.inputs['Color']);m.node_tree.links.new(normal.outputs[0],b.inputs[socket])
   else:m.node_tree.links.new(n.outputs[0],b.inputs[socket])
 return m
rock=mat('Alien islet basalt','rock_face_03');soil=mat('Alien islet earth','brown_mud_leaves_01');metal=mat('UFO reclaimed farm steel','rusty_painted_metal');glow=mat('Fruit reactor violet',color=(.36,.035,1,1),emission=2.4);green=mat('Fruit cockpit',color=(.08,.3,.045,1));green.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value=.6

def lathe(name,rings,material,parent=None,segments=48):
 vertices=[(math.cos(i/segments*math.tau)*r,math.sin(i/segments*math.tau)*r,z) for r,z in rings for i in range(segments)];faces=[]
 for j in range(len(rings)-1):
  for i in range(segments):faces.append((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i))
 faces+=[tuple(reversed(range(segments))),tuple((len(rings)-1)*segments+i for i in range(segments))]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.materials.append(material);o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);o.parent=parent
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free();uv=mesh.uv_layers.new()
 for p in mesh.polygons:
  for li in p.loop_indices:
   v=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(v.x/2,v.y/2) if abs(p.normal.z)>.6 else (math.atan2(v.y,v.x)*2,v.z/2)
 return o
islet=bpy.data.objects.new('AlienIslet',None);scene.collection.objects.link(islet)
lathe('Islet rock volume',[(.6,-7),(1.7,-4.8),(2.8,-2),(3.35,-.38),(3.4,-.035)],rock,islet)
lathe('Islet fertile rim',[(3.4,-.035),(3.4,0)],soil,islet)
for i in range(5):
 a=i/5*math.tau;bpy.ops.mesh.primitive_cone_add(vertices=5,radius1=.18,radius2=0,depth=1.1,location=(math.cos(a)*2.8,math.sin(a)*2.8,-2.2));o=bpy.context.object;o.name='Islet violet crystal';o.parent=islet;o.data.materials.append(glow)
ufo=bpy.data.objects.new('FruitSaucer',None);scene.collection.objects.link(ufo)
lathe('Saucer hull',[(.3,-.6),(1.6,-.35),(2.4,-.05),(2.5,.1),(1.4,.45),(.4,.5)],metal,ufo)
lathe('Saucer rim reactor',[(2.47,.03),(2.53,.07),(2.47,.13)],glow,ufo)
lathe('Saucer green canopy',[(1.15,.4),(1,.7),(.65,1),(.08,1.16)],green,ufo)
for i in range(8):
 a=i/8*math.tau;bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=.16,location=(math.cos(a)*1.75,math.sin(a)*1.75,.25));o=bpy.context.object;o.name='Saucer seed lights';o.parent=ufo;o.data.materials.append(glow)
# Batch decorative parts by material without changing their local parent transforms.
for parent in [islet,ufo]:
 for material in [rock,soil,metal,glow,green]:
  objects=[o for o in scene.objects if o.type=='MESH' and o.parent==parent and len(o.data.materials)==1 and o.data.materials[0]==material]
  if len(objects)>1:
   bpy.ops.object.select_all(action='DESELECT')
   for o in objects:o.select_set(True)
   bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Alien_Islets_And_Fruit_Saucer.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/alien-world.glb'),export_format='GLB',export_animations=False)
