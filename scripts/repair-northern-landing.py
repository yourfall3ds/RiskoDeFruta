import bpy,json
from pathlib import Path
root=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(root/'art/blender/Agricultural_City.blend'))
changed=0
for o in bpy.context.selected_objects:
 if o.type!='MESH' or not any(m and 'timber' in m.name.lower() for m in o.data.materials):continue
 inv=o.matrix_world.inverted()
 for v in o.data.vertices:
  p=o.matrix_world@v.co;x,y,z=-p.x,p.z,-p.y
  if 96<x<109 and 30.9<z<51.1 and abs(y-(2+(z-31)*.5))<1.85:
   old=2+max(0,min(1,(z-31)/20))*10;new=2+max(0,min(1,(z-31)/17.7))*10
   p.z+=new-old;v.co=inv@p;changed+=1
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(root/'art/blender/Agricultural_City.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(root/'public/models/farm-city.glb'),export_format='GLB',use_selection=True,export_animations=False)
p=root/'public/models/farm-city-collision.json';d=json.loads(p.read_text());d['walkableLinks'][1:2]=[dict(a=dict(x=100,y=2,z=31),b=dict(x=104.425,y=12,z=48.7),width=5.2),dict(a=dict(x=104.425,y=12,z=48.7),b=dict(x=105,y=12,z=51),width=5.2)];p.write_text(json.dumps(d,separators=(',',':')))
print('NORTHERN LANDING FIX',changed,flush=True)
