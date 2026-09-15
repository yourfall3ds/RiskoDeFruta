import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Solar_Frontier.blend'))
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;art=list(bpy.context.selected_objects)
source=(ROOT/'scripts/build-farm-world.py').read_text(encoding='utf-8-sig');exec(source[source.index('def load_asset('):source.index('assets={')])
tree,dims=load_asset('island_tree_01');bpy.context.view_layer.objects.active=tree;tree.select_set(True)
if len(tree.data.polygons)>6000:
 m=tree.modifiers.new('Orchard tree detail','DECIMATE');m.ratio=6000/len(tree.data.polygons);bpy.ops.object.modifier_apply(modifier=m.name)
for o in art:
 if 'coast_land' in o.name:
  height=max(v.co.z for v in o.data.vertices)-min(v.co.z for v in o.data.vertices);o.scale.z=4/height;o.location.z=(15 if -o.location.y>100 else 9)-3
 if 'island_tree' in o.name:o.data=tree.data
bpy.ops.object.select_all(action='DESELECT')
for o in art:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Solar_Frontier.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/solar-frontier.glb'),export_format='GLB',use_selection=True,export_animations=False)
print('ORCHARD DETAIL REFINED',len(tree.data.polygons),flush=True)
