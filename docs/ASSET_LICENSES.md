# Third-party art

## Brown Mud Leaves 01

Source: https://polyhaven.com/a/brown_mud_leaves_01

License: CC0, https://polyhaven.com/license

Downloaded through the official Poly Haven API on 2026-09-06. Local files in `public/textures/brown_mud_leaves_01/` are the 2K JPG diffuse, OpenGL normal and AO/roughness/metallic maps. MD5 checksums were verified against the API response before use. Runtime uses local files without third-party requests.

## Kloofendal 48d Partly Cloudy (Pure Sky)

Source: https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky

License: CC0. Official 2K HDR download, verified against its API MD5 checksum. Stored at `public/environment/field-sky.hdr` and used for PBR lighting. The visible sky is now the generated cosmic panorama.

The character and reference images were supplied by the user; their originals remain in `assets/`.

## Floating farm environment

Architecture textures and vegetation/rock scans: Poly Haven CC0. Individual source pages, local pipeline and generated sky prompt are recorded in [WORLD_PRESENTATION.md](WORLD_PRESENTATION.md). The sky was generated with the integrated image generation tool and saved as `public/environment/cosmic-sky.png`; it is not a Poly Haven download. No Meshy service was used.

## Farm props and fruit crest

Additional Poly Haven CC0 assets downloaded through its official API on 2026-09-06:

- Bananas: https://polyhaven.com/a/bananas
- Wooden Crate 01: https://polyhaven.com/a/wooden_crate_01
- Wooden Barrels 01: https://polyhaven.com/a/wooden_barrels_01
- Watering Can Metal 01: https://polyhaven.com/a/watering_can_metal_01

Local runtime derivatives: `supply-crate.glb`, `farm-barrels.glb`, `watering-can.glb`, banana crests and objects embedded in `farm-world.glb`. License: https://polyhaven.com/license. The current generated sky, waterfall, red paint and botanical surface are documented in [GENERATED_ART.md](GENERATED_ART.md).

## Alienígenas da Sketchfab — CC BY 4.0, 16/09/2026

Baixados pela API oficial da Sketchfab com o token da conta do usuário. **A licença CC BY exige
crédito**, então os autores ficam registrados aqui e o crédito deve acompanhar qualquer distribuição
do jogo. Metadados completos e medidas em [menu-aliens.json](menu-aliens.json).

| Runtime | Obra original | Autor | Licença |
| --- | --- | --- | --- |
| `public/models/menu-alien-ninja.glb` | [Alien Ninja Creature with 45 animations](https://sketchfab.com/3d-models/d332cac883f54a2c98492e85f41455b2) | Jungle Jim | CC BY 4.0 |
| `public/models/menu-alien-strutter.glb` | [Alien Bird - Meat Struter](https://sketchfab.com/3d-models/100254f3a4794ca491f5143e96a43ce5) | Obulman | CC BY 4.0 |

O preparo está em `scripts/build-menu-aliens.py`: descarta os auxiliares que a Sketchfab embrulha,
normaliza a escala para a altura de jogo, assenta os pés em Z=0, mantém apenas os clipes usados
(`Idle`, `Walk`, `Run`, `Attack`, `Death`) e empilha cada ação numa trilha NLA, porque o exportador
glTF só escreve ações ativas ou empilhadas. A malha, o esqueleto e as animações são os do autor
original — o único clipe derivado é o `Death` do ninja, que é o `A_rise1` do próprio autor com o
tempo invertido. Nada foi gerado proceduralmente.

`menu-alien-ninja.glb` é o corpo do **invasor do disco** (`ENEMIES.invader`), o monstro que a
represália dos discos voadores despeja pelo feixe de contra-abdução.

## Áudio gravado e acessórios — 07/09/2026

Amostras locais CC0; fontes e autores detalhados em [foley-sources.json](foley-sources.json): Kenney (impactos/passos), pauliuw (criaturas), qubodup (swishes), ezwa/qubodup (água) e TabascoCZ (tiros). Não há síntese por osciladores no áudio atual.

Baú articulado, volumes geológicos, ilha móvel e discos voadores foram modelados localmente no Blender e usam texturas PBR já existentes do acervo Poly Haven CC0. Os cinco inimigos originais fornecidos pelo usuário preservam malhas, materiais, imagens e skins; ver original-enemy-integrity.json.

- **Grito do personagem na morte**: HaelDB, [Male Grunt/Yelling sounds](https://opengameart.org/content/male-gruntyelling-sounds), CC0. Original `yelling sounds/1yell11.wav`, copiado sem alteração para `public/audio/foley/player-death-scream.wav`; velocidade de reprodução 0,95 em runtime.

## Nave de inserção (deck de entrada)

`public/models/dropship-deck.glb` é **geometria autoral deste projeto**, gerada por
`scripts/build-dropship-deck.py` (Blender, mesmo pipeline de `build-farm-world.py` e
`build-alien-world.py`). Nenhum serviço externo de geração foi usado e nenhum asset original
foi alterado.

Mapas PBR aplicados, todos Poly Haven CC0 já presentes no repositório e já listados em
[WORLD_PRESENTATION.md](WORLD_PRESENTATION.md):

- Corrugated Iron: https://polyhaven.com/a/corrugated_iron — chapa e frisos do deck
- Rusty Painted Metal: https://polyhaven.com/a/rusty_painted_metal — casco, estrutura, corrimão

Usamos **apenas os mapas de normal (`nor_gl`) e de AO/rugosidade/metalicidade (`arm`)**. Os mapas de
cor (`Diffuse`) foram retirados na revisão de 15/09: a cor marrom deles fazia o casco parecer
madeira listrada. A cor agora é tinta chapada (`baseColorFactor`) em grafite e oliva, e os mapas
entram só como relevo e desgaste.

Os mapas são reduzidos para 1K dentro do script antes da exportação, porque o asset carrega
**antes** do botão Jogar. O GLB final tem ~1,16 MB e 26.984 vértices.

## Afloramentos de rocha (relevo)

`public/models/outcrop-rocks.json` é **arquivo derivado**, extraído por
`scripts/extract-outcrop-rock.mjs` da geometria escaneada `coast_land_rocks_02` que já estava
embarcada em `public/models/highland-farms.glb`. Nenhum modelo original foi alterado: o script
apenas LÊ o GLB e grava um JSON novo com posições normalizadas (X/Z centrados, base em Y=0,
extensão 1 em cada eixo), UVs e índices — 899 triângulos, 870 vértices.

A licença é a mesma do scan de origem, já listada em
[WORLD_PRESENTATION.md](WORLD_PRESENTATION.md) (Poly Haven, CC0). O JSON carrega o bloco
`provenance` com arquivo de origem, nó, material e script, para a cadeia ficar auditável dentro do
próprio asset.

Existe para o **servidor autoritativo**, que não carrega GLB: cliente e servidor precisam gerar a
MESMA colisão de afloramento, e um JSON pequeno lido pelos dois lados é o que garante isso.

## Interiores dos celeiros

`public/models/barn-interiors.glb` é composto por `scripts/build-barn-interiors.py` a partir do
**Fantasy Props MegaKit (Standard/free)** de **Quaternius**, https://quaternius.com — licença
**CC0 1.0 Universal**, https://creativecommons.org/publicdomain/zero/1.0/. A licença original
acompanha a cópia local em `art/source/fantasy-props/License_Standard.txt`.

Os arquivos vieram do acervo local do projeto Transformice do usuário, que é apenas **lido**: o
script espelha para `art/source/fantasy-props/` somente os props que usa (49 glTF) e os quatro
atlas `T_Trim_*`, reduzidos a 1K e reexportados em JPEG dentro do GLB. Nenhum modelo original foi
alterado e nenhum serviço de geração foi usado.

As cascas dos celeiros continuam sendo geometria autoral deste projeto, já embarcada em
`farm-world.glb`, `farm-city.glb` e `highland-farms.glb`; este asset só ocupa o vazio dentro delas.

## Atlas de chuva

`public/textures/weather/rain-streaks.png`, `rain-splash.png` e `rain-haze.png` são **gerados
offline** por `scripts/build-rain-atlas.py` (numpy dentro do Blender), que é a fonte editável.

**Não são fotografia nem gravação, e não afirmamos que sejam.** São desenho por código: dezesseis
rastros com comprimento, espessura, ondulação e encordoamento sorteados; um flipbook de coroa de
respingo; e um véu de hastes fracas. RGB branco, forma no alfa. Sem dependência externa, sem
serviço de geração e sem licença de terceiros envolvida — a autoria é deste projeto.

O áudio de chuva continua sendo a gravação licenciada já registrada em
[licenses/rain-ylmir.md](licenses/rain-ylmir.md); nada novo foi gravado.

## Arquipélago esférico

O planeta recompõe as ilhas já embarcadas em `farm-world.glb`, `farm-city.glb`,
`solar-frontier.glb` e `solid-island-geology.glb`, mantendo as licenças dos materiais
e modelos registradas acima. A curvatura é aplicada aos vértices desses assets no Blender.

As pontes usam `Floor_WoodLight.gltf` e `Prop_WoodenFence_Single.gltf` do
**Quaternius Medieval Village MegaKit Standard**, CC0 1.0. A cópia local dos dois módulos,
suas dependências e a licença estão em `art/source/planet-bridge/`. Vieram do acervo
Transformice do usuário, apenas lido. Fonte editável: `scripts/build-planet-archipelago.py`.

O decodificador Draco em `public/vendor/draco/` veio do CDN oficial Babylon.js,
nos mesmos endereços configurados pela versão instalada do motor. A licença do projeto
Google Draco acompanha os arquivos em `public/vendor/draco/LICENSE`.
# Natureza do planeta

As pedras `Rock_Medium_1/2/3` e árvores `CommonTree_1/3` vêm do **Stylized Nature MegaKit — Standard**, de Quaternius, CC0. Cópia da licença: `licenses/planet-nature.txt`. Os modelos completos são posicionados com orientação radial; troncos e rochas usam colisão da malha, sem recortes de scan nas bordas.
