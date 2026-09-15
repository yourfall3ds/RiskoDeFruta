"""Build distant visual proxies from the actual authored regions, never collision geometry."""
import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
report={}
for region,source in [('rootwood','Rootwood_Region_Pavilions.blend')]:
 bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender'/source))
 selected=list(bpy.context.selected_objects)
 meshes=[o for o in selected if o.type=='MESH' and not any(word in o.name.lower() for word in ['fern','grass','orchardlod_','island_tree','coast'])]
 bpy.ops.object.select_all(action='DESELECT')
 seen=set()
 for o in meshes:
  o.hide_set(False);o.hide_render=False
  if o.data not in seen:
   seen.add(o.data)
   if len(o.data.polygons)>4000 and 'connected earth trails' not in o.name.lower():
    bpy.context.view_layer.objects.active=o;o.select_set(True);m=o.modifiers.new('Distant region budget','DECIMATE');m.ratio=4000/len(o.data.polygons);bpy.ops.object.modifier_apply(modifier=m.name);o.select_set(False)
 # Only images referenced by exported materials are emitted by glTF.
 for image in bpy.data.images:
  if image.size[0]>512 or image.size[1]>512:
   ratio=512/max(image.size);image.scale(max(1,round(image.size[0]*ratio)),max(1,round(image.size[1]*ratio)));image.pack()
 # Keep alpha-vertex trails separate: joining transfers COLOR_0 to opaque materials.
 trails=[o for o in meshes if 'connected earth trails' in o.name.lower()]
 opaque=[o for o in meshes if o not in trails]
 for o in opaque:o.select_set(True)
 bpy.context.view_layer.objects.active=opaque[0];bpy.ops.object.join();meshes=[bpy.context.object,*trails]
 for o in meshes:o.data.validate();o.select_set(True)
 path=ROOT/f'art/rootwood-staging/{region}-distant.glb'
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_animations=False)
 triangles=0
 for o in meshes:o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
 report[region]={'meshes':len(meshes),'triangles':triangles,'bytes':path.stat().st_size,'maxTextureEdge':512}
 print('DISTANT REGION READY',region,report[region],flush=True)
(ROOT/'docs/rootwood-distant-budget.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

