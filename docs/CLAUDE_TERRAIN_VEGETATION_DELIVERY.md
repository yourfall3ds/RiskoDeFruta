# Relevo, pedras e vegetação — entrega

**Data:** 2026-09-15 · **Tarefa:** `docs/CLAUDE_TERRAIN_VEGETATION_TASK.md`
**Não foi usado:** navegador, Playwright/Puppeteer, screenshot, stash/reset/commit/push.
**Nenhum modelo original foi alterado.** O único arquivo novo em `public/models/` é
`outcrop-rocks.json`, derivado por leitura (proveniência em `docs/ASSET_LICENSES.md`).

> **Sobre aprovação visual:** nada aqui está aprovado visualmente. Não rodei o jogo e não medi FPS.
> Tudo abaixo é geometria, colisão e teste — a inspeção é do Codex. Onde o texto diz "deve ler como",
> é intenção de design, não verificação.

---

## 1. Como o relevo funciona (a decisão que sustenta o resto)

O mundo é assado: malha visível em GLB, colisão em JSON, gerados juntos por script Blender que não
posso rodar. Reescrever os dois lados em tempo de execução e mantê-los coerentes seria frágil.

A solução é **aditiva e de função pura**:

`offset(x,z) = máscara(x,z) × (pedestal + feições(x,z))`, sempre **≥ 0**, função só de X e Z.

Disso saem três propriedades que os requisitos pedem e que aqui são estruturais, não promessas:

1. **Superfície visível e colisão são o MESMO array.** `buildTerrainPatch` devolve um
   `{positions, normals, uvs, indices}`. O cliente faz `VertexData.applyToMesh` com ele; cliente e
   servidor fazem `appendTriangles` com ele. Não existe caminho no código pelo qual os dois divirjam
   — não é "shader de vértice sobre piso plano", é chão novo.
2. **O piso antigo nunca precisa ser apagado.** Como o deslocamento só sobe, o chão assado fica
   sempre por baixo, e `groundAt`/`surfaceAt` (que tomam o máximo) devolvem a superfície nova.
3. **Cliente e servidor calculam o mesmo terreno.** Mesma entrada (as caixas de colisão que os dois
   já carregam do disco) ⇒ mesmos triângulos. Sem isso a simulação autoritativa empurraria o jogador
   de volta para o piso plano a cada correção.

Só nasce geometria onde o deslocamento passa de `minLift×2` (4 cm), e todo vértice emitido sobe pelo
menos `minLift` (2 cm). Consequências: **dentro de uma exclusão não existe geometria nova** (a cota
de porta, ponte e âncora de loot fica idêntica à assada), e em lugar nenhum a malha nova fica
coplanar com a antiga (sem z-fighting, sem empate no `max()`).

### Exclusões: derivadas dos dados, não de uma lista fixa

`boxExclusions` lê as **caixas de colisão reais** da região (718 no campo, 81 nos planaltos), filtra
as que de fato encostam no chão e gera uma área de peso 1 sobre a estrutura. A transição não é um
número mágico: `featherFor` dimensiona cada uma pelo relevo que existiria ALI, limitando a descida
a 26° — é isso que impede que um silo no meio de um terraço vire um poço de paredes verticais.
`bridgeExclusions` faz o mesmo com `walkableLinks` (corredor + pátio nas duas cabeceiras) e
`anchorExclusions` com `HIGHLAND_CHESTS`. As duas únicas exclusões escritas à mão estão comentadas
no código: a rampa autorada para a ilha de cima e a área de chegada do jogador.

### Caminhos que ligam os desníveis

`levelTrail` não usa altura escolhida à mão. Ela amostra a trilha autorada a cada 6 m, lê o relevo
ali (sem o termo de caminho), suaviza ao longo da trilha e aplica um limitador de rampa de 30 %. A
estrada passa a **acompanhar** as feições grandes — sobe no terraço, desce na bacia — sem herdar
cada solavanco, com inclinação garantidamente caminhável. As 11 trilhas de
`docs/highland-trails.json` viraram caminhos; no campo inicial há uma subida autorada até o terraço
leste.

---

## 2. Abrangência real

| Região | Relevo | Afloramentos | Observação |
|---|---|---|---|
| **campo inicial** (`farm-world`) | **1.540 tri**, até **+1,68 m** | — | ilha principal (0,0), raio 24×26 |
| **highland-farms** | **16.228 tri**, até **+4,13 m** | **46 novos**, 41.354 tri; **41 antigos removidos**, 36.859 tri | 3 ilhas de ~200×196 m |
| solar-frontier, rootwood, farm-city | **não esculpidas** | — | ver "Limitações" |

Isto atende ao "começar campo e uma região grande" do pedido. A extensão às demais é **mudança de
dados**, não de código: acrescentar o id em `SCULPTED_REGIONS` e um plano em `reliefPlansFor`.

---

## 3. Pedras

O problema estava no script de autoria, não na percepção: cada ilha dos planaltos recebe **14
instâncias de `coast_land_rocks_02` em ângulos exatamente regulares, no mesmo raio (0,86) e com a
mesma escala (10 × 4 × 8)**. Daí a fileira de picos alinhados no horizonte.

A troca não é girar cada pedra um pouco:

1. `ringVolumes()` reconstrói os 41 volumes (inclusive a folga de ponte que já pulava alguns) e
   `carveVolumes` **apaga os triângulos de colisão** deles — 36.859, exatamente 41 × 899. O critério
   é duplo: contido na caixa orientada **e** com aresta menor que 2,5 m. A malha de terreno tem
   arestas de ~8 m e caberia na caixa; sem o teste de tamanho, apagar as pedras abriria buraco no
   chão. O teste confirma idempotência: uma segunda passada não acha mais nada.
2. `TerrainPresentation.retire` esconde exatamente as instâncias correspondentes, a partir da MESMA
   lista de volumes. Esconder sem apagar a colisão deixaria colisor fantasma; apagar sem esconder
   deixaria pedra atravessável.
3. `highlandOutcrops` gera **aglomerados irregulares** — 5 por ilha, de 2 a 4 pedras cada, mais 2
   internas. Ângulo, raio, escala, giro, inclinação e **deformação de silhueta** saem de um hash
   determinístico; nenhuma pedra repete tamanho nem giro. Cada afloramento nasce **38 % enterrado**:
   não flutua, e o cume fica alcançável.
4. A geometria é a **rocha escaneada original**, não primitiva procedural. Sai de
   `public/models/outcrop-rocks.json` (extraído por leitura do GLB), e o MESMO array vira malha
   desenhada no cliente e triângulos de colisão nos dois lados. **Nenhuma caixa invisível.**

Bloqueio de local: `outcropBlocker` recusa nascer sobre estrutura, ponte, âncora de recompensa **ou
corredor de trilha** — as trilhas entram explicitamente porque não são exclusão de relevo (elas o
acompanham), mas são caminho obrigatório.

---

## 4. Vegetação

### Vento (`FoliageWindPlugin`)

Deslocamento no vértice, injetado em `CUSTOM_VERTEX_UPDATE_WORLDPOS` (depois de `finalWorld`, antes
de `gl_Position`), reescrevendo `worldPos` e `vPositionW`.

- **Raiz fixa:** amplitude ∝ `pow(altura acima da raiz / referência, rigidez)`. Na base o expoente
  zera o termo. A altura é medida contra a **translação da matriz de mundo**, não contra o Y
  absoluto — uma árvore no alto do terraço se comporta igual a uma no vale.
- **Fase e intensidade por planta:** saem da posição de mundo da própria instância. Funciona com
  `InstancedMesh` e thin instance sem uniforme extra.
- **Nada de tronco de borracha:** soma de duas senoides incomensuráveis, limitada em metros
  (0,055 capim · 0,085 samambaia · 0,17 copa), com rigidez 2,6 na copa. A ponta ainda **encurta** ao
  curvar, em vez de esticar.
- **Material congelado:** o Babylon pula o bind de material congelado, e o tempo do vento nunca
  chegaria à GPU. `FarmWorld` e `RegionPresentation` agora filtram por `hasFoliageWind` antes do
  `freeze()`. Isso está coberto por teste.

### Copa mais legível e o custo do bosque

Trabalhei sobre `docs/CLAUDE_ROOTWOOD_PERF_REVIEW.md`. **Não meço FPS e não afirmo que o gargalo era
permanente** — apliquei os achados que são fato medido nos assets e no código:

| Achado | O que mudou |
|---|---|
| 1 — ativação 100 % síncrona (2.671 nós num tick) | `RegionPresentation` prepara **300 peças por quadro** (`WARM_UP_BUDGET`). Até ser preparada, a peça continua desenhada: nada some. Bosque sai de 1 tick para ~9. **Ganho de pico, não de regime.** |
| 2 — 769 k tri de copa alpha-test | `ROOTWOOD_CANOPY_BUDGET`: `mediumLimit` 20 → 10, `farDistance` 85 → 62, e `nearDistance` **subiu** 18 → 24 para a copa de perto ficar mais legível. ~581 k no mesmo ponto do QA. |
| 3 — decalque de trilha em passe transparente e nunca oculto | vira **alpha-test** (volta a escrever profundidade) e ganha raio de ocultação de 220 m em `DETAIL_RADIUS`. |
| 4 — copas instanciadas furam o teto de 16 projetores | `OrchardLOD` e `trail union` entram na isenção de sombra. A regex estava **duplicada e divergente** entre `NearbyShadowCasters` e `FarmWorld.SHADOW_EXEMPT`; agora há uma fonte só, reexportada. |
| 5 — ragdoll esquecido prende região | só ragdoll a menos de `RAGDOLL_HOLD_RANGE` (70 m) do jogador retém residência. |
| 6 — `restoreAll()` do navmesh | **não mexido** (é `src/ai`, fora da minha propriedade). |

Densidade percebida sem mais draw: `alphaCutOff` da copa baixou de 0,4 para 0,33. Corte alto come a
ponta fina da folha e é parte do "copa rala" relatado; 0,33 devolve massa sem custar desenho nem
transparência real.

---

## 5. O que acompanha o terreno (e o que não pode acompanhar)

`FOLLOWS_TERRAIN` é exatamente o conjunto que os scripts de assado de colisão **descartam**
(`fern`, `grass`, frutas soltas, regador). Tudo que TEM colisão assada fica onde está: mover só o
visual de uma pedra ou de um tronco criaria colisor fantasma. Pedra de borda e forração ficam
parcialmente mais enterradas — nunca flutuando, porque o relevo só sobe.

Os decalques de trilha são **reconformados vértice a vértice** pelo mesmo deslocamento que gerou a
malha, então a trilha continua colada ao chão subindo o terraço. Detalhe que custou um bug: a malha
do glTF vem com buffer **não atualizável**, e `updateVerticesData` é silenciosamente um no-op nesse
caso — a trilha ficaria enterrada sem erro nenhum. Usa-se `setVerticesData`.

Navegação: `scripts/bake-navigation.mjs` agora esculpe as regiões antes de assar, e
`public/models/farm-navmesh.bin` foi **regerado** (57.582 tri de relevo/afloramento nos planaltos,
1.540 no campo). Todas as rotas do bake continuam válidas — `docs/navmesh-validation.json`.

---

## 6. Posições para o QA localizar no jogo

`FarmWorld.reliefStatus` devolve um resumo do relevo residente
(`campo 1540 tri · highland-farms 16228 tri, 46 afloramentos, 36859 tri de pedra antiga removidos`),
e `FarmWorld.sculptedHeightAt(x,z)` devolve a cota esculpida do campo.

**Campo inicial** — pontos mais altos por setor (relevo acrescentado entre parênteses):

| Onde | Posição | Relevo |
|---|---|---|
| lobo oeste (crista) | `-14, 1.6, -3.5` | +1,63 m |
| lobo leste (terraço) | `12, 0.8, -14` | +0,82 m |
| setor norte | `-9.5, 0.7, 2` | +0,72 m |
| rampa autorada | `0, 3.1, 16` | **0,00 m** (intocada) |
| chegada do jogador | `0, 0.0, -14` | **0,00 m** (intocada) |

**Planaltos** — cume de cada ilha e feições autoradas:

| Onde | Posição | Relevo |
|---|---|---|
| Campos Altos (cume) | `554, 24.8, 312` | +4,09 m |
| Campos Altos terraço NE | `545, 23.6, 245` | +2,59 m |
| Campos Altos crista sul | `482, 22.8, 332` | +1,71 m |
| Moinhos do Leste (cume) | `760, 34.4, 342` | +3,88 m |
| Moinhos terraço norte | `748, 32.3, 292` | +2,65 m |
| Vale das Sementes (cume) | `644, 27.9, 490` | +4,07 m |
| Vale terraço NE | `652, 27.4, 490` | +3,76 m |
| ponto do QA antigo ("trilha plana até o horizonte") | `431, 19.2, 280` | +0,51 m |

As bacias (`468,252` · `698,332` · `598,532`) ficam em **+0,00 m** de propósito: elas descem até a
cota autorada, e o contraste com o terraço vizinho é o desnível.

**Afloramentos** — aglomerados, por ilha (primeiros de cada):

- Campos Altos: `549,18.6,345` · `557,18.3,343` · `520,19.0,356` · `521,18.9,357` · `525,18.7,358`
- Moinhos do Leste: `780,26.4,369` · `780,26.2,373` · `777,26.6,369` · `778,26.4,372` · `702,26.6,390`
- Vale das Sementes: `686,20.3,572` · `684,20.2,574` · `680,20.2,579` · `570,20.8,588` · `574,20.9,589`

Note a leitura de aglomerado: pedras a poucos metros entre si, tamanhos de 5 a 14 m e nenhuma no
mesmo raio — o oposto da fileira regular anterior.

---

## 7. Validação executada

**Typecheck cliente e servidor: limpos** (o único erro em `npx tsc --noEmit` está em
`tests/fruit-fragments.test.ts`, arquivo de outro autor, em edição concorrente).

**Suíte completa: 674 passando, 7 falhando.** As falhas são as **6 de assets originais que já eram
baseline** (`combat-assets` ×5 pede `assets/*.glb`, `hordes-arsenal-catalog` ×1 pede
`art/processed/*.glb`; nenhuma dessas pastas existe nesta cópia) mais **1 de
`tests/fruit-fragments.test.ts`**, que é trabalho em andamento de outro autor em `src/vfx/` —
arquivos que não toquei. **Minha entrega não acrescenta nenhuma falha.**

25 testes novos, todos passando:

`tests/terrain-relief.test.ts` (14) — comparam a superfície gerada com o `CollisionWorld` montado
dos mesmos arquivos que o jogo carrega:

- o piso devolvido é exatamente a altura da malha gerada (pior divergência **< 6 cm**, com teto de
  amostragem de 5 cm para prop nenhum entrar na conta), no campo e nos planaltos;
- A/B contra o mundo sem relevo: **mais de 35 %** da área aberta do campo subiu mais de 15 cm, pico
  acima de 1 m — não é relevo só visual;
- **nenhuma** das 718 caixas de estrutura, ponte, rampa ou âncora vê campo diferente de zero (a
  malha, que é discreta, fica em < 10 cm, o degrau de borda mais a interpolação da célula vizinha);
  os 9 baús dos planaltos continuam na cota exata e com piso ao lado;
- **zero** faces acima da inclinação caminhável (50°), e no máximo 96 % das faces abaixo de 12° —
  há desnível de verdade, e ele é todo jogável;
- o contorno de **todo** retalho (arestas usadas por um triângulo só) está a no máximo 4 cm do chão
  antigo: não existe degrau de conexão;
- as 11 trilhas dos planaltos são contínuas metro a metro (salto < 60 cm), com mais de 2 m de
  desnível ganho — elas ligam os níveis;
- travessia física com `PlayerMotor` subindo o terraço leste: sem respawn, sem recuperação de
  sólido, chegando ao destino sobre o chão;
- pedras: 41 volumes, remoção exata de 41 × 899 triângulos, idempotente; o que saiu tinha mais de
  3.000 vértices acima da cota autorada, até 2,6 m; cada cume novo tem superfície de colisão igual à
  malha (< 35 cm), **nada de sólido acima dele**, e 60 %+ têm topo caminhável; nenhum afloramento a
  menos de 6,5 m de baú, nem sobre ponte ou trilha;
- determinismo: duas esculpidas dos mesmos dados dão triângulos idênticos, e o **servidor real**
  (`FarmSimulation` com `loadCollision()`) devolve o mesmo piso que o cliente desenha.

`tests/foliage-wind.test.ts` (7) — pipeline de shader REAL do Babylon (resolve `#include`, injeção
antes do pré-processador, quebra nos `;`, GLSL ES 3.00): a injeção cai depois de `finalWorld` e
antes de `gl_Position`, nenhuma linha órfã `;`, shader intacto sem o plugin, perfis por família,
alpha-test/decalque e o filtro de congelamento.

`tests/terrain-presentation.test.ts` (4) — com `NullEngine` e um `__root__` espelhado como o do
glTF: retalho desenhado com o material autorado, vegetação sobe exatamente o deslocamento, estrutura
com colisão assada **não** sobe, decalque reconformado, pedra aposentada escondida, `dispose`
devolve tudo e é idempotente, e a preparação de região é fatiada sem esconder nada.

Também rodei, verdes: `highland-traversal`, `mesh-collision`, `ground-following`, `player`,
`net-simulation`, `farm-world`, `scene`, `region-streaming`, `regional-havok`, `collision-regions`,
`render-budget`, `orchard-lods`, `far-canopies`, `arrival-visibility`, `tiled-navigation`,
`navigation-tile-residency`, `navigation-physics`, `city-traversal`, `exploration`,
`solar-frontier`, `highland-trails`, `chest-and-spawn`.

---

## 8. Custo acrescentado, medido

`sculptRegion` em Node (não é o navegador, mas é o mesmo código):

- campo inicial: **~28 ms**, uma vez, em `FarmWorld.load`;
- highland-farms: **~107 ms** (retalhos 76 ms, remoção das pedras 40 ms, afloramentos e normais o
  resto), no carregador **assíncrono** da região, no mesmo trecho onde o parse do JSON de 13 MB já
  custa ~170 ms.

Para chegar aí acrescentei duas grades de índice — exclusões em `ReliefField` e volumes em
`carveVolumes` — que cortaram o custo de 460 ms para 277 ms (incluindo o parse).

Colisão: planaltos vão de 180.132 para **200.855** triângulos (+11,5 %): entram 16.228 de relevo e
41.354 de afloramento, saem 36.859 de pedra antiga.

---

## 9. Limitações honestas (o que NÃO foi feito, e por quê)

1. **`solar-frontier`, `rootwood` e `farm-city` não têm relevo esculpido.** O pedido era campo mais
   uma região grande, e ampliar "onde seguro". Estas três não são seguras hoje pelo mesmo motivo,
   que é concreto: em `farm-city` o chão de cada ilha também é uma `GroundSurface` elipse de altura
   constante cobrindo a ilha inteira, e as malhas de solo foram **unidas por material** na
   exportação — o chão da ilha e as leiras cultivadas são a mesma malha, então não dá para tratar só
   o chão pelo nome. `rootwood` e `solar-frontier` precisam de leitura equivalente da autoria antes
   de eu declarar exclusão correta. Estender é acrescentar um plano em `reliefPlansFor`; a mecânica
   já é reutilizável e está testada.
2. **Afloramentos só nos planaltos.** As pedras de borda do mundo base estão a 5–7 m abaixo do
   chão (só o topo aparece) e não formam a fileira reprovada no horizonte; a fileira é a dos
   planaltos, e é essa que saiu.
3. **A malha, sendo discreta, deixa até ~10 cm de terreno sobre o pé de algumas estruturas** (o
   degrau mínimo de 2 cm mais a interpolação da célula vizinha de 1,25 m). O campo analítico ali é
   exatamente zero — os dois números estão no teste. Abaixo de qualquer altura de passo e, na minha
   leitura, invisível; mas é o Codex quem confirma isso na tela.
4. **Achado 6 da revisão de custo (`restoreAll()` do navmesh) não foi tocado:** é `src/ai`, fora da
   propriedade que me foi dada.
5. **`TriangleGround` continua sendo construído de forma síncrona** na thread principal (113 ms
   medidos no bosque pela revisão). Mover para o worker que já calcula o índice de raios é mudança
   em `CollisionWorld`/`StaticRayIndex` com impacto em toda a colisão; preferi não abrir isso junto
   com o relevo.
6. **Nada aqui foi visto rodando.** Sem navegador não há como eu afirmar leitura de silhueta,
   z-fighting residual, legibilidade de copa ou FPS. Os números de custo acima são de Node.

---

## Arquivos

**Novos:** `src/world/terrain/ReliefField.ts` · `ReliefPlans.ts` · `TerrainPatch.ts` ·
`SculptedTerrain.ts` · `WorldTerrain.ts` · `RockOutcrops.ts` · `TerrainPresentation.ts` ·
`src/world/materials/FoliageWindPlugin.ts` · `FoliageMaterials.ts` ·
`scripts/extract-outcrop-rock.mjs` · `public/models/outcrop-rocks.json` ·
`tests/terrain-relief.test.ts` · `tests/terrain-presentation.test.ts` · `tests/foliage-wind.test.ts`

**Alterados:** `src/world/FarmWorld.ts` · `src/world/streaming/RegionPresentation.ts` ·
`src/rendering/NearbyShadowCasters.ts` · `server/FarmSimulation.ts` · `server/rooms/FarmRoom.ts` ·
`scripts/bake-navigation.mjs` · `public/models/farm-navmesh.bin` (regerado) ·
`docs/navigation-tiles.json` · `docs/navmesh-validation.json` · `docs/ASSET_LICENSES.md`

**Intocados, como pedido:** `StochasticGroundPlugin` e seus testes, `GroundMaterials`, `PlayerScene`,
animação, debug, HUD, intro, áudio, UI e CSS.

---

## Registro de andamento

- **Etapa 1 — campo de relevo e retalho.** `ReliefField` + `TerrainPatch` + `ReliefPlans`, exclusões
  derivadas das caixas de colisão, caminhos nivelados. Integrado no cliente (`FarmWorld.load` e
  carregador de região) e no servidor (`mergeCollision`). Sondado contra os JSON reais antes de
  virar teste.
- **Etapa 2 — pedras.** Extração da rocha escaneada, remoção dos 41 volumes do anel (ajuste do
  sinal de giro e do eixo de altura medidos contra a malha assada, até bater 41 × 899 exato),
  aglomerados determinísticos, apresentação escondendo as instâncias aposentadas.
- **Etapa 3 — vegetação.** Plugin de vento, perfis por família, alpha-test de copa e decalque, e os
  achados 1–5 da revisão de custo do bosque.
- **Etapa 4 — validação.** 25 testes novos, navmesh regerado, typecheck cliente/servidor, suíte
  completa sem falha nova. Índices de grade para o custo de ativação ficar aceitável.
