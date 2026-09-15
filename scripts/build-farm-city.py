"""Authored agricultural city expansion with matching visible and collision geometry."""
import bpy,math,json,random,bmesh
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
# Reuse the game's textured building kit, before its original composition/export.
source=(ROOT/'scripts/build-farm-world.py').read_text(encoding='utf-8-sig')
exec(source[:source.index('island(0,0,0,24,26)')])
bpy.context.preferences.filepaths.save_version=0
# The distant city uses dedicated lower-detail scan copies, never enemy assets.
for template,dims in assets.values():
 if len(template.data.polygons)>900:
  bpy.context.view_layer.objects.active=template;template.select_set(True);m=template.modifiers.new('City scan budget','DECIMATE');m.ratio=900/len(template.data.polygons);bpy.ops.object.modifier_apply(modifier=m.name);template.select_set(False)
collision=[];solid_objects=[];surfaces=[];walkableLinks=[]
def land(name,x,z,h,rx,rz):
 count=64;verts=[];rings=[(0,1),(.5,1),(2,.99),(5,.97),(9,.87),(15,.73),(20,.53),(23,.42)]
 for j,(drop,r) in enumerate(rings):
  for i in range(count):
   a=i/count*math.tau;rough=0 if j<2 else .025*math.sin(a*9+j)+.02*math.cos(a*5-j*.4)
   verts.append((x+math.cos(a)*rx*(r+rough),h-drop,z+math.sin(a)*rz*(r+rough)))
 faces=[]
 for j in range(len(rings)-1):
  for i in range(count):faces.append((j*count+i,j*count+(i+1)%count,(j+1)*count+(i+1)%count,(j+1)*count+i))
 faces.extend([tuple(reversed(range(count))),tuple((len(rings)-1)*count+i for i in range(count))]);o=surface(name+' continuous cliff',verts,faces,rock);bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(o.data);bm.free();solid_objects.append(o);collision.append(o)
 for poly in o.data.polygons:
  for li in poly.loop_indices:
   v=o.data.vertices[o.data.loops[li].vertex_index].co;o.data.uv_layers.active.data[li].uv=(v.x/4,v.z/4) if abs(poly.normal.x)<.7 else (v.y/4,v.z/4)
 top=surface(name+' cultivated field',[(x,h+.015,z)]+[(x+math.cos(i/count*math.tau)*rx,h+.015,z+math.sin(i/count*math.tau)*rz) for i in range(count)],[(0,i+1,(i+1)%count+1) for i in range(count)],soil)
 collision.append(top);surfaces.append(dict(id=name,x=x,z=z,width=rx*2,depth=rz*2,height=h,ellipse=True))
def bigbarn(x,z,h):
 before=set(art);n=len(colliders);barn(x,z,h)
 for o in set(art)-before:o.location=pos((x,h,z))+(o.location-pos((x,h,z)))*1.65;o.scale*=1.65;collision.append(o)
 for c in colliders[n:]:
  for k in ['min','max']:
   for axis,center in zip('xyz',[x,h,z]):c[k][axis]=center+(c[k][axis]-center)*1.65

def bridge(name,a,b,width=5.2):
 walkableLinks.append(dict(a=dict(zip("xyz",a)),b=dict(zip("xyz",b)),width=width))
 av,bv=Vector(a),Vector(b);delta=bv-av;length=math.hypot(delta.x,delta.z);right=Vector((-delta.z/length,0,delta.x/length));steps=math.ceil(length/.55)
 for i in range(steps):
  t0=i/steps;t1=(i+1)/steps;p=av.lerp(bv,t0);q=av.lerp(bv,t1);o=surface(name+' timber deck',[tuple(p-right*width/2),tuple(p+right*width/2),tuple(q+right*width/2),tuple(q-right*width/2)],[(0,1,2,3)],wood,1.6);collision.append(o)
 for side in [-1,1]:
  n=math.ceil(length/2.5)
  for i in range(n+1):
   p=av.lerp(bv,i/n)+right*width*.5*side;o=box(name+' rail post',tuple(p+Vector((0,.8,0))),(.18,1.6,.18),wood,.02,solid=True);collision.append(o)
   if i<n:
    q=av.lerp(bv,(i+1)/n)+right*width*.5*side
    for y in [.55,1.2]:o=beam(name+' rail',tuple(p+Vector((0,y,0))),tuple(q+Vector((0,y,0))),.12,wood);collision.append(o)
    # Per-span boxes would block the diagonal corridor; triangle rails provide the barrier.
centers=[('Distrito das Sementes',100,8,2,30,26),('Fazenda Solar',105,72,12,28,23),('Mercado da Colheita',160,45,7,25,23)]
for idx,(name,x,z,h,rx,rz) in enumerate(centers):
 land(name,x,z,h,rx,rz);bigbarn(x,z+7,h);silo(x+13,z+10,h,2.6,18);silo(x-12,z+11,h,2.0,21);windmill(x+19,z-1,h)
 for dx in [-20,20]:
  for dz in [-15,17]:
   instance('island_tree_01',(x+dx,h,z+dz),8+idx,idx+.5);colliders.append(dict(id='City tree trunk',min=dict(x=x+dx-.4,y=h,z=z+dz-.4),max=dict(x=x+dx+.4,y=h+4,z=z+dz+.4)))
 for side in [-1,1]:
  for row in range(4):
   xx=x+side*(8+row*3.2);zz=z-12;o=box('Raised cultivated furrow',(xx,h+.10,zz),(1.7,.2,13),soil,.05);collision.append(o)
   for k in range(6):instance('fern_02',(xx,h+.2,zz-5+k*2),.7+(k%3)*.1,k*.8)
  fence((x+side*5,z-21),(x+side*5,z-5),h)
 for i in range(24):
  a=i/24*math.tau;instance('coast_land_rocks_02',(x+math.cos(a)*rx*.98,h-5,z+math.sin(a)*rz*.98),(5.5,7,5.5),a)
 # Simple textured market shelters along the side street, human-accessible space under the awnings.
 for dx in [-17,17]:
  for dz in [-1,6]:
   for px in [-1.7,1.7]:o=box('Market pillar',(x+dx+px,h+1.7,z+dz),(.18,3.4,.18),wood,solid=True);collision.append(o)
   o=box('Market awning',(x+dx,h+3.5,z+dz),(4.4,.22,3.4),roof);collision.append(o)
bridge('East city access',(52,2,8),(72,2,8))
bridge('Northern causeway',(100,2,31),(104.425,12,48.7))
bridge('Northern landing',(104.425,12,48.7),(105,12,51))
bridge('Market crossing',(123,2,20),(140,7,32))
bridge('Harvest skywalk',(130,12,70),(145,7,61))
# Bake before render batching. Matrix updates matter after authored scale changes.
bpy.context.view_layer.update()
def bake(objects):
 p=[];ix=[]
 for o in objects:
  m=o.data;m.calc_loop_triangles();offset=len(p)//3
  for v in m.vertices:
   w=o.matrix_world@v.co;p.extend([-w.x,w.z,-w.y])
  for t in m.loop_triangles:ix.extend([offset+t.vertices[0],offset+t.vertices[2],offset+t.vertices[1]])
 return p,ix
collision=[o for o in art if not any(word in o.name.lower() for word in ['fern','tree','coast'])]
positions,indices=bake(collision);sp,si=bake(solid_objects)
(ROOT/'public/models/farm-city-collision.json').write_text(json.dumps(dict(positions=positions,indices=indices,boxes=colliders,surfaces=surfaces,solidPositions=sp,solidIndices=si,walkableLinks=walkableLinks),separators=(',',':')))
# Batching by material leaves scan templates shared, reducing draw calls.
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
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Agricultural_City.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-city.glb'),export_format='GLB',use_selection=True,export_animations=False)
(ROOT/'docs/farm-city-authoring.json').write_text(json.dumps(dict(islands=centers,bridges=4,barnScale=1.65,collisionTriangles=len(indices)//3,renderObjects=len(art)),indent=2))
print('AGRICULTURAL CITY READY',len(indices)//3,'collision triangles',flush=True)
