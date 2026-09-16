"""Harvest chalice — authored Blender source for public/models/harvest-chalice.glb.

Reference: public/images/objectives/harvest-chalice-concept.png (docs/HARVEST_CHALICE_DESIGN.md).

Everything here is real modelled geometry: surfaces of revolution built from hand-tuned
profiles and leaf patches wrapped onto those surfaces. No primitive stand-ins.

Output
  art/blender/Harvest_Chalice.blend   editable source (collections per part)
  public/models/harvest-chalice.glb   runtime asset
  docs/harvest-chalice-asset.json     measured contract consumed by tests and the visual module

Run: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/build-harvest-chalice.py
"""
import bpy, bmesh, json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# --- tuning -------------------------------------------------------------------------------
SEG_BOWL, SEG_COLUMN, SEG_LIQUID, SEG_DROP = 56, 40, 48, 20
LOBES = 6                       # scalloped rim petals, as in the concept
RIM_LOBE_R, RIM_LOBE_Z = .045, .052
FILL_LEVELS = 5                 # morph targets: Fill20 .. Fill100
JUICE_GAP = .007                # juice never touches the glass wall exactly
JUICE_CEILING = 1.30            # highest the juice ever reaches (rim is ~1.53)

BOWL_OUT = dict(R=.62, z0=.615, h=.905)
BOWL_IN = dict(R=.585, z0=.672, h=.853)
FLOOR_Z = BOWL_IN['z0']

BRASS = (.605, .440, .190)
VERDIGRIS = (.285, .475, .385)
POLISHED = (.870, .705, .390)
JUICE_DEEP = (.340, .020, .030)
JUICE_TOP = (.830, .135, .045)
JUICE_PULP = (.970, .600, .360)


# --- small maths --------------------------------------------------------------------------
def smoothstep(a, b, x):
    t = min(1., max(0., (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def mix3(a, b, t):
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t))


def linear(color):
    """Palette above is authored in sRGB; Blender inputs and glTF COLOR_0 are both linear."""
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in color)


def _hash(x, y, z):
    n = math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
    return n - math.floor(n)


def noise(x, y, z):
    """Deterministic value noise — the patina must be identical on every rebuild."""
    xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
    xf, yf, zf = x - xi, y - yi, z - zi
    u, v, w = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf), zf * zf * (3 - 2 * zf)
    def c(i, j, k):
        return _hash(xi + i, yi + j, zi + k)
    x00 = lerp(c(0, 0, 0), c(1, 0, 0), u); x10 = lerp(c(0, 1, 0), c(1, 1, 0), u)
    x01 = lerp(c(0, 0, 1), c(1, 0, 1), u); x11 = lerp(c(0, 1, 1), c(1, 1, 1), u)
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w)


# --- bowl surface of revolution -------------------------------------------------------------
def wall(t, theta, p):
    """Coupe profile: rounded bottom flaring into a near-vertical scalloped rim."""
    r = p['R'] * math.sin(t * math.pi / 2) ** .62
    z = p['z0'] + p['h'] * (t ** 1.35)
    w = smoothstep(.5, 1., t)
    lobe = math.cos(theta * LOBES)
    return r * (1 + RIM_LOBE_R * lobe * w), z + RIM_LOBE_Z * lobe * w


def wall_normal(t, theta, p, eps=1e-3):
    a = wall(max(0., t - eps), theta, p)
    b = wall(min(1., t + eps), theta, p)
    dr, dz = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dr, dz) or 1.
    return dz / length, -dr / length


def inner_radius_at(z, theta):
    """Interior radius at an exact height — the juice edge rides the scalloped wall."""
    lo, hi = 0., 1.
    for _ in range(40):
        mid = (lo + hi) / 2
        if wall(mid, theta, BOWL_IN)[1] < z:
            lo = mid
        else:
            hi = mid
    return wall((lo + hi) / 2, theta, BOWL_IN)[0]


def juice_levels():
    """Heights for 20/40/60/80/100% of the *volume* — the level rises fast, then slows."""
    steps, theta = 480, math.pi / (2 * LOBES)      # theta where the lobe term is zero
    dz = (JUICE_CEILING - FLOOR_Z) / steps
    cumulative, total = [0.], 0.
    for i in range(steps):
        r = inner_radius_at(FLOOR_Z + dz * (i + .5), theta)
        total += math.pi * r * r * dz
        cumulative.append(total)
    heights = []
    for k in range(1, FILL_LEVELS + 1):
        target = total * k / FILL_LEVELS
        i = next(j for j in range(steps + 1) if cumulative[j] >= target)
        span = cumulative[i] - cumulative[i - 1] if i else 1.
        frac = (target - cumulative[i - 1]) / span if span else 0.
        heights.append(FLOOR_Z + dz * (i - 1 + frac))
    return heights


# --- mesh accumulation ----------------------------------------------------------------------
class Part:
    """Collects vertices/faces/vertex-colours so several pieces share one object."""

    def __init__(self):
        self.verts, self.faces, self.colors, self.flat = [], [], [], set()

    def add(self, verts, faces, colors, flat_faces=()):
        base = len(self.verts)
        first = len(self.faces)
        self.verts += verts
        self.colors += colors
        self.faces += [tuple(base + i for i in f) for f in faces]
        self.flat |= {first + i for i in flat_faces}

    def build(self, name, material):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.validate()
        bm = bmesh.new(); bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh); bm.free()
        for index, polygon in enumerate(mesh.polygons):
            polygon.use_smooth = index not in self.flat
        layer = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
        for index, color in enumerate(self.colors):
            layer.data[index].color = (*linear(color), 1.)
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def revolve(profile, segments, polish):
    """Closed (r,z) profile with both ends on the axis -> watertight solid of revolution."""
    verts, faces, colors = [], [], []
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([len(verts)])
            verts.append((0., 0., z))
            colors.append(brass_color(0., 0., z, polish(r, z)))
        else:
            ring = []
            for s in range(segments):
                theta = s / segments * math.tau
                ring.append(len(verts))
                verts.append((r * math.cos(theta), r * math.sin(theta), z))
                colors.append(brass_color(r * math.cos(theta), r * math.sin(theta), z, polish(r, z)))
            rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1:
            faces += [(a[0], b[s], b[(s + 1) % segments]) for s in range(segments)]
        elif len(b) == 1:
            faces += [(a[s], a[(s + 1) % segments], b[0]) for s in range(segments)]
        else:
            faces += [(a[s], a[(s + 1) % segments], b[(s + 1) % segments], b[s]) for s in range(segments)]
    return verts, faces, colors


def brass_color(x, y, z, polish):
    """Aged brass baked into COLOR_0: verdigris settles in the shade, wear polishes ridges."""
    n = noise(x * 5.3 + 11., y * 5.3 + 3., z * 5.3)
    patina = min(.80, max(0., .62 * n + .40 * (1. - smoothstep(0., 1.6, z)) - .80 * polish))
    color = mix3(BRASS, VERDIGRIS, patina)
    return mix3(color, POLISHED, min(.70, polish * (.55 + .45 * n)))


def leaf(host, theta0, half_angle, ridge, thickness, gap, nu, nv):
    """A botanical leaf patch wrapped onto a host surface, solidified into a thin shell."""
    top, bottom, polish = [], [], []
    for i in range(nu + 1):
        u = i / nu
        width = max(half_angle * .045, half_angle * math.sin(math.pi * u ** .9) ** .72 * (1 - .15 * u))
        rowt, rowb, rowp = [], [], []
        for j in range(nv + 1):
            v = -1 + 2 * j / nv
            theta = theta0 + v * width
            r, z, nr, nz = host(u, theta)
            along = math.sin(math.pi * min(max(u, 1e-3), 1 - 1e-3)) ** .4
            midrib = (1 - abs(v)) ** 1.7 * along
            # Lateral veins fan out from the midrib; low frequency so nv still resolves them.
            veins = .60 * along * (1 - abs(v)) ** .5 * max(0., math.sin(5.2 * (abs(v) + u * 1.6))) ** 3
            rib = midrib + veins
            lift = gap + ridge * rib
            inner = max(gap * .25, lift - thickness)
            rowt.append((r + lift * nr, z + lift * nz, theta))
            rowb.append((r + inner * nr, z + inner * nz, theta))
            rowp.append(rib)
        top.append(rowt); bottom.append(rowb); polish.append(rowp)

    verts, colors = [], []
    for rows, polished in ((top, True), (bottom, False)):
        for i, row in enumerate(rows):
            for j, (r, z, theta) in enumerate(row):
                x, y = r * math.cos(theta), r * math.sin(theta)
                verts.append((x, y, z))
                colors.append(brass_color(x, y, z, polish[i][j] * .75 if polished else .05))

    stride, base = nv + 1, (nu + 1) * (nv + 1)
    T = lambda i, j: i * stride + j
    B = lambda i, j: base + i * stride + j
    faces, flat = [], []
    for i in range(nu):
        for j in range(nv):
            faces.append((T(i, j), T(i, j + 1), T(i + 1, j + 1), T(i + 1, j)))
            faces.append((B(i, j), B(i + 1, j), B(i + 1, j + 1), B(i, j + 1)))
    for i in range(nu):                                      # side rims stay flat-shaded
        flat.append(len(faces)); faces.append((T(i, 0), T(i + 1, 0), B(i + 1, 0), B(i, 0)))
        flat.append(len(faces)); faces.append((T(i, nv), B(i, nv), B(i + 1, nv), T(i + 1, nv)))
    for j in range(nv):
        flat.append(len(faces)); faces.append((T(0, j), B(0, j), B(0, j + 1), T(0, j + 1)))
        flat.append(len(faces)); faces.append((T(nu, j), T(nu, j + 1), B(nu, j + 1), B(nu, j)))
    return verts, faces, colors, flat


def polyline_host(points, u0, u1):
    """Host callback that walks a brass profile by arc length between two parameters."""
    lengths = [0.]
    for a, b in zip(points, points[1:]):
        lengths.append(lengths[-1] + math.dist(a, b))
    total = lengths[-1]

    def at(u, _theta):
        target = (u0 + (u1 - u0) * u) * total
        i = min(len(points) - 2, max(0, next(j for j in range(1, len(lengths)) if lengths[j] >= target) - 1))
        span = lengths[i + 1] - lengths[i] or 1.
        f = (target - lengths[i]) / span
        r = lerp(points[i][0], points[i + 1][0], f)
        z = lerp(points[i][1], points[i + 1][1], f)
        dr, dz = points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]
        length = math.hypot(dr, dz) or 1.
        return r, z, dz / length, -dr / length
    return at


def bowl_host(t0, t1):
    def at(u, theta):
        t = t0 + (t1 - t0) * u ** .95
        r, z = wall(t, theta, BOWL_OUT)
        nr, nz = wall_normal(t, theta, BOWL_OUT)
        return r, z, nr, nz
    return at


# --- scene --------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'


def principled(name, base, roughness, metallic, alpha=1., emission=None, vertex_color=False):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*linear(base), 1.)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Alpha'].default_value = alpha
    if 'IOR' in bsdf.inputs:
        bsdf.inputs['IOR'].default_value = 1.46
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*linear(emission), 1.)
        bsdf.inputs['Emission Strength'].default_value = 1.
    if vertex_color:
        # COLOR_0 carries the whole albedo so the glTF exporter emits it unambiguously.
        attribute = nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
    # Every piece is a watertight shell, so single-sided drawing is both correct and cheaper.
    material.use_backface_culling = True
    if alpha < 1.:
        for field, value in (('blend_method', 'BLEND'), ('surface_render_method', 'BLENDED'),
                             ('shadow_method', 'HASHED')):
            try:
                setattr(material, field, value)
            except (AttributeError, TypeError):
                pass
    return material


# Alpha blend instead of KHR transmission: readable outdoors, one transparent draw, no refraction
# pass. Kept low so the juice and the brass ribs — not the shell — carry the read.
crystal = principled('Chalice crystal', (.64, .74, .78), .05, 0., alpha=.10)
brass = principled('Chalice aged brass', (1., 1., 1.), .35, 1., vertex_color=True)
juice = principled('Harvest juice', (1., 1., 1.), .26, 0., emission=(.17, .035, .022), vertex_color=True)

root = bpy.data.objects.new('HarvestChalice', None)
scene.collection.objects.link(root)
root.empty_display_size = .25

# --- crystal bowl ---------------------------------------------------------------------------
OUT_RINGS, IN_RINGS = 24, 22
bowl_verts, bowl_faces, bowl_colors = [], [], []
rings = []
rings.append([len(bowl_verts)]); bowl_verts.append((0., 0., wall(0., 0., BOWL_OUT)[1])); bowl_colors.append((1., 1., 1.))
for i in range(1, OUT_RINGS + 1):
    t = (i / OUT_RINGS) ** .85
    rings.append([len(bowl_verts) + s for s in range(SEG_BOWL)])
    for s in range(SEG_BOWL):
        theta = s / SEG_BOWL * math.tau
        r, z = wall(t, theta, BOWL_OUT)
        bowl_verts.append((r * math.cos(theta), r * math.sin(theta), z)); bowl_colors.append((1., 1., 1.))
for k in range(1, 4):                                   # rounded lip crossing outer -> inner
    a = k / 4
    rings.append([len(bowl_verts) + s for s in range(SEG_BOWL)])
    for s in range(SEG_BOWL):
        theta = s / SEG_BOWL * math.tau
        ro, zo = wall(1., theta, BOWL_OUT)
        ri, zi = wall(1., theta, BOWL_IN)
        r = lerp(ro, ri, a); z = lerp(zo, zi, a) + .018 * math.sin(a * math.pi)
        bowl_verts.append((r * math.cos(theta), r * math.sin(theta), z)); bowl_colors.append((1., 1., 1.))
for i in range(IN_RINGS, 0, -1):
    t = (i / IN_RINGS) ** .85
    rings.append([len(bowl_verts) + s for s in range(SEG_BOWL)])
    for s in range(SEG_BOWL):
        theta = s / SEG_BOWL * math.tau
        r, z = wall(t, theta, BOWL_IN)
        bowl_verts.append((r * math.cos(theta), r * math.sin(theta), z)); bowl_colors.append((1., 1., 1.))
rings.append([len(bowl_verts)]); bowl_verts.append((0., 0., FLOOR_Z)); bowl_colors.append((1., 1., 1.))
for a, b in zip(rings, rings[1:]):
    if len(a) == 1:
        bowl_faces += [(a[0], b[s], b[(s + 1) % SEG_BOWL]) for s in range(SEG_BOWL)]
    elif len(b) == 1:
        bowl_faces += [(a[s], a[(s + 1) % SEG_BOWL], b[0]) for s in range(SEG_BOWL)]
    else:
        bowl_faces += [(a[s], a[(s + 1) % SEG_BOWL], b[(s + 1) % SEG_BOWL], b[s]) for s in range(SEG_BOWL)]
bowl_part = Part(); bowl_part.add(bowl_verts, bowl_faces, bowl_colors)
bowl = bowl_part.build('ChaliceCrystalBowl', crystal)
bowl.parent = root

# --- brass frame: foot, stem, bud, cradle, leaves ---------------------------------------------
column = [
    (.000, .000), (.150, .000), (.300, .002), (.380, .010), (.424, .028), (.436, .050),
    (.430, .070), (.404, .086), (.352, .100), (.280, .112), (.212, .128), (.160, .152),
    (.124, .186), (.102, .226), (.092, .262), (.088, .292), (.098, .316), (.112, .330),
    (.104, .344), (.126, .368), (.156, .404), (.168, .444), (.160, .482), (.136, .514),
    (.110, .540), (.094, .566), (.088, .592), (.100, .612), (.114, .624), (.106, .636),
    (.140, .654), (.196, .672), (.252, .694), (.300, .716), (.316, .730),
]
for i in range(9, -1, -1):                              # cradle interior follows the bowl shell
    t = .215 * (i / 9) ** .85
    r, z = wall(t, 0., BOWL_OUT)
    nr, nz = wall_normal(t, 0., BOWL_OUT)
    column.append((r + .005 * nr, z + .005 * nz))
column.append((.0, column[-1][1] - .002))

def column_polish(r, z):
    return .62 if (z < .06 and r > .36) else (.42 if z > .70 else .12)

frame = Part()
frame.add(*revolve(column, SEG_COLUMN, column_polish))
# Six tall petals sit in the rim valleys and six short ones on the crests. Their combined width
# deliberately leaves gaps: the juice level has to stay readable through the glass at every fill.
for k in range(6):
    frame.add(*leaf(bowl_host(.09, .78), (k + .5) / 6 * math.tau,
                    math.radians(19.), .040, .018, .006, 18, 14))
for k in range(6):
    frame.add(*leaf(bowl_host(.09, .52), k / 6 * math.tau,
                    math.radians(14.), .030, .015, .006, 13, 10))
for k in range(8):                                      # relief on the foot
    frame.add(*leaf(polyline_host(column, .052, .175), (k + .5) / 8 * math.tau,
                    math.radians(21.), .013, .009, .003, 10, 8))
for k in range(5):                                      # bud at the stem
    frame.add(*leaf(polyline_host(column, .285, .455), (k + .3) / 5 * math.tau,
                    math.radians(34.), .020, .011, .004, 12, 8))
frame_obj = frame.build('ChaliceBrassFrame', brass)
frame_obj.parent = root

# --- juice: one mesh, five shape keys, every level riding the glass wall -----------------------
LEVELS = juice_levels()
WALL_RINGS = 11


def juice_shape(level_z):
    verts = []
    verts.append((0., 0., FLOOR_Z + .003))
    for i in range(1, WALL_RINGS + 1):
        z = FLOOR_Z + (level_z - FLOOR_Z) * (i / WALL_RINGS) ** .8
        for s in range(SEG_LIQUID):
            theta = s / SEG_LIQUID * math.tau
            r = max(.0015, inner_radius_at(z, theta) - JUICE_GAP)
            verts.append((r * math.cos(theta), r * math.sin(theta), z))
    verts.append((0., 0., level_z - .005))              # concave meniscus dip
    return verts


EMPTY_Z = FLOOR_Z + .010
juice_verts = juice_shape(EMPTY_Z)                      # basis = empty
juice_faces, juice_colors = [], []
top_centre = len(juice_verts) - 1
rings = [[0]] + [[1 + i * SEG_LIQUID + s for s in range(SEG_LIQUID)] for i in range(WALL_RINGS)] + [[top_centre]]
for a, b in zip(rings, rings[1:]):
    if len(a) == 1:
        juice_faces += [(a[0], b[s], b[(s + 1) % SEG_LIQUID]) for s in range(SEG_LIQUID)]
    elif len(b) == 1:
        juice_faces += [(a[s], a[(s + 1) % SEG_LIQUID], b[0]) for s in range(SEG_LIQUID)]
    else:
        juice_faces += [(a[s], a[(s + 1) % SEG_LIQUID], b[(s + 1) % SEG_LIQUID], b[s]) for s in range(SEG_LIQUID)]
full = juice_shape(LEVELS[-1])
for index, (x, y, z) in enumerate(full):
    height = smoothstep(FLOOR_Z, LEVELS[-1], z)
    color = mix3(JUICE_DEEP, JUICE_TOP, height ** .7)
    fleck = noise(x * 26., y * 26., z * 26.)
    juice_colors.append(mix3(color, JUICE_PULP, .55 if fleck > .84 else 0.))
juice_part = Part(); juice_part.add(juice_verts, juice_faces, juice_colors)
juice_obj = juice_part.build('ChaliceJuice', juice)
juice_obj.parent = root
juice_obj.shape_key_add(name='Basis', from_mix=False)
for k, level_z in enumerate(LEVELS, start=1):
    key = juice_obj.shape_key_add(name=f'Fill{k * 100 // FILL_LEVELS}', from_mix=False)
    for index, co in enumerate(juice_shape(level_z)):
        key.data[index].co = co
    key.value = 0.

# --- droplet: the incoming juice arc, instanced by the runtime --------------------------------
drop_profile = [(0., 0.)]
for i in range(1, 10):
    u = i / 10
    drop_profile.append((.034 * math.sin(math.pi * u ** .78) ** .85 * (1 - .22 * u), .125 * u))
drop_profile.append((0., .125))
drop_part = Part()
dverts, dfaces, _ = revolve(drop_profile, SEG_DROP, lambda r, z: 0.)
drop_part.add(dverts, dfaces, [mix3(JUICE_TOP, JUICE_PULP, .2)] * len(dverts))
droplet = drop_part.build('ChaliceDroplet', juice)
droplet.parent = root

# --- anchors ----------------------------------------------------------------------------------
RIM_Z = wall(1., math.pi / (2 * LOBES), BOWL_IN)[1] + .018
anchors = {
    'ChaliceRimAnchor': (0., 0., RIM_Z),
    'ChaliceJuiceFloorAnchor': (0., 0., FLOOR_Z),
    'ChaliceGlowAnchor': (0., 0., (FLOOR_Z + JUICE_CEILING) / 2),
}
for name, position in anchors.items():
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_size = .08
    scene.collection.objects.link(empty)
    empty.parent = root
    empty.location = position

# --- save + export ------------------------------------------------------------------------------
(ROOT / 'art/blender').mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art/blender/Harvest_Chalice.blend'))

options = dict(filepath=str(ROOT / 'public/models/harvest-chalice.glb'), export_format='GLB',
               export_animations=False, export_skins=False, export_morph=True,
               export_morph_normal=True, export_apply=False, export_yup=True)
try:
    bpy.ops.export_scene.gltf(**options, export_vertex_color='ACTIVE')
except TypeError:
    bpy.ops.export_scene.gltf(**options)

triangles = {}
for obj in (bowl, frame_obj, juice_obj, droplet):
    mesh = obj.data
    triangles[obj.name] = sum(len(p.vertices) - 2 for p in mesh.polygons)

contract = {
    'model': 'public/models/harvest-chalice.glb',
    'source': 'art/blender/Harvest_Chalice.blend',
    'script': 'scripts/build-harvest-chalice.py',
    'reference': 'public/images/objectives/harvest-chalice-concept.png',
    'nodes': {'root': 'HarvestChalice', 'bowl': 'ChaliceCrystalBowl', 'frame': 'ChaliceBrassFrame',
              'juice': 'ChaliceJuice', 'droplet': 'ChaliceDroplet', **{k: k for k in anchors}},
    'materials': {'crystal': 'Chalice crystal', 'brass': 'Chalice aged brass', 'juice': 'Harvest juice'},
    'height': round(RIM_Z, 4),
    'rimRadius': round(BOWL_OUT['R'], 4),
    'footRadius': round(max(r for r, _ in column), 4),
    'juiceFloor': round(FLOOR_Z, 4),
    'juiceCeiling': round(JUICE_CEILING, 4),
    # Volume-proportional surface heights. Index 0 is the basis (empty); index i>0 is morph
    # target Fill{i*20}. The runtime blends the two neighbouring entries.
    'fillLevels': [round(EMPTY_Z, 4)] + [round(z, 4) for z in LEVELS],
    'morphTargets': [f'Fill{k * 100 // FILL_LEVELS}' for k in range(1, FILL_LEVELS + 1)],
    'triangles': triangles,
    'totalTriangles': sum(triangles.values()),
}
(ROOT / 'docs/harvest-chalice-asset.json').write_text(json.dumps(contract, indent=2) + '\n', encoding='utf8')
print('chalice triangles', contract['totalTriangles'], 'levels', contract['fillLevels'])
