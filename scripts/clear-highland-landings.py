import bpy,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Highland_Farms.blend'))
source=(ROOT/'scripts/build-highland-farms.py').read_text(encoding='utf-8')
exec(source[source.index('bridge_segments='):source.index('for c in centers:')])
objects=list(bpy.context.selected_objects);removed=[]
for o in list(objects):
 if 'coast_land' in o.name and not bridge_clearance(-o.location.x,-o.location.y):
  removed.append(o.name);objects.remove(o);bpy.data.objects.remove(o,do_unlink=True)
bpy.context.view_layer.update()
p=[];ix=[]
for o in objects:
 if o.type!='MESH' or any(word in o.name.lower() for word in ['fern','grass']):continue
 m=o.data;m.calc_loop_triangles();offset=len(p)//3
 for v in m.vertices:
  w=o.matrix_world@v.co;p.extend([-w.x,w.z,-w.y])
 for t in m.loop_triangles:ix.extend([offset+t.vertices[0],offset+t.vertices[2],offset+t.vertices[1]])
path=ROOT/'public/models/highland-farms-collision.json';d=json.loads(path.read_text());d['positions']=p;d['indices']=ix;path.write_text(json.dumps(d,separators=(',',':')),encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Highland_Farms.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/highland-farms.glb'),export_format='GLB',use_selection=True,export_animations=False)
print('LANDING ROCKS REMOVED',removed,flush=True)
