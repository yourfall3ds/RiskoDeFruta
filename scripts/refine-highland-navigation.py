import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Highland_Farms.blend'))
p=[];ix=[]
for o in bpy.context.selected_objects:
 if o.type!='MESH' or not ('rolling solid terrain' in o.name or 'coast_land' in o.name):continue
 m=o.data;m.calc_loop_triangles();offset=len(p)//3
 for v in m.vertices:
  w=o.matrix_world@v.co;p.extend([-w.x,w.z,-w.y])
 for t in m.loop_triangles:ix.extend([offset+t.vertices[0],offset+t.vertices[2],offset+t.vertices[1]])
path=ROOT/'public/models/highland-farms-collision.json';d=json.loads(path.read_text());d['navPositions']=p;d['navIndices']=ix;path.write_text(json.dumps(d,separators=(',',':')),encoding='utf-8')
print('HIGHLAND NAV GEOMETRY',len(ix)//3,flush=True)
