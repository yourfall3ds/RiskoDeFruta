"""Doorway render of every barn interior, for eyes-on review before the asset ships.

Opens the authored file, drops a camera where the player walks in and a lamp where the runtime
lantern sits, then writes one frame per barn to `art/barn-review/`.

Run: blender --background --python scripts/render-barn-review.py
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'art/barn-review'
OUT.mkdir(parents=True, exist_ok=True)
manifest = json.loads((ROOT / 'public/models/barn-interiors.json').read_text(encoding='utf8'))

bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'art/blender/Barn_Interiors.blend'))
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 960, 600
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('barn-review')
world.use_nodes = True
background = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
background.inputs['Color'].default_value = (.24, .27, .32, 1)
background.inputs['Strength'].default_value = .55
scene.world = world


def pos(x, y, z):
    return Vector((-x, -z, y))


# The per-barn tint ships as glTF `baseColorFactor`, which lives in the Base Color socket value and
# is invisible to EEVEE while a texture is linked. Folding it into a preview-only multiply is what
# makes this render show what the game will actually show.
for material in bpy.data.materials:
    if not material.use_nodes:
        continue
    bsdf = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf or not bsdf.inputs['Base Color'].links:
        continue
    factor = tuple(bsdf.inputs['Base Color'].default_value)
    mix = material.node_tree.nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1
    mix.inputs[2].default_value = factor
    material.node_tree.links.new(bsdf.inputs['Base Color'].links[0].from_socket, mix.inputs[1])
    material.node_tree.links.new(mix.outputs[0], bsdf.inputs['Base Color'])


# Review-only stand-in for the shell the interiors live inside. The real walls and gambrel roof are
# baked into farm-world.glb / farm-city.glb / highland-farms.glb, which are far too heavy to import
# for a preview. These planes exist so occlusion and bounce read the way they will in game; they are
# never exported and never reach the player.
shell_material = bpy.data.materials.new('barn-review-shell')
shell_material.use_nodes = True
next(n for n in shell_material.node_tree.nodes
     if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (.30, .09, .06, 1)


def shell(barn):
    interior, floor = barn['interior'], barn['centre']['y']
    top = interior['ceiling']
    walls = []
    for name, verts in [
        ('floor', [(interior['minX'], floor, interior['minZ']), (interior['maxX'], floor, interior['minZ']),
                   (interior['maxX'], floor, interior['maxZ']), (interior['minX'], floor, interior['maxZ'])]),
        ('roof', [(interior['minX'], top, interior['minZ']), (interior['maxX'], top, interior['minZ']),
                  (interior['maxX'], top, interior['maxZ']), (interior['minX'], top, interior['maxZ'])]),
        ('rear', [(interior['minX'], floor, interior['maxZ']), (interior['maxX'], floor, interior['maxZ']),
                  (interior['maxX'], top, interior['maxZ']), (interior['minX'], top, interior['maxZ'])]),
        ('left', [(interior['minX'], floor, interior['minZ']), (interior['minX'], floor, interior['maxZ']),
                  (interior['minX'], top, interior['maxZ']), (interior['minX'], top, interior['minZ'])]),
        ('right', [(interior['maxX'], floor, interior['minZ']), (interior['maxX'], floor, interior['maxZ']),
                   (interior['maxX'], top, interior['maxZ']), (interior['maxX'], top, interior['minZ'])]),
    ]:
        mesh = bpy.data.meshes.new('shell-' + name)
        mesh.from_pydata([pos(*v) for v in verts], [], [(0, 1, 2, 3)])
        mesh.update()
        mesh.materials.append(shell_material)
        o = bpy.data.objects.new('shell-' + name, mesh)
        scene.collection.objects.link(o)
        walls.append(o)
    return walls


camera_data = bpy.data.cameras.new('barn-review')
camera_data.lens = 20
camera = bpy.data.objects.new('barn-review', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
lamp_data = bpy.data.lights.new('barn-lantern', 'POINT')
lamp_data.energy = 900
lamp_data.shadow_soft_size = .6
lamp = bpy.data.objects.new('barn-lantern', lamp_data)
scene.collection.objects.link(lamp)

meshes = {o.name: o for o in scene.objects if o.type == 'MESH'}
for barn in manifest['barns']:
    for name, o in meshes.items():
        o.hide_render = name != barn['mesh']
    walls = shell(barn)
    lantern = barn['lantern']
    lamp.location = pos(lantern['x'], lantern['y'], lantern['z'])
    lamp_data.color = tuple(int(lantern['color'].lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4))
    centre, interior, door = barn['centre'], barn['interior'], barn['door']
    # Stand in the doorway at eye height and look at the middle of the room.
    eye = pos(centre['x'], centre['y'] + 1.65, door['z'] - 1.2)
    target = pos(centre['x'], centre['y'] + 1.3, (interior['minZ'] + interior['maxZ']) / 2)
    camera.location = eye
    camera.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(OUT / ('barn-' + barn['id'] + '.png'))
    bpy.ops.render.render(write_still=True)
    for o in walls:
        bpy.data.objects.remove(o, do_unlink=True)
    print('BARN REVIEW', barn['id'], scene.render.filepath, flush=True)
print('BARN REVIEW COMPLETE', len(manifest['barns']), flush=True)
