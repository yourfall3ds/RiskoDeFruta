"""Render authored strike contacts from front and profile; no gameplay pose offsets."""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
motion='--motion' in sys.argv
if motion:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'art/processed/gunslinger-motion-review.glb'))
else:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'art/blender/Gunslinger_Combo.blend'))
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
rig.animation_data.use_nla = False
for track in rig.animation_data.nla_tracks:
    track.mute = True
manifest = json.loads((ROOT / 'docs/combo-clip-manifest.json').read_text())
if motion:
    manifest={'clips':[{'clip':a.name,'id':a.name,'contactFrame':a.frame_range[1]*.35,'frames':a.frame_range[1]} for a in bpy.data.actions if 'Recorded' in a.name]}
out = ROOT / ('art/motion-review' if motion else 'art/combo-review')
out.mkdir(parents=True, exist_ok=True)
# Studio floor is only in the offline review, never exported as a game prop.
bpy.ops.mesh.primitive_plane_add(size=200)
floor = bpy.context.object
mat = bpy.data.materials.new('Review floor')
mat.diffuse_color = (.085, .105, .13, 1)
floor.data.materials.append(mat)
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 2.45
scene.camera = camera
for location, power in [((2, -4, 5), 650), ((-3, -1, 3), 450), ((1, 3, 4), 700)]:
    bpy.ops.object.light_add(type='AREA', location=location)
    light = bpy.context.object
    light.data.energy = power
    light.data.shape = 'DISK'
    light.data.size = 4
    light.rotation_euler = (Vector((0, 0, 1)) - light.location).to_track_quat('-Z', 'Y').to_euler()
scene.world = bpy.data.worlds.new('Combo review studio')
scene.world.color = (.18, .18, .18)
scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.cycles.use_denoising = True
scene.render.resolution_x = 384
scene.render.resolution_y = 480
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
for entry in manifest['clips']:
    action = bpy.data.actions[entry['clip']]
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    for phase, frame in [('guard', 1), ('contact', entry['contactFrame']), ('recover', entry['frames'] - 8)]:
        scene.frame_set(round(frame))
        for view, location in [('front', (0, -5, 1.7)), ('side', (5, -.3, 1.7))]:
            camera.location = location
            camera.rotation_euler = (Vector((0, 0, .9)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = str(out / f"{entry['id']}-{phase}-{view}.png")
            bpy.ops.render.render(write_still=True)
print('COMBO REVIEW RENDERED', out, flush=True)
