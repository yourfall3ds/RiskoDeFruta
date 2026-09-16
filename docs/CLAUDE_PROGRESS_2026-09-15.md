# Progresso do Cláudio — 15/09/2026

Implementação técnica do briefing `SESSION_BRIEF_2026-09-15.md`, com direção visual de `VISUAL_FEEDBACK_2026-09-15.md` e `EXPEDITION_DESIGN.md`.
Regras seguidas: sem commit/push/deploy/reset, sem Meshy, sem apagar assets originais. `src/style.css` permanece sob autoria do Codex.

## Linha de base medida antes de editar
- 116 arquivos TS em `src/` + `server/`, 5.605 linhas. Não é o projeto histórico de D: descrito em `CURRENT_IMPLEMENTATION.md`; esta cópia é menor.
- Suíte no checkout limpo: **6 falhas pré-existentes** em `tests/combat-assets.test.ts` e `tests/hordes-arsenal-catalog.test.ts`. Causa: leem GLBs originais em `assets/`, que está fora do repositório. Confirmado com `git stash` antes de qualquer edição. Não são regressões minhas e não posso corrigi-las sem os arquivos originais.

---

## Etapa 1 — Balanceamento inicial e atributos reais (item 8) — CONCLUÍDA

**Arquivos:** `src/player/PlayerTuning.ts`, `src/player/PlayerMotor.ts`, `src/run/RunProgression.ts`, `src/combat/MPCharge.ts`, `src/game/PlayerScene.ts`, `src/physics/TriangleGround.ts`, `src/physics/CollisionWorld.ts`.

- ~~Caminhada 5,5 m/s e corrida 8 m/s~~ — **substituído na Etapa 6 por 4,4 / 6,8** após a revisão visual apontar que 5,5/8 não desacelerava nada. Caminhada e corrida (`WALK_SPEED`/`SPRINT_SPEED`; `sprintMultiplier` é derivado, sem número mágico duplicado). Cadência de tiro **3,3/s** (`PISTOL_TUNING.rate`).
- `RunStats` ganhou `sprintSpeed` e `skillCharges`. Dois itens novos reaproveitando ícones já existentes (os 90 PNGs continuam cobertos, agora com 92 definições):
  - `turbine` (ícone 46) — +12% só na corrida por unidade.
  - `reservoir` (ícone 71) — +1 carga de especial por unidade.
- `MPCharge` ganhou cargas extras reais: `setMaxCharges`, `consumeCharge`, recarga de 16 s com `chargeProgress`/`chargeSecondsLeft` para o HUD comunicar. Item novo entrega a carga cheia na coleta.
- Descrições corrigidas para o efeito real (`battery` = cadência de disparo; `boot` = caminhada **e** corrida).
- `PlayerMotor.sprintMultiplier` aplica o bônus de corrida separado do de caminhada.

**Também nesta etapa (base para os itens 3 e 10):**
- `TriangleGround.sample()` e `CollisionWorld.surfaceAt()` devolvem altura + normal + inclinação da superfície **real**, incluindo faces mais íngremes que o limite jogável. `groundAt` continua respondendo só o piso caminhável.
- `PlayerMotor.resolveSteepSlope()` — acima de 50° o corpo apoia na malha e **escorrega** ladeira abaixo em vez de ficar suspenso contra a face.
- `PlayerMotor.updateDash()` — dash direcional por duplo toque de WASD, com cooldown, uma carga aérea e as mesmas varreduras de colisão do movimento normal.

**Validação:** `tests/player.test.ts`, `tests/combat-feel.test.ts`, `tests/reload-movement.test.ts`, `tests/net-simulation.test.ts`, `tests/run-progression.test.ts`, `tests/hordes-arsenal-catalog.test.ts` atualizados para o novo baseline e aprovados (fora as 6 falhas pré-existentes de asset).

**Não conclui nesta etapa:** animação/efeito visual dedicado do pulo aéreo extra e do dash; HUD da carga de especial. Vêm nas etapas de HUD e animação.

---

## Etapa 2 — Expedição com quatro totens (item 1) — CONCLUÍDA

**Arquivos novos:** `src/run/ExpeditionObjectives.ts`, `src/run/ExpeditionAnchors.ts`, `src/run/HarvestResonance.ts`, `src/world/ExpeditionSites.ts`.
**Integração:** `src/game/PlayerScene.ts`, `src/ui/CombatHUD.ts`, `src/game/EnemySwarm.ts`.

- **Colocação real**: `planExpedition` percorre âncoras ordenadas pela partida e só aceita centro com piso **largo, contínuo e com rota** (`isOpenGround` amostra dois anéis; `TacticalNavigation.reachable` confirma). Ponte estreita, ilhota curta e interior sólido são recusados. Se o relevo não sustentar raio 11 m, tenta 8,5 e 6,5 antes de desistir.
- **Carga por permanência**: `E` junto ao poste ativa; permanecer vivo dentro do raio carrega. **45/55/65/75 s**. Sair ou morrer **pausa** — a carga nunca é apagada. Ativar outro marco pausa o anterior preservando o progresso.
- **Nada depende de zerar inimigos**: a conclusão é só tempo dentro da área.
- **Último evento**: com os quatro marcos concluídos nasce a Praga Alfa (`EnemySwarm.requestBoss`). Sem rota até o jogador por 6 s, `recoverBoss()` recoloca **o mesmo chefe** em piso válido perto — sem recriar vida nem pagar recompensa.
- **Fenda** abre ao derrotar o chefe e avança o estágio (`advanceStage`), reiniciando marcos e ressonância.
- **Modos antigos preservados por URL**: `?mode=horde` (hordas progressivas), `?mode=classic` (diretor clássico com fenda; `?mode=expedition` foi **corrigido na Etapa 6** para apontar à expedição nova), `?mode=training`. O padrão passou a ser a expedição nova.
- **Ressonância da Colheita** (item 11, parte mecânica): alternar tiro / corpo a corpo / ação aérea acumula até 3 níveis (+12% na carga do totem por nível). Repetir o mesmo tipo não acumula e só **acertos reais** contam (`DamageDealt` com tag `bullet`/`melee`) — tecla pressionada não alimenta. Decai em 6 s por nível.
- **Visual dos marcos**: primeira versão usava `supply-crate.glb` com faixa chapada — **reprovada na revisão e refeita na Etapa 6** (runas autorais, base imóvel, texturas SVG do Codex, limite preso ao relevo e colisão).

**Validação:** `tests/expedition-objectives.test.ts` — 15 testes.

---

## Etapa 3 — Diretor sempre ativo perto do jogador (item 2) — CONCLUÍDA

**Arquivos:** `src/ai/SpawnPlanner.ts`, `src/run/MonsterDirector.ts`, `src/game/EnemySwarm.ts`.

- Anel **15–35 m** (`SPAWN_RING_MIN/MAX`) e `validSpawnGround`: recusa vazio, interior sólido e laje sem 2,4 m de piso contínuo em volta. Distância mínima garante que nada nasce no corpo do jogador.
- `MonsterDirector` ganhou o modo `expedition`: reposição contínua, **sem janela de silêncio e sem esperar a população zerar**. `pressure` (0..1) vem do evento em curso — marco carregando e chefe custam mais que caminhar — e acelera créditos e cadência de nascimento.
- Teto continua sendo o orçamento real de performance (`PopulationBudget`); aposentar inimigo distante devolve orçamento e **não** conta abate nem paga recompensa.

**Validação:** `tests/expedition-feel.test.ts` (parte “diretor perto do jogador”) — 5 testes, incluindo prova de que a população 8 > 0 não interrompe a reposição e de que o teto de 12 nunca é ultrapassado.

---

## Etapa 4 — Câmera, lentidão e barras de inimigo (itens 12 e 6) — PARCIAL

**Arquivos:** `src/camera/ThirdPersonCamera.ts`, `src/camera/SlowMotion.ts` (novo), `src/game/PlayerScene.ts`, `src/ui/CombatHUD.ts`.

- Seguimento amortecido com **antecipação moderada** (0,55 m máx.) que volta ao parar; **a mira não é afetada** — teste prova que `forward` continua exatamente no yaw.
- **FOV de corrida** +6° com suavização contínua nos dois sentidos e independente da taxa de quadros. `configure('fov')` passou a ajustar a base, sem brigar com a abertura.
- **Lentidão** curta (0,55 s) só em finalização forte (chefe, habilidade, golpe pesado), com intervalo de 9 s. É **apenas apresentação**: aplicada a `worldDt`/animação, nunca ao passo fixo, ao diretor ou ao servidor — está comentado no código e coberto por teste.
- **Barras de vida inimigas**: nome e números saíram do DOM visível e ficaram só no rótulo acessível (`aria-label`).

**Pendente do item 12:** fragmentos de casca/polpa/semente por espécie ao quebrar frutas.

---

## Etapa 5 — Combate desarmado e dash (item 10) — PARCIAL

**Arquivos novos:** `src/combat/UnarmedCombat.ts`. **Integração:** `PlayerScene`, `GameInput`, `InputFrame`, `DualPistols`, `CharacterVisual`.

- `V` alterna postura: pistolas **guardadas de verdade** (`DualPistols.holstered` desativa os nós e o disparo). Recusa a troca no meio de um golpe.
- Combo de cinco etapas — direita, esquerda, gancho, chute frontal, giro — encadeado por novo clique durante a recuperação. Cadência inicial lenta, conforme pedido.
- **Dano uma única vez por alvo e por etapa** (`canHit`/`registerHit`); alcance, cone e diferença de altura conferidos por `meleeReaches`, mais varredura do peito ao alvo para **não atravessar cobertura**.
- Cadência dos itens encurta **preparo, janela ativa e recuperação juntos** — não só o intervalo.
- Dash duplo WASD (Etapa 1) com cooldown, carga aérea e colisão real; alimenta a ressonância como “ação aérea”.

**LIMITAÇÃO HONESTA:** o GLB do jogador **não tem clipes autorais de soco/chute**. A camada de animação reaproveita `Fire_R`/`Fire_L`/`Release` com giro de tronco como substituto, sinalizado em comentário no código. Clipes dedicados exigem Blender e os `assets/` originais, que não estão nesta cópia.

**Validação:** `tests/unarmed-combat.test.ts` (14 testes) e `tests/expedition-feel.test.ts` (dash, 5 testes).

---

## Etapa 6 — Correções de prioridade do feedback de 15/09 — CONCLUÍDA

Lidos antes de editar: `VISUAL_FEEDBACK_2026-09-15.md` e `CLAUDE_MOVEMENT_REVIEW_2026-09-15.md` atualizados.

### Balanceamento corrigido (substitui os 5,5/8 da Etapa 1)
`WALK_SPEED 4.4` / `SPRINT_SPEED 6.8`. Os testes de travessia deixaram de fixar 5,4/8,1 e passaram a
derivar o orçamento das constantes (`city-traversal`, `highland-traversal`, `highland-trails`,
`solar-frontier`, `farm-world`, `mesh-collision`, `net-simulation`, `combat-feel`, `player`, `reload-movement`).

### Mira viva de MP I e MP II (bug reproduzido pelo usuário)
`DualPistols` copiava a mira por `Vector3.LerpToRef` + `normalize`. Com direções **antipodais** isso
nunca vira: o resultado degenera e a rajada inteira continuava saindo para o lado inicial.
Agora **cada novo disparo copia `camera.forward` do momento** (`copyFrom`), em MP I e MP II.
Balas já em voo mantêm a trajetória. `tests/skill-aim.test.ts` cobre 90°, 180°, mira vertical,
preservação das balas em voo e um teste que documenta a degeneração do lerp.

### MP III sempre dispara
Sem alvo válido a tempestade agora atira para a frente em vez de ficar em silêncio; os alvos do
rodízio passaram a exigir alcance, ângulo **e linha de visão** reais.

### Achados da revisão técnica (`CLAUDE_MOVEMENT_REVIEW`)
- **#1 coop:** `server/FarmSimulation.ts` aplica `sprintSpeed` e `setMaxCharges` — fim do snap-back contínuo.
- **#2 carga de especial:** integrada na Etapa 6 anterior (`consumeCharge` na janela final, HUD lê `mp.charges`).
- **#3 dash sobrevive ao respawn:** `respawn()` e a recuperação de sólido zeram `dashRemaining`/`dashAirUsed`/`sliding`.
- **#4 esquiva durante o dash:** bloqueada enquanto o dash roda; `barrageRetreat()` cancela o dash antes de recuar.
- **#5 faces íngremes invisíveis:** filtro do índice de `TriangleGround` de `.25` (75,5°) para `.08` (85,4°).
- **#6 escorregar sem saída:** durante o deslizamento o salto e os recursos aéreos voltam; `slides` conta episódios.
- **#7 dash em rede:** o duplo toque passou a ser detectado na **captura** (`src/input/DoubleTap.ts`) e viaja
  como intenção (`InputFrame.dash`, bit `BUTTON.DASH`). O servidor não redetecta borda, então perder o
  pacote da soltura não dessincroniza mais. O servidor continua validando cooldown, carga aérea e colisão.

### Bug próprio encontrado e corrigido no deslizamento
A primeira versão **fixava `position.y` na face íngreme** e o corpo ficava pairando na beira do
penhasco para sempre — o oposto do pedido. Diagnóstico com sonda dedicada (`.temp/claudio-trail-probe.mjs`):
o jogador parava a 8,7 m do waypoint, em face de 81,8°, com `vy` zerado todo quadro.
Duas causas: (a) o clamp de altura levantava o corpo para a face; (b) `moveAirborne` tratava
QUALQUER normal com componente vertical como piso e zerava a queda.
Correções: o deslizamento não reposiciona mais o corpo, e `moveAirborne` recebe `supportNormalY`
— só piso de verdade (acima da inclinação caminhável) ou teto contam como contato vertical.
Isso destravou `tests/highland-trails.test.ts`, que o baseline mais lento tinha exposto.

### Expedição
- `?mode=expedition` voltou a ser a URL **explícita** da expedição nova; só `classic`/`legacy` caem no diretor antigo.
- HUD passou a usar `player.position` para distância e alcance de interação; a câmera só orienta a seta.
- Copy do menu e dos controles reescrita para o modo real (marcos, arrancada, corpo a corpo);
  o texto antigo prometia item no centro e chefe a cada cinco ondas.
- `PlayerHUD.setObjective` publica o marco/estado atual no cabeçalho.

### Recompensa onde a praga caiu
`src/run/RewardAnchor.ts` (novo) + `EnemySwarm.lastKill` + `RunInteractables.deliverWaveReward(rng,anchors)`.
Ordem: morte decisiva → objetivo → campo. Morte no ar desce para o piso; morte na beirada escorrega
para o anel seguro mais próximo; sem piso em lugar nenhum não entrega item inalcançável.
`tests/reward-anchor.test.ts`, 8 testes.

### Marcos da expedição refeitos
- Corpo: `arcane-skill-ritual.glb` (runas autorais) — silhueta própria, **não** o baú de recompensa.
- Base **imóvel**: só a peça de energia gira/flutua.
- Feixe e núcleo usam `public/textures/expedition-beam.svg` do Codex, com alpha real (núcleo estreito,
  halo lateral, queda vertical) em vez de faixa chapada.
- Limite usa `expedition-boundary.svg` numa grade cujos vértices buscam o próprio chão: **acompanha o
  relevo** em vez de um disco plano que some sob o solo. Só aparece no marco ativo/carregando.
- **Colisão** com topo pisável, registrada no mundo e devolvida no `dispose`.

### Suíte separada da cópia de trabalho
`vitest.config.ts` (novo) exclui `.temp/` e `.tools/`; o vitest estava coletando as suítes da cópia
de outro agente e reportando falhas que não são deste repositório.

---

## Etapa 7 — Estúdio de sons ligado ao áudio real do jogo — CONCLUÍDA

**Arquivo editado:** `src/audio/RecordedAudio.ts` (mais `DebugOverlay.ts` e `vite.config.ts`).
Os arquivos do painel (`EnemyAudioOverrides.ts`, `EnemyAudioCatalog.ts`, `EnemyAudioLab.ts`,
`audio-lab.html`) são de outro autor e **não foram tocados**.

- `WeaponAudio` cria um `EnemyAudioOverrides` (injetável; `null` desliga em teste/servidor),
  chama `prepare(context)` no `unlock()` e `dispose()` no `dispose()`. O `BroadcastChannel` da própria
  classe atualiza o cache, então o loop de áudio nunca espera IndexedDB.
- `enemy()` consulta `muted`/`gain`/`customBuffer` por espécie e evento. Enquanto `ready` carrega, o
  cache está vazio e tudo soa no padrão — sem bloquear.
- **Ataque toca dois eventos independentes:** `attack` (voz) e `attack-layer` (ruído). Cada um com
  mute, volume e arquivo próprios.
- Os padrões (grupo, ganho, gap, `playbackRate`) vêm do **catálogo compartilhado**; não existe segunda
  tabela no runtime que possa divergir do painel.
- Arquivo do usuário tem prioridade e cadência isolada (`playBuffer`), para não herdar o intervalo de um
  grupo compartilhado. Silenciar o ruído do milho **não** silencia a pistola do jogador (caminho distinto).
- Link **Trocar sons dos inimigos** no F1, abrindo `/audio-lab.html` em outra aba.
- `audio-lab.html` entrou como entrada do Vite: `dist/audio-lab.html` confirmado no build.

### Áudio de dano recebido e impacto por habilidade (pedido do usuário)
- `playerHurt(source)` escolhe o timbre pela origem real (corpo a corpo, projétil, laser, ambiente) e
  **garante que o primeiro acerto direto depois de um respiro seja audível**, ignorando o intervalo
  anti-metralhadora. Dano periódico de fogo tem cadência própria e mais baixa.
- `skillImpact(id)` dá impacto próprio a MP I, MP II, MP III e a cada etapa do corpo a corpo;
  o som do disparo deixou de ser tratado como substituto do impacto. Chamado em
  `DualPistols.damageTarget` e na resolução do golpe desarmado.

**Validação:** `tests/enemy-audio-integration.test.ts` — 10 testes (voz/ruído independentes, mute por
espécie, volume 0 e 1,8, pistola do jogador preservada, arquivo do usuário realmente tocado, restaurar,
espécie/evento desconhecido, ausência de segunda tabela). `tests/recorded-audio.test.ts` continua passando.
Build e typecheck cliente/servidor aprovados.

**Não validado por mim:** timbre, mixagem percebida e qualquer QA visual do painel — isso é do Codex via CUA.

---

## Etapa 8 — Clima e ambiente (item 14) — CONCLUÍDA

**Arquivos novos:** `src/world/WeatherCycle.ts` (puro), `src/world/WeatherPresentation.ts`.
**Integração:** `PlayerScene` (update/reset/dispose) e `CombatHUD` (rótulo da fase).

- Ciclo **sol → nublado → chuva → crepúsculo → noite → sol**, com 95 s de permanência e 35 s de
  transição. Cada parada define sol, preenchimento, névoa, exposição, chuva, umidade e legibilidade.
- **Transições contínuas**, com suavização em S: teste percorre 6 horas simuladas e exige que nenhum
  parâmetro salte entre quadros — nada de corte seco.
- Progresso por **tempo e abates** (0,9 s de crédito por abate); o contador de abates nunca faz o
  relógio retroceder ao reiniciar o estágio. Pausa congela o ciclo.
- **Chuva limitada à câmera**: um único sistema de partículas de 900 gotas ancorado na câmera,
  em caixa de 16 m — não há emissor por região.
- **Navegação preservada**: `fogEnd` nunca fecha abaixo de 150 m e `readability` sobe nas fases
  escuras (a intensidade do ambiente é dividida por ela), para inimigos e marcos continuarem legíveis
  à noite. Teste garante ambas as invariantes.
- Rótulo da fase no HUD (`.run-weather`).

**Validação:** `tests/weather-cycle.test.ts` — 11 testes.

**Não entregue deste item:** material de chão realmente molhado (a umidade é calculada e exposta em
`WeatherPresentation.wetness`, mas ainda não alimenta o material do terreno) e áudio de chuva.

---

## Validação geral desta sessão

- `npm run typecheck` e `npm run server:typecheck`: **aprovados**.
- `npx vitest run`: **530 aprovados / 536**. As 6 falhas são as **pré-existentes** de asset
  (`combat-assets` × 5 e `hordes-arsenal-catalog` × 1), que leem GLBs originais em `assets/`,
  fora do repositório. Confirmado com `git stash` antes da primeira edição.
- `npm run build`: **aprovado**, com `dist/index.html` e `dist/audio-lab.html`.
  O aviso de chunk > 500 kB é anterior a esta sessão.
- `vitest.config.ts` novo: exclui `.temp/` e `.tools/` e usa 30 s de limite por teste
  (travessias reais estouravam os 5 s padrão sob carga paralela, embora passassem sozinhas).

## Ainda NÃO entregue do briefing — não considerar feito

- **Item 3 (relevo das ilhas)**: só a parte física foi feita (deslizamento, superfície real, colisão
  do marco). Esculpir cristas, terraços e afloramentos exige Blender e os `assets/` originais.
- **Item 4 (texturas estocásticas e vento na vegetação)**: não iniciado. A referência MIT está
  clonada em `.tools/references/three-hex-tiling` e o plano é um `MaterialPluginBase` do Babylon.
- **Item 7 (entrada pela plataforma da nave)**: não iniciado; depende de clipes autorais.
- **Item 10 (animação do corpo a corpo)**: a mecânica está completa, mas os clipes de soco/chute
  **não existem** no GLB — a camada atual reaproveita `Fire_R`/`Fire_L`/`Release`.
- **Item 11 (trampolins/propulsores e baús em rotas verticais)**: só a Ressonância da Colheita saiu.
- **Item 12 (fragmentos de fruta por espécie)**: não iniciado.
- **Item 13 (terreno destrutível)**: não iniciado.
- **Nenhuma revisão visual foi feita por mim**: não tenho navegador nesta sessão. Tudo que depende de
  ver — feixe do marco, limite no relevo, chuva, HUD novo, timbre dos sons — precisa do QA do Codex.

---

## Etapa 9 — Correções do `CLAUDE_WORLD_CONTINUATION` (1–3) — CONCLUÍDA

### 1. Feixe branco dos marcos
`StandardMaterial` **soma** `emissiveTexture.rgb` a `emissiveColor`; com os SVGs brancos do Codex o
resultado ia a branco puro. Novo helper `ExpeditionSites.tinted()`: o SVG entra **só** como
`opacityTexture` (`getAlphaFromRGB=false`) e a cor do estado vem inteira de `emissiveColor`.
Âmbar disponível → menta carregando → apagado concluído agora aparecem de verdade.

### 2. Caixa invisível do totem
`arcane-skill-ritual.glb` é selo de runas e filamentos, não pedestal. A caixa `TOTEM_BODY`
0,62 × 1,15 m não correspondia à imagem e fazia o personagem pisar no vazio.
**Removida por completo**: o selo é energia sobre o chão e não registra colisor nenhum; quem
atravessa o marco caminha no terreno real. `TOTEM_BODY` deu lugar a `TOTEM_ENERGY_HEIGHT`
(altura da peça flutuante). Nenhum teste impunha o colisor, então não havia teste a preservar.

### 3. Clima sob céu azul fixo
- O céu é o `ShaderMaterial` do `SeamlessSky` e **não** recebe `clearColor`. O shader ganhou
  `skyTint`/`skyCoverage`/`skyNight` e a função `applySkyWeather()`; a cobertura puxa o panorama
  para a cor do tempo (mais forte perto do zênite) e a noite escurece preservando contraste.
  A textura original não é alterada.
- **`wetness` ganhou consumidor**: `WeatherPresentation` captura os materiais de chão por whitelist
  (`WET_MATERIAL_PATTERN`), guarda `roughness`/`albedoColor` **originais** e molha a partir deles
  (mais liso, mais escuro). `dispose()` restaura os valores originais. A varredura repete a cada 4 s
  porque as regiões entram por streaming.
- **`environmentIntensity` corrigido**: antes eu dizia "realce" e na prática escurecia. Agora o
  ambiente acompanha só a noite e o contraste real vem da **luz de preenchimento**
  (`fillIntensity * readability`), que sobe nas fases escuras.
- **Poeira ambiente implementada** (não só comentada): segundo sistema de partículas, 180 no pior
  caso, ancorado na câmera, que some na chuva.
- **Áudio de chuva**: `WeaponAudio.ambientRain()` toca em laço o grupo `rain` do manifest, com
  volume proporcional. **O grupo não existe ainda** — nenhuma gravação de chuva foi baixada e
  licenciada, e o arquivo proíbe ruído sintético. Enquanto faltar, nada toca, de propósito. Não
  reaproveitei `water` (respingos de passo) como chuva. Basta acrescentar `"rain": [...]`.
- **Seletor QA no F1**: `Clima: sol/nublado/chuva/crepúsculo/noite` e `Clima: voltar ao ciclo`.
  `WeatherCycle.manualPhase` fixa a fase sem parar o relógio; voltar ao automático retoma de onde
  o relógio estava. `reset()` libera a fase.

**Validação:** `tests/weather-cycle.test.ts` — 16 testes (5 novos para céu, umidade e seletor).

---

## Etapa 10 — Poses autorais de corpo a corpo (item 7) — CONCLUÍDA

**Arquivo novo:** `src/animation/MeleePoses.ts`.

O substituto anterior (`Fire_R`/`Fire_L` representando soco e chute) foi **removido**. Cada etapa do
combo tem agora curvas escritas nos **ossos reais do rig** — conferidos contra os nós de
`gunslinger.glb` por teste — aplicadas como camada aditiva pelo mesmo caminho do `freefallFlutter`,
que o clipe de locomoção reescreve no quadro seguinte (nada acumula, reset e dispose intactos).

- Antecipação carrega no sentido oposto, impacto estende, recuperação volta.
- **Quadril, tronco, ombros e pés participam** de todas as cinco etapas — teste exige `Hips`,
  `Spine*` e `Leg/Foot/ToeBase` em cada uma.
- Chutes movem a perna mais que o braço; socos o contrário — também testado.
- Direita e esquerda são lados opostos de verdade.
- Deslocamento de raiz por etapa (o giro tem o maior yaw).
- As duas camadas nunca somam mais que 1, senão uma junta passava de 90° — bug encontrado pelo
  próprio teste de limite.
- `UnarmedCombat.phaseProgress` (novo) dá 0..1 dentro da fase; como o relógio já avança pela
  cadência, acelerar o ataque encurta as três fases juntas e a pose acompanha.

**Validação:** `tests/melee-poses.test.ts` — 13 testes; `tests/unarmed-combat.test.ts` continua com 14.

---

## Etapa 11 — Fragmentos de fruta e chão estocástico — CONCLUÍDA

### Fragmentos por espécie (item 9 do plano de continuação)
`src/vfx/FruitFragments.ts` (novo), integrado em `EnemySwarm` (abate, `update`, `nextStage`, `dispose`).
- Casca saturada, polpa clara e sementes escuras **por espécie**, cada papel com escala, quantidade,
  ressalto, atrito e vida próprios — não partícula genérica.
- Geometria **derivada do corpo real do inimigo** (clone reduzido em runtime). O asset original não é
  tocado e continua visível e intacto — coberto por teste.
- Pool com teto de 54 pedaços, reciclando o mais antigo; assentam no piso e param de se mexer; quem
  cai no vazio entre ilhas é recolhido; somem no fim da vida com fade.
**Validação:** `tests/fruit-fragments.test.ts` — 11 testes.

### Integração do chão estocástico (item 4)
O `StochasticGroundPlugin` é de outro autor e chegou com DELIVERY. Fiz apenas a integração:
`src/world/materials/GroundMaterials.ts` (novo) com a whitelist `Sunlit farm track`,
`Leaf litter soil` e `soil`, instalada **dentro dos laços que já configuram materiais**, antes do
`freeze` do primeiro render — em `RegionPresentation`, `FarmWorld` e `TrainingYard`.
Parede, silo, telhado, prop e LOD distante ficam de fora. UV divergente vira aviso no console.
`tests/stochastic-ground.test.ts` (16, do autor do plugin) continua passando com a integração.

---

## Fechamento desta sessão

`npm run typecheck`, `npm run server:typecheck` e `npm run build` aprovados.
`npx vitest run`: **575 aprovados / 581** — as 6 falhas são a linha de base de asset já documentada.
Relatório honesto, com o que ficou de fora, em `docs/CLAUDE_DELIVERY_2026-09-15.md`.

---

## Etapa 12 — Entrada da nave e revisão corporal (`CLAUDE_INTRO_PRESENTATION_TASK`) — CONCLUÍDA

Relatório completo em `docs/CLAUDE_INTRO_PRESENTATION_DELIVERY.md`.

- **Nave real**: `scripts/build-dropship-deck.py` → `public/models/dropship-deck.glb` (1,0 MB), com
  deck, volume estrutural, corrimão nos dois lados, saída aberta, casco, cabine e propulsores.
  Mapas Poly Haven CC0 já do repositório, reduzidos a 1K. Medido por `tests/dropship-deck.test.ts`.
- **Fluxo completo**: `IntroSequence` — espera no deck → corrida → salto → mergulho de cabeça →
  impacto → recuperação → controle liberado. O mergulho continua sendo o `MeteorArrival` preservado;
  o deck é ancorado no topo da trajetória dele, então é integração e não teleporte.
- **Câmera** acompanha corrida e salto, aponta para o destino antes da queda, abre o FOV na arrancada
  e volta sozinha ao jogo. **Pular** por botão acessível e por `Enter`.
- **Reset / cancelamento / co-op**: `holdsControl` para o passo fixo inteiro; teste prova que a
  entrada não toca o `PlayerMotor` e que dois clientes veem quadros idênticos.
- **Dois bugs de animação confirmados e corrigidos** em `CharacterVisual`: acúmulo de rotação nos
  braços durante o corpo a corpo com mira ligada (1,017 rad de divergência sem a correção) e desvio
  de yaw da raiz pela realimentação do amortecedor (0,771 rad sem a correção). Ambos com teste que
  falha ao reverter.
- **Revisão do combo no F1**: ciclo lento em quatro ritmos, pose de contato, passo a passo por
  quadro, troca de etapa, câmera de corpo inteiro, armas guardadas e saída que devolve origem e mira.
- **Apresentação**: relatório de morte por marcos da expedição (modo horda legado intacto), copy do
  TAB por modo, `_wasDisposed` substituído por `onDisposeObservable`, chuva legível com as texturas
  dedicadas do Codex. O grupo `rain` do manifest já existia — gancho preservado.

`npx vitest run`: 627/633 (as 6 de sempre, por asset fora do repositório). `vite build` aprovado.

### Etapa 12b — Revisão 2 da nave, após o render e o QA de menu do Codex

Feedback atendido em `docs/CLAUDE_INTRO_PRESENTATION_DELIVERY.md` (seção “Revisão 2”):

1. **Madeira listrada → metal pintado.** Os mapas difusos saíram do asset; a cor virou
   `baseColorFactor` (casco grafite, deck oliva, corrimão aço) e o desgaste ficou no normal + ARM.
   UV das peças de revolução passou a usar comprimento de arco real.
2. **Boca branca acesa → marcação fosca.** 14 blocos amarelo/preto sem emissão e duas galhas; a
   única luz da saída são as guias menta. Teste exige um único material emissivo na nave.
3. **Escoras penduradas → viga entre dois pontos reais**, com cartela nas pontas. Asserção de build
   confere que cada ponta cai dentro de outra peça.
4. **Caixas com face acesa → naceles** de revolução com aro e cavidade de 1,1 m, com o disco
   luminoso lá dentro. Asserção de build confere o recuo.
5. **Pés flutuando.** Duas causas: nervura de 8,5 cm e a constante `DECK_TREAD_HEIGHT` em 4 cm, que
   não correspondia nem à chapa nem ao friso. Nervura, faixa de perigo e guias foram todas para
   8 mm (com asserção de build) e a profundidade da sola foi remedida rodando a entrada de verdade:
   o pior quadro do `Run` afunda 9,2 cm, não os 7,1 cm da amostragem uniforme. Medido depois da
   correção: espera +5,8 a +8,9 mm, corrida +0,6 mm no pior quadro.
6. **Barra de carregamento a 100% sobre o menu pronto** — `ready()` agora esconde o bloco de
   progresso, com trava contra carregamento tardio. Nenhum CSS tocado.

GLB reexportado: 1,16 MB, 26.984 vértices, 7 peças, 4 imagens (só normal e ARM).
Suítes focadas 70/70; `npx vitest run` 654/665 — 6 são a linha de base de asset e 5 são de
`fruit-fragments` e `terrain-relief`, arquivos de outros agentes editados nestes minutos.

## Relevo, pedras e vegetação (subtarefa `CLAUDE_TERRAIN_VEGETATION_TASK.md`)

Entrega completa em `docs/CLAUDE_TERRAIN_VEGETATION_DELIVERY.md`. Resumo:

- **Relevo** aditivo e determinístico (`src/world/terrain/`), gerando o MESMO array de vértices para
  a malha desenhada e para a colisão — cliente e servidor. Campo inicial (1.540 tri, até +1,68 m) e
  `highland-farms` (16.228 tri, até +4,13 m). Exclusões derivadas das caixas de colisão, pontes e
  âncoras reais; trilhas autoradas viraram caminhos com rampa limitada a 30 %.
- **Pedras:** os 41 picos idênticos do anel dos planaltos saíram da colisão (36.859 tri, remoção
  exata e idempotente) e do visual; entraram 46 afloramentos em aglomerados irregulares, com a
  geometria escaneada original, sem nenhuma caixa invisível.
- **Vegetação:** vento de raiz fixa por altura com fase/intensidade por instância, compatível com
  instâncias (materiais de vento ficam fora do `freeze`); copa com corte de alpha menor; e os
  achados 1–5 de `CLAUDE_ROOTWOOD_PERF_REVIEW.md` aplicados (ativação fatiada em 300 peças/quadro,
  orçamento de copa, decalque de trilha em alpha-test com raio de ocultação, isenção de sombra
  unificada, ragdoll distante não retém região).
- **Validação:** 25 testes novos verdes; typecheck cliente/servidor limpo em `src/` e `server/`;
  navmesh regerado com o relevo; suíte completa sem nenhuma falha nova (as 6 de assets originais
  seguem baseline). **Nada foi inspecionado no navegador** — QA visual é do Codex.
