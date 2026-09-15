"""Build material-aware orchard LODs and identical-camera review renders from the original tree."""
import bpy,math,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene
source=(ROOT/'scripts/build-farm-world.py').read_text(encoding='utf-8-sig');exec(source[source.index('def load_asset('):source.index('assets={')])
tree,dims=load_asset('island_tree_01');tree.location=(0,0,0)
bpy.ops.object.select_all(action='DESELECT');tree.select_set(True);bpy.context.view_layer.objects.active=tree;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='MATERIAL');bpy.ops.object.mode_set(mode='OBJECT')
parts=list(bpy.context.selected_objects)
for o in parts:o.name='Tree_'+o.data.materials[0].name
camera_data=bpy.data.cameras.new('Review camera');camera=bpy.data.objects.new('Review camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera
height=dims.z;camera.location=(height*1.6,-height*2.5,height*.95);target=Vector((0,0,height*.5));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=max(dims.x,dims.y,height)*1.15
world=bpy.data.worlds.new('Review sky');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.75,1,1);world.node_tree.nodes['Background'].inputs[1].default_value=.6;scene.world=world
light_data=bpy.data.lights.new('Warm sun','SUN');light_data.energy=2.2;light_data.angle=.1;light=bpy.data.objects.new('Warm sun',light_data);scene.collection.objects.link(light);light.rotation_euler=(math.radians(25),math.radians(-20),math.radians(-30))
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=8;scene.cycles.use_denoising=True
scene.render.resolution_x=768;scene.render.resolution_y=768;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
folder=ROOT/'art/tree-lod-review';folder.mkdir(exist_ok=True,parents=True)
scene.render.filepath=str(folder/'original.png');bpy.ops.render.render(write_still=True)
report={};outputs={}
for tier,budgets in [('near',dict(leaves=80000,branches=14000,trunk=4000)),('medium',dict(leaves=22000,branches=4500,trunk=1400))]:
 copies=[];counts={}
 for original in parts:
  o=original.copy();o.data=original.data.copy();scene.collection.objects.link(o);o.hide_render=False;o.hide_set(False);copies.append(o)
  material=o.data.materials[0].name;kind='leaves' if 'leaves' in material else 'branches' if 'branches' in material else 'trunk';target_count=budgets[kind]
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  if len(o.data.polygons)>target_count:
   mod=o.modifiers.new('Preserve '+kind,'DECIMATE');mod.ratio=target_count/len(o.data.polygons);bpy.ops.object.modifier_apply(modifier=mod.name)
  o.data.calc_loop_triangles();counts[kind]=len(o.data.loop_triangles);o.name='Orchard_'+kind+'_'+tier;o.select_set(False)
 for o in parts:o.hide_render=True;o.hide_set(True)
 bpy.ops.object.select_all(action='DESELECT')
 for o in copies:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/orchard-tree-{tier}.glb'),export_format='GLB',use_selection=True,export_animations=False)
 scene.render.filepath=str(folder/(tier+'.png'));bpy.ops.render.render(write_still=True)
 report[tier]=counts;outputs[tier]=copies
 for o in copies:o.hide_render=True;o.hide_set(True)
for o in outputs['near']:o.hide_set(False);o.hide_render=False
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/Orchard_Tree_LODs.blend'),compress=True)
report['dimensions']=list(dims);(ROOT/'docs/tree-lod-budget.json').write_text(json.dumps(report,indent=2));print('TREE LOD REVIEW READY',report,flush=True)
