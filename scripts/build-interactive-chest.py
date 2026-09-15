import bpy,math
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.render.fps=60

def mat(name,folder,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;b=n['Principled BSDF'];b.inputs['Roughness'].default_value=.73;b.inputs['Metallic'].default_value=metal
 image=n.new('ShaderNodeTexImage');image.image=bpy.data.images.load(str(ROOT/'public/textures'/folder/'Diffuse.jpg'),check_existing=True);l.new(image.outputs[0],b.inputs['Base Color']);return m
wood=mat('Chest worn oak','wood_planks');steel=mat('Chest oxidized iron','rusty_painted_metal',.65)
root=bpy.data.objects.new('InteractiveFarmChest',None);scene.collection.objects.link(root)
hinge=bpy.data.objects.new('ChestLidPivot',None);scene.collection.objects.link(hinge);hinge.parent=root;hinge.location=(0,-.36,.58)
def box(name,location,size,material,parent=root):
 bpy.ops.mesh.primitive_cube_add(size=1,location=location);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 mod=o.modifiers.new('Hand-worn edges','BEVEL');mod.width=.012;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
 o.parent=parent;o.location-=parent.location
 # Cube UVs preserve grain on each board; boards remain separate around the hollow interior.
 return o
box('Chest floor',(0,0,.06),(1,.76,.12),wood)
for i in range(3):
 h=.17+i*.16
 for side in [-1,1]:box('Chest oak wall',(side*.47,0,h),(.08,.76,.15),wood);box('Chest oak wall',(0,side*.34,h),(.88,.08,.15),wood)
for side in [-1,1]:
 for front in [-1,1]:box('Chest corner brace',(side*.49,front*.35,.31),(.075,.065,.52),steel)
for i in range(6):
 x=-.425+i*.17;box('Lid oak plank',(x,0,.61),(.163,.78,.075),wood,hinge)
for x in [-.34,.34]:box('Lid iron strap',(x,0,.66),(.065,.82,.035),steel,hinge)
box('Lid front clasp',(0,.40,.57),(.13,.035,.20),steel,hinge)
box('Chest latch',(0,.395,.45),(.17,.045,.14),steel)
for frame,angle in [(0,0),(8,.04),(40,1.85),(48,1.75)]:hinge.rotation_euler.x=angle;hinge.keyframe_insert(data_path='rotation_euler',frame=frame)
hinge.animation_data.action.name='ChestOpen';scene.frame_start=0;scene.frame_end=48;scene.frame_set(0)
# Two material batches for the box and two for the articulated lid.
for parent in [root,hinge]:
 for material in [wood,steel]:
  objects=[o for o in scene.objects if o.type=='MESH' and o.parent==parent and o.data.materials[0]==material]
  if len(objects)>1:
   bpy.ops.object.select_all(action='DESELECT')
   for o in objects:o.select_set(True)
   bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Interactive_Farm_Chest.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/interactive-chest.glb'),export_format='GLB',export_animations=True,export_frame_range=True,export_force_sampling=True)
