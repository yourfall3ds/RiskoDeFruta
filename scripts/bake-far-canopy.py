import bpy,math,json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/Orchard_Tree_LODs.blend'))
scene=bpy.context.scene
scene.world.node_tree.nodes['Background'].inputs[1].default_value=1.15
parts=[o for o in scene.objects if o.type=='MESH' and o.name.startswith('Orchard_') and o.name.endswith('_near')]
for o in scene.objects:
 if o.type=='MESH':o.hide_render=o not in parts
for o in parts:o.hide_set(False)
points=[o.matrix_world@Vector(c) for o in parts for c in o.bound_box]
low=Vector(tuple(min(p[i] for p in points) for i in range(3)));high=Vector(tuple(max(p[i] for p in points) for i in range(3)))
center=(low+high)/2;size=max(high-low)*1.08
camera=scene.camera;camera.data.type='ORTHO';camera.data.ortho_scale=size;camera.location=center+Vector((0,-size*3,0));camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.cycles.samples=16
scene.render.film_transparent=True;scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.file_format='PNG'
out=ROOT/'public/textures/orchard-canopy-far.png';out.parent.mkdir(exist_ok=True,parents=True);scene.render.filepath=str(out)
bpy.ops.render.render(write_still=True)
(ROOT/'docs/far-canopy-bake.json').write_text(json.dumps({'source':'art/blender/Orchard_Tree_LODs.blend','tier':'near','orthographicSize':size,'boundsMin':list(low),'boundsMax':list(high),'texture':str(out.relative_to(ROOT)),'pixels':512,'bytes':out.stat().st_size},indent=2))
print('CANOPY BAKE READY',flush=True)
