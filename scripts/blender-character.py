import bpy, math, json
from pathlib import Path
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'art/processed/gunslinger-animated.glb'))
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.fps = 30
character = [o for o in scene.objects]
armature = next(o for o in character if o.type == 'ARMATURE')
armature.name = 'Gunslinger_Rig'
for image in bpy.data.images:
    if image.size[0] > 2048 or image.size[1] > 2048:
        factor = 2048 / max(image.size)
        image.scale(round(image.size[0] * factor), round(image.size[1] * factor))
for material in bpy.data.materials:
    if material.use_nodes:
        bsdf = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            bsdf.inputs['Metallic'].default_value = 0.12
            bsdf.inputs['Roughness'].default_value = 0.62
            bsdf.inputs['Emission Strength'].default_value = 0.18
            bsdf.inputs['Specular IOR Level'].default_value = 0.38
for o in character:
    if o.type == 'MESH':
        for poly in o.data.polygons: poly.use_smooth = True
actions = []
for action in bpy.data.actions:
    action.use_fake_user = True
    actions.append({'name':action.name,'frames':list(action.frame_range)})
idle = next((a for a in bpy.data.actions if 'Idle' in a.name),None)
if armature.animation_data:
    for track in armature.animation_data.nla_tracks: track.mute = True
    if idle:
        armature.animation_data.action = idle
        if idle.slots: armature.animation_data.action_slot = idle.slots[0]
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
for o in character: o.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/gunslinger.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=93,export_image_quality=93,export_lights=False,export_cameras=False)

def material(name,color,metal=0,rough=.5):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m
floor=material('Studio · graphite',(0.045,0.063,0.08),.3,.32)
bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=1.35,depth=.12,location=(0,0,-.07))
bpy.context.object.name='Inspection_Plinth';bpy.context.object.data.materials.append(floor)
bevel=bpy.context.object.modifiers.new('Machined edge','BEVEL');bevel.width=.03;bevel.segments=3
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.14));bpy.context.object.data.materials.append(floor)

def point_at(obj,position): obj.rotation_euler=(Vector(position)-obj.location).to_track_quat('-Z','Y').to_euler()
for name,loc,energy,color,size in [
    ('Key · warm',(-3,-4,5),600,(1,.83,.65),4),
    ('Fill · cool',(4,-1,3),450,(.45,.72,1),3),
    ('Rim',(0,3,4),800,(.55,1,.78),2)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.color=color;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=loc;point_at(obj,(0,0,.9))
data=bpy.data.cameras.new('Inspection camera');cam=bpy.data.objects.new('Inspection camera',data);scene.collection.objects.link(cam)
cam.location=(2.6,-4.4,2.0);point_at(cam,(0,0,.85));cam.data.lens=55;scene.camera=cam
scene.world=bpy.data.worlds.new('Studio world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.07,.10,.16,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'
        area.spaces.active.shading.type='MATERIAL'
        area.spaces.active.overlay.show_overlays=False
bpy.ops.object.select_all(action='DESELECT')
armature.select_set(True);bpy.context.view_layer.objects.active=armature
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Gunslinger_Inspection.blend'))
(ROOT/'docs/character-blender.json').write_text(json.dumps({'actions':actions,'bones':[b.name for b in armature.data.bones],'meshes':[{'name':o.name,'vertices':len(o.data.vertices),'polygons':len(o.data.polygons)} for o in character if o.type=='MESH'],'images':[{'name':i.name,'size':list(i.size)} for i in bpy.data.images]},indent=2))
scene.render.filepath=str(ROOT/'art/blender/gunslinger-inspection.png')
bpy.ops.render.render(write_still=True)
