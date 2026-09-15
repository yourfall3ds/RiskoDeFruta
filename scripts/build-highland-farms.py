"""Authored highland farms: three solid, textured islands with continuous rolling ground."""
import bpy,math,json,bmesh
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
source=(ROOT/'scripts/build-farm-city.py').read_text(encoding='utf-8-sig')
exec(source[:source.index('centers=[')])
terrain=[]
centers=[('Campos Altos',500,280,18,100,98),('Moinhos do Leste',720,320,26,95,85),('Vale das Sementes',610,520,20,110,95)]

def elevation(x,z,c):
 name,cx,cz,h,rx,rz=c;u=(x-cx)/rx;v=(z-cz)/rz;r=math.hypot(u,v)
 return h+max(0,1-r*r)**2*(5+3*math.sin(u*3+v*2))

def island_mesh(c):
 name,cx,cz,h,rx,rz=c;n=64;rings=12
 profile=[1+.035*math.sin(i/n*math.tau*5)+.025*math.cos(i/n*math.tau*9) for i in range(n)]
 verts=[(cx,elevation(cx,cz,c),cz)]
 for ring in range(1,rings+1):
  for i in range(n):
   a=i/n*math.tau;r=ring/rings*profile[i];x=cx+math.cos(a)*rx*r;z=cz+math.sin(a)*rz*r
   verts.append((x,elevation(x,z,c),z))
 faces=[(0,1+(i+1)%n,1+i) for i in range(n)]
 for ring in range(rings-1):
  for i in range(n):
   a=1+ring*n+i;b=1+ring*n+(i+1)%n;d=a+n;e=b+n
   faces.extend([(a,b,e),(a,e,d)])
 topfaces=len(faces)
 for scale,drop in [(1,2),(.99,7),(.92,17),(.81,29),(.68,40)]:
  for i in range(n):
   a=i/n*math.tau;r=profile[i]*scale;verts.append((cx+math.cos(a)*rx*r,h-drop,cz+math.sin(a)*rz*r))
 for ring in range(rings-1,rings+4):
  for i in range(n):
   a=1+ring*n+i;b=1+ring*n+(i+1)%n;faces.append((a,b,b+n,a+n))
 faces.append(tuple(reversed([1+(rings+4)*n+i for i in range(n)])))
 o=surface(name+' rolling solid terrain',verts,faces,soil,5);o.data.materials.append(rock)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(o.data);bm.free()
 for poly in o.data.polygons:
  poly.material_index=0 if poly.index<topfaces else 1
  for li in poly.loop_indices:
   v=o.data.vertices[o.data.loops[li].vertex_index].co
   o.data.uv_layers.active.data[li].uv=(v.x/5,v.y/5) if poly.index<topfaces else ((v.x if abs(poly.normal.y)>.5 else v.y)/5,v.z/5)
 terrain.append(o);solid_objects.append(o)

bridge_segments=[((354,280),(410,280)),((586,297),(636,306)),((539,363),(573,434)),((689,393),(658,440))]
def bridge_clearance(x,z):
 for (ax,az),(bx,bz) in bridge_segments:
  dx=bx-ax;dz=bz-az;t=max(0,min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)))
  if math.hypot(x-ax-t*dx,z-az-t*dz)<12:return False
 return True

for c in centers:
 island_mesh(c)
 name,cx,cz,h,rx,rz=c
 # Cultivation follows rolling ground, leaving the central crossing open.
 for side in [-1,1]:
  for row in range(5):
   x=cx+side*(25+row*8)
   for k in range(12):
    z=cz-34+k*6;y=elevation(x,z,c)
    instance('fern_02',(x,y+.03,z),1.1+(k%3)*.15,k*.43)
  for k in range(7):
   x=cx+side*16;z=cz-40+k*13;y=elevation(x,z,c)
   box('Highland trail post',(x,y+.75,z),(.22,1.5,.22),wood,solid=True)
 # Tangible rock outcrops on the outer terrace; include them in collision.
 for k in range(14):
  a=k/14*math.tau;x=cx+math.cos(a)*rx*.86;z=cz+math.sin(a)*rz*.86;y=elevation(x,z,c)
  if bridge_clearance(x,z):
   o=instance('coast_land_rocks_02',(x,y-1.4,z),(10,4,8),a);collision.append(o)
 # Separate settlement silhouette for each island.
 if name=='Campos Altos':
  x=cx-7;z=cz+28;y=elevation(x,z,c)
  box('Farmstead level foundation',(x,y-.6,z),(27,1.2,23),rock,solid=True)
  bigbarn(x,z,y);silo(x+17,z+5,elevation(x+17,z+5,c),3,21)
 elif name=='Moinhos do Leste':
  for dx,dz in [(-35,-10),(25,20),(0,-37)]:windmill(cx+dx,cz+dz,elevation(cx+dx,cz+dz,c))
  for dx in [-5,5]:silo(cx+dx,cz+28,elevation(cx+dx,cz+28,c),3.5,25)
 else:
  for dx in [-34,34]:
   x=cx+dx;z=cz+10;y=elevation(x,z,c)
   for px in [-5,5]:
    for pz in [-8,8]:box('Seed depot pillar',(x+px,y+3,z+pz),(.4,6,.4),wood,solid=True)
   surface('Seed depot shelter',[(x-6,y+6,z-10),(x+6,y+6,z-10),(x+6,y+8,z+10),(x-6,y+8,z+10)],[(0,1,2,3)],roof,3)
   for pz in [-5,5]:box('Seed depot counter',(x,y+1,z+pz),(8,2,2),wood,solid=True)
 print('HIGHLAND ISLAND BUILT',name,flush=True)

def point(c,x,z):return (x,elevation(x,z,c),z)
bridge('Glasshouse to highlands',(354,15,280),point(centers[0],410,280),7)
bridge('Eastern windmill crossing',point(centers[0],586,297),(621,elevation(636,306,centers[1]),303.3),7)
bridge('Eastern windmill landing',(621,elevation(636,306,centers[1]),303.3),point(centers[1],636,306),7)
bridge('Seed valley crossing',point(centers[0],539,363),point(centers[2],573,434),7)
bridge('Eastern valley landing',point(centers[1],689,393),(679.08,elevation(689,393,centers[1]),408.04),7)
bridge('Eastern valley loop',(679.08,elevation(689,393,centers[1]),408.04),point(centers[2],658,440),7)
bpy.context.view_layer.update()
def bake(objects):
 p=[];ix=[]
 for o in objects:
  m=o.data;m.calc_loop_triangles();offset=len(p)//3
  for v in m.vertices:
   w=o.matrix_world@v.co;p.extend([-w.x,w.z,-w.y])
  for t in m.loop_triangles:ix.extend([offset+t.vertices[0],offset+t.vertices[2],offset+t.vertices[1]])
 return p,ix
structures=[o for o in art if 'fern' not in o.name.lower() and 'grass' not in o.name.lower()]
p,ix=bake(structures);sp,si=bake(solid_objects);np,ni=bake([o for o in art if o in terrain or 'coast_land' in o.name])
assert len(terrain)==3 and len(walkableLinks)==6
(ROOT/'public/models/highland-farms-collision.json').write_text(json.dumps(dict(positions=p,indices=ix,boxes=colliders,surfaces=[],solidPositions=sp,solidIndices=si,walkableLinks=walkableLinks,navPositions=np,navIndices=ni),separators=(',',':')),encoding='utf-8')
# Keep scan instances shared. Batch structural materials only.
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
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Highland_Farms.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/highland-farms.glb'),export_format='GLB',use_selection=True,export_animations=False)
(ROOT/'docs/highland-authoring.json').write_text(json.dumps(dict(islands=centers,bridges=walkableLinks,collisionTriangles=len(ix)//3,renderObjects=len(art),status='authored; integration and navigation validation pending'),indent=2),encoding='utf-8')
print('HIGHLAND FARMS EXPORT COMPLETE',len(ix)//3,flush=True)
