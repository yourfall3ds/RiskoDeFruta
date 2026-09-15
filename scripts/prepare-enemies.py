"""Optimize existing rigged enemies and render a textured review lineup."""
import bpy, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
report=[]
for species in ['carrot','corn','eggplant']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/f'art/processed/{species}-animated.glb'))
    scene=bpy.context.scene
    for image in bpy.data.images:
        if max(image.size)>2048:
            factor=2048/max(image.size);image.scale(round(image.size[0]*factor),round(image.size[1]*factor))
    for mesh in [o for o in scene.objects if o.type=='MESH']:
        for poly in mesh.data.polygons:poly.use_smooth=True
    rig=next(o for o in scene.objects if o.type=='ARMATURE')
    if rig.animation_data:
        for track in rig.animation_data.nla_tracks:track.mute=True
        action=bpy.data.actions.get('Walk')
        rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
    scene.frame_set(1)
    for action in bpy.data.actions:action.use_fake_user=True
    bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/{species}.glb'),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=90,export_image_quality=90)
    report.append({'species':species,'actions':[a.name for a in bpy.data.actions],'meshes':[{'vertices':len(o.data.vertices),'polygons':len(o.data.polygons),'dimensions':list(o.dimensions)} for o in scene.objects if o.type=='MESH']})
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
for i,species in enumerate(['carrot','corn','eggplant']):
    existing=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{species}.glb'))
    imported=set(scene.objects)-existing
    for obj in imported:
        if obj.parent is None:obj.location.x+=(i-1)*2.4
    rig=next(o for o in imported if o.type=='ARMATURE')
    if rig.animation_data:
        for track in rig.animation_data.nla_tracks:track.mute=True
    scene.frame_set(1)
def point_at(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
scene.world=bpy.data.worlds.new('Inspection world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.11,.15,.21,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
for name,loc,power,size in [('Key',(-3,-4,6),950,5),('Fill',(4,-2,3),700,4),('Rim',(0,3,5),1000,4)]:
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.size=size
    obj=bpy.data.objects.new(name,light);scene.collection.objects.link(obj);obj.location=loc;point_at(obj,(0,0,1))
cam=bpy.data.objects.new('Review camera',bpy.data.cameras.new('Review camera'));scene.collection.objects.link(cam);scene.camera=cam
cam.location=(0,-11,3);point_at(cam,(0,0,1));cam.data.type='ORTHO';cam.data.ortho_scale=7.8
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.render.resolution_x=1500;scene.render.resolution_y=700;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Enemy_Review.blend'))
scene.render.filepath=str(ROOT/'art/blender/enemy-review.png');bpy.ops.render.render(write_still=True)
(ROOT/'docs/enemy-review.json').write_text(json.dumps(report,indent=2))
