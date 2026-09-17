"""Author reusable PRISM projectile and impact meshes; no runtime primitive stand-ins."""
import bpy, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def material(name,color,emission=0,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True
 b=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 b.inputs['Base Color'].default_value=(*color,1);b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=.25
 b.inputs['Emission Color'].default_value=(*color,1);b.inputs['Emission Strength'].default_value=emission
 return m
blue=material('Pulse cyan',(.015,.5,1),3)
white=material('Ion hot core',(.4,.85,1),4)
purple=material('Plasma violet',(.35,.01,1),2)
shell=material('Capsule titanium',(.11,.13,.22),0,.85)
enamel=material('Grenade violet armour',(.19,.025,.38),0,.7)
silver=material('Grenade silver lips',(.48,.58,.7),0,.9)
ember=material('Incendiary fuel', (1,.12,.008),2)
def group(name):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);return o
def ellipsoid(name,parent,loc,scale,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=loc)
 o=bpy.context.object;o.name=name;o.parent=parent;o.scale=scale;o.data.materials.append(mat)
 for face in o.data.polygons:face.use_smooth=True
 return o
def ring(parent,x,r,mat):
 bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=8,major_radius=r,minor_radius=.018,location=(x,0,0),rotation=(0,math.pi/2,0))
 o=bpy.context.object;o.parent=parent;o.data.materials.append(mat)
 for face in o.data.polygons:face.use_smooth=True
p=group('Pulse');ellipsoid('Pulse core',p,(0,0,0),(.24,.045,.045),white);ellipsoid('Pulse envelope',p,(-.14,0,0),(.36,.065,.065),blue)
p=group('Lance');ellipsoid('Ion needle',p,(0,0,0),(.50,.025,.025),white);ring(p,-.28,.075,blue)
p=group('Grenade')
ellipsoid('Incendiary payload',p,(0,0,0),(.22,.145,.145),ember)
ellipsoid('Impact fuse',p,(.245,0,0),(.055,.09,.09),shell)
ellipsoid('Rear igniter',p,(-.25,0,0),(.05,.10,.10),shell)
for x in [-.22,.20]:ring(p,x,.16,silver)
for i in range(6):
 a=i*math.tau/6
 bpy.ops.mesh.primitive_cube_add(size=1,location=(0,math.sin(a)*.164,math.cos(a)*.164))
 o=bpy.context.object;o.name='Grenade armoured rib';o.parent=p;o.scale=(.34,.075,.043);o.rotation_euler.x=-a
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(enamel)
 b=o.modifiers.new('Soft armour edges','BEVEL');b.width=.016;b.segments=3
 ellipsoid('Rib power stud',p,(.06,math.sin(a)*.19,math.cos(a)*.19),(.043,.020,.020),blue)
halo=group('GrenadeHalo');halo.parent=p
ring(halo,-.06,.228,blue);ring(halo,.06,.211,purple)
image=bpy.data.images.load(str(ROOT/'public/textures/weapons/prism-fireball.png'));image.pack()
for name,smoke in [('Nova',False),('Smoke',True)]:
 p=group(name);m=material(name+' sprite',(.12,.10,.09) if smoke else (1,.35,.03),0)
 b=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
 m.node_tree.links.new(tex.outputs['Alpha'],b.inputs['Alpha']);m.surface_render_method='DITHERED';m.use_backface_culling=False
 if not smoke:
  m.node_tree.links.new(tex.outputs['Color'],b.inputs['Base Color']);m.node_tree.links.new(tex.outputs['Color'],b.inputs['Emission Color']);b.inputs['Emission Strength'].default_value=1.5
 bpy.ops.mesh.primitive_plane_add(size=1,rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=name+' billboard';o.parent=p;o.data.materials.append(m)
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
p=group('Ember');ellipsoid('Hot ember',p,(0,0,0),(.06,.023,.023),ember)
p=group('Debris')
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.095);o=bpy.context.object;o.parent=p;o.scale=(1.6,.55,.8);o.data.materials.append(enamel)
p=group('Impact');ring(p,0,.5,blue);ring(p,.02,.32,purple)
ellipsoid('Impact flare',p,(0,0,0),(.08,.18,.18),white)
p=group('Spark');ellipsoid('Spark shard',p,(0,0,0),(.07,.018,.018),blue)
out=ROOT/'public/models/weapons/prism-shots.glb'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=False,export_apply=True)
source=ROOT/'art/blender/prism-triform/PRISM_SHOTS.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(source))
print('PRISM SHOTS COMPLETE',out)
