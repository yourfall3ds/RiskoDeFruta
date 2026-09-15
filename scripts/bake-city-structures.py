import bpy,json
from pathlib import Path
root=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(root/'art/blender/Agricultural_City.blend'))
data=json.loads((root/'public/models/farm-city-collision.json').read_text());positions=[];indices=[];sources={}
for obj in bpy.context.selected_objects:
 if obj.type!='MESH' or any(word in obj.name.lower() for word in ['fern','tree','coast']):continue
 mesh=obj.data;mesh.calc_loop_triangles();offset=len(positions)//3
 for v in mesh.vertices:
  p=obj.matrix_world@v.co;positions.extend([-p.x,p.z,-p.y])
 for t in mesh.loop_triangles:indices.extend([offset+t.vertices[0],offset+t.vertices[2],offset+t.vertices[1]])
 sources[obj.name]=len(mesh.loop_triangles)
data['positions']=positions;data['indices']=indices
(root/'public/models/farm-city-collision.json').write_text(json.dumps(data,separators=(',',':')))
(root/'docs/city-collision-validation.json').write_text(json.dumps(dict(triangles=len(indices)//3,sources=sources),indent=2))
print('CITY SOLID STRUCTURES',len(indices)//3,flush=True)
