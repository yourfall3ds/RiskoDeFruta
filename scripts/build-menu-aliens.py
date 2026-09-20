"""Converte os modelos CC-BY baixados da Sketchfab em GLB único, SEM alterar rig nem animação.

Origem e licença ficam em `docs/ASSET_LICENSES.md` e em `docs/menu-aliens.json`.

## Por que este script quase não faz nada

A versão anterior normalizava escala, assentava os pés em Z=0 e escolhia um subconjunto de clipes,
tudo dentro do Blender. O diagnóstico (`scripts/diagnose-aliens.mjs`) provou que isso **destruía as
animações** de três dos cinco modelos: os clipes continuavam no arquivo, com os nomes certos, mas
não moviam mais a malha — a geometria deformada ficava idêntica em `Idle`, em `Walk` e na pose de
vínculo. A conversão de passagem dos MESMOS originais preservava tudo.

A causa é o reparenteamento: pendurar a cena inteira num `Empty` normalizador e dar escala a ele
muda a avaliação dos rigs profundos que o Sketchfab entrega (729 e 744 ossos, hierarquias de
vazios), e o exportador grava canais que não acionam mais a pele.

Então a regra passou a ser: **o Blender só empacota; quem normaliza é o Babylon**, em
`src/world/AnimatedCharacter.ts`, a partir da pose animada. Aqui sobraram duas operações, ambas
inofensivas para o esqueleto:

1. remover as malhas auxiliares que o Sketchfab injeta (a esfera de preview), que não têm peso
   em osso nenhum e por isso não participam da deformação;
2. reempacotar em GLB único com as texturas em JPEG, porque o original vem como `.gltf` mais
   dezenas de arquivos soltos, somando centenas de megabytes.

Nenhuma ação é descartada, nenhuma pose é trocada, nenhuma trilha NLA é silenciada e nada é
reparenteado.

Uso:
  <blender> -b -P scripts/build-menu-aliens.py -- <pasta-dos-modelos-baixados>
"""
import bpy,sys,json
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
_ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
SOURCE=Path(_ARGS[0]) if _ARGS else ROOT/'.temp/sketchfab'
# Segundo argumento opcional: lista separada por vírgula com os nomes de saída a reconstruir.
# Reempacotar os seis leva dezenas de minutos; trocar um modelo não deveria custar isso.
ONLY={name.strip() for name in _ARGS[1].split(',')} if len(_ARGS)>1 else None

# uid da Sketchfab e nome do arquivo de runtime. Altura, orientação e clipes são resolvidos no
# Babylon (`MENU_ALIEN_PROFILES`), não aqui — este script não decide apresentação.
SPECIES=[
 {'uid':'d332cac883f54a2c98492e85f41455b2','out':'menu-alien-ninja'},
 {'uid':'43e163c12f304a35b1f85476ca2549f6','out':'menu-alien-demon'},
 {'uid':'3ddc6f711201449cbc33617f430d1b20','out':'menu-alien-predator'},
 {'uid':'100254f3a4794ca491f5143e96a43ce5','out':'menu-alien-strutter'},
 {'uid':'d3507ae804604930b1b8534d2ac1c0da','out':'menu-alien-hound'},
 # E.T. clássico: o primeiro que o disco deposita. Cabeçudo, olhos pretos, um clipe só.
 {'uid':'4983ac47fa674c1e8e9230c8afa4546e','out':'menu-alien-grey'},
]

def clear():
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.context.preferences.filepaths.save_version=0
 bpy.context.scene.render.fps=60

def belongs_to_rig(o,armature):
 """A malha faz parte do personagem?

 São TRÊS formas legítimas de pertencer, e considerar só a primeira é um erro caro: o demônio
 carrega garras, presas, espinhos e braçadeiras como malhas **presas a osso**, sem grupo de
 vértices nenhum. Filtrar só por peso jogava 18 peças do corpo fora.

 O que sobra de fato é a esfera de preview do Sketchfab: solta na cena, sem peso, sem osso pai e
 fora da hierarquia do esqueleto.
 """
 bones={b.name for b in armature.data.bones}
 if any(group.name in bones for group in o.vertex_groups):return True      # pesada no esqueleto
 if o.parent_type=='BONE' and o.parent==armature:return True               # presa a um osso
 ancestor=o.parent
 while ancestor is not None:                                               # descendente do rig
  if ancestor==armature:return True
  ancestor=ancestor.parent
 return False

def character_meshes(armature):
 return [o for o in bpy.context.scene.objects if o.type=='MESH' and belongs_to_rig(o,armature)]

report=[]
for spec in SPECIES:
 if ONLY is not None and spec['out'] not in ONLY:continue
 folder=SOURCE/spec['uid']
 source=next((p for p in folder.rglob('*.gltf')),None) or next((p for p in folder.rglob('*.glb')),None)
 assert source,f'sem gltf em {folder}'
 clear()
 bpy.ops.import_scene.gltf(filepath=str(source))
 scene=bpy.context.scene

 armatures=[o for o in scene.objects if o.type=='ARMATURE']
 assert len(armatures)==1,f'{spec["out"]}: esperado 1 armature, achei {len(armatures)}'
 rig=armatures[0]
 meshes=character_meshes(rig)
 assert meshes,f'{spec["out"]}: nenhuma malha pesada no esqueleto'

 keep={o.name for o in meshes}
 dropped=[o.name for o in scene.objects if o.type=='MESH' and o.name not in keep]
 for name in dropped:
  obj=scene.objects.get(name)
  if obj:bpy.data.objects.remove(obj,do_unlink=True)

 actions=sorted(a.name for a in bpy.data.actions)
 out=ROOT/'public/models'/(spec['out']+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',
                           export_animations=True,export_animation_mode='ACTIONS',
                           export_nla_strips=True,export_reset_pose_bones=True,
                           export_anim_single_armature=True,export_image_format='JPEG',
                           export_jpeg_quality=82,export_apply=False,export_yup=True)
 report.append({'uid':spec['uid'],'file':'public/models/'+out.name,'bytes':out.stat().st_size,
                'bones':len(rig.data.bones),'meshes':[m.name for m in meshes],
                'auxiliaresRemovidos':dropped,'acoes':actions})
 print(f'EMPACOTADO {out.name}: {out.stat().st_size/1048576:.2f} MB | {len(rig.data.bones)} ossos '
       f'| {len(actions)} acoes | auxiliares fora: {dropped or "nenhum"}')

# Conferência do ARQUIVO: só estrutura, nada de tamanho ou pose — quem julga postura é o Babylon.
def glb_json(path):
 data=path.read_bytes()
 return json.loads(data[20:20+int.from_bytes(data[12:16],'little')].decode('utf-8'))

for entry,spec in zip(report,[s for s in SPECIES if ONLY is None or s['out'] in ONLY]):
 gltf=glb_json(ROOT/entry['file'])
 assert gltf.get('skins'),f'{entry["file"]}: exportado sem esqueleto'
 assert gltf.get('animations'),f'{entry["file"]}: exportado sem animação'
 assert gltf['skins'][0].get('inverseBindMatrices') is not None,f'{entry["file"]}: sem inverseBindMatrices'
 names={a.get('name','') for a in gltf['animations']}
 faltando=[a for a in entry['acoes'] if a not in names]
 assert not faltando,f'{entry["file"]}: acoes perdidas na exportacao: {faltando[:6]}'
 entry['verificado']={'animacoes':len(names),'juntas':len(gltf['skins'][0]['joints'])}
 print(f'VERIFICADO {Path(entry["file"]).name}: {len(names)} animacoes, {len(gltf["skins"][0]["joints"])} juntas')

(ROOT/'docs').mkdir(exist_ok=True)
(ROOT/'docs/menu-aliens.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print('RELATORIO em docs/menu-aliens.json')
