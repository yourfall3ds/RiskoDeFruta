import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
for source,name,height in [('wooden_crate_01','supply-crate',.85),('wooden_barrels_01','farm-barrels',1.25),('watering_can_metal_01','watering-can',.55)]:
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(ROOT/f'art/source/{source}/{source}.gltf'))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:o.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();o=bpy.context.object;o.parent=None;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    lo=Vector([min(v.co[i] for v in o.data.vertices) for i in range(3)]);hi=Vector([max(v.co[i] for v in o.data.vertices) for i in range(3)])
    for v in o.data.vertices:v.co=(v.co-Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z)))*height/(hi.z-lo.z)
    if len(o.data.polygons)>7000:
        mod=o.modifiers.new('Prop budget','DECIMATE');mod.ratio=7000/len(o.data.polygons);bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'),export_format='GLB',export_image_format='JPEG',export_jpeg_quality=88)
