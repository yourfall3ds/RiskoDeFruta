"""Fit rigid weapon sockets to the existing closed glove geometry in the Aim pose."""
import bpy,json
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Combat.blend'))
scene=bpy.context.scene;rig=bpy.data.objects['Gunslinger_Rig']
rig.animation_data.action=bpy.data.actions['Aim'];rig.animation_data.action_slot=bpy.data.actions['Aim'].slots[0];scene.frame_set(1)
bpy.context.view_layer.update()
body=next(o for o in rig.children_recursive if o.type=='MESH')
evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
report={};sockets=[]
for side in ['Right','Left']:
    group=body.vertex_groups[side+'Hand']
    indices=[v.index for v in body.data.vertices if any(g.group==group.index and g.weight>.8 for g in v.groups)]
    points=[evaluated.matrix_world@evaluated.data.vertices[i].co for i in indices]
    low=Vector([min(p[i] for p in points) for i in range(3)]);high=Vector([max(p[i] for p in points) for i in range(3)])
    center=(low+high)*.5
    # Center the grip inside the curled glove, rather than at the wrist joint.
    socket=bpy.data.objects.new(side+'WeaponGrip',None);scene.collection.objects.link(socket)
    socket.parent=rig;socket.parent_type='BONE';socket.parent_bone=side+'Hand'
    bpy.context.view_layer.update();socket.matrix_world=Matrix.Translation(center);bpy.context.view_layer.update()
    sockets.append(socket);report[side]={'bounds':[list(low),list(high)],'center':list(center),'socketWorld':[list(row) for row in socket.matrix_world]}
for image in bpy.data.images:
    if max(image.size)>2048:
        factor=2048/max(image.size);image.scale(round(image.size[0]*factor),round(image.size[1]*factor))
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for obj in rig.children_recursive:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/gunslinger.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=93,export_image_quality=93)
for socket in sockets:
    existing=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/pistol.glb'))
    for obj in set(scene.objects)-existing:
        if obj.parent is None:obj.parent=socket;obj.matrix_basis=Matrix.Identity(4)
right=Vector(report['Right']['center']);scene.camera.location=right+Vector((.60,-.75,.23));scene.camera.rotation_euler=(right-scene.camera.location).to_track_quat('-Z','Y').to_euler();scene.camera.data.lens=70
scene.render.resolution_x=1200;scene.render.resolution_y=850;scene.cycles.samples=16
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Armed.blend'))
scene.render.filepath=str(ROOT/'art/blender/grip-fitted.png');bpy.ops.render.render(write_still=True)
(ROOT/'docs/grip-fit.json').write_text(json.dumps(report,indent=2))
