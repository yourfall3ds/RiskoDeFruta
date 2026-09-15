import bpy,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Combat.blend'))
scene=bpy.context.scene;rig=bpy.data.objects['Gunslinger_Rig'];scene.frame_set(1)
rig.animation_data.action=bpy.data.actions['Aim'];rig.animation_data.action_slot=bpy.data.actions['Aim'].slots[0]
bpy.context.view_layer.update()
body=next(o for o in rig.children_recursive if o.type=='MESH')
info={}
for side in ['Right','Left']:
    bone=rig.data.bones[side+'Hand'];inv=bone.matrix_local.inverted();group=body.vertex_groups.get(side+'Hand')
    points=[inv@(rig.matrix_world.inverted()@body.matrix_world@v.co) for v in body.data.vertices if any(g.group==group.index and g.weight>.5 for g in v.groups)]
    info[side]={'head':list(rig.matrix_world@rig.pose.bones[side+'Hand'].head),'tail':list(rig.matrix_world@rig.pose.bones[side+'Hand'].tail),'restMatrix':[list(row) for row in bone.matrix_local],'poseMatrix':[list(row) for row in rig.pose.bones[side+'Hand'].matrix],'bounds':[[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]],'vertices':len(points)}
    existing=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/pistol.glb'))
    for obj in set(scene.objects)-existing:
        if obj.parent is None:obj.location=rig.matrix_world@rig.pose.bones[side+'Hand'].head+Vector((0,-.045,0))
hand=Vector(info['Right']['head']);scene.camera.location=hand+Vector((.65,-.8,.25));scene.camera.rotation_euler=(hand-scene.camera.location).to_track_quat('-Z','Y').to_euler();scene.camera.data.lens=70
scene.render.resolution_x=1200;scene.render.resolution_y=850;scene.cycles.samples=16
scene.render.filepath=str(ROOT/'art/blender/grip-before.png');bpy.ops.render.render(write_still=True)
(ROOT/'docs/grip-inspection.json').write_text(json.dumps(info,indent=2))
