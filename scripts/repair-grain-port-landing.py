"""One-time repair of the original sloped port bridge; source builder contains the corrected two spans."""
import bpy,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
if len(json.loads((ROOT/'public/models/solar-frontier-collision.json').read_text())['walkableLinks'])!=2:
 print('Port landing already repaired; no changes');raise SystemExit(0)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Solar_Frontier.blend'))
bpy.context.preferences.filepaths.save_version=0
art=list(bpy.context.selected_objects)
# Lift the slope before the island wall, preserving deck/rail offsets and original UVs.
a=(263,80);dx,dz=9,26;length2=dx*dx+dz*dz;end_t=22.5/26
changed=0
for o in art:
 if o.type!='MESH' or not any(m and m.name=='Weathered timber' for m in o.data.materials):continue
 inv=o.matrix_world.inverted()
 for v in o.data.vertices:
  w=o.matrix_world@v.co;x,y,z=-w.x,w.z,-w.y;t=((x-a[0])*dx+(z-a[1])*dz)/length2;perp=abs((x-a[0])*dz-(z-a[1])*dx)/math.sqrt(length2)
  if -.005<=t<=1.005 and perp<3.7 and -.15<=y-(9+6*t)<=1.85:
   old=9+6*t;new=9+6*min(max(t,0)/end_t,1);w.z+=new-old;v.co=inv@w;changed+=1
 o.data.update()
bpy.context.view_layer.update()
def bake(objects):
 p=[];ix=[]
 for o in objects:
  m=o.data;m.calc_loop_triangles();base=len(p)//3
  for v in m.vertices:
   w=o.matrix_world@v.co;p.extend([-w.x,w.z,-w.y])
  for t in m.loop_triangles:ix.extend([base+t.vertices[0],base+t.vertices[2],base+t.vertices[1]])
 return p,ix
path=ROOT/'public/models/solar-frontier-collision.json';data=json.loads(path.read_text());data['positions'],data['indices']=bake([o for o in art if o.type=='MESH' and not any(k in o.name.lower() for k in ['fern','tree','coast'])])
old=data['walkableLinks'].pop();middle=dict(x=270.7884615385,y=15,z=102.5);data['walkableLinks'].extend([dict(a=old['a'],b=middle,width=6),dict(a=middle,b=old['b'],width=6)])
# Rail post AABBs move with their physical timber, keeping the walk corridor aligned.
for box in data['boxes']:
 if 'Orchard to grain port' not in box['id']:continue
 x=(box['min']['x']+box['max']['x'])/2;z=(box['min']['z']+box['max']['z'])/2;t=((x-a[0])*dx+(z-a[1])*dz)/length2;lift=6*(min(max(t,0)/end_t,1)-t)
 box['min']['y']+=lift;box['max']['y']+=lift
path.write_text(json.dumps(data,separators=(',',':')))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Solar_Frontier.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/solar-frontier.glb'),export_format='GLB',use_selection=True,export_animations=False)
print('PORT LANDING REPAIRED',changed,flush=True)
