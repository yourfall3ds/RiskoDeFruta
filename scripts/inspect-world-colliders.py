import bpy,json
from pathlib import Path
from collections import Counter
R=Path.cwd();bpy.ops.wm.open_mainfile(filepath=str(R/'art/blender/Farm_World_Polished.blend'))
objs=[o for o in bpy.context.scene.objects if o.type=='MESH']
report=[{'name':o.name,'polygons':len(o.data.polygons),'materials':[m.name if m else '' for m in o.data.materials],'location':list(o.location),'size':list(o.dimensions)} for o in objs]
(R/'art/world-object-inventory.json').write_text(json.dumps(report))
print('WORLD OBJECT INVENTORY',len(objs))
