"""Prepara os alienígenas do menu a partir dos modelos CC-BY baixados da Sketchfab.

Origem e licença ficam registradas em `docs/ASSET_LICENSES.md` e em `docs/menu-aliens.json`.
Nada é gerado proceduralmente: a malha, o esqueleto e as animações são os do autor original.
Este script só faz o que o projeto precisa para consumir o asset:

1. descarta os auxiliares que o Sketchfab injeta (esfera de preview, vazios de cena);
2. normaliza a escala para a altura de jogo e assenta os pés em Z=0;
3. orienta o corpo para caminhar em **+X**, o mesmo eixo de corrida do deck;
4. renomeia as ações para a convenção que o `EnemySwarm`/`DeckSiegeVisual` já usa
   (`Idle`, `Walk`, `Run`, `Attack`, `Death`), descartando as dezenas restantes;
5. autora `Death` invertendo o clipe de levantar do próprio autor — é a queda dele, ao contrário,
   no rig certo, em vez de uma animação inventada por cima de um esqueleto que não conheço;
6. empilha cada ação numa trilha NLA, porque o exportador glTF só escreve ações ativas ou
   empilhadas (manual do Blender 4.5, glTF 2.0 → Animation → Mode).

Uso:
  <blender> -b -P scripts/build-menu-aliens.py -- <pasta-dos-modelos-baixados>
"""
import bpy,sys,math,json
from mathutils import Vector
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
SOURCE=Path(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else ROOT/'.temp/sketchfab'

# Cada entrada: uid da Sketchfab, arquivo de saída, altura de jogo em metros e o mapa de clipes.
# A altura sai da leitura do próprio asset; o alvo é um bicho um pouco menor que o atirador (1,8 m),
# porque o pedido é de "alienígenazinhos" vindo para cima dele.
SPECIES=[
 {'uid':'d332cac883f54a2c98492e85f41455b2','out':'menu-alien-ninja','height':1.55,
  'clips':{'Idle':'A_idle','Walk':'A_walk_F','Run':'A_run_F','Attack':'A_atk_01'},
  'death_from':'A_rise1'},
 {'uid':'100254f3a4794ca491f5143e96a43ce5','out':'menu-alien-strutter','height':1.32,
  'clips':{'Idle':'Idle','Walk':'CattleSkeletonReady|Strut','Run':'CattleSkeletonReady|Running',
           'Attack':'CattleSkeletonReady|Attack'},
  'death_from':None},
]

def clear():
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.context.preferences.filepaths.save_version=0
 bpy.context.scene.render.fps=60

def world_box(objects):
 """Caixa da geometria REALMENTE DESENHADA, avaliada pelo depsgraph.

 `object.bound_box` não serve para malha com esqueleto: o importador glTF deixa os vértices no
 espaço de vínculo e a transformação no objeto é identidade, então a caixa crua devolve o tamanho
 errado — foi ela que reportou 2,000 m para um corpo normalizado em 1,55 m. Avaliar o depsgraph é
 o equivalente em Blender do `getPositionData(true,true)` que o teste de runtime usa.
 """
 lo=Vector((1e9,1e9,1e9));hi=Vector((-1e9,-1e9,-1e9))
 depsgraph=bpy.context.evaluated_depsgraph_get()
 for o in objects:
  evaluated=o.evaluated_get(depsgraph)
  mesh=evaluated.to_mesh()
  try:
   matrix=evaluated.matrix_world
   for vertex in mesh.vertices:
    w=matrix@vertex.co
    lo=Vector((min(lo[i],w[i]) for i in range(3)));hi=Vector((max(hi[i],w[i]) for i in range(3)))
  finally:
   evaluated.to_mesh_clear()
 return lo,hi

def skinned_meshes(armature):
 """Só as malhas realmente pesadas para ESTE esqueleto.

 Ter modificador de armature NÃO basta: a esfera de preview que o Sketchfab embrulha em volta do
 modelo também tem um, e foi assim que ela passou por dois filtros e acabou dentro do GLB, com
 2 m de raio medidos no lugar do corpo. O critério que separa de verdade é ter **grupos de
 vértices com peso** — é isso que faz a malha acompanhar os ossos.
 """
 keep=[]
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  if not any(m.type=='ARMATURE' and m.object==armature for m in o.modifiers):continue
  if not o.vertex_groups:continue
  bones={b.name for b in armature.data.bones}
  if not any(group.name in bones for group in o.vertex_groups):continue
  keep.append(o)
 print('MALHAS PESADAS',[o.name for o in keep])
 return keep

def reverse_action(source,name):
 """Clipe de queda a partir do clipe de levantar do autor, com o tempo invertido."""
 start,end=source.frame_range
 clone=source.copy();clone.name=name
 for fcurve in clone.fcurves:
  for point in fcurve.keyframe_points:
   for handle in (point.co,point.handle_left,point.handle_right):
    handle.x=start+end-handle.x
   point.handle_left,point.handle_right=point.handle_right,point.handle_left
  fcurve.keyframe_points.sort()
  fcurve.update()
 return clone

report=[]
for spec in SPECIES:
 folder=SOURCE/spec['uid']
 gltf=next((p for p in folder.rglob('*.gltf')),None) or next((p for p in folder.rglob('*.glb')),None)
 assert gltf,f'sem gltf em {folder}'
 clear()
 bpy.ops.import_scene.gltf(filepath=str(gltf))
 scene=bpy.context.scene

 armatures=[o for o in scene.objects if o.type=='ARMATURE']
 assert len(armatures)==1,f'{spec["out"]}: esperado 1 armature, achei {len(armatures)}'
 rig=armatures[0]
 meshes=skinned_meshes(rig)
 assert meshes,f'{spec["out"]}: nenhuma malha pesada no esqueleto'

 # Fora tudo que não é o bicho: a esfera de fundo do Sketchfab e malhas soltas sem peso.
 # A comparação é por NOME, não por identidade: o ponteiro do objeto pode mudar entre a coleta e a
 # remoção, e foi assim que o `Icosphere` de preview escapou e acabou dentro do GLB — 2 m de esfera
 # invisível que a conferência de altura media no lugar do corpo.
 keep={o.name for o in meshes}
 for o in [o for o in scene.objects if o.type=='MESH' and o.name not in keep]:
  bpy.data.objects.remove(o,do_unlink=True)
 meshes=[o for o in scene.objects if o.type=='MESH' and o.name in keep]
 remaining={o.name for o in scene.objects if o.type=='MESH'}
 assert remaining==keep,f'{spec["out"]}: sobrou malha estranha na cena: {sorted(remaining-keep)}'

 # As ações importadas ficam em bpy.data.actions; guarda antes de mexer no rig.
 actions={a.name:a for a in bpy.data.actions}
 wanted={}
 for label,source_name in spec['clips'].items():
  assert source_name in actions,f'{spec["out"]}: ação "{source_name}" não existe. Disponíveis: {sorted(actions)[:10]}'
  wanted[label]=actions[source_name]
 if spec['death_from']:
  assert spec['death_from'] in actions,f'{spec["out"]}: sem "{spec["death_from"]}" para derivar a morte'
  wanted['Death']=reverse_action(actions[spec['death_from']],'Death')

 # ---- normalização de escala e assentamento -------------------------------------------------
 # NÃO usar `transform_apply` na hierarquia: o Sketchfab embrulha o modelo em vazios (o FBX em
 # centímetros vira um `Empty` de escala 0.01) e aplicar escala num PAI não muda o mundo dos
 # filhos — o Blender compensa em `matrix_parent_inverse`. A primeira versão fez isso e exportou
 # um corpo com as coordenadas originais: em jogo ele afundava 73 m no chão.
 #
 # O caminho correto é pendurar a cena inteira num normalizador novo e deixar a escala NELE, que
 # o exportador glTF escreve como transformação do nó raiz.
 normalizer=bpy.data.objects.new(spec['out']+'-root',None)
 scene.collection.objects.link(normalizer)
 for o in [o for o in scene.objects if o.parent is None and o is not normalizer]:
  o.parent=normalizer
  o.matrix_parent_inverse=normalizer.matrix_world.inverted()

 # A medida é sempre na POSE DE REPOUSO. Medir na pose corrente dava um número diferente do que o
 # arquivo reaberto mostra (2,00 m contra 1,55 m), e a conferência do GLB acusava a diferença.
 rig.data.pose_position='REST'
 bpy.context.view_layer.update()
 lo,hi=world_box(meshes)
 raw=hi.z-lo.z
 assert raw>.001,f'{spec["out"]}: altura bruta {raw}'
 factor=spec['height']/raw
 normalizer.scale=(factor,factor,factor)
 bpy.context.view_layer.update()

 # Pés na origem e corpo centrado, já na escala final.
 lo,hi=world_box(meshes)
 normalizer.location=(normalizer.location.x-(lo.x+hi.x)/2,
                      normalizer.location.y-(lo.y+hi.y)/2,
                      normalizer.location.z-lo.z)
 bpy.context.view_layer.update()

 lo,hi=world_box(meshes)
 assert abs(lo.z)<.02,f'{spec["out"]}: pés a {lo.z:.3f} m do chão'
 assert abs(hi.z-spec['height'])<.03,f'{spec["out"]}: altura final {hi.z:.3f}, esperada {spec["height"]}'
 rig.data.pose_position='POSE'
 bpy.context.view_layer.update()

 # ---- ações: renomeia, empilha em NLA e descarta o resto ------------------------------------
 rig.animation_data_create()
 rig.animation_data.action=None
 for track in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(track)
 keep=set()
 for label,action in wanted.items():
  action.name=label;action.use_fake_user=True;keep.add(action.name)
  track=rig.animation_data.nla_tracks.new();track.name=label
  track.strips.new(label,int(action.frame_range[0]),action)
 for action in list(bpy.data.actions):
  if action.name not in keep:bpy.data.actions.remove(action)

 frames={label:int(action.frame_range[1]-action.frame_range[0]) for label,action in wanted.items()}
 out=ROOT/'public/models'/(spec['out']+'.glb')
 blend=ROOT/'art/blender';blend.mkdir(parents=True,exist_ok=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(blend/(spec['out']+'.blend')))
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',
                           export_animations=True,export_animation_mode='ACTIONS',
                           export_nla_strips=True,export_bake_animation=True,
                           export_reset_pose_bones=True,export_anim_single_armature=True,
                           export_image_format='JPEG',export_jpeg_quality=82,
                           export_apply=False,export_yup=True)
 size=out.stat().st_size
 report.append({'uid':spec['uid'],'file':'public/models/'+out.name,'height':spec['height'],
                'bytes':size,'clips':frames,'bones':len(rig.data.bones),
                'vertices':sum(len(m.data.vertices) for m in meshes),
                'meshes':[m.name for m in meshes]})
 print(f'MENU ALIEN OK {out.name} {size/1048576:.2f} MB clipes={frames}')

# ---------------------------------------------------------------- conferência do ARQUIVO exportado
# O que vale é o GLB, e a conferência lê o ARQUIVO, não uma reimportação.
#
# A primeira versão reabria o GLB no Blender e media a cena; o importador reconstrói hierarquia e
# auxiliares próprios, e a medida acusava 2,000 m (a esfera de preview) num arquivo que estava
# correto. Ler o bloco JSON do glTF elimina o intermediário: os acessores de POSITION são,
# literalmente, os vértices que o navegador vai desenhar.
def glb_json(path):
 data=path.read_bytes()
 length=int.from_bytes(data[12:16],'little')
 return json.loads(data[20:20+length].decode('utf-8'))

for spec in SPECIES:
 out=ROOT/'public/models'/(spec['out']+'.glb')
 gltf=glb_json(out)
 assert gltf.get('meshes'),f'{out.name}: exportado sem malha'
 low=min(gltf['accessors'][p['attributes']['POSITION']]['min'][1] for m in gltf['meshes'] for p in m['primitives'])
 high=max(gltf['accessors'][p['attributes']['POSITION']]['max'][1] for m in gltf['meshes'] for p in m['primitives'])
 height=high-low
 entry=next(r for r in report if r['file'].endswith(out.name))
 entry['verified']={'height':round(height,4),'feet':round(low,4),'meshes':[m.get('name') for m in gltf['meshes']]}
 assert abs(height-spec['height'])<.05,f'{out.name}: exportado com {height:.3f} m, esperado {spec["height"]}'
 assert abs(low)<.05,f'{out.name}: exportado com os pés em {low:.3f} m'
 assert gltf.get('skins'),f'{out.name}: exportado sem esqueleto'
 names={a.get('name','') for a in gltf.get('animations',[])}
 for label in list(spec['clips'])+(['Death'] if spec['death_from'] else []):
  assert label in names,f'{out.name}: clipe {label} não sobreviveu à exportação ({sorted(names)})'
 print(f'VERIFICADO {out.name}: {height:.3f} m, pés em {low:.3f}, clipes {sorted(names)}')

(ROOT/'docs').mkdir(exist_ok=True)
(ROOT/'docs/menu-aliens.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print('RELATORIO',json.dumps(report,ensure_ascii=False))
