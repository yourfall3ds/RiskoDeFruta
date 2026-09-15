"""Install material-aware shared tree LODs without changing terrain/colliders."""
import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Rootwood_Region_Landings.blend'))
scene=bpy.context.scene
art=list(bpy.context.selected_objects)
# Retain original placement objects as editable, non-exported anchors on subsequent runs.
anchors=[o for o in scene.objects if o.type=='MESH' and 'island_tree' in o.name and o.location.z>-100]
assert len(anchors)>100, f'Expected rootwood grove placements, found {len(anchors)}'
art=[o for o in art if o not in anchors and not o.name.startswith('OrchardLOD_')]
for o in list(scene.objects):
 if o.name.startswith('OrchardLOD_'):bpy.data.objects.remove(o,do_unlink=True)
with bpy.data.libraries.load(str(ROOT/'art/blender/Orchard_Tree_LODs.blend'),link=False) as (data,out):
 out.objects=[name for name in data.objects if name.startswith('Orchard_')]
templates=out.objects
assert len(templates)==6
for i,anchor in enumerate(sorted(anchors,key=lambda o:o.name)):
 for template in templates:
  _,kind,tier=template.name.split('_')
  o=bpy.data.objects.new(f'OrchardLOD_{i:02}_{tier}_{kind}',template.data);scene.collection.objects.link(o)
  o.matrix_world=anchor.matrix_world.copy();o.hide_render=False;o.hide_set(False);art.append(o)
 anchor.hide_render=True;anchor.hide_set(True)
bpy.ops.object.select_all(action='DESELECT')
for o in art:o.hide_set(False);o.select_set(True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Rootwood_Region_Trees.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'art/rootwood-staging/rootwood.glb'),export_format='GLB',use_selection=True,export_animations=False)
print('ORCHARD LODS INSTALLED',len(anchors),'shared placements',flush=True)
