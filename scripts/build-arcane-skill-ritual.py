"""Blender-authored ritual: batched rune geometry, staggered assembly and energy ribbons.
Frames 0..60 = voiced preparation; 60..120 = release to vocal end.
Runtime samples exported transforms against AudioContext, never replaces this choreography.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.render.fps=60;scene.frame_start=0;scene.frame_end=120

def material(name,color,strength):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
 p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=strength
 p.inputs['Roughness'].default_value=.4
 return m
cyan=material('Arcane cyan luminous core',(.025,.68,.8),3)
white=material('Arcane white hot accents',(.32,.85,.9),4)
gold=material('Arcane warm glyph accents',(.9,.42,.09),2)
roots=[];layers=[]
def root(name):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);roots.append(o);return o

def batch(name,parent,paths,mat,width=.012,z=.025):
 # Flat ribbons sit against the earth, no opaque disc or debug torus.
 vertices=[];faces=[]
 for path in paths:
  for a,b in zip(path,path[1:]):
   a=Vector((a[0],a[1],a[2] if len(a)>2 else z));b=Vector((b[0],b[1],b[2] if len(b)>2 else z))
   d=b-a;n=Vector((-d.y,d.x,0)).normalized()*width*.5
   k=len(vertices);vertices.extend([a-n,a+n,b+n,b-n]);faces.append((k,k+1,k+2,k+3))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.materials.append(mat)
 o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);o.parent=parent;layers.append(o);return o

def arc(r,start=0,end=math.tau,n=128,z=.025):return [(math.cos(t)*r,math.sin(t)*r,z) for t in [start+(end-start)*i/n for i in range(n+1)]]
def animate(o,delay=0,spin=.15,release=1.08):
 for f,s,ang in [(0,.001,0),(delay,.001,0),(delay+12,.30,0),(48,1,spin*.20),(60,1.025,spin*.30),(72,release,spin*.45),(108,1,spin*.87),(116,.92,spin*.96),(120,.001,spin)]:
  o.scale=(s,s,s);o.rotation_euler.z=ang;o.keyframe_insert('scale',frame=f);o.keyframe_insert('rotation_euler',frame=f)
 o.animation_data.action.name=o.name+'_Ritual'
 # Export sampled smooth Blender curves at 60 Hz; avoid overshooting negative scales.
 for slot in o.animation_data.action.slots:
  for layer in o.animation_data.action.layers:
   for strip in layer.strips:
    bag=strip.channelbag(slot)
    if bag:
     for fc in bag.fcurves:
      for k in fc.keyframe_points:k.interpolation='BEZIER';k.handle_left_type='AUTO_CLAMPED';k.handle_right_type='AUTO_CLAMPED'

ground=root('GroundSigilRoot')
o=batch('Ground_OuterSeals',ground,[arc(1.7),arc(1.63),arc(1.40)],cyan,.013);animate(o,0,.18)
# Interlocking triangles, six petal arcs and radial seals make an actual glyph composition.
paths=[]
for offset in [0,math.pi/3]:paths.append([(math.cos(offset+i*math.tau/3)*1.3,math.sin(offset+i*math.tau/3)*1.3) for i in range(4)])
for i in range(6):
 a=i*math.tau/6;paths.append([(math.cos(a)*.65+math.cos(t)*.65,math.sin(a)*.65+math.sin(t)*.65) for t in [a+math.pi*.6+j*math.pi*.8/32 for j in range(33)]])
o=batch('Ground_SixfoldWeave',ground,paths,cyan,.014,z=.030);animate(o,5,-.35)
# Hand composed angular runes, varied strokes, all one material batch.
glyphs=[[[(-.045,-.065),(0,.065),(.045,-.065)],[(0,.025),(.052,.04)]],[[(-.05,.06),(.045,.02),(-.04,-.06)],[(-.05,.01),(.03,-.03)]],[[(-.035,-.06),(-.035,.06),(.05,.025),(-.035,-.01)]]]
paths=[]
for i in range(36):
 a=i*math.tau/36
 for stroke in glyphs[i%3]:paths.append([((1.515+y)*math.cos(a)-x*math.sin(a),(1.515+y)*math.sin(a)+x*math.cos(a),.035) for x,y in stroke])
o=batch('Ground_Runewheel',ground,paths,white,.010);animate(o,14,-.30)
paths=[arc(.45),arc(.52)]
for i in range(12):
 a=i*math.tau/12;paths.append([(math.cos(a)*r,math.sin(a)*r) for r in [.55,.64]])
for i in range(6):
 a=i*math.tau/6;paths.append([((1.79+y)*math.cos(a)-x*math.sin(a),(1.79+y)*math.sin(a)+x*math.cos(a)) for x,y in [(0,.12),(.07,0),(0,-.12),(-.07,0),(0,.12)]])
o=batch('Ground_FocusDiamonds',ground,paths,gold,.018,z=.04);animate(o,20,.14)
paths=[]
for i in range(72):
 a=i*math.tau/72;paths.append([(math.cos(a)*r,math.sin(a)*r,.042) for r in [1.72,1.75+(i%3==0)*.05]])
o=batch('Ground_EtchedRadials',ground,paths,cyan,.010);animate(o,10,.18)
# Ground vortex ribbons: tapered, interrupted rising filaments, not a cage over the face.
for index in range(2):
 paths=[]
 for j in range(3):
  paths.append([(math.cos(t)*r,math.sin(t)*r,z) for t,r,z in [(j*math.tau/3+index*.6+i*.017,1.45-i*.005,.045+i*.004) for i in range(54)]])
 o=batch('Ground_RisingFilaments_'+str(index),ground,paths,cyan,.018);animate(o,24+index*3,(-1 if index else 1)*1.8,1.2)

for side in ['Right','Left']:
 aura=root(side+'AuraRoot')
 paths=[]
 for i in range(6):paths.append(arc(.22,i*math.tau/6+.08,(i+1)*math.tau/6-.12,12,z=0))
 for i in range(12):
  a=i*math.tau/12;paths.append([(math.cos(a)*r,math.sin(a)*r,0) for r in [.24,.27]])
 o=batch(side+'_MuzzleCondenser',aura,paths,white,.008);animate(o,16,math.tau*2)
 paths=[]
 for j in range(3):paths.append([(math.cos(t)*r,math.sin(t)*r,z) for t,r,z in [(j*math.tau/3+i*.085,.12+i*.0018,-.18+i*.004) for i in range(52)]])
 o=batch(side+'_SpiralAura',aura,paths,cyan,.022);animate(o,8,-math.tau*1.5,1.2)
 paths=[]
 for i in range(8):
  a=i*math.tau/8;paths.append([(math.cos(a)*.1,math.sin(a)*.1,0),(math.cos(a+.13)*.17,math.sin(a+.13)*.17,.04),(math.cos(a)*.26,math.sin(a)*.26,.08)])
 o=batch(side+'_ElectricFlares',aura,paths,white,.008);animate(o,28,math.tau*2.5,1.3)

# A preview layout for the editable Blender source; exported anchors remain identity.
scene.frame_set(54)
scene.world=bpy.data.worlds.new('Arcane Preview World');scene.world.color=(.015,.025,.04)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Arcane_Skill_Ritual.blend'))
scene.frame_set(0)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/arcane-skill-ritual.glb'),export_format='GLB',export_animations=True,export_frame_range=True,export_force_sampling=True,export_cameras=False,export_lights=False)
report={'fps':60,'frames':[0,120],'prepare_end_frame':60,'roots':[o.name for o in roots],'layers':len(layers),'triangles':sum(len(o.data.polygons)*2 for o in layers),'source':'art/blender/Arcane_Skill_Ritual.blend'}
(ROOT/'docs/arcane-ritual-authoring.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))

