# Revisão de custo — bosque `rootwood`

**Data:** 2026-09-15 · **Escopo:** inspeção estática somente-leitura + medições CLI sobre os JSON/GLB de `public/models/`.
**Não foi executado:** o jogo, navegador, Playwright/Puppeteer, screenshots. Nenhum arquivo de código foi alterado.
**Gatilho:** QA do Codex — visitar `rootwood` em `883, 31.1, 355` caiu de ~38 FPS (planaltos) para ~2 FPS numa RTX 3080 Ti, com 3 regiões retidas.

> **Aviso de método.** Não tenho captura de frame, timeline de CPU/GPU nem contagem de draw calls. Tudo abaixo está separado em **FATO** (medido nos assets ou lido no código, com arquivo/linha) e **HIPÓTESE** (mecanismo plausível que explicaria o número do QA, mas que precisa de medição). **Nenhum achado aqui prova gargalo permanente** — a leitura mais consistente com os dados é que boa parte do custo é de *ativação/aquecimento*, e só parte é sustentada. Ver "Como discriminar" no fim.

## Números de referência (medidos)

`node` sobre os arquivos em `public/models/`:

| Região | GLB | nós com mesh | tris (geometria única) | imagens | JSON colisão | parse JSON | tris colisão |
|---|---:|---:|---:|---:|---:|---:|---:|
| **rootwood** | 65,1 MB | **2.671** | 262.566 | 28 (10×2K, 18×1K) | 14,5 MB | 247 ms | 162.791 |
| highland-farms | 49,3 MB | 384 | 168.844 | 16 | 13,0 MB | 170 ms | 180.132 |
| solar-frontier | 60,5 MB | 366 | 339.740 | 27 | 9,2 MB | 112 ms | 211.270 |
| farm-city | 46,3 MB | 236 | 164.292 | 26 | 6,9 MB | 96 ms | 157.151 |

Composição dos 2.671 nós do `rootwood.glb`: 663 `fern_02`, 300 árvores × 6 partes (`OrchardLOD_*`) = 1.800, 133 `grass_medium_01`, 61 `coast_land_rocks_02`, 14 peças estáticas.

Geometria efetivamente desenhada **no ponto exato do QA** (posições de nó do GLB, mapeamento glTF→Babylon `x → -x`, aplicando os raios de `DetailVisibility` e os limites de `OrchardLods`):

- Árvores candidatas: 2 a ≤18 m (tier `near`), 46 entre 18–85 m (tier `medium`), 252 como billboard.
- Após os limites `{nearLimit:3, mediumLimit:20}`: **2 × 97.998 + 20 × 28.673 = 769.456 tris** de copa.
- Samambaias dentro de 65 m: **95 instâncias = 85.500 tris** (alpha-test).
- Peças sem raio de ocultação (sempre desenhadas): **133.196 tris**.
- Todos os materiais do `rootwood.glb` têm `doubleSided=true` → o rasterizador vê ~2× isso.

---

## Achados

### 1. `rootwood.glb` tem 7–11× mais nós de malha que qualquer outra região, e a ativação é 100 % síncrona
**Prioridade: ALTA · FATO (contagem) + HIPÓTESE (impacto no frame)**

FATO: 2.671 nós contra 236–384 das outras três regiões. A ativação em `src/world/FarmWorld.ts:67` (`activate:()=>{…new RegionPresentation(…)}`) entra em `src/world/streaming/RegionPresentation.ts:29-35`, que percorre **todos** os 2.671 meshes fazendo `computeWorldMatrix(true)` + `getBoundingInfo()` + `freezeWorldMatrix()` num único tick, sem `yield`. `OrchardLods` (`src/world/streaming/OrchardLods.ts:15-28`) percorre de novo e faz mais um `computeWorldMatrix` por parte `near` (900 chamadas).

FATO adicional na mesma cadeia sequencial (`src/world/FarmWorld.ts:61-67`):
- `response.json()` de 14,5 MB → **247 ms** medidos em Node (bloqueante, main thread).
- `physics.setGeometry(...)` (`src/physics/CollisionWorld.ts:68`) constrói `TriangleGround` com 162.791 triângulos **de forma síncrona** → **113 ms** medidos, 296.768 inserções em 12.868 células.
- `LoadAssetContainerAsync` de um GLB de 65 MB com 45 MB de JPEG/PNG (28 imagens) a decodificar e subir para a GPU.
- Só depois `prepareRaycastsAsync` vai para worker (`CollisionWorld.ts:69-74`) — o `TriangleGround` acima **não** vai.

HIPÓTESE: isso sozinho produz vários segundos de frames >300 ms ao entrar no bosque. Encaixa exatamente com a leitura de "pode ter sido carregamento/aquecimento".

**Sugestão concreta:** fatiar o laço de `RegionPresentation:29-35` em blocos por frame (ou fazê-lo sob demanda, como o `OrchardLods` já faz com tiers) e mover a construção do `TriangleGround` para o mesmo worker que já calcula o índice de raios, devolvendo a grade pronta. Ganho de pico, não de regime.

---

### 2. O orçamento de copas do rootwood entrega ~769 k tris de folhagem alpha-test, todos de dupla face
**Prioridade: ALTA · FATO (orçamento) + HIPÓTESE (que seja o custo de GPU dominante)**

FATO: `src/world/streaming/RegionPresentation.ts:20` dá ao rootwood `{nearDistance:18, farDistance:85, nearLimit:3, mediumLimit:20, farCanopies:true}`. As malhas correspondentes, medidas no GLB:

| tier | trunk | branches | leaves | **total/árvore** |
|---|---:|---:|---:|---:|
| `near` | 3.999 | 13.999 | **80.000** | **97.998** |
| `medium` | 1.400 | 5.273 | **22.000** | **28.673** |

No ponto do QA: 2 `near` + 20 `medium` = **769.456 tris**. O material `island_tree_01_leaves.001` é `alphaMode=BLEND` no glTF — convertido para `ALPHATEST` com `alphaCutOff=.4` em `RegionPresentation.ts:26` (o nome casa com `/tree/i`), o que é o comportamento certo, mas alpha-test **desativa early-Z**: cada fragmento de folha roda o PBR completo com 3 texturas antes do `discard`. Todos os 12 materiais são `doubleSided=true`, então `backFaceCulling` fica desligado e o custo de rasterização/overdraw dobra. Some as 95 samambaias (85.500 tris, mesmo regime) e a resolução de sombra `2048` com `usePercentageCloserFiltering + QUALITY_HIGH` (`src/rendering/TrainingLighting.ts:35`), SSAO2 e MSAA 4× (`TrainingLighting.ts:37-40`).

HIPÓTESE: uma 3080 Ti não cai para 2 FPS com 1,5 M de triângulos rasterizados *em regime*; cai se houver overdraw alpha-test pesado em tela cheia somado a um segundo passe (sombra) sobre a mesma geometria. É o candidato mais forte para o custo sustentado, mas **precisa de captura de frame para confirmar** — sem isso, é hipótese.

**Sugestão concreta:** baixar `mediumLimit` de 20 para ~10 e `farDistance` de 85 para ~60 (o `FarCanopies` já cobre o resto com billboards), e desligar `doubleSided` nas malhas de tronco/galho no export (só as folhas precisam). Medir antes/depois pelo contador de triângulos do `DebugOverlay`.

---

### 3. O decalque `Rootwood worn earth trails` fica em passe transparente de verdade e nunca é ocultado
**Prioridade: MÉDIA-ALTA · FATO**

O nó `Rootwood connected earth trails` (malha `Terrain conforming trail union`, **25.244 tris**) usa o material `Rootwood worn earth trails`, declarado `alphaMode=BLEND` e `doubleSided=true` no GLB.

- `src/world/streaming/RegionPresentation.ts:26` só converte para `ALPHATEST` materiais cujo **nome** casa com `/fern|grass|tree/i`. `"Rootwood worn earth trails"` não casa (`trails` ≠ `tree`) → permanece `ALPHABLEND`: sem escrita de profundidade, ordenado por distância a cada frame, overdraw integral.
- `RegionPresentation.ts:33` atribui `radius` só a `/fern|grass/`, `/coast_land/` e `/tree/`. Este nó recebe `radius=0` → **nunca entra em `DetailVisibility`**, ou seja, é desenhado em todo frame independentemente da distância.
- É uma malha única que cobre a rede de trilhas da região inteira (790–1270 × 260–740), portanto quase sempre está no frustum e cobre boa parte da tela junto ao chão.

**Sugestão concreta:** no export, marcar esse material como `MASK` (alpha-test) em vez de `BLEND`; ou, no código, trocar o teste de `RegionPresentation.ts:26` por um que também pegue os decalques de trilha (ex.: `/fern|grass|tree|trail/i`). Trilhas sobre terreno quase nunca precisam de blend real.

---

### 4. O teto de 16 projetores de sombra não limita malhas instanciadas — e as copas não estão na lista de isenção
**Prioridade: MÉDIA · HIPÓTESE (mecanismo Babylon) sobre base FACTUAL**

FATO: `src/rendering/NearbyShadowCasters.ts:11` isenta `/grass|fern|coast_land|connected earth trails|harvest (tomato|watermelon)/i`. As malhas `OrchardLOD_*` **não** estão isentas, então os 16 projetores mais próximos (`NearbyShadowCasters.ts:8`, `limit=16`) dentro do bosque serão exatamente tronco/galhos/folhas das árvores próximas — inclusive as de 80.000 tris.

FATO: existe `SHADOW_EXEMPT` exportado em `src/world/FarmWorld.ts:38` com uma regex **diferente** (sem `connected earth trails`), usado apenas por `tests/render-budget.test.ts`. A regra real de runtime está duplicada e divergente dentro de `NearbyShadowCasters.ts:11`.

HIPÓTESE: no Babylon, as 300 árvores viram 1 `Mesh` mestre + 299 `InstancedMesh` por parte. `ShadowGenerator` renderiza uma submesh via `_getInstancesRenderList`, que devolve **todas as instâncias visíveis** daquela malha de origem. Adicionar *uma* instância de `medium_leaves` ao `renderList` renderiza as ~20 instâncias visíveis no shadow map — ou seja, `limit=16` não é um teto real para folhagem instanciada. Isso duplicaria a geometria do achado 2 num segundo passe, com PCF QUALITY_HIGH. **Requer confirmação num profiler ou lendo a versão exata do Babylon em uso.**

**Sugestão concreta:** acrescentar `OrchardLOD` (ou `island_tree.*leaves`) à isenção de `NearbyShadowCasters.ts:11` — folhas alpha-test em shadow map de 2048 rendem pouco visualmente e custam caro — e unificar a regex com `SHADOW_EXEMPT` para o teste voltar a cobrir o comportamento real.

---

### 5. O orçamento de residência é 3, e ragdolls podem prender regiões indefinidamente
**Prioridade: MÉDIA · FATO (mecanismo) + HIPÓTESE (que explique as "3 regiões retidas" do QA)**

FATO: `src/world/FarmWorld.ts:59` cria `RegionResidency` com orçamento **3**. `src/world/streaming/SpatialRegionInterest.ts:14` usa `loadDistance=110 / releaseDistance=155`. As caixas em `SpatialRegionInterest.ts:5-8` se sobrepõem: de `883, 355`, a distância à caixa de `highland-farms` (354–823 × 177–620) é **60 m** — dentro dos 110 → **rootwood e highland-farms ficam ambas em detalhe completo ao mesmo tempo** (2.671 + 384 nós, 262 k + 169 k tris, 311 MB + 247 MB de textura descomprimida).

FATO: `src/world/FarmWorld.ts:123-127` retém (`regions.retain`) toda região "ocupada", e `occupied` inclui `activeRagdollPositions(this.scene)` com raio 3 (`FarmWorld.ts:125`). `src/physics/RagdollWorld.ts:44` devolve todos os ragdolls não descartados. Em `RegionResidency.reconcile()` (`src/world/streaming/RegionResidency.ts:31-32`), as regiões retidas consomem o orçamento **antes** das espaciais.

HIPÓTESE: um ragdoll deixado numa região anterior (ex.: planaltos ou solar-frontier) a mantém residente em detalhe completo; com rootwood + highland já ocupando 2 slots, o orçamento de 3 satura — o que casa com o "3 regiões retidas" observado. Isso significa ~3 GLB de região completos + `farm-world.glb` (862 nós, 504 MB de textura) + `alien-world.glb` + geologia simultâneos.

FATO que **desqualifica** uma explicação: o total de textura descomprimida estimado para *tudo* residente é ~1,4 GB (RGBA8 + mips). Numa 3080 Ti de 12 GB isso **não** é thrash de VRAM. Não atribuir a queda a memória de vídeo.

**Sugestão concreta:** dar TTL/limite de distância aos ragdolls antes de eles pinarem região (ou excluí-los do cálculo de `occupied` acima de N metros do jogador) e registrar no `DebugOverlay` *quem* retém cada região, para o QA distinguir "3 retidas por projeto" de "3 retidas por corpo esquecido".

---

### 6. `restoreAll()` do navmesh pode re-adicionar todos os tiles a cada 0,5 s quando um agente não encontra rota
**Prioridade: BAIXA-MÉDIA · HIPÓTESE**

FATO: `src/ai/TacticalNavigation.ts:67-96` roda `updateResidency` no máximo a 2 Hz. Para cada agente (até `populationCap=24`) e para cada um de 2 destinos, chama `protectPath`; se falhar, executa `this.residency.restoreAll()` (`TacticalNavigation.ts:91`) e tenta de novo. `src/ai/NavigationTileResidency.ts:24` re-insere **todos** os tiles não residentes via `mesh.addTile` (alocação WASM + cópia por tile), e `prune` em `TacticalNavigation.ts:95` volta a remover quase todos no mesmo tick. O navmesh assado é `farm-navmesh.bin`, 1,75 MB.

HIPÓTESE: se as trilhas do bosque ou os pontos de spawn produzirem agentes desconectados com frequência, isso vira um ciclo `addTile`/`removeTile` sobre o navmesh inteiro duas vezes por segundo. É um custo de CPU sustentado e específico do local onde as rotas falham. Não há evidência de que esteja ocorrendo no rootwood — é uma sensibilidade do design, não um gargalo comprovado.

**Sugestão concreta:** limitar `restoreAll()` a no máximo uma vez por tick de `updateResidency` (hoje ele pode ser chamado por agente) e expor um contador de "restoreAll/s" no `DebugOverlay` para o QA confirmar ou descartar em 10 segundos de observação.

---

## O que foi verificado e **não** é gargalo

- **Grade de colisão no ponto do QA.** A célula 3×3 m que contém `883, 355` tem **7 faces**; a média num raio de 15 m é 9, máximo 18. A média da região é 23 faces/célula. Existe uma célula patológica com 3.767 faces, mas ela fica em `393,141` (≈ `x 1179, z 423`), longe do ponto do QA. `groundAt`/`sample` não estão varrendo listas grandes ali.
- **VRAM.** Soma de todas as texturas de todos os GLB potencialmente residentes, em RGBA8 + mips: ~1,4 GB. Não explica um colapso numa placa de 12 GB.
- **Navmesh do rootwood.** `scripts/bake-navigation.mjs:12` inclui `rootwood.navPositions/navIndices`, `walkableLinks` e os colisores de baú. A região está coberta no bake; não há buraco de navegação por omissão.

## Como discriminar aquecimento de regime permanente (próximo QA)

Sem executar o jogo não dá para fechar isso. O teste mais barato: entrar no bosque, **ficar parado 30 s sem combate**, e anotar FPS aos 5 s / 15 s / 30 s no `DebugOverlay`.

- Se recuperar para 25–38 FPS → o custo dominante é ativação (achado 1) + compilação de shader de primeiro desenho; achados 2/3 são secundários.
- Se ficar travado em 2–8 FPS parado → é fill/regime: achados 2, 3 e 4 passam a ser a prioridade real, nessa ordem.
- Registrar em ambos os casos: `Meshes ativos`, `Draw calls`, `Triângulos` e a linha de regiões retidas. São exatamente os campos que separam "CPU em `evaluateActiveMeshes`" de "GPU em overdraw".
