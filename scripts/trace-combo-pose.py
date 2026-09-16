"""Dump the posed world positions of one baked combo frame, straight out of the .blend.

Used to diff the authored pose against what the exported GLB actually plays. Read-only.
"""
import bpy, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'art/blender/Gunslinger_Combo.blend'))
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
if rig.animation_data:
    for tr in rig.animation_data.nla_tracks:
        tr.mute = True
action = bpy.data.actions['ComboRightCross']
rig.animation_data.action = action
if action.slots:
    rig.animation_data.action_slot = action.slots[0]

out = {'fps': scene.render.fps, 'scale': list(rig.scale), 'frames': {}}
for frame in (1, 9, 18, 45):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    out['frames'][str(frame)] = {
        bone.name: {
            'head': [round(v, 5) for v in rig.matrix_world @ bone.head],
            'basis': [round(v, 5) for v in bone.rotation_quaternion],
            'location': [round(v, 5) for v in bone.location],
        } for bone in rig.pose.bones
    }
(ROOT / 'docs/combo-pose-trace.json').write_text(json.dumps(out, indent=1))
print('TRACE READY', out['fps'], flush=True)
for name in ('Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'):
    print(' f1', name, out['frames']['1'][name]['head'], 'q', out['frames']['1'][name]['basis'], flush=True)
