"""Authored farm dressing: connected outposts, bridges, crop harvests and machinery.

Coordinates below are gameplay metres. Export is a separate, reproducible layer.
Uses the existing textured Blender composition and supplied fruit meshes.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'))
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;random.seed(904);added=[]
collision=json.loads((ROOT/'public/models/farm-collision.json').read_text())
collision['surfaces']=[s for s in collision['surfaces'] if not s['id'].startswith('outpost') and not s['id'].startswith('bridge')]
def pos(x,y,z):return Vector((-x,-z,y))
wood=bpy.data.materials['Weathered timber'];soil=bpy.data.materials['Leaf litter soil'];red=bpy.data.materials['Barn red weathered wood'];steel=bpy.data.materials['Oxidized roof'];cream=bpy.data.materials['Ivory trim'];purple=bpy.data.materials['Corruption glow']
def box(name,x,y,z,w,h,d,mat,bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos(x,y,z));o=bpy.context.object;o.name=name;o.dimensions=(w,d,h);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
    if bevel:
        mod=o.modifiers.new('Edge wear','BEVEL');mod.width=bevel;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
    added.append(o);return o
def beam(name,a,b,width,mat):
    delta=pos(*b)-pos(*a);o=box(name,*[(a[i]+b[i])/2 for i in range(3)],width,delta.length,width,mat,.01);o.rotation_euler=delta.to_track_quat('Z','Y').to_euler();return o
def scan(name,x,y,z,height,sx=1,sy=1):
    template=next(o for o in scene.objects if name in o.name and o.type=='MESH' and o.location.z>-1000)
    o=bpy.data.objects.new(name+' dressed',template.data);scene.collection.objects.link(o);o.location=pos(x,y,z)
    hz=max(v.co.z for v in o.data.vertices)-min(v.co.z for v in o.data.vertices);s=height/max(.01,hz);o.scale=(s*sx,s*sy,s);o.rotation_euler.z=random.uniform(0,math.tau);added.append(o);return o
def ground(name,x,z,h,rx,rz):
    vertices=[pos(x,h,z)]+[pos(x+math.cos(i*math.tau/48)*rx,h,z+math.sin(i*math.tau/48)*rz) for i in range(48)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],[(0,i+1,(i+1)%48+1) for i in range(48)]);mesh.materials.append(soil);o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);added.append(o)
    uv=mesh.uv_layers.new(name='UVMap')
    for p in mesh.polygons:
        for li in p.loop_indices:
            v=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(v.x/4,v.y/4)
    for i in range(16):
        a=i*math.tau/16;scan('coast_land',x+math.cos(a)*rx*.8,h-6,z+math.sin(a)*rz*.8,7,1.2,1.2)
        scan('fern_02',x+math.cos(a)*rx*.87,h,z+math.sin(a)*rz*.87,.7)
    for i in range(4):scan('coast_land',x+math.cos(i)*3,h-13,z+math.sin(i)*3,9)
    collision['surfaces'].append(dict(id=name,x=x,z=z,width=rx*2,depth=rz*2,height=h,ellipse=True))
def bridge(name,x0,x1,z,h0,h1):
    n=30;width=3.1
    def height(t):return h0+(h1-h0)*t-math.sin(t*math.pi)*.75
    for i in range(n+1):
        t=i/n;x=x0+(x1-x0)*t;y=height(t)
        board=box('Bridge weathered plank',x,y-.06,z,abs(x1-x0)/n+.035,.14,width+random.uniform(-.12,.12),wood,.018)
        board.rotation_euler.y=math.atan2(h1-h0-math.cos(t*math.pi)*math.pi*.75,abs(x1-x0))
        for side in [-1,1]:
            if i%3==0:box('Bridge post',x,y+.72,z+side*width/2,.13,1.55,.13,wood)
            if i<n:
                nt=(i+1)/n;nx=x0+(x1-x0)*nt;ny=height(nt)
                for high in [.55,1.25]:beam('Suspension rope',(x,y+high,z+side*width/2),(nx,ny+high,z+side*width/2),.065,wood)
                beam('Bridge lower cable',(x,y-.3,z+side*width/2),(nx,ny-.3,z+side*width/2),.09,steel)
    for i in range(10):
        ta=i/10;tb=(i+1)/10;a=x0+(x1-x0)*ta;b=x0+(x1-x0)*tb
        collision['surfaces'].append(dict(id=name+str(i),x=(a+b)/2,z=z,width=abs(b-a)+.04,depth=width,height=(height(ta)+height(tb))/2,slopeX=(height(tb)-height(ta))/(b-a)))
ground('outpost-west',-45,0,0,10.5,12);ground('outpost-east',44,8,2,10,11)
bridge('bridge-west',-20,-37,0,0,0);bridge('bridge-east',20,36,8,0,2)
# Distant suspension spans read against the sky and expose the floating silhouettes.
bridge('bridge-distance-left',-45,-55,13,0,5)
collision['surfaces']=[s for s in collision['surfaces'] if not s['id'].startswith('bridge-distance')]
for x,z,h in [(-49,4,0),(-43,-6,0),(48,13,2),(42,0,2)]:scan('island_tree',x,h,z,random.uniform(5,7))
def import_prop(file,name,limit=1800):
    before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{file}.glb'));new=list(set(scene.objects)-before)
    meshes=[o for o in new if o.type=='MESH' and not o.hide_render and not o.hide_get() and any(m and m.use_nodes and any(n.type=='TEX_IMAGE' for n in m.node_tree.nodes) for m in o.data.materials)]
    for o in meshes:
        world=o.matrix_world.copy();o.parent=None;o.matrix_world=world
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:o.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]
    if len(meshes)>1:bpy.ops.object.join()
    o=bpy.context.object;o.name=name;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    if len(o.data.polygons)>limit:
        mod=o.modifiers.new('Dressing LOD','DECIMATE');mod.ratio=limit/len(o.data.polygons);bpy.ops.object.modifier_apply(modifier=mod.name)
    for item in new:
        try:
            if item!=o and item.name in scene.objects:bpy.data.objects.remove(item,do_unlink=True)
        except ReferenceError:pass
    o.location.z=-10000;return o.data
props={n:import_prop(n,'Dressing '+n,1600 if n in ['tomato','watermelon'] else 2500) for n in ['tomato','watermelon','supply-crate','farm-barrels','watering-can']}
def prop(name,x,y,z,scale=1,angle=0):
    o=bpy.data.objects.new('Harvest '+name,props[name]);scene.collection.objects.link(o);o.location=pos(x,y,z);o.scale=(scale,)*3;o.rotation_euler.z=angle;added.append(o);return o
for x,z,h in [(-4.5,-18,0),(5,-7,0),(-7,24,5),(6,29,5),(-43,-3,0),(42,9,2)]:
    prop('supply-crate',x,h,z,1.1);prop('farm-barrels',x+1.4,h,z+.3,.8);prop('watering-can',x-.8,h,z+.8,1)
    for i in range(8):
        fruit=prop('tomato',x+random.uniform(-.38,.38),h+.55+(i//4)*.13,z+random.uniform(-.25,.25),.17,random.random()*math.tau);fruit.rotation_euler.x=math.pi*.55
for x in [-13,13]:
    for z in [-12,-5,3]:
        for i in range(10):
            xx=x+random.uniform(-1.8,1.8);zz=z+random.uniform(-1.6,1.6)
            fruit=prop('tomato' if i%3 else 'watermelon',xx,.13,zz,.2 if i%3 else .24,random.random()*math.tau);fruit.rotation_euler.x=math.pi*.48
for side in [-1,1]:
    for i in range(20):
        z=random.uniform(-19,9);x=side*random.uniform(3.4,5.5);scan('fern_02',x,.01,z,random.uniform(.35,.65))
# PBR machinery built as editable Blender parts, grouped by material at export.
rubber=steel.copy();rubber.name='Tractor rubber';rubber.diffuse_color=(.035,.04,.03,1)
def tractor(x,z,h,angle=0):
    start=len(added)
    box('Tractor chassis',x,h+.6,z,1.2,.35,2.8,steel);box('Red tractor hood',x,h+1.3,z+.55,1.05,.9,1.6,red,.15)
    box('Tractor grille',x,h+1.2,z+1.39,.83,.62,.05,steel)
    for dx in [-.34,-.22,-.1,.02,.14,.26,.38]:box('Grille slat',x+dx,h+1.2,z+1.43,.035,.58,.03,cream,.004)
    box('Driver seat',x,h+1.22,z-.75,.65,.18,.63,rubber);box('Seat back',x,h+1.52,z-1.0,.65,.58,.13,rubber)
    beam('Exhaust pipe',(x+.35,h+1.6,z+.8),(x+.35,h+2.55,z+.8),.09,steel)
    beam('Steering column',(x,h+1,z-.55),(x,h+1.7,z-.18),.065,steel)
    for side in [-1,1]:
        for dz,r in [(-.9,.72),(1,.43)]:
            bpy.ops.mesh.primitive_torus_add(major_radius=r*.73,minor_radius=r*.27,major_segments=24,minor_segments=8,location=pos(x+side*.78,h+r,z+dz));o=bpy.context.object;o.rotation_euler.y=math.pi/2;o.data.materials.append(rubber);added.append(o)
            bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=r*.46,depth=.35,location=pos(x+side*.79,h+r,z+dz));o=bpy.context.object;o.rotation_euler.y=math.pi/2;o.data.materials.append(red);added.append(o)
        box('Tractor fender',x+side*.77,h+1.52,z-.9,.5,.1,1.6,red,.06)
    center=pos(x,h,z)
    from mathutils import Matrix
    rotate=Matrix.Rotation(angle,4,'Z')
    for o in added[start:]:o.matrix_world=Matrix.Translation(center)@rotate@Matrix.Translation(-center)@o.matrix_world
tractor(10,-8,0,.3);tractor(-5.8,26,5,-.8);tractor(47,6,2,.7)
# Rough stone arch gives the destination a readable doorway silhouette.
for i in range(13):
    a=i/12*math.pi;o=scan('coast_land',math.cos(a)*3.1,5+math.sin(a)*3.8,33,1.5,.7,.7);o.rotation_euler.y=a
for side in [-1,1]:
    for y in [5,6.2]:scan('coast_land',side*3.1,y,33,1.4,.65,.6)
    for j in range(4):
        o=scan('fern_02',side*(3.8+j*.3),5,31+j*.7,.9)
def sign(x,z,h,text):
    for i in range(4):box('Farm sign board',x,h+1.7+i*.28,z,2.05,.26,.1,wood)
    for dx in [-.72,.72]:box('Farm sign stake',x+dx,h+1.1,z+.08,.14,2.6,.14,wood)
    bpy.ops.object.text_add(location=pos(x,h+2.52,z-.075));o=bpy.context.object;o.name='Farm direction sign';o.rotation_euler=(math.pi/2,0,math.pi);o.data.body=text;o.data.align_x='CENTER';o.data.size=.23;o.data.space_line=1.12;o.data.extrude=.001;o.data.materials.append(cream);bpy.ops.object.convert(target='MESH');added.append(o)
sign(-5.5,-12,0,'PLANTE\nEXPLORE\nLIMPE\nREPITA');sign(-42,-7,0,'COLHA HOJE\nSOBREVIVA\nAMANHÃ')
# Keep shared vegetation and harvest meshes; merge only unique structural geometry.
groups={}
for o in added:
    if o.data.users==1 and len(o.data.materials)==1:groups.setdefault(o.data.materials[0],[]).append(o)
for group in groups.values():
    if len(group)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in group:o.select_set(True)
    bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()
    for o in group[1:]:added.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o in added:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-dressing.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=88)
(ROOT/'public/models/farm-collision.json').write_text(json.dumps(collision))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World_Final.blend'),compress=True)
print('FARM DRESSING READY',len(added),flush=True)
