"""Author a fixed, textured farm composition. Photogrammetry assets supply rocks and plants."""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene
random.seed(417);art=[];colliders=[]
def pos(v):return Vector((-v[0],-v[2],v[1]))
def pbr(name,asset,tint=(1,1,1,1),rough=.8,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;b=n.get('Principled BSDF');b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal
    if asset:
        path=ROOT/'public/textures'/asset
        d=n.new('ShaderNodeTexImage');d.image=bpy.data.images.load(str(path/'Diffuse.jpg'),check_existing=True)
        mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=tint;l.new(d.outputs['Color'],mix.inputs[1]);l.new(mix.outputs[0],b.inputs['Base Color'])
        # Export tint as the PBR factor while retaining the original texture.
        l.remove(b.inputs['Base Color'].links[0]);l.new(d.outputs['Color'],b.inputs['Base Color']);b.inputs['Base Color'].default_value=tint
        normal=n.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(str(path/'nor_gl.jpg'),check_existing=True);normal.image.colorspace_settings.name='Non-Color'
        bump=n.new('ShaderNodeNormalMap');l.new(normal.outputs['Color'],bump.inputs['Color']);l.new(bump.outputs[0],b.inputs['Normal'])
    else:b.inputs['Base Color'].default_value=tint
    m.diffuse_color=tint;return m
wood=pbr('Weathered timber','wood_planks',(.55,.39,.20,1));red=pbr('Barn red weathered wood','wood_planks',(.62,.08,.035,1));cream=pbr('Ivory trim','wood_planks',(.85,.78,.57,1));rock=pbr('Cliff stone','rock_face_03');soil=pbr('Leaf litter soil','brown_mud_leaves_01');metal=pbr('Aged silo steel','rusty_painted_metal',(.58,.66,.58,1),.65,.45);roof=pbr('Oxidized roof','rusty_painted_metal',(.20,.26,.25,1),.75,.5)
purple=pbr('Corruption glow',None,(.16,.015,.27,1));bs=purple.node_tree.nodes.get('Principled BSDF');bs.inputs['Emission Color'].default_value=(.35,.02,.65,1);bs.inputs['Emission Strength'].default_value=2
lamp=pbr('Lantern glass',None,(1,.48,.09,1));lamp.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value=(1,.35,.035,1);lamp.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=4
def box(name,xyz,size,mat,bevel=.035,solid=False):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos(xyz));o=bpy.context.object;o.name=name;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
    if bevel:mod=o.modifiers.new('Worn edges','BEVEL');mod.width=bevel;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
    art.append(o)
    if solid:colliders.append({'id':name,'min':dict(zip(['x','y','z'],[xyz[i]-size[i]/2 for i in range(3)])),'max':dict(zip(['x','y','z'],[xyz[i]+size[i]/2 for i in range(3)]))})
    return o
def beam(name,a,b,width,mat):
    delta=pos(b)-pos(a);o=box(name,tuple((a[i]+b[i])/2 for i in range(3)),(width,delta.length,width),mat,.015);o.rotation_euler=delta.to_track_quat('Z','Y').to_euler();return o
def cylinder(name,xyz,radius,height,mat,vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=height,location=pos(xyz));o=bpy.context.object;o.name=name;o.data.materials.append(mat);art.append(o)
    for face in o.data.polygons:face.use_smooth=True
    return o
def surface(name,vertices,faces,mat,uvscale=4):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([pos(v) for v in vertices],[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);mesh.materials.append(mat);art.append(o)
    uv=mesh.uv_layers.new(name='UVMap')
    for polygon in mesh.polygons:
        for li in polygon.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(co.x/uvscale,co.y/uvscale)
    return o
def load_asset(name):
    prior=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/f'art/source/{name}/{name}.gltf'))
    imported=set(scene.objects)-prior;meshes=[o for o in imported if o.type=='MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:o.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();o=bpy.context.object
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    corners=[o.matrix_world@Vector(c) for c in o.bound_box];lo=Vector([min(v[i] for v in corners) for i in range(3)]);hi=Vector([max(v[i] for v in corners) for i in range(3)])
    for v in o.data.vertices:v.co-=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
    for other in imported:
        try:
            if other!=o and other.name in bpy.data.objects:bpy.data.objects.remove(other,do_unlink=True)
        except ReferenceError:pass
    o.parent=None;o.location=(0,0,-10000);return o,hi-lo
assets={name:load_asset(name) for name in ['coast_land_rocks_02','fern_02','grass_medium_01','island_tree_01']}
def instance(name,xyz,size,angle=0):
    template,dims=assets[name];o=bpy.data.objects.new(name,template.data);scene.collection.objects.link(o);o.location=pos(xyz);o.rotation_euler.z=angle
    if isinstance(size,tuple):o.scale=(size[0]/max(.01,dims.x),size[2]/max(.01,dims.y),size[1]/max(.01,dims.z))
    else:o.scale=(size/max(.01,dims.z),)*3
    art.append(o);return o
def island(x,z,h,rx,rz,detail=True):
    count=64;verts=[(x,h,z)]+[(x+math.cos(i/count*math.tau)*rx,h,z+math.sin(i/count*math.tau)*rz) for i in range(count)]
    surface('Island cultivated ground',verts,[(0,i+1,(i+1)%count+1) for i in range(count)],soil)
    for i in range(22 if detail else 12):
        a=i/(22 if detail else 12)*math.tau
        instance('coast_land_rocks_02',(x+math.cos(a)*rx*.86,h-7,z+math.sin(a)*rz*.86),(rx*.48,9,rz*.45),a)
    # Layered scanned rock volumes taper underneath the floating landmass.
    for j in range(6):instance('coast_land_rocks_02',(x+math.cos(j)*rx*.35,h-15,z+math.sin(j)*rz*.35),(rx*.6,12,rz*.55),j)
def fence(a,b,h=0):
    distance=math.hypot(b[0]-a[0],b[1]-a[1]);n=max(1,round(distance/2.4))
    for i in range(n+1):
        x=a[0]+(b[0]-a[0])*i/n;z=a[1]+(b[1]-a[1])*i/n;box('Split rail post',(x,h+.75,z),(.18,1.5,.18),wood,.025)
        if i<n:
            nx=a[0]+(b[0]-a[0])*(i+1)/n;nz=a[1]+(b[1]-a[1])*(i+1)/n
            for y in [.55,1.08]:beam('Fence rail',(x,h+y,z),(nx,h+y,nz),.12,wood)
def barn(x,z,h,scale=1):
    # Boarded gambrel barn with open door recess, braces, trim and cupola.
    w=10;d=10
    for side in [-1,1]:
        box('Barn side wall',(x+side*5,h+3,z),(0.2,6,10),red,solid=True)
        for i in range(26):box('Side wall batten',(x+side*5.13,h+3,z-5+i*.4),(.06,6,.07),red,.008)
    box('Barn rear wall',(x,h+3,z+5),(10,6,.22),red,solid=True)
    for side in [-1,1]:box('Barn facade',(x+side*3.65,h+3,z-5),(2.7,6,.22),red,solid=True)
    box('Door header',(x,h+5.5,z-5),(4.6,1,.3),red)
    for dx in [-5,5]:box('Corner trim',(x+dx,h+3,z-5.15),(.19,6,.2),cream)
    for dx in [-2.3,2.3]:box('Door jamb',(x+dx,h+2.3,z-5.18),(.19,4.6,.25),cream)
    box('Lintel',(x,h+4.7,z-5.18),(4.8,.18,.25),cream)
    for side in [-1,1]:
        door=box('Open barn door',(x+side*3.4,h+2.2,z-5.4),(2.0,4.4,.18),wood)
        beam('Door crossbrace',(x+side*2.45,h+.25,z-5.52),(x+side*4.35,h+4.2,z-5.52),.12,cream)
    profile=[(-5,6),(-3.5,8.8),(0,10.2),(3.5,8.8),(5,6)]
    for i in range(4):
        a,b=profile[i:i+2];surface('Gambrel roof',[(x+a[0],h+a[1],z-5.5),(x+b[0],h+b[1],z-5.5),(x+b[0],h+b[1],z+5.5),(x+a[0],h+a[1],z+5.5)],[(0,1,2,3)],roof,2)
        beam('Roof edge trim',(x+a[0],h+a[1],z-5.55),(x+b[0],h+b[1],z-5.55),.18,cream)
    surface('Front gable',[(x-5,h+6,z-5),(x-3.5,h+8.8,z-5),(x,h+10.2,z-5),(x+3.5,h+8.8,z-5),(x+5,h+6,z-5)],[(0,1,2,3,4)],red)
    box('Loft window',(x,h+8,z-5.13),(1.2,1.4,.1),roof);box('Loft cross',(x,h+8,z-5.22),(.12,1.5,.1),cream);box('Loft cross',(x,h+8,z-5.22),(1.3,.1,.1),cream)
    box('Cupola',(x,h+10.65,z+1),(1.4,1.4,1.4),cream);cylinder('Cupola roof',(x,h+11.5,z+1),1.1,.28,roof,4)
    for dx in [-2.65,2.65]:
        box('Lantern housing',(x+dx,h+2.8,z-5.45),(.25,.48,.26),roof)
        box('Warm lamp',(x+dx,h+2.8,z-5.6),(.17,.32,.09),lamp,0)
def silo(x,z,h,r=1.7,height=10):
    cylinder('Weathered agricultural silo',(x,h+height/2,z),r,height,metal,48)
    colliders.append({'id':'silo','min':{'x':x-r,'y':h,'z':z-r},'max':{'x':x+r,'y':h+height,'z':z+r}})
    for y in range(1,int(height),2):
        bpy.ops.mesh.primitive_torus_add(major_radius=r+.025,minor_radius=.035,major_segments=48,minor_segments=6,location=pos((x,h+y,z)));o=bpy.context.object;o.data.materials.append(roof);art.append(o)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=12,radius=r,location=pos((x,h+height,z)));o=bpy.context.object;o.scale.z=.45;o.data.materials.append(metal);art.append(o)
    for dx in [-.3,.3]:beam('Silo ladder',(x+dx,h+.3,z-r-.1),(x+dx,h+height,z-r-.1),.045,roof)
    for j in range(int(height/.35)):beam('Ladder rung',(x-.3,h+j*.35,z-r-.12),(x+.3,h+j*.35,z-r-.12),.03,roof)
def windmill(x,z,h):
    for dx in [-1,1]:
        for dz in [-1,1]:beam('Windmill tower',(x+dx*1.4,h,z+dz*1.4),(x+dx*.4,h+12,z+dz*.4),.14,wood)
    for y in [2,5,8]:
        for side in [-1,1]:beam('Tower brace',(x-1.2,h+y,z+side),(x+1.2,h+y+3,z+side),.09,metal)
    for i in range(10):
        a=i/10*math.tau
        beam('Wind wheel spoke',(x,h+13,z-1),(x+math.cos(a)*3,h+13+math.sin(a)*3,z-1),.08,metal)
        o=box('Wind blade',(x+math.cos(a)*2.5,h+13+math.sin(a)*2.5,z-1),(.75,1.65,.09),metal,.01);o.rotation_euler.y=-a
    cylinder('Windmill hub',(x,h+13,z-1),.25,.4,roof)
island(0,0,0,24,26);island(0,34,5,17,14)
barn(0,35,5);silo(9,35,5);silo(-8,38,5,1.3,12);windmill(13,29,5)
# Broad rising track joins the two elevations without stairs obstructing movement.
surface('Rising farm path',[(-4,0,10),(4,0,10),(4,5,26),(-4,5,26)],[(0,1,2,3)],soil,3)
for x in [-4.3,4.3]:
    for j in range(9):
        z=10+j*2;y=j*5/8;box('Ramp railing post',(x,y+.65,z),(.16,1.3,.16),wood)
        if j<8:beam('Ramp rope rail',(x,y+1,z),(x,y+1+5/8,z+2),.1,wood)
for x in [-6,6]:fence((x,-18),(x,8))
fence((-17,24),(-5,24),5);fence((5,24),(17,24),5)
for x in [-13,13]:
    for z in [-12,-5,3]:
        for dx in [-2.5,2.5]:fence((x+dx,z-2),(x+dx,z+2))
        for j in range(16):instance('fern_02',(x+random.uniform(-2,2),.03,z+random.uniform(-1.6,1.6)),random.uniform(.55,1.1),random.random()*math.tau)
for i in range(105):
    x=random.uniform(-22,22);z=random.uniform(-23,18)
    if abs(x)<5.5:continue
    instance('grass_medium_01',(x,0,z),random.uniform(.3,.7),random.random()*math.tau)
for x,z,y in [(-17,-5,0),(18,6,0),(-13,29,5),(13,40,5),(-20,10,0)]:instance('island_tree_01',(x,y,z),random.uniform(6,9),random.random()*math.tau)
for i in range(24):
    a=i/24*math.tau;instance('fern_02',(math.cos(a)*22,0,math.sin(a)*24),1.2,a)
    if i%3==0:
        x,z=math.cos(a)*23,math.sin(a)*25
        for j in range(3):
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.25+j*.07,location=pos((x, -.3-j*.5,z)));o=bpy.context.object;o.scale=(1,.8,1.4);o.data.materials.append(purple);art.append(o)
for x,z,y,rx,rz in [(-55,25,5,13,12),(53,50,11,14,13),(-38,83,18,11,10),(28,105,24,15,12),(-80,115,30,13,14),(85,110,22,16,15)]:
    island(x,z,y,rx,rz,False);barn(x,z,y);silo(x+8,z+1,y,1.2,10);instance('island_tree_01',(x-8,y,z),7,.5)
# Join authored structural meshes by material; retain shared scan geometry as instances.
groups={}
for obj in list(art):
    if obj.data.users==1 and len(obj.data.materials)==1:groups.setdefault(obj.data.materials[0].name,[]).append(obj)
for objects in groups.values():
    if len(objects)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
    for obj in objects[1:]:art.remove(obj)
bpy.ops.object.select_all(action='DESELECT')
for obj in art:obj.select_set(True)
scene.unit_settings.system='METRIC'
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='AUTO')
(ROOT/'public/models/farm-collision.json').write_text(json.dumps({'boxes':colliders,'surfaces':[{'id':'main','x':0,'z':0,'width':48,'depth':52,'height':0,'ellipse':True},{'id':'upper','x':0,'z':34,'width':34,'depth':28,'height':5,'ellipse':True},{'id':'ramp','x':0,'z':18,'width':8,'depth':16,'height':2.5,'slopeZ':5/16}]}))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World.blend'))
print('FARM EXPORT COMPLETE',len(art),'objects')
