"""Offline review renders for the harvest chalice.

Renders what the shipped GLB actually contains — same meshes, same materials, same alpha-blended
crystal the engine will draw. Nothing is beautified for the render.

  art/harvest-chalice-hero.png     3/4 hero shot at 60% juice with incoming droplets
  art/harvest-chalice-ladder.png   the five authored fill levels side by side

Run: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/render-harvest-chalice-review.py
"""
import bpy, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'art/blender/Harvest_Chalice.blend'))
scene = bpy.context.scene
chalice = bpy.data.objects['HarvestChalice']
juice = bpy.data.objects['ChaliceJuice']
droplet = bpy.data.objects['ChaliceDroplet']


def set_fill(obj, fraction):
    """Same ladder the runtime module uses: blend the two neighbouring authored levels."""
    keys = obj.data.shape_keys.key_blocks
    p = max(0., min(1., fraction)) * (len(keys) - 1)
    k = min(len(keys) - 2, int(p))
    u = p - k
    for block in keys[1:]:
        block.value = 0.
    if k == 0:
        keys[1].value = u
    else:
        keys[k].value = 1. - u
        keys[k + 1].value = u


def look_at(camera, target):
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()


def stage():
    world = bpy.data.worlds.new('Chalice review sky')
    scene.world = world
    world.use_nodes = True
    background = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    background.inputs[0].default_value = (.055, .062, .075, 1.)
    background.inputs[1].default_value = 1.15

    key = bpy.data.lights.new('Review key', 'AREA'); key.energy = 260; key.size = 1.9
    key.color = (1., .92, .82)
    obj = bpy.data.objects.new('Review key', key); scene.collection.objects.link(obj)
    obj.location = (2.6, -3.1, 3.4); look_at(obj, Vector((0, 0, 1.)))

    rim = bpy.data.lights.new('Review rim', 'AREA'); rim.energy = 120; rim.size = 1.8
    rim.color = (.72, .82, 1.)
    obj = bpy.data.objects.new('Review rim', rim); scene.collection.objects.link(obj)
    obj.location = (-3.0, 2.2, 2.2); look_at(obj, Vector((0, 0, 1.)))

    fill = bpy.data.lights.new('Review bounce', 'AREA'); fill.energy = 45; fill.size = 3.
    obj = bpy.data.objects.new('Review bounce', fill); scene.collection.objects.link(obj)
    obj.location = (0., -2.4, .2); look_at(obj, Vector((0, 0, .8)))

    floor = bpy.data.meshes.new('Review floor')
    floor.from_pydata([(-9, -9, 0), (9, -9, 0), (9, 9, 0), (-9, 9, 0)], [], [(0, 1, 2, 3)])
    obj = bpy.data.objects.new('Review floor', floor); scene.collection.objects.link(obj)
    obj.is_shadow_catcher = True

    camera_data = bpy.data.cameras.new('Review camera')
    camera = bpy.data.objects.new('Review camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    # Standard, not AgX: the review must show the albedo the engine will sample, not a film curve.
    try:
        scene.view_settings.view_transform = 'Standard'
    except TypeError:
        pass
    return camera, camera_data


camera, camera_data = stage()


def render(path, width, height):
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(ROOT / 'art' / path)
    bpy.ops.render.render(write_still=True)
    print('rendered', path)


# --- hero: 3/4 elevated view, 60% juice, droplets arcing in ------------------------------------
set_fill(juice, .6)
rim = bpy.data.objects['ChaliceRimAnchor'].location.z
for index, (angle, distance, height, scale) in enumerate(
        [(.55, .95, .68, 1.), (.85, .62, .42, .8), (1.15, .34, .2, .62), (1.45, .12, .05, .45)]):
    copy = droplet.copy(); copy.data = droplet.data
    scene.collection.objects.link(copy)
    copy.parent = chalice
    copy.location = (math.cos(angle) * distance, math.sin(angle) * distance, rim + height)
    copy.scale = (scale, scale, scale)
    copy.rotation_euler = (math.radians(14 + index * 6), 0, angle)
droplet.hide_render = True
camera_data.type = 'PERSP'; camera_data.lens = 62
camera.location = (2.90, -3.60, 1.78)
look_at(camera, Vector((0, 0, .84)))
render('harvest-chalice-hero.png', 1000, 1250)

# --- ladder: the five authored fill levels, plus empty, in one orthographic strip ---------------
for obj in [o for o in scene.objects if o.name.startswith('ChaliceDroplet.')]:
    bpy.data.objects.remove(obj, do_unlink=True)
STEPS = [0., .25, .5, .75, 1.]
SPACING = 1.5
for index, fraction in enumerate(STEPS):
    copy_juice = None
    group = bpy.data.objects.new(f'Ladder {index}', None)
    scene.collection.objects.link(group)
    group.location = ((index - (len(STEPS) - 1) / 2) * SPACING, 0, 0)
    for source in (bpy.data.objects['ChaliceCrystalBowl'], bpy.data.objects['ChaliceBrassFrame'], juice):
        copy = source.copy()
        copy.data = source.data.copy()
        scene.collection.objects.link(copy)
        copy.parent = group
        if source is juice:
            copy_juice = copy
    set_fill(copy_juice, fraction)
for name in ('ChaliceCrystalBowl', 'ChaliceBrassFrame', 'ChaliceJuice'):
    bpy.data.objects[name].hide_render = True
camera_data.type = 'ORTHO'
camera_data.ortho_scale = SPACING * len(STEPS) + .5
camera.location = (0, -12, .85)
look_at(camera, Vector((0, 0, .85)))
render('harvest-chalice-ladder.png', 1800, 620)
