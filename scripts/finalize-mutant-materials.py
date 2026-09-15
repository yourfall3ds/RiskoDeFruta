"""Remove baked-color emission and give botanical crowns their own organic surface."""
import bpy, bmesh
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
for name in ['broccoli','lettuce','banana','corn','carrot','tomato','watermelon','boss']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'))
    bpy.context.preferences.filepaths.save_version=0
    for material in bpy.data.materials:
        if not material.use_nodes:continue
        bs=material.node_tree.nodes.get('Principled BSDF')
        if not bs:continue
        for link in list(bs.inputs['Emission Color'].links):material.node_tree.links.remove(link)
        bs.inputs['Emission Color'].default_value=(0,0,0,1)
        bs.inputs['Emission Strength'].default_value=0
        bs.inputs['Metallic'].default_value=0
        bs.inputs['Roughness'].default_value=.64
        if 'Botanical floret' in material.name:
            for input_name in ['Base Color','Normal']:
                for link in list(bs.inputs[input_name].links):material.node_tree.links.remove(link)
            tex=material.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image=bpy.data.images.load(str(ROOT/'public/textures/mutant-skins/broccoli-crown.png'))
            material.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    for o in bpy.context.scene.objects:
        if o.type!='MESH' or not any(m and 'Botanical floret' in m.name for m in o.data.materials):continue
        bm=bmesh.new();bm.from_mesh(o.data);bm.normal_update()
        normals=[tuple(v.normal) for v in bm.verts];bm.free()
        for face in o.data.polygons:face.use_smooth=True
        o.data.normals_split_custom_set_from_vertices(normals)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=88)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'))
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'art/blender/Mutant_{name}.blend'),compress=True)
    print('MATERIAL READY',name,flush=True)
