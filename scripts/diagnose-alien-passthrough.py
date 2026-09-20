"""Converte cada modelo baixado para GLB SEM NENHUMA alteração. É o lado "A" do teste A/B.

Não normaliza escala, não mexe em pose, não filtra ação, não remove malha, não toca em NLA.
Importa e exporta. Serve exclusivamente para separar duas hipóteses:

- se o GLB de passagem também sai quebrado no Babylon, o problema é a viagem de ida e volta pelo
  Blender (ou o arquivo de origem), não as nossas etapas de preparo;
- se o de passagem sai correto e o preparado sai quebrado, o problema está no nosso preparo.

Uso:
  <blender> -b -P scripts/diagnose-alien-passthrough.py -- <pasta-dos-downloads> <pasta-de-saida>
"""
import bpy,sys
from pathlib import Path

argv=sys.argv[sys.argv.index('--')+1:]
SOURCE=Path(argv[0]);OUT=Path(argv[1]);OUT.mkdir(parents=True,exist_ok=True)

UIDS={
 'ninja':'d332cac883f54a2c98492e85f41455b2',
 'demon':'43e163c12f304a35b1f85476ca2549f6',
 'predator':'3ddc6f711201449cbc33617f430d1b20',
 'strutter':'100254f3a4794ca491f5143e96a43ce5',
 'hound':'d3507ae804604930b1b8534d2ac1c0da',
}

for label,uid in UIDS.items():
 folder=SOURCE/uid
 source=next((p for p in folder.rglob('*.gltf')),None) or next((p for p in folder.rglob('*.glb')),None)
 if not source:
  print('SEM ORIGEM',label);continue
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.context.preferences.filepaths.save_version=0
 bpy.ops.import_scene.gltf(filepath=str(source))
 rigs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
 actions=[a.name for a in bpy.data.actions]
 out=OUT/f'passthrough-{label}.glb'
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',
                           export_animations=True,export_animation_mode='ACTIONS',
                           export_nla_strips=True,export_reset_pose_bones=True,
                           export_anim_single_armature=True,export_image_format='JPEG',
                           export_apply=False,export_yup=True)
 print(f'PASSTHROUGH {label}: {out.stat().st_size/1048576:.2f} MB | armatures {len(rigs)} '
       f'| pose_position {rigs[0].data.pose_position if rigs else "-"} | acoes {len(actions)}')
