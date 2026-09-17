"""Author the reference-inspired PRISM weapon and its mechanical transformation clips.
Run with Blender 5.2: blender -b --python scripts/author-prism-triform.py
The game consumes exported GLBs; all visible geometry is authored here, never at runtime.
"""
import bpy, math, os, json
from mathutils import Vector, Euler
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'art/blender/prism-triform'; OUT.mkdir(parents=True,exist_ok=True)
EXPORT=ROOT/'public/models/weapons'; EXPORT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for d in list(bpy.data.materials): bpy.data.materials.remove(d)
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=1600; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.fps=30
scene.world.color=(.12,.12,.12)
scene.view_settings.view_transform='AgX'
weapon=bpy.data.collections.new('PRISM • transformable weapon'); scene.collection.children.link(weapon)
stage=bpy.data.collections.new('STUDIO • excluded from export'); scene.collection.children.link(stage)
moving=[]; poses={}; all_parts=[]

def mat(name,color,metal=.0,rough=.35,emit=0):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
 bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Base Color'].default_value=(*color,1)
 bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough
 if emit:bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emit
 return m
purple=mat('01 • violet enamel',(.16,.027,.34),.72,.26)
violet=mat('02 • amethyst facets',(.39,.055,.72),.6,.22)
dark=mat('03 • graphite titanium',(.025,.035,.055),.82,.3)
steel=mat('04 • brushed silver edges',(.47,.57,.69),.9,.24)
rubber=mat('05 • textured polymer grip',(.018,.021,.028),.1,.67)
cyan=mat('06 • cyan reactor',(.001,.28,.72),.25,.27,1.8)
white=mat('07 • reactor hot centre',(.01,.48,1),.2,.23,3)
gemmat=mat('08 • energized crystal',(.22,.005,.65),.55,.23,1.1)
etch=mat('09 • pale violet engraving',(.65,.45,.92),.5,.3)

# Image-authored violet metal: keep energy channels separate from the armour.
armour_image=bpy.data.images.load(str(ROOT/'public/textures/weapons/prism-violet-surreal-basecolor.png'))
armour_image.pack()
for material in (purple,violet,gemmat):
 bs=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=armour_image
 texture.label='Violet titanium / amethyst enamel — generated material'
 material.node_tree.links.new(texture.outputs['Color'],bs.inputs['Base Color'])
 bs.inputs['Roughness'].default_value=.34 if material==purple else .25
 bs.inputs['Metallic'].default_value=.68

atlas=bpy.data.images.load(str(ROOT/'public/textures/weapons/prism-material-atlas.png'));atlas.pack()
atlas_regions={steel:(0,.5),etch:(0,.5),dark:(.5,.5),rubber:(0,0),cyan:(.5,0),white:(.5,0)}
for material in atlas_regions:
 bs=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=atlas
 material.node_tree.links.new(texture.outputs['Color'],bs.inputs['Base Color'])
 if material in (cyan,white):
  material.node_tree.links.new(texture.outputs['Color'],bs.inputs['Emission Color'])
  bs.inputs['Metallic'].default_value=.05
  bs.inputs['Roughness'].default_value=.17
  bs.inputs['Coat Weight'].default_value=.65

def move_collection(obj,col):
 for c in list(obj.users_collection):c.objects.unlink(obj)
 col.objects.link(obj)
def finish(obj,name,material,parent=None,bevel=0):
 obj.name=name;move_collection(obj,weapon);all_parts.append(obj)
 if material:obj.data.materials.append(material)
 if material and obj.type=='MESH':
  # Per-face box projection preserves scale on narrow plates and bevel edges.
  uv=obj.data.uv_layers.active or obj.data.uv_layers.new(name='UVMap')
  uv.name='UVMap'
  uv.active_render=True
  for face in obj.data.polygons:
   axis=max(range(3),key=lambda i:abs(face.normal[i]))
   axes=[i for i in range(3) if i!=axis]
   points=[obj.data.vertices[obj.data.loops[i].vertex_index].co for i in face.loop_indices]
   low=[min(p[a] for p in points) for a in axes]
   span=[max(max(p[a] for p in points)-low[j],.0001) for j,a in enumerate(axes)]
   for loop_index in face.loop_indices:
    co=obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
    if material in atlas_regions:
     u,v=atlas_regions[material]
     uv.data[loop_index].uv=(u+.10+(co[axes[0]]-low[0])/span[0]*.30,v+.10+(co[axes[1]]-low[1])/span[1]*.30)
    else:uv.data[loop_index].uv=(co[axes[0]]*.48+.37,co[axes[1]]*.48+.23)
 if parent:obj.parent=parent
 if bevel:
  mod=obj.modifiers.new('Machined rounded edges','BEVEL');mod.width=bevel;mod.segments=3
  mod=obj.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');mod.keep_sharp=True
 return obj
def empty(name,parent=None,loc=(0,0,0)):
 o=bpy.data.objects.new(name,None);weapon.objects.link(o);o.parent=parent;o.location=loc;all_parts.append(o);return o
root=empty('PRISM_ROOT');root['forward_axis']='+X';root['grip_origin']='local origin';root['authoring_units']='metres, design scale'
def panel(name,outline,depth,material,parent=root,y=0,bevel=.025):
 verts=[(x,y-depth/2,z) for x,z in outline]+[(x,y+depth/2,z) for x,z in outline];n=len(outline)
 faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
 o=bpy.data.objects.new(name,mesh);weapon.objects.link(o);return finish(o,name,material,parent,bevel)
def box(name,loc,size,material,parent=root,bevel=.025):
 bpy.ops.mesh.primitive_cube_add(size=1);o=bpy.context.object;o.location=loc;o.scale=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 return finish(o,name,material,parent,bevel)
def cyl(name,loc,radius,depth,material,parent=root,axis='X',vertices=96):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
 o=bpy.context.object
 if vertices>=24:
  for face in o.data.polygons:face.use_smooth=len(face.vertices)==4
 if axis=='X':o.rotation_euler[1]=math.pi/2
 elif axis=='Y':o.rotation_euler[0]=math.pi/2
 return finish(o,name,material,parent,.012)
def ring(name,x,outer,inner,depth,material,parent=root,n=128):
 vs=[]
 for px,r in [(x-depth/2,outer),(x+depth/2,outer),(x-depth/2,inner),(x+depth/2,inner)]:
  vs.extend((px,math.sin(i*2*math.pi/n)*r,math.cos(i*2*math.pi/n)*r) for i in range(n))
 fs=[]
 for i in range(n):
  j=(i+1)%n;fs.extend([(i,j,n+j,n+i),(2*n+j,2*n+i,3*n+i,3*n+j),(i,2*n+i,2*n+j,j),(n+j,3*n+j,3*n+i,n+i)])
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update();o=bpy.data.objects.new(name,mesh);weapon.objects.link(o)
 for face in mesh.polygons:face.use_smooth=face.index%4<2
 return finish(o,name,material,parent,.008)
def line(name,points,r,material,parent=root):
 curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=1;curve.bevel_depth=r;curve.bevel_resolution=2
 spline=curve.splines.new('POLY');spline.points.add(len(points)-1)
 for p,co in zip(spline.points,points):p.co=(*co,1)
 o=bpy.data.objects.new(name,curve);weapon.objects.link(o)
 # Mesh assets export consistently without curve-specific runtime support.
 bpy.ops.object.select_all(action='DESELECT')
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
 return finish(o,name,material,parent)
def gem(name,loc,size,parent=root):
 x,y,z=loc;sx,sy,sz=size
 vs=[(x,y,z+sz),(x,y,z-sz),(x-sx,y-sy,z),(x+sx,y-sy,z),(x+sx,y+sy,z),(x-sx,y+sy,z)]
 fs=[(0,2,3),(0,3,4),(0,4,5),(0,5,2),(1,3,2),(1,4,3),(1,5,4),(1,2,5)]
 m=bpy.data.meshes.new(name);m.from_pydata(vs,[],fs);m.update();o=bpy.data.objects.new(name,m);weapon.objects.link(o);finish(o,name,gemmat,parent)
def bolt(name,x,z,y,parent=root):
 cyl(name,(x,y,z),.043,.035,steel,parent,'Y',8)
 box(name+' inset',(x,y+(-.02 if y<0 else .02),z),(.042,.008,.009),dark,parent,.002)
def module(name,loc,states):
 o=empty(name,root,loc);moving.append(o)
 poses[o.name]=[(tuple(Vector(loc)+Vector(s[0])),s[1],s[2] if len(s)>2 else (1,1,1)) for s in states]
 return o
Z=(0,0,0);S=(1,1,1)

# A continuous rigid receiver, matching the silhouette of the supplied concept.
panel('Receiver titanium skeleton',[(-.95,.72),(-1.0,1.23),(-.7,1.53),(.67,1.53),(1.02,1.24),(.85,.72),(.25,.55),(-.42,.6)],.57,dark)
for y in [-.325,.325]:
 panel('Receiver silver frame',[(-.89,.83),(-.78,1.38),(-.45,1.53),(.62,1.47),(.91,1.25),(.71,.78),(.3,.66),(-.4,.7)],.075,steel,y=y)
 panel('Receiver violet enamel',[(-.65,.87),(-.59,1.29),(-.31,1.43),(.61,1.39),(.81,1.18),(.58,.8),(.22,.73),(-.37,.78)],.08,purple,y=y+math.copysign(.055,y))
 # Visible circular reactor recessed into armour, both sides.
 cyl('Reactor gasket',(-.37,y*1.48,1.12),.39,.08,dark,axis='Y')
 cyl('Reactor silver bezel',(-.37,y*1.59,1.12),.343,.035,steel,axis='Y')
 cyl('Reactor energized lens',(-.37,y*1.67,1.12),.285,.027,cyan,axis='Y')
 cyl('Reactor centre',(-.37,y*1.73,1.12),.12,.03,white,axis='Y')
 # Screw bodies intersect their supporting silver / violet plates.
 for x,z,depth in [(-.80,1.23,.355),(.55,1.30,.408),(.54,.91,.408)]:
  bolt('Receiver fastener',x,z,math.copysign(depth,y))

# Rear stock is open, formed from separate structural rails.
panel('Stock shoulder pad',[(-2.72,.45),(-2.72,1.59),(-2.55,1.66),(-2.43,1.5),(-2.43,.46),(-2.55,.34)],.45,rubber)
panel('Stock top silver spine',[(-2.5,1.5),(-2.36,1.64),(-1.1,1.41),(-.99,1.21),(-1.3,1.14),(-2.3,1.34)],.36,steel)
panel('Stock bottom silver strut',[(-2.46,.48),(-2.22,.5),(-1.1,1.0),(-1.02,1.2),(-1.31,1.22),(-2.5,.74)],.34,steel)
panel('Stock purple top',[(-2.45,1.5),(-2.33,1.56),(-1.16,1.37),(-1.11,1.25),(-1.38,1.26),(-2.3,1.4)],.40,purple)
panel('Stock diagonal purple',[(-2.44,.58),(-2.23,.62),(-1.31,1.07),(-1.21,1.2),(-1.42,1.18),(-2.45,.82)],.38,purple)
for side in [-1,1]:
 line('Stock cyan upper rail',[(-2.25,side*.217,1.39),(-1.52,side*.217,1.3)],.027,cyan)
 line('Stock cyan brace',[(-2.26,side*.208,.77),(-1.65,side*.208,1.06)],.021,cyan)
 gem('Stock crystal',(-2.45,side*.246,1.12),(.095,.035,.23))
for i in range(10):box('Rubber shoulder rib',(-2.736,0,.48+i*.105),(.04,.48,.031),dark,bevel=.008)
cyl('Stock coupling',(-1.0,0,1.14),.29,.21,dark)

# Grip, open trigger guard and energy magazine.
panel('Pistol grip',[(-.48,.77),(-.08,.7),(-.35,-.19),(-.8,-.02)],.31,rubber)
panel('Grip silver heel',[(-.82,.03),(-.34,-.15),(-.29,-.24),(-.35,-.3),(-.88,-.09)],.38,steel)
for side in [-1,1]:
 panel('Grip violet insert',[(-.49,.6),(-.27,.57),(-.47,.12),(-.68,.19)],.025,purple,y=side*.169)
 line('Grip energy line',[(-.65,side*.19,.08),(-.48,side*.19,.02)],.018,cyan)
 for i in range(7):line('Grip tactile groove',[(-.54-i*.015,side*.188,.49-i*.045),(-.38-i*.015,side*.188,.44-i*.045)],.007,dark)
line('Trigger guard',[(-.14,-.01,.64),(.48,-.01,.66),(.48,-.01,.34),(.32,-.01,.26),(-.18,-.01,.28),(-.22,-.01,.45)],.045,dark)
line('Trigger',[ (.14,0,.64),(.08,0,.45),(.15,0,.4)],.037,steel)
panel('Energy magazine housing',[(.51,.72),(.9,.65),(1.04,-.07),(.64,-.17)],.34,dark)
for side in [-1,1]:
 panel('Magazine silver rim',[(.56,.64),(.87,.58),(.99,-.07),(.66,-.1)],.025,steel,y=side*.18)
 panel('Magazine plasma window',[(.62,.56),(.82,.52),(.91,.00),(.71,-.035)],.03,cyan,y=side*.20)
 for i in range(3):gem('Magazine crystal cell',(.73+i*.04,side*.23,.41-i*.16),(.09,.024,.10))
# A real feed neck fits inside an open receiver socket. Cells remain attached to the magazine.
box('Magazine feed neck',(.735,0,.755),(.29,.265,.16),dark,bevel=.014)
for side in [-1,1]:
 box('Magazine feed lip',(.735,side*.132,.84),(.31,.028,.035),steel,bevel=.007)
 box('Magazine contact rail',(.735,side*.138,.77),(.19,.016,.028),steel,bevel=.004)
for x in [.65,.735,.82]:
 cyl('Magazine charged cell',(x,0,.85),.030,.205,cyan,axis='Y',vertices=32)
 for side in [-1,1]:cyl('Magazine cell terminal',(x,side*.106,.85),.032,.018,steel,axis='Y',vertices=24)
# Four separate lips form an actual opening, not a solid box beneath the weapon.
for side in [-1,1]:
 box('Feed socket side',(.735,side*.207,.665),(.47,.055,.15),steel,bevel=.012)
 box('Feed socket guide',(.735,side*.180,.755),(.32,.022,.19),dark,bevel=.005)
for x in [.495,.975]:box('Feed socket end',(x,0,.665),(.055,.46,.15),steel,bevel=.012)
box('Feed socket latch',(.982,-.16,.66),(.065,.10,.07),dark,bevel=.008)
# Cut a blind recess into the receiver; the seated cells enter this cavity.
receiver=bpy.data.objects['Receiver titanium skeleton']
bpy.ops.mesh.primitive_cube_add(size=1,location=(.735,0,.65));cutter=bpy.context.object;cutter.scale=(.425,.36,.60)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
bpy.context.view_layer.objects.active=receiver
cut=receiver.modifiers.new('Open magazine feed cavity','BOOLEAN');cut.operation='DIFFERENCE';cut.solver='EXACT';cut.object=cutter
bpy.ops.object.modifier_apply(modifier=cut.name);bpy.data.objects.remove(cutter,do_unlink=True)
# Keep fresh recess faces inside the graphite atlas quadrant.
uv=receiver.data.uv_layers.active
for loop in uv.data:
 loop.uv.x=max(.60,min(.90,loop.uv.x));loop.uv.y=max(.60,min(.90,loop.uv.y))
panel('Magazine base shoe',[(.6,-.12),(1.08,.0),(1.12,-.14),(.63,-.26)],.43,steel)
for i in range(6):box('Upper optic rail',(-.55+i*.19,0,1.57),(.105,.28,.075),dark,bevel=.01)
box('Scope fixed riser',(0,0,1.66),(.40,.20,.20),dark)
for sy in [-1,1]:cyl('Scope lift piston',(0,sy*.09,1.77),.042,.30,steel,axis='Z',vertices=32)
scope=module('Optic_lift',(0,0,1.7),[(Z,Z),((.04,0,.15),Z),((-.05,0,.02),Z)])
box('Scope foot',(0,0,0),(.65,.25,.1),steel,scope)
cyl('Scope main tube',(.02,0,.23),.22,.6,dark,scope)
for x in [-.30,.34]:
 o=ring('Scope silver bezel',x,.237,.17,.055,steel,scope);o.location.z=.23
 cyl('Scope blue optic',(x+(.031 if x>0 else -.031),0,.23),.166,.012,cyan,scope)
gem('Scope crown',(.0,0,.46),(.19,.15,.14),scope)

# Main coupling and exposed conductive spine.
coupling=empty('Front receiver coupling',root,(1.0,0,1.13))
for x,r,m in [(0,.36,dark),(.12,.39,steel),(.20,.29,cyan),(.28,.33,dark)]:cyl('Receiver collar',(x,0,0),r,.09,m,coupling)
for side in [-1,1]:box('Coupling latch',(.14,side*.32,0),(.15,.11,.31),dark,coupling,.025)

cyl('Fixed barrel anchor',(1.64,0,1.13),.18,.86,dark)
for sy in [-1,1]:box('Anchor blue rail',(1.64,sy*.17,1.13),(.75,.026,.045),cyan)
# Telescopic segments nest physically into each other, never disappear.
for j in range(3):
 b=module('Telescope_%02d'%j,(1.32+j*.24,0,1.13),[(Z,Z),((.4+j*.72,0,0),Z),((-.10-j*.17,0,0),Z)])
 radius=.215-j*.029
 cyl('Telescopic graphite sleeve',(.48,0,0),radius,1.15,dark,b)
 for angle in [0,math.pi/2,math.pi,math.pi*1.5]:
  yy=math.sin(angle)*(radius+.005);zz=math.cos(angle)*(radius+.005)
  box('Conductive exposed rail',(.48,yy,zz),(.96,.04,.04),cyan,b,.009)
 for x in [-.08,1.04]:ring('Telescopic lock ring',x,radius+.035,radius-.026,.10,steel,b)

# Four front armour petals: wide barrel cage -> long sniper shroud -> radial launcher petals.
for j,angle in enumerate([0,math.pi/2,math.pi,math.pi*1.5]):
 y,z=math.sin(angle)*.36,math.cos(angle)*.36
 # Local top petal rotated around X to share a handcrafted profile.
 base_rot=(-angle,0,0)
 states=[(Z,base_rot),((.64,math.sin(angle)*-.05,math.cos(angle)*-.05),base_rot),((.15,math.sin(angle)*.30,math.cos(angle)*.30),(-angle,0,0))]
 petal=module('Armour_petal_%02d'%j,(1.30,y,1.13+z),states)
 panel('Petal silver perimeter',[(-.08,.08),(.16,.27),(.91,.30),(1.40,.12),(1.22,-.03),(.40,-.10),(.0,-.06)],.40,steel,petal,bevel=.027)
 panel('Petal violet carapace',[(.0,.09),(.2,.22),(.85,.24),(1.28,.1),(1.13,.02),(.4,-.04),(.08,-.015)],.43,purple,petal,bevel=.021)
 panel('Petal amethyst bevel',[(.19,.16),(.43,.19),(.75,.16),(.92,.05),(.52,.04)],.455,violet,petal,bevel=.012)
 for sy in [-1,1]:
  gem('Armour embedded shard',(.38,sy*.244,.09),(.17,.035,.065),petal)
  bolt('Petal bolt',.25,.11,sy*.208,petal)
 box('Petal cyan slot',(.91,0,.251),(.3,.08,.016),cyan,petal,.008)

# Broad violet cap on the outward face of every armour petal.
for j in range(4):
 petal=bpy.data.objects['Armour_petal_%02d'%j]
 cap=panel('Outer violet armour cap',[(.12,-.16),(.28,-.18),(.91,-.14),(1.19,-.05),(1.04,.12),(.34,.17),(.1,.08)],.035,purple,petal,bevel=.012)
 cap.rotation_euler.x=math.pi/2;cap.location.z=.285

# Muzzle carrier shifts forward in sniper and retracts to the wide launcher mouth.
muzzle=module('Muzzle_carrier',(2.78,0,1.13),[(Z,Z),((2.03,0,0),Z),((-.04,0,0),Z)])
ring('Muzzle hollow throat',0,.235,.162,.23,dark,muzzle)
ring('Muzzle plasma annulus',.13,.246,.178,.045,cyan,muzzle)
ring('Muzzle silver tip',.20,.29,.20,.08,steel,muzzle)
# Six transforming muzzle segments form an open ring in launcher mode.
for j in range(6):
 a=j*math.tau/6
 pos=(2.99,math.sin(a)*.20,1.13+math.cos(a)*.20)
 states=[(Z,(-a,0,0)),((2.04,0,0),(-a,0,0)),((-.03,math.sin(a)*.54,math.cos(a)*.54),(-a,0,0))]
 claw=module('Muzzle_radial_jaw_%02d'%j,pos,states)
 panel('Jaw silver outline',[(-.16,.0),(-.07,.16),(.14,.21),(.28,.04),(.20,-.025),(.04,.04)],.22,steel,claw,.0,.016)
 panel('Jaw violet facet',[(-.10,.05),(-.03,.13),(.12,.16),(.20,.065),(.1,.065)],.245,purple,claw,bevel=.012)
 box('Jaw cyan tip',(.15,0,.16),(.13,.12,.035),cyan,claw,.008)
# Segmented iris rings widen, with sectors translated radially (no scaling the weapon).
for j in range(12):
 a=j*math.tau/12
 iris=module('Launcher_iris_segment_%02d'%j,(2.83,0,1.13),[(Z,(a,0,0)),((2.03,0,0),(a,0,0)),((0,0,0),(a,0,0),(1,3.0,3.0))])
 # Small arc segment; joints open as it expands into a grenade aperture.
 pts=[]
 for x,r in [(-.015,.247),(.025,.247),(-.015,.216),(.025,.216)]:
  pts += [(x,math.sin(t)*r,math.cos(t)*r) for t in [-.22+i*.44/16 for i in range(17)]]
 n=17;fs=[]
 for k in range(n-1):fs.extend([(k,k+1,k+1+n,k+n),(k+2*n+1,k+2*n,k+3*n,k+3*n+1),(k,k+2*n,k+2*n+1,k+1),(k+n+1,k+3*n+1,k+3*n,k+n)])
 fs.extend([(0,n,3*n,2*n),(n-1,3*n-1,4*n-1,2*n-1)])
 mesh=bpy.data.meshes.new('iris arc');mesh.from_pydata(pts,[],fs);mesh.update();o=bpy.data.objects.new('Iris luminous sector',mesh);weapon.objects.link(o);finish(o,o.name,cyan,iris)
 for face in mesh.polygons:face.use_smooth=face.index<4*(n-1) and face.index%4<2

# Armoured iris barrel: twelve overlapping sleeve sectors unfold into the launcher drum.
for j in range(12):
 a=j*math.tau/12
 sleeve=module('Grenade_chamber_sector_%02d'%j,(2.30,0,1.13),[(Z,(a,0,0),(1,.38,.38)),((1.64,0,0),(a,0,0),(1,.30,.30)),(Z,(a,0,0),(1,1,1))])
 vs=[]
 for px,r in [(-.55,.70),(.51,.75),(-.55,.61),(.51,.67)]:
  vs.extend((px,math.sin(t)*r,math.cos(t)*r) for t in [-.27+i*.54/16 for i in range(17)])
 fs=[]
 n=17
 for k in range(n-1):
  fs.extend([(k,k+1,k+n+1,k+n),(k+2*n+1,k+2*n,k+3*n,k+3*n+1),(k,k+2*n,k+2*n+1,k+1),(k+n+1,k+3*n+1,k+3*n,k+n)])
 fs.extend([(0,n,3*n,2*n),(n-1,3*n-1,4*n-1,2*n-1)])
 mesh=bpy.data.meshes.new('Layered launcher sector');mesh.from_pydata(vs,[],fs);mesh.update()
 for face in mesh.polygons:face.use_smooth=face.index<4*(n-1) and face.index%4<2
 o=bpy.data.objects.new('Launcher armoured chamber',mesh);weapon.objects.link(o);finish(o,o.name,dark,sleeve,.01)
 line('Chamber luminous internal edge',[(.52,math.sin(t)*.694,math.cos(t)*.694) for t in [-.255+i*.51/16 for i in range(17)]],.014,cyan,sleeve)
 line('Chamber silver outer rim',[(.51,math.sin(t)*.75,math.cos(t)*.75) for t in [-.27+i*.54/16 for i in range(17)]],.02,steel,sleeve)

# Mount sockets are stable in all forms; gameplay can use per-mode muzzle sockets.
empty('SOCKET_hand_R',root,(0,0,.35));empty('SOCKET_hand_L',root,(1.2,0,.8))
empty('SOCKET_muzzle',muzzle,(.3,0,0));empty('SOCKET_scope',scope,(-.35,0,.23))

# Independent reload and trigger assemblies, preserving all child world transforms.
def regroup(name,position,prefixes):
 group=module(name,position,[(Z,Z),(Z,Z),(Z,Z)])
 for child in list(weapon.objects):
  if child.type=='MESH' and any(child.name.startswith(p) for p in prefixes):
   child.parent=group;child.location-=Vector(position)
 return group
magazine=regroup('Magazine_reload',(.78,0,.27),['Energy magazine','Magazine '])
trigger=regroup('Trigger_actuator',(.14,0,.64),['Trigger.'])
# The exact trigger curve has no numerical suffix; guard stays rigid.
for child in list(weapon.objects):
 if child.name=='Trigger':child.parent=trigger;child.location-=Vector((.14,0,.64))
bolt_group=module('Charging_bolt',(.58,-.37,1.40),[(Z,Z),(Z,Z),(Z,Z)])
box('Bolt slide shoe',(0,0,0),(.31,.09,.13),dark,bolt_group,.018)
cyl('Bolt handle',(0,-.10,0),.045,.18,steel,bolt_group,'Y',12)
box('Bolt lever grip',(0,-.21,0),(.16,.09,.12),rubber,bolt_group,.02)
moving.append(root);poses[root.name]=[(Z,Z,S)]*3
charge=module('FX_charge',Z,[(Z,Z),(Z,Z),(Z,Z)])

# Full authored timeline: three settled forms, anticipation, clearance, travel and lock.
def key(obj,frame,loc,rot,scale):
 obj.location=loc;obj.rotation_mode='QUATERNION';obj.rotation_quaternion=Euler(rot,'XYZ').to_quaternion();obj.scale=scale
 for path in ['location','rotation_quaternion','scale']:obj.keyframe_insert(data_path=path,frame=frame,group=obj.name)
for obj in moving:
 states=poses[obj.name]
 for k,(start,end) in enumerate([(25,85),(109,169),(193,253)]):
  src=states[k];dst=states[(k+1)%3]
  key(obj,start,*src)
  # Shells unlock away from bore first, telescope travels only after clearance.
  radial='petal' in obj.name or 'jaw' in obj.name
  midloc=Vector(src[0]).lerp(Vector(dst[0]),.48)
  if radial:
   radialvec=Vector((0,src[0][1],src[0][2]-1.13)).normalized();midloc+=radialvec*.20
  midrot=Vector(src[1]).lerp(Vector(dst[1]),.5)
  if 'petal' in obj.name:midrot.y+=.13
  key(obj,start+14,src[0],src[1],src[2])
  key(obj,start+32,midloc,midrot,Vector(src[2]).lerp(Vector(dst[2]),.5))
  key(obj,end-8,*dst);key(obj,end,*dst)
 key(obj,1,*states[0]);key(obj,277,*states[0])
 obj.animation_data.action.name='Cycle • '+obj.name
# Fire clips have distinct mechanical rhythm; reload opens, ejects, seats and locks.
clips=[('Assault_to_Sniper',25,85,0,1),('Sniper_to_Grenade',109,169,1,2),('Grenade_to_Assault',193,253,2,0)]
for name,start,end,mode in [('Assault_Fire',301,313,0),('Sniper_Fire',337,361,1),('Grenade_Fire',385,411,2),('Assault_Reload',435,513,0),('Sniper_Reload',537,627,1),('Grenade_Reload',651,747,2)]:
 clips.append((name,start,end,mode,mode));duration=end-start
 for o in moving:key(o,start,*poses[o.name][mode]);key(o,end,*poses[o.name][mode])
 if name.endswith('Fire'):
  strength=[.075,.16,.23][mode]
  key(root,start+2,(-strength,0,.016),(0,-[.028,.055,.085][mode],0),S)
  key(root,start+int(duration*.48),(-strength*.28,0,0),(0,.012,0),S)
  key(root,end,*poses[root.name][mode])
  for o in moving:
   if o.name.startswith(('Telescope_','Muzzle_carrier','Charging_bolt')):
    loc,rot,scale=poses[o.name][mode]
    key(o,start+3,Vector(loc)+Vector((-.09*(mode+1),0,0)),rot,scale)
    key(o,start+int(duration*.65),*poses[o.name][mode])
  loc,rot,scale=poses[trigger.name][mode]
  key(trigger,start+1,loc,(0,-.22,0),scale);key(trigger,end-2,loc,rot,scale)
 else:
  # The energy cell is pulled below the well, turns clear, then is reseated.
  loc,rot,scale=poses[magazine.name][mode]
  for fraction,offset,angle in [(.12,(0,0,-.16),0),(.32,(.08,0,-.92),.22),(.54,(.08,0,-.92),.22),(.68,(0,0,-.30),0),(.78,(0,0,-.10),0),(.85,(0,0,-.10),0),(.90,Z,0)]:
   key(magazine,start+round(duration*fraction),Vector(loc)+Vector(offset),(0,angle,0),scale)
  for fraction,angle in [(.14,.08),(.40,.12),(.67,.08),(.86,-.015)]:key(root,start+round(duration*fraction),Z,(-angle,-.025,0),S)
  loc,rot,scale=poses[bolt_group.name][mode]
  key(bolt_group,start+round(duration*.91),Vector(loc)+Vector((-.32,0,0)),rot,scale)
  key(bolt_group,start+round(duration*.97),loc,rot,scale)
  if mode==2:
   for o in moving:
    if o.name.startswith(('Grenade_chamber','Muzzle_radial_jaw','Launcher_iris','Armour_petal')):
     loc,rot,scale=poses[o.name][mode]
     for fraction,amount in [(.18,.25),(.55,.25),(.79,0)]:
      rotation=Vector(rot);rotation.x+=math.pi/6*(1 if amount else 0)
      key(o,start+round(duration*fraction),Vector(loc)+Vector((amount,0,0)),rotation,scale)
 for o in moving:key(o,end,*poses[o.name][mode])
 scene.timeline_markers.new(name,frame=start)
# Orbit around the BARREL axis, not each plate's own centre. Baked quaternion keys
# preserve full revolutions and prevent a last-frame Euler unwind at the lock pose.
for clip,start,end,source,target in clips:
 if clip.endswith('Fire'):
  for frame in range(start,end+1):
   t=(frame-start)/(end-start);energy=max(0,1-t*3)
   key(charge,frame,(energy,0,0),Z,S)
  continue
 reload=clip.endswith('Reload');duration=end-start
 for frame in range(start,end+1):
  t=(frame-start)/duration
  travel=max(0,min(1,(t-.15)/.68));ease=travel*travel*(3-2*travel)
  orbit=max(0,min(1,(t-.10)/.80));orbit=orbit*orbit*(3-2*orbit)
  clearance=math.sin(math.pi*max(0,min(1,t/.94)))**2
  energy=(math.sin(math.pi*t)**.7)*(0.83+.17*math.sin(t*math.tau*3)**2)
  key(charge,frame,(energy,0,0),Z,S)
  for o in moving:
   if not o.name.startswith(('Armour_petal','Muzzle_radial_jaw','Grenade_chamber','Launcher_iris','Telescope_')):continue
   src=poses[o.name][source];dst=poses[o.name][target]
   loc=Vector(src[0]).lerp(Vector(dst[0]),ease);rot=Vector(src[1]).lerp(Vector(dst[1]),ease);scale=Vector(src[2]).lerp(Vector(dst[2]),ease)
   outer=o.name.startswith(('Armour_petal','Muzzle_radial_jaw'))
   direction=1 if o.name.startswith(('Armour_petal','Grenade_chamber')) else -1
   turns=(1 if outer else 2) if not reload else (2 if outer else 3)
   theta=direction*math.tau*turns*orbit
   if outer:
    y,z=loc.y,loc.z-1.13;r=math.hypot(y,z);expansion=1+clearance*(.28 if reload else .38)/max(.15,r)
    loc.y=(y*math.cos(theta)-z*math.sin(theta))*expansion
    loc.z=1.13+(y*math.sin(theta)+z*math.cos(theta))*expansion
    loc.x+=clearance*(.14 if 'petal' in o.name else .24)
   elif o.name.startswith('Telescope_'):
    # Conductive barrel rails rotate against the armour while the tubes extend.
    loc.x+=clearance*.07
   rot.x+=theta
   if outer:rot.y+=math.sin(math.pi*t)*.075
   key(o,frame,loc,rot,scale)
  # Tilt the complete weapon to display the unfolding assembly, then settle.
  if not reload:key(root,frame,(0,0,.025*clearance),(.08*math.sin(math.pi*t),-.025*clearance,0),S)
 # The source material animation is saved in Blender. The exported FX_charge node
 # carries the same envelope to the renderer without a vendor-only glTF extension.
 for material,base_strength in [(cyan,1.8),(white,3.0),(gemmat,1.1)]:
  socket=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Emission Strength']
  for frame in range(start,end+1):
   t=(frame-start)/(end-start);energy=(math.sin(math.pi*t)**.7)*(0.83+.17*math.sin(t*math.tau*3)**2)
   socket.default_value=base_strength*(1+energy*2.0);socket.keyframe_insert('default_value',frame=frame)
scene.frame_start=1;scene.frame_end=747
for name,frame in [('01 ASSAULT',1),('ASSAULT → SNIPER',25),('02 SNIPER',85),('SNIPER → GRENADE',109),('03 GRENADE',169),('GRENADE → ASSAULT',193),('01 ASSAULT RETURN',253)]:scene.timeline_markers.new(name,frame=frame)

import bmesh
for o in weapon.objects:
 if o.type=='MESH':
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(o.data);bm.free()
  if 'sleeve' in o.name.lower() or 'tube' in o.name.lower() or 'lens' in o.name.lower():
   for f in o.data.polygons:f.use_smooth=True
# Studio, with a neutral slate background and large reflected softboxes.
def studio_obj(o):move_collection(o,stage)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.37));floor=bpy.context.object;studio_obj(floor);floor.name='Studio floor';floor.data.materials.append(mat('Studio slate',(.055,.07,.10),.1,.48))
def area(name,loc,power,color,size,target=(.8,0,.9)):
 data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
 o=bpy.data.objects.new(name,data);stage.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Key softbox',(0,-5,7),1100,(.8,.88,1),7)
area('Violet rim',(1,4,5),1500,(.56,.36,1),5)
area('Front edge',(6,-1,4),800,(.7,1,1),4)
area('Stock fill',(-5,-1,3),700,(1,.8,.65),4)
camera_data=bpy.data.cameras.new('Presentation camera');camera=bpy.data.objects.new('Presentation camera',camera_data);stage.objects.link(camera);scene.camera=camera
camera.location=(4,-12,5);target=Vector((1.05,0,.9));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=9.2;camera_data.lens=50
scene.frame_set(1)
for area_ui in bpy.context.screen.areas if bpy.context.screen else []:
 if area_ui.type=='VIEW_3D':
  area_ui.spaces.active.region_3d.view_perspective='CAMERA'

def select_weapon():
 bpy.ops.object.select_all(action='DESELECT')
 for o in weapon.objects:o.select_set(True)
 bpy.context.view_layer.objects.active=root
def export(path,animated=False,mode='SCENE'):
 # Consolidate rigid parts per moving module/material for the runtime asset only.
 # The .blend keeps every authored piece independently editable.
 temp=bpy.data.collections.new('EXPORT_TEMP');scene.collection.children.link(temp)
 groups={}
 for source in list(weapon.objects):
  if source.type!='MESH':continue
  copy=source.copy();copy.data=source.data.copy();temp.objects.link(copy)
  material=source.data.materials[0].name if source.data.materials else 'none'
  groups.setdefault((source.parent.name if source.parent else '',material),[]).append(copy)
 bpy.ops.object.select_all(action='DESELECT')
 for o in temp.objects:o.select_set(True)
 if temp.objects:
  bpy.context.view_layer.objects.active=next(iter(temp.objects));bpy.ops.object.convert(target='MESH')
 for (parent,material),group in groups.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in group:o.select_set(True)
  bpy.context.view_layer.objects.active=group[0]
  if len(group)>1:bpy.ops.object.join()
  group[0].name='Runtime_'+parent+'_'+material[:2]
 bpy.ops.object.select_all(action='DESELECT')
 for o in weapon.objects:
  if o.type=='EMPTY':o.select_set(True)
 for o in temp.objects:o.select_set(True)
 bpy.context.view_layer.objects.active=root
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_apply=True,export_animations=animated,export_animation_mode=mode,export_frame_range=True,export_force_sampling=True,export_optimize_animation_size=False,export_optimize_animation_keep_anim_object=True,export_extras=True)
 for o in list(temp.objects):bpy.data.objects.remove(o,do_unlink=True)
 bpy.data.collections.remove(temp)

# Save the master before freezing snapshots; all moving pieces remain independently editable.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'PRISM_TRIFORM_MASTER.blend'))
export(EXPORT/'prism-triform-cycle.glb',True)
actions={o.name:o.animation_data.action for o in moving}
for phase,frame in [('assault',1),('sniper',85),('grenade',169)]:
 scene.frame_set(frame)
 frozen={o.name:(o.location.copy(),o.rotation_quaternion.to_euler().copy(),o.scale.copy()) for o in moving}
 for o in moving:o.animation_data_clear();o.location=frozen[o.name][0];o.rotation_quaternion=frozen[o.name][1].to_quaternion();o.scale=frozen[o.name][2]
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/('PRISM_'+phase.upper()+'.blend')))
 export(EXPORT/('prism-'+phase+'.glb'))
 scene.render.filepath=str(OUT/(phase+'.png'))
 if not os.environ.get('PRISM_SKIP_RENDER'):bpy.ops.render.render(write_still=True)
 for o in moving:o.animation_data_create();o.animation_data.action=actions[o.name]

# Three individually named NLA clips exported together. Each clip includes every moving module.
samples={}
for clip,start,end,source_mode,target_mode in clips:
 samples[clip]={o.name:[] for o in moving}
 for frame in range(start,end+1):
  scene.frame_set(frame)
  for o in moving:samples[clip][o.name].append((tuple(o.location),tuple(o.rotation_quaternion.to_euler()),tuple(o.scale)))
for o in moving:
 o.animation_data_clear()
 for clip in samples:
  for i,pose in enumerate(samples[clip][o.name]):key(o,i+1,*pose)
  action=o.animation_data.action;action.name=clip+' • '+o.name
  track=o.animation_data.nla_tracks.new();track.name=clip;track.strips.new(clip,1,action)
  o.animation_data.action=None
scene.frame_start=1;scene.frame_end=97
export(EXPORT/'prism-triform.glb',True,'NLA_TRACKS')
# Reopen master so opening the last save displays the complete authoring timeline.
bpy.ops.wm.open_mainfile(filepath=str(OUT/'PRISM_TRIFORM_MASTER.blend'))
manifest={'name':'PRISM Triform','reference':'1b5c3666-d06e-4e05-a2ef-fa857832dd22.png','fps':30,'clips':list(samples),'clip_seconds':{name:round((end-start)/30,3) for name,start,end,_,_ in clips},'poses':{'assault':1,'sniper':85,'grenade':169},'root_forward':'+X','runtime_files':['prism-triform.glb','prism-triform-cycle.glb','prism-assault.glb','prism-sniper.glb','prism-grenade.glb'],'note':'Standalone authored asset. Not yet integrated into player controls, firing or balance.'}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('PRISM COMPLETE',OUT)
