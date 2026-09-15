"""Prepare supplied mutants and author textured botanical variants in Blender."""
import bpy,math,random,struct,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
def clear():bpy.ops.wm.read_factory_settings(use_empty=True)
def import_mesh(path,name,height):
    before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(path));objects=list(set(bpy.context.scene.objects)-before)
    bpy.context.view_layer.update();depsgraph=bpy.context.evaluated_depsgraph_get();meshes=[]
    eligible=[o for o in objects if o.type=='MESH' and any(m and m.use_nodes and any(n.type=='TEX_IMAGE' for n in m.node_tree.nodes) for m in o.data.materials)]
    if path.stem=='bananas':eligible=[max(eligible,key=lambda o:o.dimensions.z)]
    for original in eligible:
        evaluated=original.evaluated_get(depsgraph);mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=depsgraph)
        baked=bpy.data.objects.new(name+' baked',mesh);bpy.context.scene.collection.objects.link(baked);baked.matrix_world=original.matrix_world.copy();meshes.append(baked)
    for original in objects:bpy.data.objects.remove(original,do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:o.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]
    if len(meshes)>1:bpy.ops.object.join()
    obj=bpy.context.object
    obj.parent=None;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    corners=[v.co for v in obj.data.vertices];lo=Vector([min(v[i] for v in corners) for i in range(3)]);hi=Vector([max(v[i] for v in corners) for i in range(3)])
    for v in obj.data.vertices:v.co=(v.co-Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z)))*height/max(.01,hi.z-lo.z)
    obj.location=(0,0,0);obj.name=name
    if len(obj.data.polygons)>16000:
        mod=obj.modifiers.new('Game silhouette budget','DECIMATE');mod.ratio=16000/len(obj.data.polygons);bpy.ops.object.modifier_apply(modifier=mod.name)
    for face in obj.data.polygons:face.use_smooth=True
    return obj
def export(name):
    for image in bpy.data.images:
        if image.size[0]:
            f=min(1,2048/max(image.size));image.scale(round(image.size[0]*f),round(image.size[1]*f))
    for action in bpy.data.actions:action.use_fake_user=True
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if not obj.hide_render and not obj.hide_get():obj.select_set(True)
    path=ROOT/f'public/models/{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_image_format='JPEG',export_jpeg_quality=88)
    blob=path.read_bytes();length=struct.unpack_from('<I',blob,12)[0];data=json.loads(blob[20:20+length]);binary=blob[20+length:]
    for material in data.get('materials',[]):
        if 'Botanical floret' in material.get('name',''):material.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=[.24,.64,.055,1]
    chunk=json.dumps(data,separators=(',',':')).encode();chunk+=b' '*((-len(chunk))%4)
    path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(chunk)+len(binary))+struct.pack('<II',len(chunk),0x4e4f534a)+chunk+binary)
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(ROOT/f'public/models/{name}.glb'))
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'art/blender/Mutant_{name}.blend'),compress=True)
    print('ROSTER READY',name,flush=True)
for name,file,height in [('tomato','Meshy_AI_Character_output.glb',1.8),('watermelon','melancia-Meshy_AI_Character_output (1).glb',2.1)]:
    clear();import_mesh(ROOT/'assets'/file,name,height);export(name)
# Botanical crowns are meshes with photographic bark/leaf materials and displaced silhouettes.
def crown_material():
    m=bpy.data.materials.new('Botanical floret skin');m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;bs=n.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.17,.36,.025,1);bs.inputs['Roughness'].default_value=.8
    tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'public/textures/rock_face_03/nor_gl.jpg'));tex.image.colorspace_settings.name='Non-Color';normal=n.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.6;l.new(tex.outputs['Color'],normal.inputs['Color']);l.new(normal.outputs[0],bs.inputs['Normal'])
    diffuse=n.new('ShaderNodeTexImage');diffuse.image=bpy.data.images.load(str(ROOT/'public/textures/wood_planks/Diffuse.jpg'));l.new(diffuse.outputs['Color'],bs.inputs['Base Color'])
    return m
for name in ['broccoli','lettuce','banana']:
    clear();bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/eggplant.glb'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    skin=bpy.data.images.load(str(ROOT/f"public/textures/mutant-skins/{'banana' if name=='banana' else 'green'}.png"))
    for material in bpy.data.materials:
        if not material.use_nodes:continue
        bs=material.node_tree.nodes.get('Principled BSDF')
        if bs and bs.inputs['Base Color'].links:
            source=bs.inputs['Base Color'].links[0].from_node
            if source.type=='TEX_IMAGE':source.image=skin
    if rig.animation_data:
        for track in rig.animation_data.nla_tracks:track.mute=True
    bpy.context.scene.frame_set(1)
    if name=='banana':
        fruit=import_mesh(ROOT/'art/source/bananas/bananas.gltf','Banana crest',1.4);fruit.location=(0,.12,1.0);fruit.scale=(.72,.72,1);bpy.context.view_layer.update();matrix=fruit.matrix_world.copy();fruit.parent=rig;fruit.matrix_world=matrix
    else:
        mat=crown_material();random.seed(42)
        for i in range(24 if name=='broccoli' else 12):
            angle=i*2.39996;r=.52*math.sqrt((i+1)/24) if name=='broccoli' else .58
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3,radius=.29 if name=='broccoli' else .42,location=(math.cos(angle)*r,math.sin(angle)*r,1.6+(.34*(1-r) if name=='broccoli' else 0)))
            obj=bpy.context.object;obj.name='Floret' if name=='broccoli' else 'Cabbage leaf';obj.scale=(1,1,.85) if name=='broccoli' else (.55,1.25,.3);obj.rotation_euler=(.3,math.sin(angle)*.7,angle);obj.data.materials.append(mat)
            mod=obj.modifiers.new('Organic relief','DISPLACE');texture=bpy.data.textures.new('Plant relief',type='CLOUDS');texture.noise_scale=.09;mod.texture=texture;mod.strength=.06;bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.sphere_project();bpy.ops.object.mode_set(mode='OBJECT')
            matrix=obj.matrix_world.copy();obj.parent=rig;obj.matrix_world=matrix
    export(name)
# Multi-fruit boss: rigged corn core, winged tomato mantle, melon armor and banana crown.
clear();bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/corn.glb'));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.scale*=2.5
if rig.animation_data:
    for track in rig.animation_data.nla_tracks:track.mute=True
bpy.context.scene.frame_set(1)
for side in [-1,1]:
    shoulder=import_mesh(ROOT/'public/models/watermelon.glb',f'Melon shoulder {side}',1.5);shoulder.location=(side*1.45,.2,3.5)
head=import_mesh(ROOT/'public/models/tomato.glb','Alfa fruit mantle',2.4);head.location=(0,-.1,4.1)
crown=import_mesh(ROOT/'art/source/bananas/bananas.gltf','Alfa banana crown',1.8);crown.location=(0,.1,5.5)
export('boss')
