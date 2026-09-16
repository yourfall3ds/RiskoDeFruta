"""Measure the real rest pose, limb reach and ground plane before authoring any combo pose.

Everything the authoring script needs comes from here — no invented proportions. Read-only.
"""
import bpy, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/gunslinger.glb'), bone_heuristic='TEMPERANCE')
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == 'ARMATURE')

# The importer leaves NLA tracks driving the pose; mute them and clear the basis to see the rest rig.
if rig.animation_data:
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    rig.animation_data.action = None
for bone in rig.pose.bones:
    bone.matrix_basis.identity()
bpy.context.view_layer.update()

world = rig.matrix_world
rest = {b.name: {'head': [round(v, 4) for v in world @ b.head], 'tail': [round(v, 4) for v in world @ b.tail]} for b in rig.pose.bones}

def point(name, end='head'):
    return Vector(rest[name][end])

def span(a, b):
    return round((point(a) - point(b)).length, 4)

limbs = {
    'rightUpperArm': span('RightArm', 'RightForeArm'),
    'rightForeArm': span('RightForeArm', 'RightHand'),
    'rightArmReach': round((point('RightArm') - point('RightHand')).length, 4),
    'leftArmReach': round((point('LeftArm') - point('LeftHand')).length, 4),
    'rightThigh': span('RightUpLeg', 'RightLeg'),
    'rightShin': span('RightLeg', 'RightFoot'),
    'rightLegReach': round((point('RightUpLeg') - point('RightFoot')).length, 4),
    'stanceWidth': round(abs(point('LeftUpLeg').x - point('RightUpLeg').x), 4),
}
# Straight-arm reach is what limits a punch: shoulder to wrist with the elbow locked.
limbs['rightArmStraight'] = round(limbs['rightUpperArm'] + limbs['rightForeArm'], 4)
limbs['rightLegStraight'] = round(limbs['rightThigh'] + limbs['rightShin'], 4)

low = None
for obj in scene.objects:
    if obj.type != 'MESH':
        continue
    for corner in obj.bound_box:
        z = (obj.matrix_world @ Vector(corner)).z
        low = z if low is None else min(low, z)

idle = bpy.data.actions.get('Idle')
idle_pose = {}
if idle:
    rig.animation_data.action = idle
    rig.animation_data.action_slot = idle.slots[0]
    scene.frame_set(int(idle.frame_range[0]))
    bpy.context.view_layer.update()
    idle_pose = {b.name: [round(v, 4) for v in world @ b.head] for b in rig.pose.bones}
    idle_pose['_frameRange'] = [round(v, 2) for v in idle.frame_range]

report = {
    'armatureScale': [round(v, 5) for v in rig.scale],
    'forwardAxis': '-Y (headfront tail points -Y)',
    'restHeadTail': rest,
    'limbs': limbs,
    'meshLowestZ': round(low, 4) if low is not None else None,
    'restToeZ': {'left': rest['LeftToeBase']['head'][2], 'right': rest['RightToeBase']['head'][2]},
    'restAnkleZ': {'left': rest['LeftFoot']['head'][2], 'right': rest['RightFoot']['head'][2]},
    'idleFirstFrame': idle_pose,
}
out = ROOT / 'docs/combo-rig-measurements.json'
out.write_text(json.dumps(report, indent=1))
print('MEASUREMENTS', out, flush=True)
print(json.dumps({'limbs': limbs, 'meshLowestZ': report['meshLowestZ'], 'restToeZ': report['restToeZ'], 'restAnkleZ': report['restAnkleZ']}, indent=1), flush=True)
for name in ('Hips', 'Spine', 'neck', 'Head', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftHand', 'RightUpLeg', 'RightFoot', 'RightToeBase'):
    print(' rest', name, rest[name]['head'], flush=True)
