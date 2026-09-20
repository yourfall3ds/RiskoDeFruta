"""Empacota os modelos de fazenda baixados da Sketchfab em GLB unico, leve e autocontido.

Origem e licenca ficam em `docs/farm-assets.md` e em `docs/farm-assets.json`.

## Regras herdadas de `scripts/build-menu-aliens.py`

Aquele script provou, com diagnostico, que **reparentear ou reescalar um rig do Sketchfab destroi a
animacao**: os clipes continuam no arquivo, com os nomes certos, e simplesmente nao movem mais a
malha. Entao aqui vale a mesma lei: em modelo COM esqueleto o Blender so empacota — nao junta
malha, nao aplica escala, nao decima, nao reparenteia. Quem normaliza altura e orientacao e o
Babylon, em tempo de execucao.

Modelo SEM esqueleto nao tem esse risco, e ai sim vale mexer, porque o custo de runtime e real:

* o milho vem como 42 objetos soltos. Instanciado as centenas, isso seriam 42 draw calls por pe de
  milho. Juntar em uma malha unica (o Blender preserva os 3 materiais como slots) derruba para 3.
* o pacote de margaridas traz LOD0/LOD1/LOD2 e planos de billboard da mesma flor. O jogo so quer o
  LOD0: o resto e peso morto que ainda seria desenhado, sobreposto, no mesmo lugar.
* o espantalho passa de 40k triangulos, o teto acordado. Decimate resolve, e sem esqueleto e seguro.

Em todos os casos as malhas auxiliares que o Sketchfab injeta (a esfera de preview `Icosphere`) sao
removidas: nao tem peso em osso nenhum e nao participam de deformacao.

As texturas sao reamostradas ate `maxtex` e gravadas em JPEG dentro do GLB. O original vem como
`.gltf` mais dezenas de arquivos soltos; um crow com textura 2048 nao se justifica num passaro que
ocupa poucos pixels na tela.

Uso:
  <blender> -b -P scripts/build-farm-assets.py -- <pasta-dos-downloads> [saidas,separadas,por,virgula]
"""
import bpy, sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SOURCE = Path(_ARGS[0]) if _ARGS else Path('C:/Users/Dariox/AppData/Local/Temp/claude/rdf/sketchfab')
ONLY = {n.strip() for n in _ARGS[1].split(',')} if len(_ARGS) > 1 else None

# `drop`: substring no nome da malha que a exclui. `keep`: se presente, SO malhas que casam ficam.
# `join`: junta tudo numa malha (apenas sem esqueleto). `maxtris`: decima acima disso (sem esqueleto).
SPECS = [
    {'uid': 'd5a9b0df4da3493688b63ce42c8a83e2', 'out': 'farm-crow', 'maxtex': 1024},
    {'uid': '7c72450ac7e0472eb9b647b6efee2984', 'out': 'farm-chicken', 'maxtex': 1024,
     # Object_63 e o frango ASSADO (prop de comida do CS2), nao a galinha viva.
     'drop': ['Object_63']},
    {'uid': '026d23b0c0954f328694cb339ade4045', 'out': 'farm-bird', 'maxtex': 1024},
    {'uid': 'bb672e5996254111a7d2e93ed01b5e0c', 'out': 'farm-scarecrow', 'maxtex': 1024,
     'maxtris': 30000},
    {'uid': '5fd3b104d8104519b061469c365d4974', 'out': 'farm-corn', 'maxtex': 512, 'join': True},
    # O pacote vem com 9 touceiras enfileiradas lado a lado, cada uma em LOD0/LOD1/LOD2 mais um
    # plano de billboard. Guardamos so os LOD0 e NAO juntamos: o jogo quer escolher UMA touceira e
    # planta-la, nao a fileira inteira de sete metros. `recenter` poe cada uma na propria origem.
    {'uid': '0748471f99f2416a8b66b522c293720f', 'out': 'farm-flowers', 'maxtex': 512,
     'keep': ['LOD0'], 'recenter': True},
]

AUX = ('Icosphere',)  # esfera de preview que o Sketchfab injeta


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.scene.render.fps = 60


def tris(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in objs:
        m = o.evaluated_get(dg).to_mesh()
        n += sum(max(len(p.vertices) - 2, 0) for p in m.polygons)
    return n


def remove(obj):
    bpy.data.objects.remove(obj, do_unlink=True)


report = []
for spec in SPECS:
    if ONLY is not None and spec['out'] not in ONLY:
        continue
    folder = SOURCE / spec['uid']
    src = next((p for p in folder.rglob('*.gltf')), None) or next((p for p in folder.rglob('*.glb')), None)
    assert src, f'sem gltf em {folder}'
    clear()
    bpy.ops.import_scene.gltf(filepath=str(src))
    sc = bpy.context.scene

    rigs = [o for o in sc.objects if o.type == 'ARMATURE']
    meshes = [o for o in sc.objects if o.type == 'MESH']

    dropped = []
    for o in list(meshes):
        bad = any(a in o.name for a in AUX) \
            or any(d in o.name for d in spec.get('drop', [])) \
            or (spec.get('keep') and not any(k in o.name for k in spec['keep']))
        if bad:
            dropped.append(o.name)
            remove(o)
    meshes = [o for o in sc.objects if o.type == 'MESH']
    assert meshes, f'{spec["out"]}: nada sobrou depois do filtro'

    # Esqueleto orfao (a galinha assada do CS2 traz um rig proprio de 2 ossos).
    for r in list(rigs):
        bones = {b.name for b in r.data.bones}
        used = any(any(g.name in bones for g in m.vertex_groups) or m.parent == r for m in meshes)
        if not used:
            dropped.append(r.name)
            remove(r)
    rigs = [o for o in sc.objects if o.type == 'ARMATURE']

    before = tris(meshes)

    # --- daqui pra baixo, SO em modelo sem esqueleto (ver docstring) ---
    joined = decimated = False
    if not rigs and spec.get('join') and len(meshes) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        joined = True
        meshes = [o for o in sc.objects if o.type == 'MESH']
        # A juncao deixa para tras os EMPTY que seguravam cada peca solta. Sem esqueleto eles nao
        # animam nada, mas viram TransformNode no Babylon — vezes as centenas de instancias.
        # A hierarquia e aninhada, entao repete ate estabilizar: remover as folhas expoe os pais.
        while True:
            leaves = [o for o in sc.objects if o.type == 'EMPTY' and not o.children]
            if not leaves:
                break
            for o in leaves:
                dropped.append(o.name)
                remove(o)

    recentered = False
    if not rigs and spec.get('recenter'):
        import mathutils
        for o in meshes:
            # Desligar do pai zerando `parent` faria a malha saltar: o Blender reinterpreta a
            # transformacao local sem a do pai. Guardar e devolver `matrix_world` mantem no lugar.
            world = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = world
            bpy.context.view_layer.update()
            ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
            lo3 = [min(w[i] for w in ws) for i in range(3)]
            hi3 = [max(w[i] for w in ws) for i in range(3)]
            # X/Y no centro da touceira, Z assentado na base: pronto para plantar no terreno.
            o.location -= mathutils.Vector(((lo3[0] + hi3[0]) / 2, (lo3[1] + hi3[1]) / 2, lo3[2]))
        recentered = True

    limit = spec.get('maxtris')
    if not rigs and limit and before > limit:
        for o in meshes:
            mod = o.modifiers.new('decimate', 'DECIMATE')
            mod.ratio = limit / before
        decimated = True

    after = tris(meshes)

    # Texturas: reamostra o que passar do teto; o JPEG final sai no exportador.
    resized = []
    for img in bpy.data.images:
        w, h = img.size
        cap = spec['maxtex']
        if img.name == 'Render Result' or not w or max(w, h) <= cap:
            continue
        s = cap / max(w, h)
        img.scale(max(1, int(w * s)), max(1, int(h * s)))
        resized.append(f'{img.name} {w}x{h}->{img.size[0]}x{img.size[1]}')

    actions = sorted(a.name for a in bpy.data.actions)
    out = ROOT / 'public/models' / (spec['out'] + '.glb')
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format='GLB',
        export_animations=True, export_animation_mode='ACTIONS',
        export_nla_strips=True, export_reset_pose_bones=True,
        export_anim_single_armature=True, export_image_format='JPEG',
        export_jpeg_quality=82, export_apply=bool(decimated), export_yup=True)

    report.append({
        'uid': spec['uid'], 'file': 'public/models/' + out.name, 'bytes': out.stat().st_size,
        'tris': after, 'trisOriginais': before, 'juntado': joined, 'decimado': decimated,
        'recentrado': recentered,
        'ossos': (len(rigs[0].data.bones) if rigs else 0),
        'malhas': [m.name for m in meshes], 'removidos': dropped,
        'texturasReduzidas': resized, 'acoes': actions,
    })
    print(f'EMPACOTADO {out.name}: {out.stat().st_size / 1048576:.2f} MB | {after} tris '
          f'(de {before}) | {len(actions)} acoes | fora: {dropped or "nada"}')


def glb_json(path):
    data = path.read_bytes()
    return json.loads(data[20:20 + int.from_bytes(data[12:16], 'little')].decode('utf-8'))


for e in report:
    g = glb_json(ROOT / e['file'])
    assert g.get('meshes'), f'{e["file"]}: exportado sem malha'
    names = {a.get('name', '') for a in g.get('animations', [])}
    if e['acoes']:
        assert g.get('animations'), f'{e["file"]}: tinha acoes e exportou sem animacao'
        assert g['skins'][0].get('inverseBindMatrices') is not None, f'{e["file"]}: sem inverseBindMatrices'
        faltando = [a for a in e['acoes'] if a not in names]
        assert not faltando, f'{e["file"]}: acoes perdidas: {faltando[:6]}'
    e['verificado'] = {'animacoes': len(names),
                       'juntas': len(g['skins'][0]['joints']) if g.get('skins') else 0}
    print(f'VERIFICADO {Path(e["file"]).name}: {len(names)} animacoes, {e["verificado"]["juntas"]} juntas')

(ROOT / 'docs').mkdir(exist_ok=True)
(ROOT / 'docs/farm-assets.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print('RELATORIO em docs/farm-assets.json')
