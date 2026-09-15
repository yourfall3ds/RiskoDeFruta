import bpy, math, json
from pathlib import Path
from mathutils import Matrix, Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Pistol_Inspection.blend'))
mesh=bpy.data.objects['Gunslinger_Pistol']
bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);bpy.context.view_layer.objects.active=mesh
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
# Source barrel points -X. Bake grip origin, 42 cm length and glTF +Z barrel direction.
transform=Matrix.Scale(.22,4)@Matrix.Rotation(math.pi/2,4,'Z')@Matrix.Translation(Vector((-.58,0,.36)))
mesh.data.transform(transform);mesh.data.update()
for image in bpy.data.images:
    if max(image.size)>2048:
        factor=2048/max(image.size);image.scale(round(image.size[0]*factor),round(image.size[1]*factor))
for material in mesh.data.materials:material.surface_render_method='DITHERED'
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/pistol.glb'),export_format='GLB',use_selection=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=93,export_image_quality=93)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Pistol_GameReady.blend'))
(ROOT/'docs/pistol-mount.json').write_text(json.dumps({'source':'user-supplied GLB','lengthMeters':.418,'gripOrigin':'center of grip, behind trigger','muzzle':[0,.154,.341],'triangles':len(mesh.data.polygons),'textureResolution':2048},indent=2))
