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
p=group('Grenade');ellipsoid('Capsule shell',p,(0,0,0),(.18,.115,.115),shell)
ellipsoid('Capsule plasma nose',p,(.13,0,0),(.075,.09,.09),purple)
for x in [-.12,0,.12]:ring(p,x,.117,blue)
p=group('Impact');ring(p,0,.5,blue);ring(p,.02,.32,purple)
ellipsoid('Impact flare',p,(0,0,0),(.08,.18,.18),white)
p=group('Spark');ellipsoid('Spark shard',p,(0,0,0),(.07,.018,.018),blue)
out=ROOT/'public/models/weapons/prism-shots.glb'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=False,export_apply=True)
source=ROOT/'art/blender/prism-triform/PRISM_SHOTS.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(source))
print('PRISM SHOTS COMPLETE',out)
