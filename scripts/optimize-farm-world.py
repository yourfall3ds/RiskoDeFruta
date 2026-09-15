import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Farm_World.blend'))
scene=bpy.context.scene;report=[]
groups={}
for obj in scene.objects:
    if obj.type=='MESH':groups.setdefault(obj.data,[]).append(obj)
for original,users in groups.items():
    faces=len(original.polygons)
    limit=55000 if 'island_tree' in original.name else 18000 if faces>100000 else 5000 if len(users)>30 else 12000 if len(users)>10 else faces
    if faces<=limit:continue
    obj=users[0];obj.data=original.copy()
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    mod=obj.modifiers.new('Runtime scan LOD','DECIMATE');mod.ratio=limit/faces
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for other in users:other.data=obj.data
    report.append({'mesh':original.name,'before':faces,'after':len(obj.data.polygons),'instances':len(users)})
    print('OPTIMIZED',report[-1],flush=True)
for image in bpy.data.images:
    if not image.size[0]:continue
    factor=min(1,2048/max(image.size));image.scale(round(image.size[0]*factor),round(image.size[1]*factor))
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if obj.type=='MESH' and obj.location.z>-1000:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/farm-world.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=88,export_image_quality=88)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Farm_World_GameReady.blend'))
(ROOT/'docs/farm-optimization.json').write_text(json.dumps(report,indent=2))
