"""Author the six unarmed combo strikes on the real gunslinger rig, in Blender.

Why this exists: the runtime used to fake the combo with additive Euler offsets on top of the
locomotion clip. That twisted the torso and skated the feet, and the user rejected it. This script
authors *actual actions* on the rig — weight shift, anticipation, contact, recovery — and bakes the
IK solve into plain bone tracks.

How the poses are built (no invented proportions — everything comes from `measure-combo-rig.py`):

* The torso is FK: hips get a world yaw/pitch/roll plus a translation offset, and the twist is spread
  over `Spine02/Spine01/Spine` so no single joint corkscrews. The neck counter-rotates so the head
  keeps looking at the target.
* The hands are IK: each key gives a **direction from the shoulder** and an **extension fraction** of
  the measured straight-arm reach. Extension is clamped below 1, so the elbow never hyperextends and
  a punch can never reach further than the arm actually is.
* The planted feet are IK from the **ball of the foot**: a key gives the ball's world position, the
  foot yaw and the heel lift, and the ankle target is derived from it. A foot that keeps the same
  ball position across keys therefore cannot skate — the pivot is exact, not eyeballed.
* The kicking foot is IK from the hip with the same direction/extension contract as the hands.
* The spin pivots the whole body around the planted ball, so the hips ride a small circle and come
  back to the stance instead of sliding.

Every clip starts and ends on the same guard pose, so the runtime cross-fade has a neutral to blend
against and repeated cycles cannot accumulate.

Run: blender -b --python scripts/author-combo-actions.py
Writes: art/blender/Gunslinger_Combo.blend, art/processed/gunslinger-combos.glb,
        docs/combo-clip-manifest.json
"""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parent.parent
FPS = 60
A = 100.0                     # armature units per metre (the rig is imported at scale 0.01)
FORWARD = Vector((0, -1, 0))  # the character faces -Y in Blender
RIGHT = Vector((-1, 0, 0))    # the character's own right hand side
UP = Vector((0, 0, 1))
MAX_EXTENSION = .95           # never straighten a limb completely

# --------------------------------------------------------------------------------------------
# pose algebra
# --------------------------------------------------------------------------------------------

def rot(axis, degrees):
    return Matrix.Rotation(math.radians(degrees), 3, axis)

def body_rotation(yaw, pitch, roll):
    """World rotation from the character's own yaw (around up), pitch (lean forward) and roll."""
    return rot('Z', yaw) @ rot('X', pitch) @ rot('Y', roll)

def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)

def ease_out(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3

def snap(x):
    """Fast start, hard arrival — the acceleration of a strike leaving the chamber."""
    x = max(0.0, min(1.0, x))
    return x ** .55

EASINGS = {'smooth': smooth, 'ease-out': ease_out, 'snap': snap, 'linear': lambda x: max(0.0, min(1.0, x))}

def blend(a, b, s):
    if isinstance(a, (list, tuple)):
        return tuple(blend(x, y, s) for x, y in zip(a, b))
    if isinstance(a, dict):
        return {k: blend(a[k], b[k], s) for k in a}
    return a + (b - a) * s

def direction(value):
    vector = Vector(value)
    return vector.normalized() if vector.length > 1e-6 else Vector(FORWARD)

# --------------------------------------------------------------------------------------------
# rig
# --------------------------------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# The scene rate must be 60 BEFORE the import: the importer turns glTF seconds into frames with it,
# and the exporter turns them back. Setting it afterwards re-times every original clip.
scene.render.fps = FPS
scene.render.fps_base = 1.0
# `BLENDER` keeps each bone's rest frame exactly as the glTF stored it. `TEMPERANCE` guesses nicer
# tails but flips `Hips` and `Spine02`, and then the exported rotations no longer belong to the same
# local frames as the player GLB — the merge would silently corrupt the rig. Nothing here needs the
# tails: every solve works from bone *heads*, so the faithful rest frame costs nothing.
CLIP_NAMES = ('ComboRightCross', 'ComboLeftHook', 'ComboRightKick', 'ComboUppercut', 'ComboLeftKick', 'ComboSpinKick')
# Author from the pristine character whenever it exists. `public/models/gunslinger.glb` already
# carries the merged combo clips after the first run, and re-importing those made `actions.new()`
# hand back `ComboRightCross.001` — so the script kept authoring into a duplicate while the exporter
# happily shipped the stale original. Working from the backup keeps re-runs idempotent.
BACKUP = ROOT / 'art/processed/gunslinger-before-combos.glb'
SOURCE = BACKUP if BACKUP.exists() else ROOT / 'public/models/gunslinger.glb'
bpy.ops.import_scene.gltf(filepath=str(SOURCE), bone_heuristic='BLENDER')
rig = next(o for o in scene.objects if o.type == 'ARMATURE')

for name in CLIP_NAMES:
    stale = bpy.data.actions.get(name)
    if not stale:
        continue
    if rig.animation_data:
        for track in list(rig.animation_data.nla_tracks):
            if any(strip.action == stale for strip in track.strips):
                rig.animation_data.nla_tracks.remove(track)
    bpy.data.actions.remove(stale)
ORIGINAL_ACTIONS = [a.name for a in bpy.data.actions]
print('SOURCE', SOURCE.name, '| preserved actions', len(ORIGINAL_ACTIONS), flush=True)
if rig.animation_data:
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    # The importer files every clip as an NLA track. Leaving the stack live means the active action
    # is blended on top of whatever else is enabled, so the rig never poses at exactly what is keyed.
    rig.animation_data.use_nla = False
    rig.animation_data.action = None
else:
    rig.animation_data_create()
def clear_pose():
    """Reset every bone to rest.

    `pose_bone.matrix_basis.identity()` does NOT do this: the matrix handed back is a copy, so the
    call mutates a temporary and the bone keeps its previous pose. Every frame then solved on top of
    the frame before it, which is how the clips came out as a lagged smear of the intended poses.
    """
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)
    bpy.context.view_layer.update()

for bone in rig.pose.bones:
    bone.rotation_mode = 'QUATERNION'
clear_pose()

def update():
    bpy.context.view_layer.update()

def head(name):
    """Posed head of a bone, in metres."""
    return rig.matrix_world @ rig.pose.bones[name].head

REST = {bone.name: (rig.matrix_world @ bone.head).copy() for bone in rig.pose.bones}
REST_BASIS = {bone.name: bone.matrix.to_3x3().copy() for bone in rig.pose.bones}
REST_LOCAL = {bone.name: bone.matrix.copy() for bone in rig.pose.bones}

def length_between(a, b):
    return (REST[a] - REST[b]).length

LIMB = {
    'Right': {
        'arm': length_between('RightArm', 'RightForeArm') + length_between('RightForeArm', 'RightHand'),
        'leg': length_between('RightUpLeg', 'RightLeg') + length_between('RightLeg', 'RightFoot'),
    },
    'Left': {
        'arm': length_between('LeftArm', 'LeftForeArm') + length_between('LeftForeArm', 'LeftHand'),
        'leg': length_between('LeftUpLeg', 'LeftLeg') + length_between('LeftLeg', 'LeftFoot'),
    },
}
# Ankle measured from the ball of the foot, in the foot's own rest frame: this is what turns a
# "ball on the ground at (x,y)" key into an ankle IK target without ever guessing the heel height.
BALL_TO_ANKLE = {side: REST[side + 'Foot'] - REST[side + 'ToeBase'] for side in ('Right', 'Left')}
REST_FOOT_DIR = {side: (REST[side + 'ToeBase'] - REST[side + 'Foot']).normalized() for side in ('Right', 'Left')}

def set_world_matrix(name, rotation3, position):
    """Place a bone by its world rotation and head position (metres)."""
    bone = rig.pose.bones[name]
    matrix = rotation3.to_4x4()
    matrix.translation = position * A
    bone.matrix = matrix
    update()

def rotate_world(name, rotation3):
    """Rotate a bone in world space around its own head, keeping the head where it is."""
    bone = rig.pose.bones[name]
    current = bone.matrix
    pivot = current.translation.copy()
    matrix = (rotation3 @ current.to_3x3()).to_4x4()
    matrix.translation = pivot
    bone.matrix = matrix
    update()

def aim(name, child, world_direction):
    """Minimal rotation that points a bone's child along `world_direction`."""
    current = head(child) - head(name)
    if current.length < 1e-6 or world_direction.length < 1e-6:
        return
    rotate_world(name, current.normalized().rotation_difference(world_direction.normalized()).to_matrix())

def solve_chain(root, mid, end, target, pole):
    """Two-bone IK: put `end`'s head on `target`, with the joint pushed toward `pole`. Metres."""
    origin = head(root)
    upper = (REST[root] - REST[mid]).length
    lower = (REST[mid] - REST[end]).length
    offset = target - origin
    reach = max(abs(upper - lower) + 1e-3, min(upper + lower - 1e-3, offset.length))
    if offset.length < 1e-6:
        return
    unit = offset.normalized()
    along = (upper * upper - lower * lower + reach * reach) / (2 * reach)
    height = math.sqrt(max(0.0, upper * upper - along * along))
    hint = pole - origin
    hint = hint - unit * hint.dot(unit)
    if hint.length < 1e-5:
        hint = UP - unit * UP.dot(unit)
    joint = origin + unit * along + hint.normalized() * height
    aim(root, mid, joint - origin)
    aim(mid, end, origin + unit * reach - head(mid))

# --------------------------------------------------------------------------------------------
# the guard: the neutral every clip starts and ends on
# --------------------------------------------------------------------------------------------

GUARD = {
    # Orthodox stance: left side leads, so the hips are turned toward -Z yaw.
    'hips': {'yaw': -22., 'pitch': 6., 'roll': 0., 'dx': 0., 'dy': 0., 'dz': -.055},
    'spine': {'yaw': -7., 'pitch': 7., 'roll': 0.},
    'neck': {'yaw': 24., 'pitch': -5.},
    'shoulder': {'Right': {'lift': 5., 'forward': 9.}, 'Left': {'lift': 5., 'forward': 11.}},
    'hand': {
        'Right': {'dir': (.35, -.55, .55), 'ext': .62, 'twist': 0., 'elbow': (.85, .30, .20)},
        'Left': {'dir': (-.25, -.75, .40), 'ext': .70, 'twist': 0., 'elbow': (.85, .30, .20)},
    },
    # `ball` is where the ball of the foot meets the floor, in metres on the ground plane. The floor
    # height is the bone's own rest height, not zero — planting the toe bone at z=0 buries the foot
    # mesh, which is exactly the sort of thing a render hides and a measurement does not.
    # `lift` raises the same foot straight up, so leaving the ground costs no horizontal motion.
    'foot': {
        'Right': {'mode': 'plant', 'ball': (-.175, .145), 'lift': 0., 'yaw': -52., 'pitch': 6., 'knee': (.55, .18)},
        'Left': {'mode': 'plant', 'ball': (.155, -.175), 'lift': 0., 'yaw': -14., 'pitch': 0., 'knee': (.60, .15)},
    },
}
FLOOR = {side: REST[side + 'ToeBase'].z for side in ('Right', 'Left')}

def pose(**overrides):
    """A full key built from the guard, so no channel is ever left half-specified."""
    key = {
        'hips': dict(GUARD['hips']), 'spine': dict(GUARD['spine']), 'neck': dict(GUARD['neck']),
        'shoulder': {s: dict(v) for s, v in GUARD['shoulder'].items()},
        'hand': {s: dict(v) for s, v in GUARD['hand'].items()},
        'foot': {s: dict(v) for s, v in GUARD['foot'].items()},
    }
    for group, value in overrides.items():
        if group in ('hips', 'spine', 'neck'):
            key[group].update(value)
        else:
            for side, channels in value.items():
                key[group][side].update(channels)
    return key

def pivot_hips(key, ball, yaw):
    """Rotate the hips around a planted ball instead of sliding them: this is what a spin does."""
    centre = Vector((REST['Hips'].x, REST['Hips'].y, 0))
    anchor = Vector((ball[0], ball[1], 0))
    turned = rot('Z', yaw - GUARD['hips']['yaw']) @ (centre - anchor) + anchor
    key['hips']['yaw'] = yaw
    key['hips']['dx'] = turned.x - centre.x
    key['hips']['dy'] = turned.y - centre.y
    return key

# --------------------------------------------------------------------------------------------
# applying a key to the rig
# --------------------------------------------------------------------------------------------

SPINE_SHARE = (('Spine02', .34), ('Spine01', .33), ('Spine', .33))

def apply(key):
    clear_pose()

    hips = key['hips']
    body = body_rotation(hips['yaw'], hips['pitch'], hips['roll'])
    set_world_matrix('Hips', body @ REST_BASIS['Hips'],
                     REST['Hips'] + Vector((hips['dx'], hips['dy'], hips['dz'])))

    spine = key['spine']
    for name, share in SPINE_SHARE:
        rotate_world(name, body_rotation(spine['yaw'] * share, spine['pitch'] * share, spine['roll'] * share))
    rotate_world('neck', body_rotation(key['neck']['yaw'] * .55, key['neck']['pitch'] * .55, 0))
    rotate_world('Head', body_rotation(key['neck']['yaw'] * .45, key['neck']['pitch'] * .45, 0))

    torso_yaw = hips['yaw'] + spine['yaw']
    forward = rot('Z', torso_yaw) @ FORWARD
    right = rot('Z', torso_yaw) @ RIGHT
    for side in ('Right', 'Left'):
        shoulder = key['shoulder'][side]
        sign = 1 if side == 'Right' else -1
        rotate_world(side + 'Shoulder',
                     Matrix.Rotation(math.radians(shoulder['forward']) * sign, 3, UP)
                     @ Matrix.Rotation(math.radians(shoulder['lift']) * -sign, 3, forward))

    for side in ('Right', 'Left'):
        spec = key['hand'][side]
        shoulder = head(side + 'Arm')
        reach = LIMB[side]['arm'] * min(MAX_EXTENSION, spec['ext'])
        target = shoulder + direction(spec['dir']) * reach
        down, out, back = spec['elbow']
        sign = 1 if side == 'Right' else -1
        pole = shoulder + (-UP * down + right * (out * sign) - forward * back) * .6
        solve_chain(side + 'Arm', side + 'ForeArm', side + 'Hand', target, pole)
        # The wrist already continues the forearm after the solve; only the fist roll is authored,
        # and it is applied around the forearm line so the wrist can never break sideways.
        forearm = head(side + 'Hand') - head(side + 'ForeArm')
        if abs(spec['twist']) > 1e-6 and forearm.length > 1e-6:
            rotate_world(side + 'Hand', Matrix.Rotation(math.radians(spec['twist']), 3, forearm.normalized()))

    for side in ('Right', 'Left'):
        spec = key['foot'][side]
        hip = head(side + 'UpLeg')
        foot_rotation = rot('Z', spec['yaw']) @ rot('X', spec['pitch'])
        planted = None
        lifted = None
        if spec['mode'] in ('plant', 'blend'):
            ball = Vector((spec['ball'][0], spec['ball'][1], FLOOR[side] + spec['lift']))
            planted = ball + foot_rotation @ BALL_TO_ANKLE[side]
        if spec['mode'] in ('reach', 'blend'):
            lifted = hip + direction(spec['dir']) * (LIMB[side]['leg'] * min(MAX_EXTENSION, spec['ext']))
        if spec['mode'] == 'plant':
            target = planted
        elif spec['mode'] == 'reach':
            target = lifted
        else:
            # Leaving or meeting the ground: blend the two targets in world space, so the ankle is
            # exactly on the ball at weight 1 and exactly on the limb line at weight 0 — no jump.
            target = planted.lerp(lifted, 1 - spec['plantWeight'])
        limit = LIMB[side]['leg'] * MAX_EXTENSION
        if (target - hip).length > limit:
            target = hip + (target - hip).normalized() * limit
        ahead, out = spec['knee']
        sign = 1 if side == 'Right' else -1
        pole = hip + (forward * ahead + right * (out * sign) + UP * .1) * .8
        solve_chain(side + 'UpLeg', side + 'Leg', side + 'Foot', target, pole)
        aim(side + 'Foot', side + 'ToeBase', foot_rotation @ REST_FOOT_DIR[side])
    update()

# --------------------------------------------------------------------------------------------
# the six strikes
# --------------------------------------------------------------------------------------------

def strike(identifier, clip, windup, active, recover, keys, note):
    total = windup + active + recover
    return {'id': identifier, 'clip': clip, 'windup': windup, 'active': active, 'recover': recover,
            'frames': round(total * FPS) + 1, 'contactFrame': 1 + round(windup * FPS),
            'keys': keys, 'note': note}

def at(frame, key, easing='smooth'):
    return {'frame': frame, 'key': key, 'easing': easing}

LEAD = GUARD['foot']['Left']['ball']
REAR = GUARD['foot']['Right']['ball']

RIGHT_CROSS = strike(
    'right-cross', 'ComboRightCross', .28, .13, .33, [
        at(1, pose()),
        # Coil: the hips close, the weight sits back on the rear foot, the right fist chambers.
        at(8, pose(hips={'yaw': -32, 'dz': -.070, 'dy': .020}, spine={'yaw': -9},
                   neck={'yaw': 30},
                   hand={'Right': {'dir': (.42, -.34, .42), 'ext': .52},
                         'Left': {'dir': (-.22, -.86, .28), 'ext': .78}},
                   foot={'Right': {'pitch': 2}, 'Left': {'pitch': 4}}), 'smooth'),
        # Contact: hips and spine drive the shoulder through, rear heel lifts onto the ball.
        at(18, pose(hips={'yaw': -2, 'pitch': 9, 'dz': -.048, 'dy': -.055}, spine={'yaw': 9, 'pitch': 9},
                    neck={'yaw': -4},
                    shoulder={'Right': {'forward': 15}},
                    hand={'Right': {'dir': (.06, -.99, .02), 'ext': .94, 'elbow': (.9, .12, .1)},
                          'Left': {'dir': (-.30, -.52, .55), 'ext': .56}},
                    foot={'Right': {'yaw': -34, 'pitch': 34}, 'Left': {'pitch': 0}}), 'snap'),
        # Settle on the extended arm before pulling it back — the punch does not teleport home.
        at(25, pose(hips={'yaw': -6, 'pitch': 8, 'dz': -.052, 'dy': -.022}, spine={'yaw': 6, 'pitch': 9},
                    neck={'yaw': 0},
                    shoulder={'Right': {'forward': 13}},
                    hand={'Right': {'dir': (.09, -.98, .05), 'ext': .84, 'elbow': (.9, .14, .1)},
                          'Left': {'dir': (-.28, -.56, .55), 'ext': .58}},
                    foot={'Right': {'yaw': -38, 'pitch': 28}}), 'ease-out'),
        at(35, pose(hips={'yaw': -16, 'dz': -.060}, spine={'yaw': -2},
                    neck={'yaw': 16},
                    hand={'Right': {'dir': (.28, -.74, .42), 'ext': .68}},
                    foot={'Right': {'yaw': -46, 'pitch': 16}}), 'smooth'),
        at(45, pose()),
    ], 'rear straight; hips lead, rear heel pivots onto the ball, lead hand never drops below the chin')

LEFT_HOOK = strike(
    'left-hook', 'ComboLeftHook', .26, .13, .31, [
        at(1, pose()),
        # Coil onto the lead foot and open the elbow: the hook is thrown from the shoulder line.
        at(7, pose(hips={'yaw': 8, 'dz': -.080, 'dx': .038}, spine={'yaw': 8},
                   neck={'yaw': -12},
                   shoulder={'Left': {'lift': 9, 'forward': 6}},
                   hand={'Left': {'dir': (.70, -.15, .20), 'ext': .48, 'elbow': (.45, .85, .1)},
                         'Right': {'dir': (.30, -.60, .58), 'ext': .64}},
                   foot={'Left': {'pitch': 2}, 'Right': {'pitch': 10}}), 'smooth'),
        # Contact: hips rotate past neutral, lead heel turns out on the ball, elbow stays bent.
        at(17, pose(hips={'yaw': -36, 'pitch': 8, 'dz': -.060, 'dx': -.020, 'dy': -.018}, spine={'yaw': -10, 'pitch': 7},
                    neck={'yaw': 40},
                    shoulder={'Left': {'lift': 11, 'forward': 14}},
                    hand={'Left': {'dir': (-.20, -.95, .03), 'ext': .82, 'twist': -22, 'elbow': (.35, .9, .05)},
                          'Right': {'dir': (.34, -.50, .60), 'ext': .58}},
                    foot={'Left': {'yaw': -48, 'pitch': 22}, 'Right': {'yaw': -44, 'pitch': 4}}), 'smooth'),
        at(24, pose(hips={'yaw': -44, 'pitch': 7, 'dz': -.060, 'dx': -.024, 'dy': -.024}, spine={'yaw': -10, 'pitch': 7},
                    neck={'yaw': 48},
                    shoulder={'Left': {'lift': 10, 'forward': 13}},
                    hand={'Left': {'dir': (-.78, -.60, .06), 'ext': .68, 'twist': -26, 'elbow': (.3, .9, .05)},
                          'Right': {'dir': (.34, -.48, .62), 'ext': .56}},
                    foot={'Left': {'yaw': -56, 'pitch': 20}, 'Right': {'yaw': -44, 'pitch': 2}}), 'ease-out'),
        at(33, pose(hips={'yaw': -6, 'dz': -.062}, spine={'yaw': 2},
                    neck={'yaw': 12},
                    hand={'Left': {'dir': (-.46, -.72, .30), 'ext': .66}},
                    foot={'Left': {'yaw': 4, 'pitch': 12}}), 'smooth'),
        at(43, pose()),
    ], 'lead hook; the turn comes from the hips and the lead ball, the elbow stays under 90 degrees')

RIGHT_KICK = strike(
    'right-kick', 'ComboRightKick', .30, .15, .37, [
        at(1, pose()),
        # Roll onto the rear ball and pass the weight to the lead foot before anything leaves the
        # floor. The ball stays exactly where it was, so this costs no sliding.
        at(5, pose(hips={'yaw': -20, 'dz': -.060, 'dx': .014, 'dy': .020},
                   foot={'Right': {'pitch': 44}}), 'smooth'),
        # Straight up off that ball — a vertical lift is the only way out of contact without a skate.
        at(9, pose(hips={'yaw': -18, 'pitch': 0, 'dz': -.048, 'dx': .020, 'dy': .036},
                   spine={'pitch': 2}, neck={'yaw': 20},
                   hand={'Right': {'dir': (.42, -.32, .46), 'ext': .58},
                         'Left': {'dir': (-.20, -.72, .48), 'ext': .64}},
                   foot={'Right': {'lift': .13, 'pitch': 34}}), 'smooth'),
        # Chamber: knee up, weight fully on the lead foot, torso counterbalances backwards.
        at(13, pose(hips={'yaw': -16, 'pitch': -4, 'dz': -.040, 'dy': .050, 'dx': .020},
                    spine={'yaw': -4, 'pitch': -6},
                    neck={'yaw': 18, 'pitch': 6},
                    hand={'Right': {'dir': (.42, -.20, .48), 'ext': .56},
                          'Left': {'dir': (-.20, -.70, .50), 'ext': .62}},
                    foot={'Right': {'mode': 'reach', 'dir': (.05, -.62, -.78), 'ext': .62, 'yaw': -18, 'pitch': 20, 'knee': (.9, .1)},
                          'Left': {'pitch': 0}}), 'smooth'),
        # Contact: the leg drives out to hip height, the body leans back to pay for it.
        at(19, pose(hips={'yaw': -10, 'pitch': -16, 'dz': -.030, 'dy': .075, 'dx': .025},
                    spine={'yaw': -2, 'pitch': -10},
                    neck={'yaw': 10, 'pitch': 14},
                    hand={'Right': {'dir': (.38, .34, -.58), 'ext': .70},
                          'Left': {'dir': (-.26, -.60, .58), 'ext': .60}},
                    foot={'Right': {'mode': 'reach', 'dir': (.05, -.96, .27), 'ext': .90, 'yaw': -12, 'pitch': -14, 'knee': (.95, .05)},
                          'Left': {'yaw': -24, 'pitch': 8}}), 'snap'),
        at(28, pose(hips={'yaw': -12, 'pitch': -12, 'dz': -.034, 'dy': .068, 'dx': .024},
                    spine={'pitch': -8},
                    neck={'pitch': 10},
                    hand={'Right': {'dir': (.40, .20, -.50), 'ext': .66},
                          'Left': {'dir': (-.24, -.62, .58), 'ext': .60}},
                    foot={'Right': {'mode': 'reach', 'dir': (.05, -.88, .10), 'ext': .74, 'yaw': -14, 'pitch': -4, 'knee': (.95, .05)},
                          'Left': {'yaw': -22, 'pitch': 6}}), 'ease-out'),
        # Re-chamber before putting the foot down: the leg does not drop straight through the floor.
        at(36, pose(hips={'yaw': -16, 'pitch': -4, 'dz': -.042, 'dy': .050, 'dx': .018},
                    neck={'yaw': 18},
                    hand={'Right': {'dir': (.40, -.32, .36), 'ext': .58}},
                    foot={'Right': {'mode': 'reach', 'dir': (.02, -.50, -.86), 'ext': .68, 'yaw': -22, 'pitch': 16, 'knee': (.85, .12)},
                          'Left': {'yaw': -18}}), 'smooth'),
        # Back over the stance and straight down onto the same ball it left from.
        at(42, pose(hips={'yaw': -18, 'dz': -.052, 'dx': .014, 'dy': .030},
                    neck={'yaw': 20},
                    hand={'Right': {'dir': (.40, -.40, .44), 'ext': .60}},
                    foot={'Right': {'lift': .12, 'pitch': 30}}), 'smooth'),
        at(46, pose(hips={'yaw': -20, 'dz': -.058, 'dy': .010},
                    foot={'Right': {'pitch': 22}}), 'ease-out'),
        at(50, pose()),
    ], 'rear push kick; the support foot stays planted and the torso pays for the leg with a lean back')

UPPERCUT = strike(
    'uppercut', 'ComboUppercut', .30, .15, .37, [
        at(1, pose()),
        # Dip: both knees load, the right fist drops to the hip. The punch is a leg drive.
        at(9, pose(hips={'yaw': -30, 'pitch': 12, 'dz': -.145, 'dy': .015},
                   spine={'yaw': -8, 'pitch': 12},
                   neck={'yaw': 26, 'pitch': -14},
                   shoulder={'Right': {'lift': 2, 'forward': 4}},
                   hand={'Right': {'dir': (.28, -.44, -.85), 'ext': .60, 'elbow': (.9, .25, .3)},
                         'Left': {'dir': (-.24, -.70, .48), 'ext': .66}},
                   foot={'Right': {'pitch': 2}, 'Left': {'pitch': 0}}), 'smooth'),
        # Contact: the legs extend, the hips open and the fist rises through the centre line.
        at(19, pose(hips={'yaw': -6, 'pitch': -4, 'dz': -.012, 'dy': -.020},
                    spine={'yaw': 8, 'pitch': -6},
                    neck={'yaw': -2, 'pitch': 8},
                    shoulder={'Right': {'lift': 10, 'forward': 14}},
                    hand={'Right': {'dir': (.10, -.60, .79), 'ext': .82, 'twist': 18, 'elbow': (.95, .10, .25)},
                          'Left': {'dir': (-.30, -.52, .58), 'ext': .58}},
                    foot={'Right': {'yaw': -40, 'pitch': 26}, 'Left': {'pitch': 4}}), 'snap'),
        at(27, pose(hips={'yaw': -10, 'pitch': -2, 'dz': -.024, 'dy': -.012},
                    spine={'yaw': 5, 'pitch': -3},
                    neck={'yaw': 4, 'pitch': 6},
                    shoulder={'Right': {'lift': 9, 'forward': 12}},
                    hand={'Right': {'dir': (.14, -.62, .77), 'ext': .74, 'twist': 14, 'elbow': (.95, .12, .25)},
                          'Left': {'dir': (-.30, -.54, .58), 'ext': .58}},
                    foot={'Right': {'yaw': -44, 'pitch': 20}}), 'ease-out'),
        at(37, pose(hips={'yaw': -18, 'dz': -.062}, spine={'yaw': -2},
                    neck={'yaw': 16},
                    hand={'Right': {'dir': (.30, -.60, .62), 'ext': .64}},
                    foot={'Right': {'yaw': -48, 'pitch': 12}}), 'smooth'),
        at(50, pose()),
    ], 'right uppercut; the dip and the leg extension carry the fist, the elbow never passes the shoulder')

LEFT_KICK = strike(
    'left-kick', 'ComboLeftKick', .32, .15, .38, [
        at(1, pose()),
        # The support foot turns out BEFORE the hips rotate — that is what keeps the twist out of the
        # standing knee. Only then does the lead foot roll onto its ball.
        at(5, pose(hips={'yaw': -30, 'dz': -.066, 'dx': -.016},
                   neck={'yaw': 32},
                   foot={'Left': {'pitch': 40}, 'Right': {'yaw': -64, 'pitch': 4}}), 'smooth'),
        at(9, pose(hips={'yaw': -38, 'dz': -.058, 'dx': -.024, 'dy': .012},
                   spine={'yaw': -8}, neck={'yaw': 38},
                   hand={'Left': {'dir': (-.14, -.58, .48), 'ext': .60},
                         'Right': {'dir': (.36, -.56, .56), 'ext': .64}},
                   foot={'Left': {'lift': .13, 'pitch': 30}, 'Right': {'yaw': -70, 'pitch': 6}}), 'smooth'),
        # Chamber across: knee up and out, still square to the target.
        at(14, pose(hips={'yaw': -46, 'pitch': 2, 'dz': -.058, 'dx': -.030, 'dy': .020},
                    spine={'yaw': -10, 'roll': 6},
                    neck={'yaw': 44},
                    hand={'Left': {'dir': (-.10, -.44, .52), 'ext': .58},
                          'Right': {'dir': (.36, -.52, .58), 'ext': .64}},
                    foot={'Left': {'mode': 'reach', 'dir': (.52, -.56, -.64), 'ext': .60, 'yaw': -30, 'pitch': 22, 'knee': (.75, -.45)},
                          'Right': {'yaw': -72, 'pitch': 6}}), 'smooth'),
        # Contact: the hips rotate through the target, the body leans away from the leg.
        at(20, pose(hips={'yaw': 24, 'pitch': 2, 'roll': -14, 'dz': -.036, 'dx': -.046, 'dy': .014},
                    spine={'yaw': 12, 'roll': -10},
                    neck={'yaw': -26},
                    hand={'Left': {'dir': (.22, .28, -.72), 'ext': .70},
                          'Right': {'dir': (.30, -.40, .70), 'ext': .60}},
                    foot={'Left': {'mode': 'reach', 'dir': (-.24, -.96, .20), 'ext': .94, 'yaw': 30, 'pitch': -12, 'knee': (.9, -.55)},
                          'Right': {'yaw': -88, 'pitch': 14}}), 'snap'),
        at(29, pose(hips={'yaw': 30, 'roll': -12, 'dz': -.040, 'dx': -.048, 'dy': .014},
                    spine={'yaw': 12, 'roll': -8},
                    neck={'yaw': -30},
                    hand={'Left': {'dir': (.20, .18, -.66), 'ext': .66},
                          'Right': {'dir': (.30, -.42, .68), 'ext': .60}},
                    foot={'Left': {'mode': 'reach', 'dir': (-.52, -.80, .20), 'ext': .76, 'yaw': 34, 'pitch': -6, 'knee': (.9, -.55)},
                          'Right': {'yaw': -88, 'pitch': 12}}), 'ease-out'),
        # Bring the leg back before it lands, and unwind the support foot to the stance.
        at(38, pose(hips={'yaw': -14, 'roll': -2, 'dz': -.060, 'dx': -.014},
                    spine={'yaw': -2},
                    neck={'yaw': 14},
                    hand={'Left': {'dir': (-.18, -.66, .44), 'ext': .64}},
                    foot={'Left': {'mode': 'reach', 'dir': (.30, -.56, -.77), 'ext': .68, 'yaw': -16, 'pitch': 16, 'knee': (.8, -.25)},
                          'Right': {'yaw': -64, 'pitch': 8}}), 'smooth'),
        at(44, pose(hips={'yaw': -24, 'dz': -.062, 'dx': -.010},
                    neck={'yaw': 26},
                    hand={'Left': {'dir': (-.22, -.70, .42), 'ext': .66}},
                    foot={'Left': {'lift': .12, 'pitch': 26}, 'Right': {'yaw': -58, 'pitch': 8}}), 'smooth'),
        at(48, pose(hips={'yaw': -22, 'dz': -.060},
                    foot={'Left': {'pitch': 16}, 'Right': {'yaw': -54}}), 'ease-out'),
        at(52, pose()),
    ], 'lead round kick; support foot turns out before the hips rotate, so the knee never takes the twist')

def spin_key(frame, yaw, easing='smooth', **overrides):
    """The spin turns around the planted lead ball, so the hips ride a circle instead of sliding."""
    key = pivot_hips(pose(**overrides), LEAD, yaw)
    # Keep the guard with the turning torso. A world-fixed fist target drove the arm behind
    # the back halfway through the turn. Head spotting also stays within anatomical range.
    key['neck']['yaw'] = max(-55., min(55., key['neck']['yaw']))
    turn = rot('Z', yaw - GUARD['hips']['yaw'])
    for side in ('Right', 'Left'):
        key['hand'][side]['dir'] = tuple(turn @ Vector(GUARD['hand'][side]['dir']))
    return at(frame, key, easing)

SPIN_KICK = strike(
    'spin-kick', 'ComboSpinKick', .34, .25, .50, [
        at(1, pose()),
        # Load: the head turns first, the weight crosses to the lead foot, the rear heel comes up.
        spin_key(5, -40, 'smooth',
                 hips={'pitch': 6, 'dz': -.068}, spine={'yaw': -9}, neck={'yaw': 40},
                 foot={'Right': {'pitch': 40}, 'Left': {'yaw': -22, 'pitch': 4}}),
        # Straight up off the rear ball: leaving the floor must not cost any horizontal travel.
        spin_key(10, -70, 'smooth',
                 hips={'pitch': 6, 'dz': -.075}, spine={'yaw': -10}, neck={'yaw': 56},
                 hand={'Right': {'dir': (.42, -.34, .52), 'ext': .60},
                       'Left': {'dir': (-.10, -.62, .50), 'ext': .60}},
                 foot={'Right': {'lift': .14, 'pitch': 30}, 'Left': {'yaw': -38, 'pitch': 12}}),
        # Back turned, kicking leg chambers behind the body.
        spin_key(16, -146, 'smooth',
                 hips={'pitch': 4, 'dz': -.070}, spine={'yaw': -6}, neck={'yaw': 92},
                 hand={'Right': {'dir': (.30, -.10, .58), 'ext': .62},
                       'Left': {'dir': (-.02, -.30, .58), 'ext': .62}},
                 foot={'Right': {'mode': 'reach', 'dir': (-.30, -.32, -.90), 'ext': .60, 'yaw': -170, 'pitch': 18, 'knee': (.9, .1)},
                       'Left': {'yaw': -104, 'pitch': 20}}),
        # Contact: the heel fires back into the target while the body is still side on.
        spin_key(24, -202, 'snap',
                 hips={'pitch': 10, 'roll': 8, 'dz': -.055}, spine={'yaw': 6, 'pitch': 8}, neck={'yaw': 150, 'pitch': 4},
                 hand={'Right': {'dir': (.20, .30, .50), 'ext': .62},
                       'Left': {'dir': (-.16, .36, .46), 'ext': .62}},
                 foot={'Right': {'mode': 'reach', 'dir': (-.04, -.95, .30), 'ext': .95, 'yaw': -206, 'pitch': -10, 'knee': (.95, .05)},
                       'Left': {'yaw': -150, 'pitch': 26}}),
        spin_key(33, -252, 'ease-out',
                 hips={'pitch': 8, 'roll': 5, 'dz': -.058}, spine={'yaw': 2, 'pitch': 6}, neck={'yaw': 150},
                 hand={'Right': {'dir': (.26, .12, .54), 'ext': .62},
                       'Left': {'dir': (-.18, .14, .52), 'ext': .62}},
                 foot={'Right': {'mode': 'reach', 'dir': (-.10, -.82, .04), 'ext': .74, 'yaw': -248, 'pitch': 4, 'knee': (.95, .05)},
                       'Left': {'yaw': -196, 'pitch': 28}}),
        # Unwind and bring the kicking foot back over the stance.
        spin_key(44, -318, 'smooth',
                 hips={'pitch': 6, 'dz': -.070}, spine={'yaw': -6}, neck={'yaw': 92},
                 hand={'Right': {'dir': (.34, -.30, .56), 'ext': .62},
                       'Left': {'dir': (-.14, -.44, .54), 'ext': .62}},
                 foot={'Right': {'mode': 'reach', 'dir': (-.22, -.10, -.94), 'ext': .70, 'yaw': -320, 'pitch': 14, 'knee': (.85, .12)},
                       'Left': {'yaw': -262, 'pitch': 22}}),
        # Hovering straight above the ball it left from, then straight down onto it.
        spin_key(53, -362, 'smooth',
                 hips={'pitch': 7, 'dz': -.078}, spine={'yaw': -8}, neck={'yaw': 40},
                 hand={'Right': {'dir': (.36, -.48, .54), 'ext': .62},
                       'Left': {'dir': (-.22, -.66, .46), 'ext': .64}},
                 foot={'Right': {'lift': .14, 'pitch': 24}, 'Left': {'yaw': -340, 'pitch': 14}}),
        spin_key(59, -378, 'ease-out',
                 hips={'pitch': 6, 'dz': -.066}, spine={'yaw': -8}, neck={'yaw': 28},
                 hand={'Right': {'dir': (.36, -.52, .54), 'ext': .62},
                       'Left': {'dir': (-.24, -.72, .44), 'ext': .66}},
                 foot={'Right': {'yaw': -404, 'pitch': 18}, 'Left': {'yaw': -364, 'pitch': 4}}),
        # Frame 66 is the guard again, one whole turn later: -382 is -22 modulo a full revolution.
        at(66, pivot_hips(pose(foot={'Right': {'yaw': -412}, 'Left': {'yaw': -374}}), LEAD, -382)),
    ], 'spinning back kick; one full revolution around the planted lead ball, head leads the turn')

CLIPS = [RIGHT_CROSS, LEFT_HOOK, RIGHT_KICK, UPPERCUT, LEFT_KICK, SPIN_KICK]

# --------------------------------------------------------------------------------------------
# baking
# --------------------------------------------------------------------------------------------

def interpolate(keys, frame):
    if frame <= keys[0]['frame']:
        return keys[0]['key']
    if frame >= keys[-1]['frame']:
        return keys[-1]['key']
    for previous, following in zip(keys, keys[1:]):
        if previous['frame'] <= frame <= following['frame']:
            span = following['frame'] - previous['frame']
            raw = (frame - previous['frame']) / span if span else 1.0
            return mix(previous['key'], following['key'], EASINGS[following['easing']](raw))
    return keys[-1]['key']

def mix(a, b, s):
    """Blend two full keys. Directions are re-normalised; a mode switch snaps at the midpoint."""
    out = {}
    for group in ('hips', 'spine', 'neck'):
        out[group] = {k: a[group][k] + (b[group][k] - a[group][k]) * s for k in a[group]}
    out['shoulder'] = {side: {k: a['shoulder'][side][k] + (b['shoulder'][side][k] - a['shoulder'][side][k]) * s
                              for k in a['shoulder'][side]} for side in a['shoulder']}
    out['hand'] = {}
    for side in a['hand']:
        first, second = a['hand'][side], b['hand'][side]
        merged = direction(first['dir']).lerp(direction(second['dir']), s).normalized()
        out['hand'][side] = {
            'dir': tuple(merged), 'ext': blend(first['ext'], second['ext'], s),
            'twist': blend(first['twist'], second['twist'], s),
            'elbow': blend(first['elbow'], second['elbow'], s),
        }
    out['foot'] = {}
    for side in a['foot']:
        first, second = a['foot'][side], b['foot'][side]
        merged = {'yaw': blend(first['yaw'], second['yaw'], s), 'pitch': blend(first['pitch'], second['pitch'], s),
                  'knee': blend(first['knee'], second['knee'], s)}
        if first['mode'] == second['mode'] == 'plant':
            merged.update({'mode': 'plant', 'ball': blend(first['ball'], second['ball'], s),
                           'lift': blend(first['lift'], second['lift'], s)})
        elif first['mode'] == second['mode'] == 'reach':
            direction_mix = direction(first['dir']).lerp(direction(second['dir']), s).normalized()
            merged.update({'mode': 'reach', 'dir': tuple(direction_mix), 'ext': blend(first['ext'], second['ext'], s)})
        else:
            # Leaving or meeting the ground. Both targets are carried and `apply` blends them in
            # world space against the posed hip, so the endpoints stay exact and nothing jumps.
            planted, lifted = (first, second) if first['mode'] == 'plant' else (second, first)
            weight = (1 - s) if first['mode'] == 'plant' else s
            merged.update({'mode': 'blend', 'ball': planted['ball'], 'lift': planted['lift'],
                           'dir': lifted['dir'], 'ext': lifted['ext'], 'plantWeight': weight})
        out['foot'][side] = merged
    return out

BONES = [bone.name for bone in rig.pose.bones]

def bake(clip):
    """Solve every frame with NO action bound, then write the recorded poses as keys.

    Posing and keying cannot be interleaved on this rig. `apply` reads evaluated bone matrices, so it
    has to flush the depsgraph between joints — and once an action is assigned, each of those flushes
    re-applies the half-written action on top of the pose being built. The result still *replays*
    consistently, which is exactly why it went unnoticed: the clip was a lagged, flattened version of
    the intent, and every in-session check agreed with it. Solving first and keying second removes
    the feedback entirely.
    """
    rig.animation_data.action = None
    clear_pose()

    solved, drift = [], {'error': 0.0, 'frame': 0}
    for frame in range(1, clip['frames'] + 1):
        key = interpolate(clip['keys'], frame)
        apply(key)
        error = contact_error(key)
        if error > drift['error']:
            drift.update(error=error, frame=frame)
        solved.append({bone.name: (bone.location.copy(), bone.rotation_quaternion.copy())
                       for bone in rig.pose.bones})

    # The curves are written directly instead of through `keyframe_insert`: with an action bound,
    # that operator was storing values that did not match the properties it was asked to key, and the
    # clip silently came out as a flattened version of the solve.
    action = bpy.data.actions.new(clip['clip'])
    action.use_fake_user = True
    slot = action.slots.new(id_type='OBJECT', name=rig.name)
    channels = action.layers.new('Combo').strips.new(type='KEYFRAME').channelbags.new(slot)

    for bone in rig.pose.bones:
        rotations = [snapshot[bone.name][1].copy() for snapshot in solved]
        # Quaternions are keyed on the same hemisphere as the frame before, otherwise a sign flip
        # makes the interpolation take the long way round and the joint spins between two frames.
        for previous, current in zip(rotations, rotations[1:]):
            if previous.dot(current) < 0:
                current.negate()
        tracks = [('rotation_quaternion', 4, [tuple(q) for q in rotations]),
                  ('location', 3, [tuple(snapshot[bone.name][0]) for snapshot in solved])]
        for prop, width, rows in tracks:
            for axis in range(width):
                curve = channels.fcurves.new(f'pose.bones["{bone.name}"].{prop}', index=axis)
                curve.keyframe_points.add(count=len(rows))
                flat = []
                for index, row in enumerate(rows):
                    flat += [index + 1, row[axis]]
                curve.keyframe_points.foreach_set('co', flat)
                curve.keyframe_points.foreach_set('interpolation', [1] * len(rows))   # LINEAR
                curve.update()

    rig.animation_data.action = action
    rig.animation_data.action_slot = slot
    return action, drift, solved

def contact_error(key):
    """How far each planted toe ends up from the ball it was told to stand on, in millimetres."""
    worst = 0.0
    for side in ('Right', 'Left'):
        spec = key['foot'][side]
        if spec['mode'] != 'plant':
            continue
        wanted = Vector((spec['ball'][0], spec['ball'][1], FLOOR[side] + spec['lift']))
        worst = max(worst, (head(side + 'ToeBase') - wanted).length * 1000)
    return worst

def replay_error(clip, action, solved):
    """Play the action back and compare every joint against the pose that was solved for that frame.

    Comparing against the solve — not against a tolerance on the feet — is the check that matters:
    an action can replay perfectly consistently and still not be the animation that was authored.
    """
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]
    worst = {'degrees': 0.0, 'frame': 0, 'bone': '', 'toeMillimetres': 0.0}
    for frame in range(1, clip['frames'] + 1):
        # Wipe the pose first: otherwise a replay that silently fails to drive the rig just measures
        # the pose `apply` left behind and reports a clean pass for a broken action.
        for bone in rig.pose.bones:
            bone.location = (0, 0, 0)
            bone.rotation_quaternion = (1, 0, 0, 0)
            bone.scale = (1, 1, 1)
        update()
        scene.frame_set(frame)
        update()
        for bone in rig.pose.bones:
            wanted = solved[frame - 1][bone.name][1]
            degrees = math.degrees(2 * math.acos(min(1.0, abs(bone.rotation_quaternion.dot(wanted)))))
            if degrees > worst['degrees']:
                worst.update(degrees=degrees, frame=frame, bone=bone.name)
        worst['toeMillimetres'] = max(worst['toeMillimetres'], contact_error(interpolate(clip['keys'], frame)))
    return worst

# The guard is solved once on its own first: if the stance itself does not put both balls on the
# floor, nothing built on top of it can either.
apply(pose())
print('GUARD floor', {k: round(v, 5) for k, v in FLOOR.items()},
      '| toeL', [round(v, 5) for v in head('LeftToeBase')],
      '| toeR', [round(v, 5) for v in head('RightToeBase')],
      '| error %.3f mm' % contact_error(pose()), flush=True)

manifest, broken = [], []
for clip in CLIPS:
    action, drift, solved = bake(clip)
    replay = replay_error(clip, action, solved)
    manifest.append({k: clip[k] for k in ('id', 'clip', 'windup', 'active', 'recover', 'frames', 'contactFrame', 'note')})
    manifest[-1].update(plantErrorMillimetres=round(drift['error'], 3), plantErrorFrame=drift['frame'],
                        replayErrorDegrees=round(replay['degrees'], 5))
    if action.name != clip['clip']:
        broken.append('%s was created as %s — a stale clip of that name is still in the file'
                      % (clip['clip'], action.name))
    print('BAKED', clip['clip'], clip['frames'], 'frames, contact at', clip['contactFrame'],
          '| planted toe %.2f mm at %d | replay %.4f deg at %s/%d'
          % (drift['error'], drift['frame'], replay['degrees'], replay['bone'], replay['frame']), flush=True)
    # Half a degree is the residual of Blender's own keyframe evaluation on this rig — about two
    # millimetres at the ankle. The bug this gate exists for was an order of magnitude worse.
    if replay['degrees'] > .6:
        broken.append('%s replays %.3f deg away from the solve at %s/%d'
                      % (clip['clip'], replay['degrees'], replay['bone'], replay['frame']))
if broken:
    raise SystemExit('AUTHORING ABORTED — the baked actions do not match the solve:\n - ' + '\n - '.join(broken))

rig.animation_data.action = None
scene.frame_set(1)
clear_pose()

(ROOT / 'docs/combo-clip-manifest.json').write_text(json.dumps(
    {'fps': FPS, 'source': 'public/models/gunslinger.glb', 'blend': 'art/blender/Gunslinger_Combo.blend',
     'preservedActions': ORIGINAL_ACTIONS, 'clips': manifest}, indent=1))

(ROOT / 'art/blender').mkdir(parents=True, exist_ok=True)
(ROOT / 'art/processed').mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
# The editable source keeps every original action AND the six new ones.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art/blender/Gunslinger_Combo.blend'), compress=True)

# The sibling export carries only the new clips plus Idle, which the merge uses as a parity probe.
keep = {clip['clip'] for clip in CLIPS} | {'Idle'}
for action in list(bpy.data.actions):
    if action.name not in keep:
        bpy.data.actions.remove(action)
if rig.animation_data:
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if obj.type in ('ARMATURE', 'MESH'):
        obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'art/processed/gunslinger-combos.glb'), export_format='GLB',
                          use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
                          export_anim_single_armature=True, export_bake_animation=True,
                          export_image_format='NONE')
print('COMBO ACTIONS READY', [c['clip'] for c in CLIPS], flush=True)
