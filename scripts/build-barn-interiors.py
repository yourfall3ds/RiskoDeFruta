"""Authored interiors for the five walk-in barns. One kit, five different buildings.

The barn SHELLS already exist and are untouched: they were baked into `farm-world.glb`,
`farm-city.glb` and `highland-farms.glb` by scripts whose scan sources (`art/source/`) no longer
live in the clone, so those files cannot be regenerated. The interiors therefore ship as a
SEPARATE, additive asset (`public/models/barn-interiors.glb`) dropped into the empty rooms those
shells already enclose. Nothing existing is re-encoded and no world is rebuilt.

Variety comes from three layers, not from colour alone:
  1. a different set of kit props per barn (harvest store / granary / workshop / cellar / rope loft),
  2. a different floor plan, and
  3. a per-barn material palette — each barn owns tinted copies of the kit materials.

Props are Quaternius "Fantasy Props MegaKit" (CC0); see docs/ASSET_LICENSES.md. The kit is read
from `art/source/fantasy-props` and, when absent there, mirrored once from `BARN_PROP_KIT`
(default: the local Transformice asset drop). The source project is only ever READ.

Outputs:
  public/models/barn-interiors.glb   one merged mesh per barn
  public/models/barn-interiors.json  manifest: rooms, palettes, lanterns, colliders, chest spots

Run: blender --background --python scripts/build-barn-interiors.py
"""
import bpy, json, math, os, shutil
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
KIT_LOCAL = ROOT / 'art/source/fantasy-props'
KIT_SOURCE = Path(os.environ.get(
    'BARN_PROP_KIT',
    r'C:/Users/darck/transformice/assets/itens 3d/Assets baixados novos/Fantasy Props MegaKit[Standard]/Exports/glTF',
))

# ---------------------------------------------------------------------------------------------
# Rooms. Every bound below is READ from the shipped collision data, not invented: the walls are the
# `Barn side wall` / `Barn rear wall` / `Barn facade` boxes, and the floor height was probed with
# the game's own CollisionWorld. `door` is the gap the two facade halves leave open.
# ---------------------------------------------------------------------------------------------
ROOMS = [
    dict(id='campo', name='Celeiro do Campo', region='base', collision='farm-collision',
         floor=5.0, minX=-7.35, maxX=7.35, minZ=29.13, maxZ=40.87, doorMinX=-3.45, doorMaxX=3.45,
         ceiling=13.10, palette=dict(furniture='#d8c39a', metal='#b9c0c4', props='#e4d9b4',
                                     cloth='#7fb8e6', sack='#c9b489', lantern='#ffd08a')),
    dict(id='sementes', name='Depósito de Sementes', region='farm-city', collision='farm-city-collision',
         floor=2.015, minX=91.91, maxX=108.09, minZ=6.93, maxZ=23.07, doorMinX=96.20, doorMaxX=103.80,
         ceiling=11.90, palette=dict(furniture='#b59b63', metal='#c2b88a', props='#d8dfae',
                                     cloth='#4f9d63', sack='#b8a76a', lantern='#ffe3a0')),
    dict(id='solar', name='Oficina Solar', region='farm-city', collision='farm-city-collision',
         floor=12.015, minX=96.91, maxX=113.09, minZ=70.93, maxZ=87.07, doorMinX=101.20, doorMaxX=108.80,
         ceiling=21.90, palette=dict(furniture='#8f9aa8', metal='#9fb6c9', props='#cfd6dd',
                                     cloth='#e07a32', sack='#9aa0a6', lantern='#ff9a4d')),
    dict(id='colheita', name='Adega da Colheita', region='farm-city', collision='farm-city-collision',
         floor=7.015, minX=151.91, maxX=168.09, minZ=43.93, maxZ=60.07, doorMinX=156.20, doorMaxX=163.80,
         ceiling=16.90, palette=dict(furniture='#8f5340', metal='#c9a24a', props='#e0b878',
                                     cloth='#7d2740', sack='#a8886a', lantern='#ffc06a')),
    dict(id='altos', name='Celeiro dos Campos Altos', region='highland-farms', collision='highland-farms-collision',
         floor=23.057, minX=484.92, maxX=501.08, minZ=299.93, maxZ=316.07, doorMinX=489.21, doorMaxX=496.79,
         ceiling=32.96, palette=dict(furniture='#9a8f7a', metal='#a7a29a', props='#d5c9a8',
                                     cloth='#d9a326', sack='#bfae86', lantern='#ffdca0')),
]
for room in ROOMS:
    room['cx'] = (room['minX'] + room['maxX']) / 2
    room['cz'] = (room['minZ'] + room['maxZ']) / 2

# Free corridor from the doorway to the far wall. Nothing solid may stand in it and the chest spots
# sit on it, so a 0.4 m player capsule always has a straight way in and back out.
AISLE_HALF_WIDTH = 1.9
# Warm point light per barn, driven at runtime by src/world/BarnInteriors.ts.
LANTERN_HEIGHT = 3.4


def P(prop, dx, dz, yaw=0.0, dy=0.0, solid=True):
    """One prop, positioned RELATIVE to the room centre so a layout reads as a floor plan."""
    return dict(prop=prop, dx=dx, dz=dz, yaw=yaw, dy=dy, solid=solid)


# ---------------------------------------------------------------------------------------------
# Floor plans. Offsets are metres from the room centre; +Z is deeper into the barn and the door is
# at -Z. `yaw` 0 faces the door, +90 faces +X, 180 faces the rear wall.
# ---------------------------------------------------------------------------------------------
LAYOUTS = {
    # Small home barn (14.7 x 11.7): the harvest store the player walks past on every run.
    'campo': [
        P('Barrel', -5.6, -3.2), P('Barrel', -5.6, -2.3), P('Barrel_Apples', -5.6, -1.4, 20),
        P('Crate_Wooden', -5.5, 0.6, -12), P('Crate_Wooden', -5.5, 0.6, 8, dy=.931),
        P('Crate_Wooden', -5.4, 2.0, 25),
        P('FarmCrate_Carrot', -5.8, 4.6, 6), P('FarmCrate_Apple', -5.8, 4.6, -8, dy=0.42, solid=False),
        P('Workbench', 5.6, -2.6, -90), P('Bucket_Wooden_1', 4.1, -1.3), P('Bucket_Metal', 4.5, -0.6, 40),
        P('Shelf_Simple', 7.0, 0.8, -90, dy=1.75, solid=False),
        P('FarmCrate_Empty', 5.8, 2.2, -80), P('FarmCrate_Carrot', 5.8, 3.4, -95),
        P('Cage_Small', 5.4, 4.6, 150),
        P('Table_Large', -3.4, 4.7, 180), P('Pot_1', -3.9, 4.7, 0, dy=0.82, solid=False),
        P('Mug', -2.9, 4.6, 30, dy=0.82, solid=False),
        P('Bag', 2.6, 5.0, -20), P('Pouch_Large', 3.2, 4.6, 40, solid=False),
        P('Rope_2', -4.4, 3.2, 15, solid=False), P('Rope_1', 4.6, -3.4, -30, solid=False),
        # Second rank off the walls, so the middle of the room is dressed without closing the aisle.
        P('Crate_Wooden', -3.6, -4.2, 18), P('Barrel', 3.4, -4.4), P('Barrel', 4.1, -3.9, 30),
        P('Bucket_Wooden_1', -3.2, -2.8), P('Stool', 3.0, 1.2), P('Bag', -3.4, 1.0, 25),
        P('Lantern_Wall', -1.6, 5.0, 0, dy=3.1, solid=False),
        P('Lantern_Wall', 1.6, 5.0, 0, dy=3.1, solid=False),
        P('Banner_1', -3.0, 5.6, 0, dy=4.3, solid=False),
        P('Banner_1', 3.0, 5.6, 0, dy=4.3, solid=False),
    ],
    # City granary (16.2 x 16.1): shelves, sacks, seed crates and an empty market stall.
    'sementes': [
        P('Shelf_Arch', -7.6, -3.0, 90), P('Shelf_Small_Bottles', -7.7, -1.2, 90, dy=1.35, solid=False),
        P('Cabinet', -7.6, 0.4, 90), P('Bookcase_2', -7.6, 2.6, 90),
        P('Barrel', -5.8, 5.0), P('Barrel', -5.0, 5.6, 25), P('Barrel_Apples', -6.2, 6.0, -15),
        P('FarmCrate_Carrot', 7.2, -5.2, -90), P('FarmCrate_Apple', 7.2, -5.2, -95, dy=0.42, solid=False),
        P('FarmCrate_Empty', 7.2, -3.9, -85), P('FarmCrate_Carrot', 7.2, -2.6, -95),
        P('FarmCrate_Apple', 7.2, -2.6, -80, dy=0.42, solid=False),
        P('Crate_Wooden', 6.8, -0.8, 12), P('Crate_Wooden', 6.8, 0.6, -8),
        P('Crate_Wooden', 6.8, -0.8, 30, dy=1.12, solid=False),
        P('Workbench', 4.2, 6.6, 180), P('SmallBottles_1', 4.0, 6.4, 0, dy=0.90, solid=False),
        P('Vase_2', 5.9, 6.4), P('Bag', -2.4, 6.6, -15), P('Bag', -1.5, 7.0, 30),
        P('Pouch_Large', -3.0, 6.2, 0, solid=False),
        P('Stall_Empty', -5.4, -6.0, 60), P('Stool', -2.6, -4.0),
        P('Vase_Rubble_Medium', 3.0, -6.4, -40, solid=False),
        # Second rank off the walls, so the middle of the room is dressed without closing the aisle.
        P('Crate_Wooden', -3.8, 2.4, -20), P('Crate_Wooden', -3.8, 3.6, 14),
        P('Crate_Wooden', -3.8, 2.4, 5, dy=1.12, solid=False),
        P('Barrel', 3.6, 2.6), P('Barrel', 4.3, 3.2, 40), P('Barrel_Apples', 3.9, 4.0, -20),
        P('FarmCrate_Carrot', -3.6, -1.6, 12), P('FarmCrate_Apple', -3.6, -1.6, -5, dy=0.42, solid=False),
        P('Bag', 3.4, -2.2, 10), P('Pouch_Large', 4.0, -1.7, 0, solid=False),
        P('Torch_Metal', -2.6, 7.2, 0, dy=2.9, solid=False), P('Torch_Metal', 2.6, 7.2, 0, dy=2.9, solid=False),
        P('Banner_2', -4.2, 7.3, 0, dy=4.1, solid=False), P('Banner_2', 4.2, 7.3, 0, dy=4.1, solid=False),
    ],
    # City workshop: forge corner, bench wall, tool racks. Reads cold and metallic.
    'solar': [
        P('Anvil_Log', -5.2, -4.6, 35), P('Anvil', -5.2, -4.6, 35, dy=1.06, solid=False),
        P('Whetstone', -3.2, -4.2, -20), P('WeaponStand', -6.8, -2.2, 90),
        P('Dummy', -6.2, 5.4, 160), P('Cauldron', -5.6, 1.2),
        P('Workbench', 6.8, -4.4, -90), P('Workbench', 6.8, -1.8, -90),
        P('Peg_Rack', 7.9, -3.1, -90, dy=2.2, solid=False),
        P('Crate_Metal', 6.9, 0.6, 14), P('Crate_Metal', 6.9, 1.7, -10),
        P('Crate_Metal', 6.9, 0.6, 40, dy=0.86, solid=False),
        P('Bucket_Metal', 4.9, 2.9), P('Chain_Coil', 5.4, 4.2, 25, solid=False),
        P('Table_Large', 2.0, 6.7, 180), P('Bottle_1', 1.4, 6.6, 0, dy=0.82, solid=False),
        P('Mug', 2.6, 6.5, -25, dy=0.82, solid=False),
        P('Bench', -2.4, 6.6, 180), P('Stool', -4.0, 4.4),
        P('Crate_Wooden', -6.8, -6.2, -16), P('Bag', 5.6, -6.4, 20),
        # Second rank off the walls, so the middle of the room is dressed without closing the aisle.
        P('Crate_Metal', -3.6, 2.6, 20), P('Crate_Metal', -3.6, 3.7, -12),
        P('Barrel', 3.6, 3.0), P('Bucket_Metal', 4.2, 3.8),
        P('Crate_Wooden', 3.6, -3.4, -18), P('Bag', -3.6, -1.4, 15), P('Stool', -3.2, 2.0),
        P('Torch_Metal', -3.0, 7.2, 0, dy=2.9, solid=False), P('Torch_Metal', 3.0, 7.2, 0, dy=2.9, solid=False),
        P('Torch_Metal', -7.9, 0.0, 90, dy=2.9, solid=False),
        P('Banner_1', -4.6, 7.3, 0, dy=4.3, solid=False), P('Banner_1', 4.6, 7.3, 0, dy=4.3, solid=False),
    ],
    # City cellar: barrel racks, a long table under a chandelier, a parked market cart.
    'colheita': [
        P('Barrel_Holder', -7.0, -4.6, 90), P('Barrel', -7.0, -4.6, 0, dy=1.22, solid=False),
        P('Barrel_Holder', -7.0, -2.8, 90), P('Barrel_Apples', -7.0, -2.8, 15, dy=1.22, solid=False),
        P('Barrel_Holder', -7.0, -1.0, 90), P('Barrel', -7.0, -1.0, -20, dy=1.22, solid=False),
        P('Barrel', -6.2, 1.2), P('Barrel_Apples', -6.0, 2.2, 30), P('Barrel', -6.6, 3.2, -15),
        P('Table_Large', 4.6, 1.0, -90), P('Bench', 3.2, 1.0, -90), P('Bench', 6.0, 1.0, 90),
        P('Table_Plate', 4.6, 0.0, 0, dy=0.82, solid=False), P('Table_Plate', 4.6, 1.8, 0, dy=0.82, solid=False),
        P('Mug', 4.2, 0.6, 0, dy=0.82, solid=False), P('Bottle_1', 5.0, 1.4, 0, dy=0.82, solid=False),
        P('CandleStick', 4.6, 0.9, 0, dy=0.82, solid=False),
        P('Stool', 6.9, -1.4), P('Stool', 3.0, 3.0),
        P('Stall_Cart_Empty', 5.2, -5.6, -70),
        P('Cauldron', -3.0, 6.6), P('Pot_1', -4.2, 6.6, 0, solid=False),
        P('Cabinet', 2.4, 6.9, 180), P('Vase_2', 0.6, 6.9),
        # Second rank off the walls, so the middle of the room is dressed without closing the aisle.
        P('Barrel_Holder', -3.8, -4.0, 0), P('Barrel', -3.8, -4.0, 10, dy=1.22, solid=False),
        P('Barrel', -3.6, 3.4), P('Barrel_Apples', -4.4, 4.0, 25),
        P('Crate_Wooden', 3.4, 4.6, -15), P('Stool', -3.0, 0.4),
        P('Pot_1', 3.0, -3.4, 0, solid=False),
        P('Chandelier', 0.0, 0.0, 0, dy=8.2, solid=False),
        P('Banner_2', -3.2, 7.3, 0, dy=4.1, solid=False), P('Banner_2', 3.2, 7.3, 0, dy=4.1, solid=False),
        P('Lantern_Wall', -7.4, 2.0, 90, dy=3.1, solid=False),
    ],
    # Highland rope loft: cages, coils and stacked crates against bare slate walls.
    'altos': [
        P('Crate_Wooden', -6.8, -4.8, 10), P('Crate_Wooden', -6.8, -3.5, -14),
        P('Crate_Wooden', -6.8, -4.8, 28, dy=1.12, solid=False),
        P('Cage_Small', -6.8, -1.8, 120), P('Cage_Small', -6.8, -0.8, -40, dy=0.80, solid=False),
        P('Barrel', -6.4, 1.2), P('Barrel', -5.6, 1.8, 20), P('Barrel_Apples', -6.6, 2.6, -25),
        P('Nightstand_Shelf', -7.6, 5.4, 90), P('Bucket_Wooden_1', -5.0, 5.8),
        P('Rope_3', 6.4, -4.6, 15, solid=False), P('Rope_2', 5.2, -3.6, -30, solid=False),
        P('Rope_1', 6.8, -2.4, 40, solid=False), P('Chain_Coil', 5.4, -1.2, 10, solid=False),
        P('Peg_Rack', 7.9, -3.0, -90, dy=2.2, solid=False),
        P('FarmCrate_Empty', 7.2, 0.6, -85), P('FarmCrate_Carrot', 7.2, 1.9, -95),
        P('FarmCrate_Apple', 7.2, 1.9, -80, dy=0.42, solid=False),
        P('Bag', 5.8, 4.2, -20), P('Bag', 6.4, 5.2, 25), P('Pouch_Large', 5.0, 4.8, 0, solid=False),
        P('Shelf_Simple', 7.9, 6.2, -90, dy=1.75, solid=False),
        P('Table_Large', -2.6, 6.9, 180), P('Vase_4', -3.4, 6.8, 0, dy=0.82, solid=False),
        P('Stool', -2.6, 4.0),
        # Second rank off the walls, so the middle of the room is dressed without closing the aisle.
        P('Crate_Wooden', -3.8, -1.0, 22), P('Crate_Wooden', -3.8, 0.2, -10),
        P('Barrel', 3.6, 2.2), P('Barrel', 4.3, 2.8, 35), P('Cage_Small', -3.6, 2.6, 60),
        P('Bag', 3.4, -5.4, -18), P('Bucket_Metal', -3.2, -5.6),
        P('Lantern_Wall', -2.0, 7.0, 0, dy=3.1, solid=False),
        P('Lantern_Wall', 2.0, 7.0, 0, dy=3.1, solid=False),
        P('Banner_1', -4.4, 7.3, 0, dy=4.3, solid=False), P('Banner_1', 4.4, 7.3, 0, dy=4.3, solid=False),
    ],
}

# Chest spots relative to the room centre. They sit on the free aisle, on the real floor; the build
# asserts no prop collider reaches them and `place-barn-chests.mts` re-samples the actual collision
# floor before they become gameplay data.
CHEST_SPOTS = {
    'campo':    [('loft', 0.0, 3.6, 'supply')],
    'sementes': [('aisle', 0.0, 5.4, 'supply'), ('stall', -3.4, -5.8, 'shop')],
    'solar':    [('forge', 0.0, 4.9, 'supply'), ('bench', 3.2, -6.2, 'shop')],
    'colheita': [('cellar', 0.0, 5.6, 'supply'), ('rack', -3.4, -6.4, 'shop')],
    'altos':    [('loft', 0.0, 5.4, 'supply')],
}


def hexcolor(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


def pos(v):
    """Game (x, y, z) -> Blender. The same mapping the other world scripts use."""
    return Vector((-v[0], -v[2], v[1]))


# ---------------------------------------------------------------------------------------------
# Kit import
# ---------------------------------------------------------------------------------------------
USED = sorted({entry['prop'] for layout in LAYOUTS.values() for entry in layout})


def mirror_kit():
    """Copy only the props this script uses into art/source, so later runs need no outside path."""
    KIT_LOCAL.mkdir(parents=True, exist_ok=True)
    missing = [name for name in USED if not (KIT_LOCAL / (name + '.gltf')).exists()]
    if missing:
        if not KIT_SOURCE.exists():
            raise SystemExit('Prop kit not found. Set BARN_PROP_KIT to the Quaternius glTF export folder.')
        for name in missing:
            for suffix in ('.gltf', '.bin'):
                shutil.copy2(KIT_SOURCE / (name + suffix), KIT_LOCAL / (name + suffix))
        for texture in KIT_SOURCE.glob('T_Trim_*.png'):
            if not (KIT_LOCAL / texture.name).exists():
                shutil.copy2(texture, KIT_LOCAL / texture.name)
        license_file = KIT_SOURCE.parent.parent / 'License_Standard.txt'
        if license_file.exists():
            shutil.copy2(license_file, KIT_LOCAL / 'License_Standard.txt')


mirror_kit()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
bpy.context.preferences.filepaths.save_version = 0

# Triangle ceiling per kit prop. The interiors are lit by one lantern and read at two to ten
# metres, so the extra density on the round props (chandelier, crates, cages) buys nothing and
# lands straight in the download. The same DECIMATE pass the dressing props already go through.
PROP_TRIANGLE_LIMIT = 2000

templates = {}
for name in USED:
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(KIT_LOCAL / (name + '.gltf')))
    imported = set(scene.objects) - before
    meshes = [o for o in imported if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # The kit ships a lightmap UV set and a second colour attribute that these materials never
    # sample. Joined into one mesh per barn they would be paid for on every vertex.
    while len(o.data.uv_layers) > 1:
        o.data.uv_layers.remove(o.data.uv_layers[-1])
    while len(o.data.color_attributes) > 1:
        o.data.color_attributes.remove(o.data.color_attributes[-1])
    if len(o.data.polygons) > PROP_TRIANGLE_LIMIT:
        bpy.context.view_layer.objects.active = o
        modifier = o.modifiers.new('Prop budget', 'DECIMATE')
        modifier.ratio = PROP_TRIANGLE_LIMIT / len(o.data.polygons)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector([min(v[i] for v in corners) for i in range(3)])
    hi = Vector([max(v[i] for v in corners) for i in range(3)])
    # Origin at the horizontal centre with the base on the floor: placement becomes a floor plan.
    for v in o.data.vertices:
        v.co -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    o.name = o.data.name = 'kit_' + name
    o.location = (0, 0, -10000)
    # Blender X/Y/Z map to game X/Z/Y, so the game footprint is (dx, dy) and the height is dz.
    templates[name] = (o, Vector((hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)))
    for other in list(imported):
        try:
            if other is not o and other.name in bpy.data.objects:
                bpy.data.objects.remove(other, do_unlink=True)
        except ReferenceError:
            pass

# Every prop file carries its own copy of the shared trim materials, so the importer hands back
# `MI_Trim_Metal.017` and friends. Collapsing them onto one material per kit atlas is what lets a
# whole barn merge into a handful of draw batches instead of one per prop.
canonical = {}
for material in list(bpy.data.materials):
    base = material.name.split('.')[0]
    canonical.setdefault(base, material)
for template, _ in templates.values():
    for slot, material in enumerate(list(template.data.materials)):
        if material:
            template.data.materials[slot] = canonical[material.name.split('.')[0]]
for material in list(bpy.data.materials):
    if material.users == 0:
        bpy.data.materials.remove(material)
for image in list(bpy.data.images):
    if image.users == 0:
        bpy.data.images.remove(image)

# The 4K source maps are far more than a barn interior needs; 1K keeps the GLB near the prop budget.
for image in bpy.data.images:
    if max(image.size or (0, 0)) > 1024:
        image.scale(1024, 1024)

BASE_MATERIALS = {m.name: m for m in bpy.data.materials}
PALETTE_SLOT = {
    'MI_Trim_Furniture': 'furniture', 'MI_Trim_Metal': 'metal',
    'MI_Trim_Props': 'props', 'MI_Trim_Props_Vertex': 'props',
    'MI_Trim_Cloth': 'sack', 'MI_Banner': 'cloth',
}


def tinted(material, color, slot, suffix):
    """Per-barn copy of a kit material.

    The tint has to survive the glTF export, and the exporter only reads `baseColorFactor` from the
    Base Color socket's own `default_value` — a mix node in front of it is dropped on the floor and
    every material ships white. Setting the socket value while the texture stays linked is the same
    trick `build-farm-world.py` uses for `WORLD_MATERIAL_TINT`.

    Cloth is the exception: banners are the barn's signage, so they take the palette colour FLAT,
    with the kit texture unlinked. Multiplying a crimson banner by a blue tint only produces mud;
    dropping the albedo and keeping normal + ORM keeps the weave and gives a real colour.
    """
    copy = material.copy()
    copy.name = material.name + '_' + suffix
    bsdf = next((n for n in copy.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        base = bsdf.inputs['Base Color']
        if slot == 'cloth':
            for link in list(base.links):
                copy.node_tree.links.remove(link)
        base.default_value = (*color, 1)
    copy.diffuse_color = (*color, 1)
    return copy


# ---------------------------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------------------------
manifest = dict(source='scripts/build-barn-interiors.py',
                kit='Quaternius Fantasy Props MegaKit (CC0)',
                aisleHalfWidth=AISLE_HALF_WIDTH, barns=[])

for room in ROOMS:
    suffix = room['id']
    palette = {name: tinted(material, hexcolor(room['palette'][PALETTE_SLOT[name]]), PALETTE_SLOT[name], suffix)
               for name, material in BASE_MATERIALS.items() if name in PALETTE_SLOT}
    colliders, members = [], []
    for entry in LAYOUTS[suffix]:
        template, dims = templates[entry['prop']]
        x, z = room['cx'] + entry['dx'], room['cz'] + entry['dz']
        y = room['floor'] + entry['dy']
        o = bpy.data.objects.new('%s_%s' % (suffix, entry['prop']), template.data.copy())
        scene.collection.objects.link(o)
        o.location = pos((x, y, z))
        o.rotation_euler.z = math.radians(entry['yaw'])
        for slot in o.material_slots:
            if slot.material and slot.material.name in palette:
                slot.material = palette[slot.material.name]
        members.append(o)
        # Footprint after yaw, in game axes. Colliders shrink 10% so the player brushes the prop
        # instead of bumping an invisible box, and stop at the prop's own top: nothing floats.
        angle = math.radians(entry['yaw'])
        sx, sz = dims.x / 2, dims.y / 2
        hx = abs(sx * math.cos(angle)) + abs(sz * math.sin(angle))
        hz = abs(sx * math.sin(angle)) + abs(sz * math.cos(angle))
        if x - hx < room['minX'] - .3 or x + hx > room['maxX'] + .3 \
           or z - hz < room['minZ'] - .3 or z + hz > room['maxZ'] + .3:
            raise SystemExit('Prop leaves the barn shell: %s %s' % (suffix, entry['prop']))
        if y + dims.z > room['ceiling'] + .1:
            raise SystemExit('Prop reaches through the roof: %s %s' % (suffix, entry['prop']))
        if not entry['solid']:
            continue
        colliders.append(dict(
            id='barn-interior-%s-%s-%d' % (suffix, entry['prop'].lower(), len(colliders)),
            min=dict(x=round(x - hx * .9, 3), y=round(room['floor'], 3), z=round(z - hz * .9, 3)),
            max=dict(x=round(x + hx * .9, 3), y=round(y + max(.45, dims.z), 3), z=round(z + hz * .9, 3)),
        ))

    # The corridor that has to stay walkable runs from the doorway to the deepest chest. A prop
    # reaching into it would turn the room into a trap; past the last chest the centre is free to
    # be dressed. This is a build error, not a runtime surprise.
    aisle_end = room['cz'] + max(dz for _, _, dz, _ in CHEST_SPOTS[suffix]) + .9
    for box in colliders:
        if box['min']['z'] < aisle_end \
           and box['min']['x'] < room['cx'] + AISLE_HALF_WIDTH and box['max']['x'] > room['cx'] - AISLE_HALF_WIDTH:
            raise SystemExit('Prop blocks the entrance aisle: ' + box['id'])

    chests = []
    for name, dx, dz, kind in CHEST_SPOTS[suffix]:
        x, z = room['cx'] + dx, room['cz'] + dz
        for box in colliders:
            if box['min']['x'] - .8 < x < box['max']['x'] + .8 and box['min']['z'] - .8 < z < box['max']['z'] + .8:
                raise SystemExit('Chest spot %s-%s sits in %s' % (suffix, name, box['id']))
        chests.append(dict(id='barn-%s-%s' % (suffix, name), x=round(x, 3), z=round(z, 3), kind=kind))

    # One merged mesh per barn: a single node to cull, one draw call per palette slot. This is the
    # same batching the other world scripts do before export.
    bpy.ops.object.select_all(action='DESELECT')
    for o in members:
        o.select_set(True)
    bpy.context.view_layer.objects.active = members[0]
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = merged.data.name = 'barn-interior-' + suffix
    # Joining props with mismatched attribute domains leaves a second colour layer behind. Only the
    # render colour drives the kit's produce tint; the spare would ship a megabyte of dead vertices.
    keep = merged.data.color_attributes.render_color_index
    for attribute in [a for i, a in enumerate(merged.data.color_attributes) if i != keep]:
        merged.data.color_attributes.remove(attribute)

    manifest['barns'].append(dict(
        id=suffix, name=room['name'], region=room['region'], collision=room['collision'],
        mesh='barn-interior-' + suffix,
        centre=dict(x=round(room['cx'], 3), y=room['floor'], z=round(room['cz'], 3)),
        interior=dict(minX=room['minX'], maxX=room['maxX'], minZ=room['minZ'], maxZ=room['maxZ'],
                      ceiling=room['ceiling']),
        door=dict(minX=room['doorMinX'], maxX=room['doorMaxX'], z=room['minZ']),
        palette=room['palette'],
        lantern=dict(x=round(room['cx'], 3), y=round(room['floor'] + LANTERN_HEIGHT, 3),
                     z=round(room['cz'], 3), color=room['palette']['lantern']),
        props=len(LAYOUTS[suffix]), triangles=len(merged.data.polygons),
        chests=chests, colliders=colliders,
    ))
    print('BARN INTERIOR', suffix, len(LAYOUTS[suffix]), 'props',
          len(merged.data.polygons), 'faces', len(colliders), 'colliders', flush=True)

for template, _ in templates.values():
    bpy.data.objects.remove(template, do_unlink=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/barn-interiors.glb'), export_format='GLB',
                          use_selection=True, export_animations=False, export_image_format='JPEG',
                          export_jpeg_quality=88)
(ROOT / 'public/models/barn-interiors.json').write_text(json.dumps(manifest, indent=1), encoding='utf8')
Path(ROOT / 'art/blender').mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art/blender/Barn_Interiors.blend'), compress=True)
print('BARN INTERIORS READY', len(manifest['barns']), 'barns',
      sum(len(barn['colliders']) for barn in manifest['barns']), 'colliders', flush=True)
