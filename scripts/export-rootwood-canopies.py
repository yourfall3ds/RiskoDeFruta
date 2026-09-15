import bpy,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Rootwood_Region_Pavilions.blend'))
groups={}
for o in bpy.context.selected_objects:
 if o.type=='MESH' and o.name.startswith('OrchardLOD_') and '_near_' in o.name:groups.setdefault(o.name.split('_')[1],[]).append(o)
entries=[]
for key,objects in sorted(groups.items()):
 points=[o.matrix_world@Vector(c) for o in objects for c in o.bound_box]
 low=[min(p[i] for p in points) for i in range(3)];high=[max(p[i] for p in points) for i in range(3)]
 entries.append(dict(id=key,center=dict(x=-(low[0]+high[0])/2,y=(low[2]+high[2])/2,z=-(low[1]+high[1])/2),size=(high[2]-low[2])*1.08,visible=True))
assert len(entries)==300
(ROOT/'public/models/rootwood-canopies.json').write_text(json.dumps(entries,separators=(',',':')))
print('EXPORTED',len(entries),'canopy placements',flush=True)
