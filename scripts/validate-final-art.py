import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent;report=[]
for name in ['Farm_World_Polished.blend','Gunslinger_Final.blend']:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender'/name))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    assert meshes,'Missing meshes'
    if name.startswith('Gunslinger'):
        rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
        assert 'RightHand' in rig.pose.bones and 'LeftHand' in rig.pose.bones
        assert all(n in bpy.data.actions for n in ['Backflip','JumpRise','JumpFall','Aim'])
        assert bpy.data.objects.get('RightWeaponGrip') and bpy.data.objects.get('LeftWeaponGrip')
    report.append({'file':name,'meshes':len(meshes),'actions':list(bpy.data.actions.keys()),'opens':True})
(ROOT/'docs/art-validation.json').write_text(json.dumps(report,indent=2))
print('FINAL BLENDER SOURCES VALIDATED',flush=True)
