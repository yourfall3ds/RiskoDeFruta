import bpy,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent;report=[]
for name in ['broccoli','lettuce','banana','boss','tomato','watermelon']:
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
    bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'))
    groups={}
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH' and not obj.hide_render and not obj.hide_get() and not any(m.type=='ARMATURE' for m in obj.modifiers):groups.setdefault((obj.parent,tuple(obj.data.materials)),[]).append(obj)
    for group in groups.values():
        if len(group)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for obj in group:obj.select_set(True)
        bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()
    rig=next((o for o in bpy.context.scene.objects if o.type=='ARMATURE'),None)
    if rig and rig.animation_data:
        for track in rig.animation_data.nla_tracks:track.mute=True
    bpy.context.scene.frame_set(1)
    for mat in bpy.data.materials:
        if 'Botanical floret' in mat.name:
            bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.18,.52,.035,1)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if not obj.hide_render and not obj.hide_get():obj.select_set(True)
    bounds=[o.matrix_world@Vector(c) for o in bpy.context.scene.objects if o.type=='MESH' and o.select_get() for c in o.bound_box]
    report.append({'kind':name,'height':max(p.z for p in bounds)-min(p.z for p in bounds),'meshes':len([o for o in bpy.context.scene.objects if o.type=='MESH'])})
    bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=88)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'art/blender/Mutant_{name}.blend'),compress=True)
(ROOT/'docs/roster-geometry.json').write_text(json.dumps(report,indent=2))
