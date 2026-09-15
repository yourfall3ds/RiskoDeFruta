"""Two authored frontier farms. Fixed layout, textured scan kit, editable Blender source."""
import bpy, math, json, bmesh
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
source=(ROOT/'scripts/build-farm-city.py').read_text(encoding='utf-8-sig')
exec(source[:source.index("centers=[")])
# Placement anchors reuse the kit tree; install-orchard-lods.py supplies production crowns after export.
# Hand-selected profiles: broad shelves and recessed cliff faces, with a flat cultivated interior.
terrain=[]
def frontier_land(name,x,z,h,rx,rz,profile):
 n=len(profile);verts=[(x,h,z)]
 for scale,drop in [(.60,0),(1,0),(.99,1.3),(.94,5),(.85,11),(.69,20),(.52,29),(.46,32)]:
  for i,r in enumerate(profile):
   a=i/n*math.tau;verts.append((x+math.cos(a)*rx*r*scale,h-drop,z+math.sin(a)*rz*r*scale))
 faces=[(0,1+(i+1)%n,1+i) for i in range(n)]
 for ring in range(7):
  for i in range(n):faces.append((1+ring*n+i,1+ring*n+(i+1)%n,1+(ring+1)*n+(i+1)%n,1+(ring+1)*n+i))
 faces.append(tuple(reversed([1+7*n+i for i in range(n)])))
 o=surface(name+' solid cultivated island',verts,faces,rock,4);o.data.materials.append(soil)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(o.data);bm.free()
 for poly in o.data.polygons:
  # Blender Z is world height. Horizontal upper faces receive the soil texture.
  poly.material_index=1 if poly.center.z>h-.05 and abs(poly.normal.z)>.8 else 0
  for li in poly.loop_indices:
   v=o.data.vertices[o.data.loops[li].vertex_index].co
   o.data.uv_layers.active.data[li].uv=(v.x/5,v.y/5) if abs(poly.normal.z)>.8 else ((v.x if abs(poly.normal.y)>.5 else v.y)/5,v.z/5)
 solid_objects.append(o);terrain.append(o)
 return o
frontier_land('Pomar dos Ventos',248,45,9,48,43,[1,.97,1.04,1.02,.94,.96,1.03,1,.98,.91,.95,1.02,1.04,.96,.94,1])
frontier_land('Porto dos Graos',285,147,15,48,45,[.97,1.02,1.06,.98,.96,1.02,1.05,.98,1,.94,.96,1.01,1.04,1.02,.95,.97])
# Orchard: open north/south avenue, a long grain elevator and terraces of cultivated rows.
for x,z,h in [(229,57,9),(285,160,15)]:
 for dx in [-4,4]:silo(x+dx,z,h,2.6,19 if h==9 else 24)
 box('Grain elevator transfer house',(x,h+17,z),(12,4,5),red,solid=True)
 for dx in [-5.5,5.5]:box('Elevator reinforced column',(x+dx,h+7,z),(.7,14,.7),wood,solid=True)
 beam('Elevator cross tie',(x-5.5,h+2,z),(x+5.5,h+13,z),.28,metal)
for cx,cz,h in [(248,45,9),(285,147,15)]:
 for side in [-1,1]:
  for row in range(4):
   x=cx+side*(12+row*5.5)
   for k in range(7):instance('fern_02',(x,h+.03,cz-17+k*3.8),.85+(k%2)*.2,k*.5)
   fence((x-1.8,cz-20),(x-1.8,cz+9),h)
 for dx,dz in [(-28,-18),(28,-17),(-31,17),(31,15),(-16,29),(18,29)]:
  instance('island_tree_01',(cx+dx,h,cz+dz),10+(int(dx)%3),dz*.13)
  colliders.append(dict(id='Frontier orchard trunk',min=dict(x=cx+dx-.6,y=h,z=cz+dz-.6),max=dict(x=cx+dx+.6,y=h+5,z=cz+dz+.6)))
 for dx,dz in [(-7,-24),(7,-24),(-7,22),(7,22)]:
  box('Wayfinding lantern post',(cx+dx,h+1.7,cz+dz),(.24,3.4,.24),wood,solid=True)
  box('Wayfinding warm lantern',(cx+dx,h+3,cz+dz),(.45,.55,.45),lamp,.02)
 for i in range(16):
  a=i/16*math.tau;instance('coast_land_rocks_02',(cx+math.cos(a)*44,h-3,cz+math.sin(a)*39),(8,4,7),a)
# Grain port: broad market square, loading docks and two distinct awnings, no repeated barn row.
for x,z in [(262,132),(307,132)]:
 for dx in [-3,3]:
  for dz in [-2.5,2.5]:box('Port market pillar',(x+dx,17.2,z+dz),(.32,4.4,.32),wood,solid=True)
 surface('Sloped port market roof',[(x-3.8,19.3,z-3.2),(x+3.8,19.3,z-3.2),(x+3.8,20.3,z+3.2),(x-3.8,20.3,z+3.2)],[(0,1,2,3)],roof,2)
 box('Grain display counter',(x,15.7,z),(5.4,1.4,1.4),wood,solid=True)
windmill(271,61,9);windmill(315,162,15)
bridge('Frontier approach',(183,7,45),(205,9,45),6)
bridge('Orchard to grain port',(263,9,80),(270.7884615385,15,102.5),6)
bridge('Grain port landing',(270.7884615385,15,102.5),(272,15,106),6)
# Glasshouse district: broad cultivated shelf, open central avenue and explorable crop halls.
frontier_land('Distrito das Estufas',285,280,15,74,72,[1,.98,1.04,.95,1.02,.97,1.05,.96,1,.94,1.02,.98,1.04,.96,1.01,.97])
# Roof glazing only: translucent panes do not hide solid walls or pretend to be water.
glass=bpy.data.materials.new('Weathered greenhouse glazing');glass.use_nodes=True
bsdf=glass.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.36,.65,.54,1);bsdf.inputs['Roughness'].default_value=.22;bsdf.inputs['Alpha'].default_value=.23;glass.surface_render_method='DITHERED'
for x in [254,316]:
 z=280;h=15
 for zz in range(258,305,6):
  for side in [-1,1]:
   box('Greenhouse steel column',(x+side*10,h+3.2,zz),(.22,6.4,.22),metal,solid=True)
   beam('Greenhouse sloping roof rib',(x+side*10,h+6.4,zz),(x,h+10,zz),.2,metal)
 for side in [-1,1]:
  beam('Greenhouse eaves',(x+side*10,h+6.4,256),(x+side*10,h+6.4,306),.2,metal)
  surface('Greenhouse roof glazing',[(x,h+10,256),(x+side*10,h+6.4,256),(x+side*10,h+6.4,306),(x,h+10,306)],[(0,1,2,3)],glass,4)
  for row in [4,7]:
   box('Greenhouse soil bed',(x+side*row,h+.15,280),(2,.3,42),soil,.03)
   for k in range(14):instance('fern_02',(x+side*row,h+.3,260+k*3),1.15+(k%3)*.12,k*.5)
 beam('Greenhouse ridge',(x,h+10,256),(x,h+10,306),.23,metal)
 # Long halls keep both end doors and the central aisle open.
 for zz in [256,306]:
  for side in [-1,1]:box('Greenhouse end sill',(x+side*6.5,h+.4,zz),(7,.8,.45),wood,solid=True)
for x in [277,293]:
 fence((x,223),(x,249),15);fence((x,311),(x,333),15)
 for z in [231,246,316,330]:
  box('Glasshouse avenue lamp post',(x,16.8,z),(.24,3.6,.24),wood,solid=True)
  box('Glasshouse avenue lantern',(x,18.4,z),(.48,.6,.48),lamp,.02)
for x,z in [(240,242),(329,241),(239,320),(328,320)]:
 silo(x,z,15,3,13)
for i in range(28):
 a=i/28*math.tau;instance('coast_land_rocks_02',(285+math.cos(a)*69,12,280+math.sin(a)*66),(9,4.5,8),a)
bridge('Port to glasshouse avenue',(285,15,185),(285,15,214),7)
bpy.context.view_layer.update()
def bake(objects):
 p=[];ix=[]
 for o in objects:
  m=o.data;m.calc_loop_triangles();offset=len(p)//3
  for v in m.vertices:
   w=o.matrix_world@v.co;p.extend([-w.x,w.z,-w.y])
  for t in m.loop_triangles:ix.extend([offset+t.vertices[0],offset+t.vertices[2],offset+t.vertices[1]])
 return p,ix
structure=[o for o in art if not any(word in o.name.lower() for word in ['fern','tree','coast'])]
positions,indices=bake(structure);sp,si=bake(solid_objects);np,ni=bake(terrain)
assert len(terrain)==3 and len(walkableLinks)==4, 'Incomplete frontier district layout'
assert max(np[2::3])>350, 'Glasshouse terrain missing from collision/nav export'
(ROOT/'public/models/solar-frontier-collision.json').write_text(json.dumps(dict(positions=positions,indices=indices,boxes=colliders,surfaces=[],solidPositions=sp,solidIndices=si,walkableLinks=walkableLinks,navPositions=np,navIndices=ni),separators=(',',':')))
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
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Solar_Frontier.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/solar-frontier.glb'),export_format='GLB',use_selection=True,export_animations=False)
print('SOLAR FRONTIER EXPORT COMPLETE',len(indices)//3,'collision triangles',len(art),'objects',flush=True)
