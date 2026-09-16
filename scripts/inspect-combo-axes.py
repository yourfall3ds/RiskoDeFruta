"""Check armature scale and bone tails: decides whether Blender's native IK can be used at all."""
import bpy
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for heuristic in ('TEMPERANCE', 'BLENDER', 'FORTUNE'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/gunslinger.glb'), bone_heuristic=heuristic)
    except TypeError as error:
        print('heuristic unsupported', heuristic, error, flush=True)
        continue
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    print('---', heuristic, 'scale', tuple(round(v, 5) for v in rig.scale), 'matrix_world', [round(v, 4) for r in rig.matrix_world for v in r], flush=True)
    for name in ('LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftArm', 'LeftForeArm', 'LeftHand'):
        bone = rig.pose.bones[name]
        print(' ', name,
              'head', tuple(round(v, 3) for v in bone.head),
              'tail', tuple(round(v, 3) for v in bone.tail),
              'len', round(bone.length, 4),
              'childHead', tuple(round(v, 3) for v in bone.children[0].head) if bone.children else None, flush=True)
