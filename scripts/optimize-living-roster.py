"""Bound per-species geometry while retaining skin weights and all authored actions."""
import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent;report=[]
for name in ['broccoli','lettuce','banana','corn','carrot','tomato','watermelon','boss']:
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'));scene=bpy.context.scene
    for o in list(scene.objects):
        if o.type!='MESH' or o.hide_get() or o.hide_render:continue
        budget=6000 if name=='lettuce' else 10000
        if any('Botanical' in m.name for m in o.data.materials if m):budget=7000
        if len(o.data.polygons)>budget:
            bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
            mod=o.modifiers.new('Runtime silhouette budget','DECIMATE');mod.ratio=budget/len(o.data.polygons)
            while o.modifiers.find(mod.name)>0:bpy.ops.object.modifier_move_up(modifier=mod.name)
            bpy.ops.object.modifier_apply(modifier=mod.name)
        for face in o.data.polygons:face.use_smooth=True
    bpy.ops.object.select_all(action='DESELECT')
    for o in scene.objects:
        if not o.hide_get() and not o.hide_render:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=88)
    report.append({'kind':name,'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH' and o.select_get()),'bytes':(ROOT/f'public/models/{name}.glb').stat().st_size})
(ROOT/'docs/roster-geometry.json').write_text(json.dumps(report,indent=2))
print('ROSTER BUDGET COMPLETE',flush=True)
