import bpy,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
report=[]
for name in ['broccoli','lettuce','banana','corn','carrot','tomato','watermelon','boss']:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/f'art/blender/Mutant_{name}.blend'))
    scene=bpy.context.scene;scene.frame_set(1);deps=bpy.context.evaluated_depsgraph_get()
    meshes=[]
    for o in scene.objects:
        if o.type!='MESH' or o.hide_render:continue
        e=o.evaluated_get(deps);pts=[e.matrix_world@Vector(v) for v in e.bound_box]
        lo=[min(p[k] for p in pts) for k in range(3)];hi=[max(p[k] for p in pts) for k in range(3)]
        meshes.append({'name':o.name,'size':[round(hi[k]-lo[k],3) for k in range(3)],'min':lo,'max':hi})
    report.append({'kind':name,'meshes':meshes})
(ROOT/'docs/mutant-scale-audit.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report),flush=True)
