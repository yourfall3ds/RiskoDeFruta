# Multiplayer cooperativo — mapa de estado e desenho do servidor

Projeto ativo: `D:\Riskodefruta2`. Objetivo: rodada cooperativa online em que todos os jogadores veem as mesmas animações, itens, inimigos, baús e drops. Servidor autoritativo em Node com Colyseus; clientes Babylon.js só renderizam e enviam entrada.

Este documento é o levantamento completo do que existe hoje, classificado por quem manda em cada estado. Foi produzido lendo o código do D: em 07/09/2026 (203 testes / 22 arquivos).

## 1. Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Autoridade | **Servidor simula; cliente renderiza** | É o modelo nativo do Colyseus (estado flui servidor → cliente). Evita trapaça e divergência de RNG. |
| Modo | **Co-op, 1–4 jogadores, uma rodada por sala** | É o que "todos enxergam os mesmos itens" pede. Inventário, créditos, estágio e diretor são **compartilhados**. |
| Tick | **60 Hz fixo no servidor** com o `FixedLoop` existente | O loop já é puro e determinístico; o cliente continua interpolando `previous/current` com `alpha`. |
| RNG | Seed escolhida pelo host, compartilhada; **só o servidor sorteia** | `RunRNG` é mulberry32 por string; streams nomeados já existem. |
| Transporte | WebSocket (Colyseus padrão), porta 2567 | Sem WebRTC nesta etapa. |
| Versões | `colyseus` 0.18.5 · `@colyseus/schema` 5.0.27 · `@colyseus/ws-transport` 0.18.2 · `@colyseus/sdk` 0.18.2 · `@colyseus/testing` 0.18.5 · `@colyseus/loadtest` 0.18.2 · `tsx` 4.23.13 | Últimas do npm em 07/09. **Compatibilidade 0.18 ↔ 0.16 a confirmar** com teste de conexão real na instalação. |

## 2. O que já roda sem Babylon (servidor pronto)

Varredura por `import '@babylonjs'` no `src/` do D:. Tudo abaixo importa **zero** Babylon e já é exercitado pelos testes em Node:

| Sistema | Arquivo | Estado que carrega |
|---|---|---|
| Loop fixo | `core/FixedLoop.ts` | acumulador, tick |
| RNG | `core/RunRNG.ts` | streams `run director loot scene spawn boss elite interactable procs` |
| Eventos | `core/EventBus.ts` | por cena, síncrono |
| Entidades | `core/EntityStore.ts`, `core/contracts.ts` | id, definição, transform previous/current |
| Jogador | `player/PlayerMotor.ts` | posição, velocidade, hp, cargas de esquiva, invulnerabilidade, sprint, wall-slide |
| Carga MP | `combat/MPCharge.ts` | segundos, tier, held |
| Cadência/pente | `combat/PistolCadence.ts`, `combat/PistolMagazine.ts` | cooldown, lado, `ammo/50`, recarga 1,35 s |
| Timeline de skill | `combat/SkillTimeline.ts` | tier, elapsed, released; durações fixas em `SKILL_CUES` |
| Vida | `combat/Health.ts` | current/maximum |
| Progressão | `run/RunProgression.ts` | 90 itens (`ITEMS`), inventário `Map<id,pilhas>`, xp, nível, créditos, estágio, `stats` |
| Diretor de horda | `run/MonsterDirector.ts` | wave, quota `7+3w`, chefe a cada 5, intermissão, `rewardsPending` |
| Procs de item | `items/ItemProcs.ts` | burn/blast/harvest |
| Comportamentos | `enemies/EnemyBehaviors.ts`, `EnemyAffixes.ts`, `EnemyImpact.ts` | tabelas puras; `effects` no contexto é só tipo |
| IA | `ai/AIScheduler.ts`, `ai/FarmNavigation.ts`, `ai/TacticalNavigation.ts` | recast WASM — **roda em Node**, provado por `navigation-physics.test.ts` |
| Contato | `physics/ActorContact.ts`, `physics/TriangleGround.ts` | cápsula × ator, altura por triângulo |

## 3. O que importa Babylon só como matemática (roda em Node como está)

`Vector3` e `Ray` de `@babylonjs/core/Maths` e `Culling/ray` não dependem de DOM nem de cena. Confirmado por grep: nenhum `pickWithRay`, `intersectsMesh`, `scene` ou `Mesh` nestes arquivos.

- `physics/CollisionWorld.ts` — caixas, superfícies, `movingBoxes`, `sweepSphere`, `move`, `groundAt`, geometria de triângulos.
- `physics/CapsuleTriangle.ts`, `physics/SolidInteriors.ts`, `physics/StaticRayIndex.ts` — varredura de cápsula e índice de raios contra o mundo.
- `world/IslandFerry.ts` — `ferryPose(time)` é função pura; o servidor só precisa sincronizar `time`.

Podem ficar como estão. Trocar `Vector3` por `Vec3` puro é opcional e só reduz o peso do bundle do servidor.

## 4. Onde estado de gameplay está preso na apresentação (trabalho real)

| Arquivo | Estado preso | Acoplamento | Extração |
|---|---|---|---|
| `game/EnemySwarm.ts` | atores (posição, estado, vida, burn, stagger), avisos e projéteis inimigos | `a.root.position` é `TransformNode`; avisos/projéteis vivem em `CombatPresentation` (pool de VFX) | `EnemySimulation` puro com `Vec3`; avisos/projéteis viram registros no schema; `CombatPresentation` só lê |
| `combat/DualPistols.ts` | acertos, ricochete, barragem, tempestade | `scene.pickWithRay` contra **meshes renderizadas**; origem no `muzzle` do modelo | Hitscan puro: `CollisionWorld.sweepSphere(origem, dir·alcance, 0.01)` para obstrução + raio × esfera contra atores (`ENEMIES[kind].radius × scale`) |
| `run/RunInteractables.ts` | baús (`used/cost/loot/opening`), loja, altar, fenda | `TransformNode`, torus, shader do portal | Lógica de `update/reset/buy/atRift` é pura; visual assina o schema |
| `run/LootDrops.ts` | drops no chão (`item`, arco, `landed`) | plano + textura do ícone | Registro `{item, x,y,z, age, landed}` no schema; `take()` no servidor |
| `game/PlayerScene.ts` | **cinemática de skill congela o mundo** (`worldDt=0`, física off, tick retorna) e aguarda `audio.voice()` | timeline dirigida pelo relógio de áudio do cliente | Servidor: `SkillTimeline` por jogador com `SKILL_CUES` fixos, sem pausa. Cliente: voz, cut-in e câmera só cosméticos |

## 5. Cheiros de single-player a corrigir

- `entityId:1` / `victimId!==1` fixos em `MPCharge`, `PlayerMotor.applyDamage`, `DualPistols`, `PlayerScene.configure`. Parametrizar pelo id do jogador.
- `PlayerScene` lê `location.href` para seed/modo; o servidor recebe seed por mensagem de criação da sala.
- `EnemySwarm` persegue **um** `player`; passa a escolher alvo entre jogadores vivos (mais próximo, com o mesmo `AIScheduler`).
- `RunInteractables.nearest`/`atRift` usam **um** `player.position`; passam a ser por jogador (quem está perto), com compra debitando o crédito compartilhado.

## 6. Schema (o que o servidor publica)

Derivado dos campos reais de cada sistema. Ver `server/schema.ts`.

```text
FarmState
  seed, stage, wave, hordeState, intermission, time, bossDeadTime
  progression: credits, xp, level, totalKills, stats(10 números), inventory: Map<itemId, pilhas>
  ferryTime
  players: Map<sessionId, PlayerState>
    x y z yaw pitch  hp maxHP  grounded sprinting dodgeRemaining charges invulnerable
    ammo reloading mpSeconds mpTier  skillTier skillElapsed skillActive
  enemies: Map<id, EnemyState>
    kind variant scale x y z yaw  hp maxHP  state(spawn|chase|windup|recover|dead) time burn stagger
  warnings: Array<WarningState>   x y z radius remaining duration kind owner
  projectiles: Array<ProjectileState>  x y z vx vy vz radius owner
  interactables: Array<InteractableState>  id kind x y z cost used opening lootIcon
  drops: Array<DropState>  itemId icon x y z landed
```

Mensagens (não-estado, para cosmético de um frame): `DamageDealt`, `EnemyKilled`, `Dodged`, `SkillUsed`, `MPCharged`, `LevelUp`, `BossSpawned`, `ItemPicked`, `Reload`. O `GameEvents` existente já tem esses nomes; o servidor reencaminha.

Entrada cliente → servidor: `InputFrame` (`x z jump dodge fire charging reload interact`) + `yaw pitch`, a cada tick de cliente, com `seq` para reconciliação.

## 7. Fluxo de um tick no servidor

```text
para cada jogador: aplica último InputFrame → PlayerMotor.fixedUpdate → MPCharge → PistolCadence/Magazine → hitscan puro
IslandFerry.update → CollisionWorld.movingBoxes
EnemySimulation.fixedUpdate (director, spawn, IA via TacticalNavigation, avisos, projéteis, separação)
RunInteractables/LootDrops (puros)
progression.time += dt
copia sim → schema (só campos que mudaram; Colyseus faz o delta)
```

O cliente continua com `FixedLoop`, mas o `simulate` local vira **predição** só do próprio jogador (mesmo `PlayerMotor`), reconciliada pelo `seq`; tudo o mais é interpolado do schema.

## 8. Ordem de trabalho proposta

1. **Servidor mínimo** (`server/`): sala, entrada, tick 60 Hz com `PlayerMotor` + `CollisionWorld` do D:, schema de jogadores. Dois clientes se veem andando. *(É o que este drop contém.)*
2. Extrair `EnemySimulation` de `EnemySwarm` (puro) — o maior item. Reaproveita `MonsterDirector`, `TacticalNavigation`, comportamentos.
3. Hitscan puro em `DualPistols` (servidor decide o dano; cliente mantém tracer/decal cosmético).
4. Skill sem pausa global; timeline por jogador.
5. Interativos, baús e drops no schema.
6. Reconciliação e interpolação no cliente; HUD lendo do schema. *(Fase 2 feita: `src/net/NetworkSession.ts`, `Reconciliation.ts`, `RemotePlayers.ts`; HUD do schema fica com as fases 4–5.)*

## 9. Limites conhecidos

- Ragdoll, destroços, poses por distância, sombras e áudio continuam **locais** — são cosméticos e não precisam concordar entre clientes.
- Cinemática de skill deixa de pausar o mundo para todos. Se a pausa for desejada em co-op, vira decisão de design (votação/pausa só no host), não default.
- Colyseus 0.18 no servidor com `colyseus.js` 0.16 no cliente é o par mais novo do npm; se a conexão falhar, fixar ambos na mesma linha 0.16.
