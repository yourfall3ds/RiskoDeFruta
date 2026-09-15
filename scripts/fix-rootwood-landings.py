import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Rootwood_Region.blend'))
art=list(bpy.context.selected_objects);path=ROOT/'art/rootwood-staging/rootwood-collision.json';data=json.loads(path.read_text());links=data['walkableLinks']
def elevation(x,z):
 u=(x-720)/95;v=(z-320)/85;r=math.hypot(u,v);return 26+max(0,1-r*r)**2*(5+3*math.sin(u*3+v*2))
newA={'x':797,'y':elevation(797,342),'z':342}
def transformed(p,i,force=False):
 a=links[i]['a'];b=links[i]['b'];dx=b['x']-a['x'];dz=b['z']-a['z'];length2=dx*dx+dz*dz;t=((p[0]-a['x'])*dx+(p[2]-a['z'])*dz)/length2
 base=a['y']+(b['y']-a['y'])*t;perp=abs((p[0]-a['x'])*dz-(p[2]-a['z'])*dx)/math.sqrt(length2)
 if not force and (t<-.005 or t>1.005 or perp>4.4 or p[1]<base-.15 or p[1]>base+1.9):return p
 t=max(0,min(1,t));x,y,z=p
 if i==0:return(x+(newA['x']-a['x'])*(1-t),y+(newA['y']-a['y'])*(1-t),z+(newA['z']-a['z'])*(1-t))
 if i==1:newHeight=a['y']+(b['y']-a['y'])*min(1,t/.5)
 elif i==2:newHeight=a['y']+(b['y']-a['y'])*max(0,(t-.4)/.6)
 else:return p
 return(x,y+newHeight-base,z)
# Bridge wood is batched with other timber, but spatial and height bounds isolate its vertices.
for o in art:
 if o.type!='MESH' or not any(m and m.name=='Weathered timber' for m in o.data.materials):continue
 inverse=o.matrix_world.inverted()
 for v in o.data.vertices:
  w=o.matrix_world@v.co;p=(-w.x,w.z,-w.y)
  for i in [0,1,2]:p=transformed(p,i)
  v.co=inverse@Vector((-p[0],-p[2],p[1]))
names=['Rootwood main access','Engine grove crossing','Seed terraces eastern bridge']
for box in data['boxes']:
 for i,name in enumerate(names):
  if not box['id'].startswith(name):continue
  corners=[transformed((x,y,z),i,True) for x in [box['min']['x'],box['max']['x']] for y in [box['min']['y'],box['max']['y']] for z in [box['min']['z'],box['max']['z']]]
  box['min']={axis:min(p[j] for p in corners) for j,axis in enumerate('xyz')};box['max']={axis:max(p[j] for p in corners) for j,axis in enumerate('xyz')}
newLinks=[]
for i,link in enumerate(links):
 a,b=link['a'],link['b']
 if i==0:newLinks.append(dict(a=newA,b=b,width=8))
 elif i in [1,2]:
  t=.5 if i==1 else .4;mid={axis:a[axis]+(b[axis]-a[axis])*t for axis in 'xyz'};mid['y']=b['y'] if i==1 else a['y']
  newLinks.extend([dict(a=a,b=mid,width=8),dict(a=mid,b=b,width=8)])
 else:newLinks.append(link)
data['walkableLinks']=newLinks
bpy.context.view_layer.update();p=[];ix=[]
for o in art:
 if o.type!='MESH' or any(k in o.name.lower() for k in ['fern','grass','island_tree']):continue
 m=o.data;m.calc_loop_triangles();offset=len(p)//3
 for v in m.vertices:
  w=o.matrix_world@v.co;p.extend([-w.x,w.z,-w.y])
 for tri in m.loop_triangles:ix.extend([offset+tri.vertices[0],offset+tri.vertices[2],offset+tri.vertices[1]])
data['positions']=p;data['indices']=ix;path.write_text(json.dumps(data,separators=(',',':')))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Rootwood_Region_Landings.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'art/rootwood-staging/rootwood.glb'),export_format='GLB',use_selection=True,export_animations=False)
reportPath=ROOT/'docs/rootwood-authoring.json';report=json.loads(reportPath.read_text());report['bridges']=newLinks;report['landingSource']='art/blender/Rootwood_Region_Landings.blend';reportPath.write_text(json.dumps(report,indent=2))
print('ROOTWOOD LANDINGS EXPORTED',flush=True)
