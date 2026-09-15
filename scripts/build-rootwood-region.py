"""Author the rootwood region; staging until physics/navigation integration passes."""
import bpy,math,json,bmesh
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
source=(ROOT/'scripts/build-highland-farms.py').read_text(encoding='utf-8-sig')
exec(source[:source.index('bridge_segments=')])
centers=[('Bosque da Colheita',940,360,30,110,90),('Ruinas do Engenho',1150,420,38,110,110),('Terracos das Sementes',1030,630,24,120,100)]
paths=[[(840,350),(885,355),(940,360),(985,365),(1025,360)],[(940,360),(945,400),(955,440)],[(1055,400),(1100,410),(1150,420),(1190,440)],[(1150,420),(1140,465),(1120,510)],[(990,550),(1010,590),(1030,630),(1030,695)],[(1080,550),(1050,600),(1030,630)]]
def trail_distance(x,z):
 best=1e6
 for path in paths:
  for (ax,az),(bx,bz) in zip(path,path[1:]):
   dx=bx-ax;dz=bz-az;t=max(0,min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)))
   best=min(best,math.hypot(x-ax-t*dx,z-az-t*dz))
 return best
for index,c in enumerate(centers):
 island_mesh(c);name,cx,cz,h,rx,rz=c
 # Dense outer groves, clear routes and plazas in the middle.
 for gx in range(-6,7):
  for gz in range(-5,6):
   x=cx+gx*15+2*math.sin(gz*2+index);z=cz+gz*15+2*math.cos(gx+index)
   radius=math.hypot((x-cx)/rx,(z-cz)/rz)
   if radius>.89 or trail_distance(x,z)<8 or math.hypot(x-cx,z-cz)<23:continue
   y=elevation(x,z,c);size=13+(gx*3+gz*7)%8
   instance('island_tree_01',(x,y,z),size,gx*.7+gz)
   colliders.append(dict(id='Rootwood tree trunk',min=dict(x=x-.65,y=y,z=z-.65),max=dict(x=x+.65,y=y+5,z=z+.65)))
   for j in range(2):instance('fern_02',(x+2+j*2,elevation(x+2+j*2,z+2,c),z+2),1.1,j+gx)
 for k in range(22):
  a=k/22*math.tau;x=cx+math.cos(a)*rx*.91;z=cz+math.sin(a)*rz*.91
  if trail_distance(x,z)<10:continue
  instance('coast_land_rocks_02',(x,elevation(x,z,c)-2,z),(12,7,11),a)
 # Distinct agricultural landmarks, not duplicate barns on every island.
 if index==0:
  for side in [-1,1]:
   for k in range(6):
    x=cx+side*(11+k*3);z=cz-16;y=elevation(x,z,c)
    for j in range(7):instance('fern_02',(x,elevation(x,z+j*3,c)+.02,z+j*3),1.3,j*.6)
  for z in [cz-22,cz+22]:
   for dx in [-7,7]:box('Orchard store pier',(cx+dx,elevation(cx+dx,z,c)+2,z),(.45,4,.45),wood,solid=True)
   surface('Orchard covered store',[(cx-9,h+10,z-4),(cx+9,h+10,z-4),(cx+9,h+12,z+4),(cx-9,h+12,z+4)],[(0,1,2,3)],roof,3)
 elif index==1:
  for dx,dz in [(-20,-20),(20,-20),(-20,20),(20,20)]:
   x=cx+dx;z=cz+dz;y=elevation(x,z,c)
   cylinder('Ruined stone mill pier',(x,y+4,z),2.8,8,rock,12)
   colliders.append(dict(id='Ruined mill pier',min=dict(x=x-2.8,y=y,z=z-2.8),max=dict(x=x+2.8,y=y+8,z=z+2.8)))
  for side in [-1,1]:
   x=cx+side*30;z=cz+10;silo(x,z,elevation(x,z,c),4,18)
  windmill(cx,cz-28,elevation(cx,cz-28,c))
 else:
  for side in [-1,1]:
   for row in range(5):
    x=cx+side*(18+row*7)
    for j in range(14):
     z=cz-28+j*4
     if trail_distance(x,z)>7:instance('grass_medium_01',(x,elevation(x,z,c),z),1.8,row)
  for side in [-1,1]:
   x=cx+side*18;z=cz+28;y=elevation(x,z,c)
   for dx in [-5,5]:box('Seed terrace storage pillar',(x+dx,y+3,z),(.5,6,.5),wood,solid=True)
   box('Seed terrace storage roof',(x,y+6,z),(12,.3,8),roof)
 print('ROOTWOOD ISLAND',name,flush=True)
def point(c,x,z):return(x,elevation(x,z,c),z)
bridge('Rootwood main access',point(('old',720,320,26,95,85),800,320),point(centers[0],840,350),8)
bridge('Engine grove crossing',point(centers[0],1025,360),point(centers[1],1055,400),8)
bridge('Seed terraces eastern bridge',point(centers[1],1120,510),point(centers[2],1080,550),8)
bridge('Seed terraces western bridge',point(centers[0],955,440),point(centers[2],990,550),8)
bpy.context.view_layer.update()
def bake(objects):
 p=[];ix=[]
 for o in objects:
  m=o.data;m.calc_loop_triangles();offset=len(p)//3
  for v in m.vertices:
   w=o.matrix_world@v.co;p.extend([-w.x,w.z,-w.y])
  for t in m.loop_triangles:ix.extend([offset+t.vertices[0],offset+t.vertices[2],offset+t.vertices[1]])
 return p,ix
structures=[o for o in art if not any(k in o.name.lower() for k in ['fern','grass','island_tree'])]
p,ix=bake(structures);sp,si=bake(solid_objects);np,ni=bake([o for o in art if o in terrain or 'coast_land' in o.name])
out=ROOT/'art/rootwood-staging';out.mkdir(exist_ok=True)
(out/'rootwood-collision.json').write_text(json.dumps(dict(positions=p,indices=ix,boxes=colliders,surfaces=[],solidPositions=sp,solidIndices=si,walkableLinks=walkableLinks,navPositions=np,navIndices=ni),separators=(',',':')))
groups={}
for o in art:
 if o.data.users==1 and len(o.data.materials)==1:groups.setdefault(o.data.materials[0].name,[]).append(o)
for objects in groups.values():
 if len(objects)<2:continue
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
 for o in objects[1:]:art.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o in art:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Rootwood_Region.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(out/'rootwood.glb'),export_format='GLB',use_selection=True,export_animations=False)
(ROOT/'docs/rootwood-authoring.json').write_text(json.dumps(dict(islands=centers,paths=paths,bridges=walkableLinks,collisionTriangles=len(ix)//3,renderObjects=len(art),status='staging: physical traversal and navigation required before integration'),indent=2))
print('ROOTWOOD STAGING COMPLETE',flush=True)
