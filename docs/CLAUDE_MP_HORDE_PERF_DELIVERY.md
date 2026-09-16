# MP por acerto e custo da horda — entrega

**Data:** 2026-09-15 · **Tarefa:** `docs/CLAUDE_MP_HORDE_PERF_TASK.md`
· **Revisão aplicada:** `.temp/horde-render-review.md`
**Sem browser, Playwright, Puppeteer ou automação de UI. Sem commit/push/reset/stash.**

## Arquivos tocados

| Arquivo | Natureza |
|---|---|
| `src/combat/MPCharge.ts` | MP: fim da regeneração passiva, ganho por acerto confirmado, janela deslizante real |
| `src/game/HordeTickCache.ts` | **novo** — fila de ataque e contagem de `windup` por tique |
| `src/game/EnemySwarm.ts` | horda: cache por tique, curto-circuito da linha de visão, fim de alocações por frame, fim do resync de cena das luzes de carga |
| `src/ai/TacticalNavigation.ts` | horda: `freeRank` sem `Set`/listas intermediárias por ator |
| `src/game/PlayerScene.ts` | **uma linha**: `weatherView.world=this.collision` |
| `tests/mp-economy.test.ts` | **novo** — economia de MP, comportamental |
| `tests/horde-performance.test.ts` | **novo** — medição de CPU, integridade a 24/48/80, espião de resync das luzes |
| `tests/mp.test.ts` | ajuste dos dois casos que assumiam regeneração passiva |

Nada foi tocado em `CharacterVisual`, `AnimationStateMachine`, `WeatherPresentation`, terreno/mundo/colisão, `FruitFragments`/`FragmentShapes`, áudio, UI ou CSS. Em `PlayerScene.ts` a única mudança é a linha de integração da chuva. Cálice **não** foi implementado. `EnemySwarm`/`PlayerScene` ficam liberados.

## Correções da revisão (2ª rodada)

| # | Ponto da revisão | Estado |
|---|---|---|
| 1 | `includedOnlyMeshes` reatribuído por quadro → `_resyncMeshes` varre a cena inteira | **corrigido**, com teste-espião |
| 2 | Janela fixa de MP admitia 12 MP na virada | **corrigido**: janela deslizante real de 3 acertos/1 s |
| 3 | `weatherView.world=this.collision` não ligado | **ligado** |

### 1. Luzes de carga do tomate — varredura de cena por quadro

**Causa (confirmada no Babylon 9.25 instalado, `Lights/light.js:129-131` e `:644-658`):** o
`set includedOnlyMeshes` chama `_hookArrayForIncludedOnly`, que termina em `_resyncMeshes()` — uma
passagem por **todas** as malhas da cena. `EnemySwarm.update` reatribuía
`light.includedOnlyMeshes=[...meshes]` a cada quadro, para cada uma das 2 luzes, **mesmo com o mesmo
ator e a mesma lista**. Com 869 malhas ativas no cenário do QA, isso são duas varreguras completas da
cena por quadro, de graça.

**Correção:** `chargeLightTargets[i]` guarda qual ator cada luz já filtra. A lista de malhas de um ator
é fixa desde a criação (a reciclagem do corpo não a reconstrói), então só a **troca de ator** muda a
filiação e só ela reatribui. Intensidade e posição continuam por quadro. Luz sem ator carregando fica
apenas com `intensity=0` e **mantém** a lista anterior — esvaziar significaria, no Babylon, "iluminar
tudo", ou seja, acender o mundo inteiro. `nextStage()` e `dispose()` soltam o vínculo.

**Testes (espião sobre `_resyncMeshes` das duas luzes, `tests/horde-performance.test.ts`):**
primeira filiação = exatamente 1 resync por luz; **120 quadros com os mesmos atores carregando = 0
resyncs**; trocar quem está mais perto volta a resincronizar e a luz passa a filtrar o corpo certo;
sem tomate carregando as luzes ficam em intensidade 0 **sem** esvaziar a lista e **sem** resync; e a
troca de fase apaga as luzes e refaz o vínculo no corpo reciclado.

### 2. MP — janela deslizante real

A revisão está certa: janela fixa deixava passar 6 MP em `t=0,99` e mais 6 em `t=1,01`, ou seja
**12 MP num intervalo de 1 s**, contrariando o "no máximo 6 MP/s" que eu havia escrito.

Agora o estado são os carimbos dos **últimos 3 acertos premiados** num anel de 3 posições (O(1) de
tempo e memória): um acerto só rende se o mais antigo dos três já saiu da janela de 1 s. Garantia
**estrita**: em qualquer intervalo de 1 s a barra sobe no máximo 6 MP. Continuam valendo 2 MP por
acerto básico confirmado e zero ganho passivo, de proc, DOT, especial ou QA/debug.

**Teste novo de fronteira:** 8 alvos em `t≈0` rendem 6; os mesmos 8 em `t≈0,983 s` rendem **0**; em
`t≈1,017 s` voltam a render 6. **Teste de varredura:** 10 s acertando 4 alvos por tique, gravando
`current` quadro a quadro e verificando **todas** as janelas deslizantes de 60 quadros do traçado —
o pior intervalo rende ≤ 6 MP. Total em 10 s: ~6 MP/s (54–60), contra 4.800 sem teto.

### 3. Chuva — integração de uma linha

`src/game/PlayerScene.ts:253`, ao lado do `onRain` já existente:
`this.weatherView.world=this.collision`. É exatamente a integração documentada em
`WeatherPresentation` ("sem isso a chuva roda inteira, apenas sem respingo e sem supressão sob
cobertura"). Nenhum outro arquivo de clima foi tocado; `WeatherPresentation` e seus testes são do dono
da tarefa de chuva.

---

## Parte 1 — MP por acerto

### Causa

`MPCharge` tinha duas fontes de ganho, ambas erradas para o pedido:

1. `MP_REGEN=1.8` somado a cada passo fixo em `update()` — 1,8 MP/s **parado, sem combate**.
2. `events.on('DamageDealt', …)` com `3.5` por acerto não-especial. `DamageDealt` é emitido **antes** de
   `target.onHit` (`DualPistols.ts:202` e `:226`, `PlayerScene.ts:605`), ou seja, é *intenção* de dano,
   não confirmação. Quem prova que o dano entrou é `Health.apply`, que só emite `EnemyHit` **depois** de
   subtrair a vida (`Health.ts:11`) e devolve `false` para cadáver, vítima errada e dano ≤ 0.

Somando: com a cadência das duas pistolas a barra subia dezenas de MP por segundo, e subia sozinha parado.

### Correção

- **`MP_REGEN` removido** — a constante não existe mais.
- A escuta passou de `DamageDealt` para **`EnemyHit`**, com o filtro `awardsMP()` exportado e testável:
  - `attackerId === 1` e `victimId !== 1` (sofrer dano nunca rende);
  - `finalDamage > 0`;
  - `procChainDepth === 0` **e** sem `sourceProcId` — corta proc de bomba, queimadura e os comandos de QA/debug,
    que entram com profundidade 1 (`PlayerScene.ts:724,729,735`);
  - sem as etiquetas `skill`, `dot`, `qa`, `debug` — especiais não se realimentam;
  - **exige** `bullet` ou `melee` (lista positiva): pistola normal e soco entram, o resto não entra por omissão.
- **2 MP por acerto básico confirmado** (`MP_HIT_GAIN`).
- **Teto de 6 MP por janela deslizante de 1 s** (`MP_HIT_WINDOW_CAP`, `MP_HIT_WINDOW`,
  `MP_HIT_WINDOW_HITS=3`).

### Decisão documentada sobre o teto

- O teto morde a partir do **3º acerto premiado** dentro da janela. Rajada e multi-alvo (perfuração,
  ricochete, explosão em área) rendem no máximo 6 MP e o resto do intervalo não rende nada.
- Garantia **estrita**, não média: em **qualquer** intervalo de 1 s a barra sobe no máximo 6 MP.
  MP I (25) pede ~4,2 s de combate contínuo, MP II (55) ~9,2 s e MP III (100) ~16,7 s.
- O estado são os carimbos dos últimos 3 acertos premiados num anel de 3 posições — O(1) de tempo e
  de memória, sem o furo de fronteira de uma janela fixa (que liberaria 12 MP em cima da virada).
- **Não há dedupe por nome de golpe nem por alvo.** `attackId` é o nome da habilidade (`'right'`, `'jab'`,
  `'ricochet_fan'`), não um identificador único do golpe — dedupar por ele bloquearia acertos legítimos.
  Dois tiros no mesmo alvo rendem duas vezes; quem limita é o teto da janela.

Não mudou: estado inicial da barra (100), custos `MP_COSTS`, seleção por segurar o botão, `speedMultiplier`,
e as cargas extras de item (`setMaxCharges`/`consumeCharge`/`SKILL_CHARGE_RECHARGE`) continuam independentes do
ganho por acerto.

### Testes comportamentais (`tests/mp-economy.test.ts`, 11 casos)

| Caso | Resultado |
|---|---|
| 60 s parado (3.600 passos fixos) | `current` fica em **0** |
| `DamageDealt` sem `EnemyHit` (errar, parede, céu) | **0** |
| `Health.apply` recusa: dano zero, vítima errada, cadáver | **0** ganho adicional |
| Pistola confirmada | **+2** |
| Soco confirmado | **+2** |
| Mesmo `attackId` no mesmo alvo, duas vezes | **+4** (sem dedupe) |
| MP I/II/III, proc de bomba, queimadura, `qa`, `debug` | **0** |
| Sofrer dano (`attackerId≠1`) | **0** |
| 8 alvos num único tique | **6** (teto), não 16 |
| 8 alvos em `t≈0`, de novo em `t≈0,983 s` (fronteira) | **6**, não 12 |
| 10 s acertando 4 alvos por tique (2.400 acertos ⇒ 4.800 MP sem teto) | **~6 MP/s**, e **nenhuma** janela deslizante de 1 s do traçado passa de 6 |
| Custos de especial + cargas de item | preservados |

Mais dois casos ponta a ponta contra o `EnemySwarm` real (`Health` real, `hit()` real, queimadura real do
enxame): acerto de pistola e de soco em berinjela viva rendem; a queimadura que o próprio enxame reaplica
não rende; o comando de QA que mata não rende; o cadáver depois dele não rende; e varrer 8 inimigos num
tique respeita o teto.

---

## Parte 2 — custo de CPU da horda

### Método da medição — e o que ela NÃO é

`tests/horde-performance.test.ts` roda a **implementação real** (`EnemySwarm.fixedUpdate` +
`EnemySwarm.update` + `updateCameraVisibility`) sob `NullEngine`, em 24/48/80 atores distribuídos em anéis de
7 a 38 m (cobre as três faixas de frequência do `AIScheduler`), nos dois caminhos de navegação: com Detour
(`tactical`, o do jogo) e com a grade de fallback (`grid`).

```
HORDE_BENCH=1 npx vitest run tests/horde-performance.test.ts
```
(600 frames por amostra, melhor de 3; sem a variável roda 120 frames × 1, só como fumaça.)

**Isto não é FPS e não mede GPU. O banco de caixas não vale como evidência de FPS em nenhum sentido.**
O QA do browser (RTX 3080 Ti, 50 inimigos, 244 draw calls, 869 malhas ativas, 1.870.282 tris) mediu
36→42 FPS com `presentation` entre 12,66 e 18,46 ms, e **não** produziu um A/B confiável: a captura de
35 FPS de referência caiu num ponto diferente do ciclo de spawn e com processos concorrentes diferentes.
Nada abaixo contradiz nem confirma esses números. Limites honestos do banco:

- `NullEngine` não rasteriza: draw calls, overdraw, shadow map e custo de material ficam **inteiramente de fora**.
- Os inimigos do fixture são **caixas sem esqueleto e sem clipes**. Portanto `PosePalette.sync()`,
  `AnimationStateMachine.sample()` e o skinning **não entram na conta**. O que sobra medido é IA, colisão,
  telegraph, seleção, sincronização de posição e alocação.
- O número absoluto depende da máquina; só vale a comparação antes/depois no mesmo host.
- Esta máquina estava com carga concorrente durante as medições. Por isso reporto **mínimo entre execuções**
  e trago o passo do Detour (`crowd.update`, WASM que **não** foi alterado) como **controle de ruído**.

### Custos identificados antes de alterar

| # | Custo | Onde |
|---|---|---|
| 1 | `think` fazia `filter`+`sort` da lista inteira **por ator**, só para achar a própria posição na fila | `EnemySwarm.ts:148` (antigo) |
| 2 | `think` fazia um segundo `filter` da lista inteira **por ator**, para contar quem está em `windup` | `EnemySwarm.ts:151` (antigo) |
| 3 | `think` chamava `sweepSphere` (varredura de linha de visão) **incondicionalmente**, mesmo para quem estava fora de alcance, em recarga ou sem vaga | `EnemySwarm.ts:151` (antigo) |
| 4 | `TacticalNavigation.target` montava `[...entries()]` + `filter` + `map` + `Set` a cada chamada — e é chamado uma vez por ator por tique | `TacticalNavigation.ts:63` |
| 5 | A posição vinda do Detour era sincronizada **duas vezes por ator por frame** (`position()` + `groundAt()` repetidos) para quem estava em perseguição | `EnemySwarm.ts:196` e `:200` (antigo) |
| 6 | `update()` criava **dois `Color3` por malha por frame**, um deles reparseando `'#fff0bc'` | `EnemySwarm.ts:241` (antigo) |
| 7 | `update()` fazia `filter`+`sort` da horda inteira por frame só para achar os 2 tomates carregando, e `filter`+`sort`+`slice`+`map` para os 4 projetores de sombra | `EnemySwarm.ts:234` e `:237` (antigo) |
| 8 | `count` alocava um array a cada leitura (e é lido pelo diretor, pelo orçamento e pelo HUD) | `EnemySwarm.ts:67` (antigo) |
| 9 | A separação local recriava `Map` + listas + chaves de texto a cada passo fixo | `EnemySwarm.ts:206` (antigo) |
| 10 | `damageContext` fazia `actors.find` linear por evento de dano | `EnemySwarm.ts:131` (antigo) |

### O que foi feito

**`HordeTickCache` (módulo novo).** O conjunto de atores não muda durante `AIScheduler.update`: `think` não
move, não mata e não cria ninguém — os spawns do diretor e das invocações acontecem **depois**. Então a fila de
ataque (ordenada por distância, separada em corpo a corpo e à distância) e a contagem de `windup` são montadas
**uma vez por passo fixo** e lidas em O(1). Resolve 1 e 2.

Equivalência preservada: a ordenação usa distância ao quadrado (mesma ordem) e `sort` estável sobre a lista na
ordem original (mesmo desempate do `filter().sort()` antigo). A contagem de `windup` só **cresce** dentro de um
tique, e `noteWindup()` reproduz exatamente o que o `filter` antigo via — o teste garante que o limite de
**3 vagas corpo a corpo e 4 à distância** continua valendo a 24 e a 80 atores.

**Curto-circuito da linha de visão (3).** Alcance, altura, recarga e vaga são testes aritméticos; a varredura é
o item caro. Agora ela só roda para quem já passou por todos eles. `sweepSphere` não tem efeito colateral, então
o resultado é idêntico.

**`TacticalNavigation.freeRank` (4).** Mesma regra ("menor sector livre da classe"), com um vetor de marcação
reaproveitado em vez de três listas intermediárias e um `Set` novos por ator.

**Sincronização única do Detour (5).** Quem está em perseguição cai no bloco de baixo, que refaz exatamente a
mesma sincronização. A de cima ficou restrita a `windup`, `recover` e empurrão — os três casos que **leem** a
posição antes de chegar lá (a checagem de contato do `recover` depende disso).

**Alocações por frame (6, 7, 8, 9, 10).** Cores de overlay viraram constantes de módulo e só são reescritas
quando há overlay a mostrar ou a apagar; seleção dos mais próximos por varredura direta O(n×k) em buffer
reaproveitado; `count`, aposentadoria e vizinhança por laço simples; grade de separação com chave numérica e
`Map`/listas reaproveitados entre tiques; índice `id → ator` para o contexto de dano.

**O que deliberadamente NÃO foi feito:** nenhuma redução de quantidade de inimigos, nenhuma IA/dano/colisão
desligada, nenhum LOD alterado, nenhum telegraph/laser/aviso suprimido, nenhuma mudança em chefe, fragmentos,
âncora de recompensa ou marcadores. O `populationCap`, o `PopulationBudget` e o `AIScheduler` estão como estavam.

### Números medidos

**Contadores determinísticos** (idênticos byte a byte entre execuções — imunes ao ruído da máquina; são a
prova algorítmica):

| nav | atores | `sweepSphere`/frame | `groundAt`/frame | `move`/frame |
|---|---:|---|---|---|
| tactical | 24 | 9,5 → **5,1** (−46 %) | 54,8 → **39,7** (−28 %) | 0 → 0 |
| tactical | 48 | 17,7 → **7,9** (−55 %) | 102,0 → **68,9** (−32 %) | 0 → 0 |
| tactical | 80 | 24,0 → **6,6** (−73 %) | 149,6 → **89,0** (−41 %) | 0 → 0 |
| grid | 24 | 10,1 → **5,8** (−43 %) | 33,0 → 33,0 | 22,9 → 22,9 |
| grid | 48 | 17,5 → **7,9** (−55 %) | 57,8 → 57,8 | 60,6 → 60,6 |
| grid | 80 | 25,3 → **8,0** (−68 %) | 85,6 → 85,6 | 112,3 → 112,3 |

`groundAt` não muda no caminho `grid` porque a sincronização dupla só existia no caminho do Detour. `move`
ficando **idêntico** nos três tamanhos é a prova de que a reescrita da separação local não mudou nada de
comportamento — os mesmos pares, na mesma ordem, com o mesmo teto de 8.

Antes de 80 atores o contador de `sweepSphere` estava **saturado em 24,0/frame**, exatamente o
`AI_TUNING.maxPerTick`: toda decisão de IA pagava uma varredura de linha de visão.

**Relógio, ms/frame, mínimo entre execuções** (antes: mínimo de 3; depois: mínimo de 6):

| nav | atores | total antes | total depois | horda s/ Detour antes | horda s/ Detour depois | Δ | *controle: Detour* |
|---|---:|---:|---:|---:|---:|---:|---:|
| tactical | 24 | 0,312 | **0,202** | 0,226 | **0,132** | −42 % | 0,086 → 0,070 |
| tactical | 48 | 0,699 | **0,371** | 0,494 | **0,203** | −59 % | 0,204 → 0,168 |
| tactical | 80 | 1,431 | **0,636** | 1,067 | **0,311** | −71 % | 0,364 → 0,325 |
| grid | 24 | 0,153 | **0,118** | 0,153 | 0,118 | −23 % | — |
| grid | 48 | 0,288 | **0,185** | 0,288 | 0,185 | −36 % | — |
| grid | 80 | 0,467 | **0,296** | 0,467 | 0,296 | −37 % | — |

**Leitura honesta do controle.** A coluna do Detour é código que eu **não** toquei e ainda assim caiu 11–19 %
entre as duas baterias. Isso é o piso de ruído desta máquina (havia trabalho concorrente rodando). Descontando
esse piso, o ganho real atribuível à mudança em 80 atores fica em torno de **−66 %** na parte da horda fora do
Detour, e não nos −71 % brutos. Em 24 atores, ~**−32 %**. Os contadores acima não têm essa ressalva.

Depois da mudança, em 80 atores o Detour (`crowd.update`) passou a ser **o maior item medido isoladamente**:
0,325 de 0,636 ms/frame, ou 51 % do total.

### Integridade preservada (testes)

`tests/horde-performance.test.ts` roda 600 frames a 24 e a 80 atores e verifica: os 80 continuam agendados;
`scheduler.totalTicks > frames`; telegraphs acontecem; ataques (`recover`) acontecem; o pico simultâneo de
`windup` respeita 3 corpo a corpo / 4 à distância; a fila é montada **exatamente uma vez por passo fixo**
independentemente da população; e nenhuma posição vira `NaN`.

Continuam passando sem alteração: `enemy-swarm` (contratos de espécie, investida, laser da cenoura com e sem
parede, teto de população, chefe, aposentadoria), `telegraph-shapes`, `population-budget`, `tiled-navigation`,
`reward-anchor`, `fruit-fragments`, `net-simulation`, `skill-charges`.

---

## Verificação executada

**2ª rodada (revisão), validação delimitada — suíte completa e as 6 baterias de tempo NÃO foram repetidas,
como pedido:**

- `npx tsc --noEmit` — **limpo**.
- `npx vitest run` sobre os arquivos afetados: `mp`, `mp-economy`, `skill-charges`, `horde-performance`,
  `enemy-swarm`, `telegraph-shapes`, `weather-presentation`, `weather-cycle`, `net-simulation` —
  **116 passando, 0 falhando**.
- A evidência das três correções é **determinística** (contagem de `_resyncMeshes`, varredura de todas as
  janelas de 1 s do traçado de MP), não cronometrada — por isso não precisou de nova bateria de tempo.

**1ª rodada (implementação inicial):**

- `npx tsc --noEmit` — **limpo**.
- `npx vitest run` — **722 passando**. Falhas restantes (9), todas **alheias a esta tarefa** e confirmadas
  como tal rodando cada arquivo isolado:
  - `tests/combat-assets.test.ts` (5) e `tests/hordes-arsenal-catalog.test.ts` (1): `ENOENT` em
    `assets/Meshy_AI_*.glb` e `art/processed/gunslinger-before-directional.glb` — arquivos de arte que não
    existem neste clone.
  - `tests/footstep-sync.test.ts` (3): arquivo de teste **e** `src/animation/FootstepSync.ts` são
    **não rastreados** (`??` no git), trabalho em curso de outra tarefa. Não toquei em `src/animation/`.
  - Observação: `tests/hud-dom-churn.test.ts` falhou numa das execuções da suíte cheia e passou isolado e nas
    seguintes — instável sob carga, também de outra tarefa.

---

## Gargalos restantes — sem evidência, declarados como tal

0. **O ganho do hotspot das luzes não foi cronometrado.** A prova é a contagem de `_resyncMeshes`
   (120 quadros × 2 luzes → de 240 varreduras de cena para **0**). Quanto isso vale em ms depende do número
   de malhas ativas, que o `NullEngine` não representa: o fixture tem dezenas de malhas, o cenário do QA tinha
   **869**. **Não converto isso em FPS nem em ms.** A medição confiável é o QA repetir a captura no browser.
1. **Esqueleto, pose e amostragem de animação: não medidos.** O fixture usa caixas sem rig. No jogo, cada ator
   roda `machine.sample()`, `palette.sync()` (24 ossos por rig, comparação por osso) e
   `root.computeWorldMatrix(true)` a cada frame em que o LOD de animação não pula. **Suspeito que este seja o
   maior custo de CPU real da horda a 24 inimigos rigados, e não tenho nenhuma medição que sustente isso.**
   A revisão aponta, com razão, que carregar GLB rigado real sob `NullEngine` é possível sem editar
   `src/animation/`. Não fiz isso nesta rodada — o pedido foi priorizar as três correções concretas e não
   ampliar para redesenho de animação/LOD. **O número de `presentation 18,46 ms` do QA continua sem causa
   atribuída por medição minha.**
2. **GPU, draw calls, overdraw e shadow map: fora do harness.** Nada aqui contradiz nem confirma os achados
   de `docs/CLAUDE_ROOTWOOD_PERF_REVIEW.md`; terreno e regiões não foram tocados, como pedido.
3. **`crowd.update` do Detour** é agora o maior item medido a 80 atores (51 %). Não foi tocado. Se o teto de
   população subir, é o próximo alvo — e é WASM, então precisa de outra abordagem.
4. **`TacticalNavigation.updateResidency`** pode chamar `restoreAll()` por agente a 2 Hz (achado 6 da revisão do
   rootwood). Não observei isso disparar nas medições — mas o fixture tem um navmesh de um plano só, então a
   medição **não** cobre esse caminho. Continua sem evidência em qualquer direção.
5. **Achado colateral, não corrigido:** o parâmetro `rank` de `TacticalNavigation.target` é **descartado** —
   a função recalcula `rank = previous ? min(previous.rank, free) : free` logo em seguida. Ou seja, o
   `filter`+`sort` por ator que eu substituí estava alimentando um argumento que a função sobrescreve. Mantive
   a assinatura para não mexer na API de outra tarefa, mas o argumento pode ser removido.
