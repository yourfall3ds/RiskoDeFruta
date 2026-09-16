"""Dump the gunslinger rig so the combo authoring works on measured bones, not guesses.

Prints the bone hierarchy with rest heads/tails in world space, the existing actions (which must all
survive), and whether the rig carries finger bones for closed fists. Read-only: nothing is saved.
"""
import bpy, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/gunslinger.glb'))
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == 'ARMATURE')

report = {'armature': rig.name, 'boneCount': len(rig.pose.bones), 'bones': [], 'actions': [], 'meshes': [], 'images': []}
for bone in rig.pose.bones:
    head = rig.matrix_world @ bone.head
    tail = rig.matrix_world @ bone.tail
    report['bones'].append({
        'name': bone.name,
        'parent': bone.parent.name if bone.parent else None,
        'head': [round(v, 4) for v in head],
        'tail': [round(v, 4) for v in tail],
        'length': round(bone.length, 4),
    })
def curve_count(action):
    """Blender 5 slotted actions: fcurves live in a channelbag per slot, not on the action."""
    total = 0
    for layer in action.layers:
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', []):
                total += len(bag.fcurves)
    return total

for action in bpy.data.actions:
    start, end = action.frame_range
    report['actions'].append({'name': action.name, 'start': round(start, 2), 'end': round(end, 2),
                              'curves': curve_count(action), 'slots': [s.identifier for s in action.slots]})
for obj in scene.objects:
    if obj.type == 'MESH':
        report['meshes'].append({'name': obj.name, 'vertices': len(obj.data.vertices), 'materials': [m.name for m in obj.data.materials if m]})
for image in bpy.data.images:
    if image.size[0]:
        report['images'].append({'name': image.name, 'size': list(image.size)})

fingers = [b['name'] for b in report['bones'] if any(k in b['name'].lower() for k in ('finger', 'thumb', 'index', 'middle', 'ring', 'pinky'))]
report['fingerBones'] = fingers
report['hasFingers'] = bool(fingers)
report['lowestBoneZ'] = round(min(b['head'][2] for b in report['bones']), 4)

out = ROOT / 'docs/combo-rig-inspection.json'
out.write_text(json.dumps(report, indent=1))
print('COMBO RIG INSPECTION', out, flush=True)
print(json.dumps({k: report[k] for k in ('armature', 'boneCount', 'hasFingers', 'fingerBones', 'lowestBoneZ')}, indent=1), flush=True)
print('ACTIONS', [a['name'] for a in report['actions']], flush=True)
print('BONES', [b['name'] for b in report['bones']], flush=True)
