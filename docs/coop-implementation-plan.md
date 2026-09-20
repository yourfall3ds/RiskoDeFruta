# 4-Player Co-op — Implementation Spec

Status: **planning deliverable**. No game code changed by this document.
Scope: LAN / local rooms only. 1–4 players, one shared run per room.
Supersedes the design sketch in `docs/MULTIPLAYER.md` §8 (that document's "ordem de trabalho" step 1 is done; steps 2–6 are re-planned here against the code as it actually stands).

Stack in the repo today (`package.json:26-35`): `colyseus@^0.18.5`, `@colyseus/schema@^5.0.27`, `@colyseus/ws-transport@^0.18.2`, `@colyseus/sdk@^0.18.2`, `@colyseus/testing@^0.18.5`, `vitest@5`, Node ≥22.12.

---

## 0. Research basis (all claims below cite these)

Colyseus 0.18 is a large break from the 0.15/0.16-era patterns most tutorials still teach. The relevant pages:

- Room lifecycle, `onDrop`/`onReconnect`, `onBeforePatch`, `setTimestep` — https://docs.colyseus.io/room/lifecycle , https://docs.colyseus.io/room/reconnection , https://docs.colyseus.io/room/timing-events
- Schema builder (`schema()` + `t.*`), 63-field cap, encoding cost per field, `t.quantized()`, `.patchOnly()`, `.fullStateOnly()`, `.noSync()` — https://docs.colyseus.io/state/schema/decorators , https://docs.colyseus.io/state/optimization
- Server input buffers + fixed timestep + sanitization + idle policy — https://docs.colyseus.io/netcode/server-input
- Client prediction / reconciliation / `Predict` / `predict.reconciler` — https://docs.colyseus.io/netcode/client-prediction
- Determinism requirement for shared step code — https://docs.colyseus.io/netcode/determinism
- Streaming many entities (`t.stream()`, `view.subscribe()` with priority) — https://docs.colyseus.io/state/streaming
- `StateView` and its explicit "not optimized for large datasets" caveat — https://docs.colyseus.io/state/view
- Lag compensation / `allowRewindState` / `lastSeenBy` — https://docs.colyseus.io/netcode/lag-compensation
- Projectile spawns + `defineEvent` optimistic effects + smoothing modes (`lerp`/`reckon`/`damped`/`snap`) — https://docs.colyseus.io/netcode/recipes
- Matchmaking, `matchMaker.query`, `exposedMethods`, `.filterBy`, `.enableRealtimeListing()` — https://docs.colyseus.io/matchmaker
- LobbyRoom real-time listing (`getAvailableRooms()` was **removed in 0.16**) — https://docs.colyseus.io/matchmaker/lobby , https://docs.colyseus.io/migrating/0.16
- Room visibility: `locked` / `private` / `unlisted`, `setMatchmaking()` — https://docs.colyseus.io/matchmaker/visibility
- SDK: `joinById`, `consumeSeatReservation`, `getLatency`, `reconnect(token)` — https://docs.colyseus.io/sdk , https://docs.colyseus.io/sdk/connection
- `publicAddress` for LAN-correct advertised endpoints — https://docs.colyseus.io/server
- Migration notes (`setMetadata` no longer merges; field cap 64→63; fossil-delta removed; `Callbacks.get(room)`) — https://docs.colyseus.io/migrating/0.17 , https://docs.colyseus.io/migrating/0.18 , https://colyseus.io/blog/colyseus-018-is-here/
- Playground now requires auth middleware in production — https://docs.colyseus.io/tools/playground

**Two facts that shape this whole plan:**

1. The repo is *already* written against 0.18 idioms — `defineInput` (`server/rooms/FarmRoom.ts:39`), `setFixedTimestep` (`:51`), `allowRewindState` (`:49-50`), `Predict` on the client (`src/net/NetworkClient.ts:38,63`). We do not need a netcode rewrite; we need to move *game systems* behind the line that already exists.
2. `client.getAvailableRooms()` no longer exists (removed 0.16). LAN discovery must be `LobbyRoom` + `enableRealtimeListing()`, or a custom HTTP route over `matchMaker.query()`. §7 specifies the former.

---

## 1. Current state — what IS and is NOT replicated

### 1.1 Already server-authoritative (works today with 2+ clients)

The premise "position-only netcode" understates what exists. `FarmSimulation` is a full headless player simulation:

| Replicated | Evidence |
|---|---|
| Player position/orientation | `server/FarmSimulation.ts:170` `m.fixedUpdate(dt, reloadMovement(...), player.yaw)`; mirrored `server/rooms/FarmRoom.ts:86` |
| Player HP / armor / regen / invuln | `FarmSimulation.ts:163-166`, `:199` |
| Dodge charges, sprint, grounded, extra jumps | `FarmSimulation.ts:163-166`, `:199` |
| Ammo + reload timing | `FarmSimulation.ts:169,176`; asserted by `tests/net-room.test.ts:70-71` ("a cadência é do servidor") |
| MP charge, skill tier/elapsed/active | `FarmSimulation.ts:171-174`, `:201` |
| Fire cadence (shots counted, not resolved) | `FarmSimulation.ts:176` `player.cadence.update(dt, firing, () => { if (player.magazine.consume()) player.shots++; })` |
| Island ferry time + rider carry | `FarmSimulation.ts:160`, `:214-223` |
| Run progression counters (credits/xp/level/kills/inventory) | `FarmSimulation.ts:104` `readonly progression = new RunProgression(this.events)`; mirrored `FarmRoom.ts:80-82` |
| Input transport with seq + duplicate rejection | `src/net/NetInput.ts:11-14`; `FarmSimulation.ts:148` `if (!player || input.seq <= player.seq) return` |
| Client prediction + reconciliation | `src/net/NetworkSession.ts:43-70`, `src/net/Reconciliation.ts:44-57` |
| Remote player interpolation | `src/net/NetworkClient.ts:63` `predict.attach(state, { x:'lerp', y:'lerp', z:'lerp', yaw:{mode:'lerp',angle:true} })` |
| Cosmetic event fan-out | `FarmSimulation.ts:125-126` outbox; `FarmRoom.ts:74` `for (const event of this.sim.drain()) this.broadcast(event.type, event.payload)` |
| Rewind buffer for future hit validation | `FarmRoom.ts:49-50` `allowRewindState({ maxRewindMs: 500 })` + `attachAll(this.state.players, { fields: ['x','y','z'] })` |

### 1.2 Schema classes that exist but are **never populated** — dead weight today

`server/schema.ts` declares `EnemyState` (`:20-25`), `WarningState` (`:28-31`), `ProjectileState` (`:33-35`), `InteractableState` (`:37-40`), `DropState` (`:42-44`), and wires them into `FarmState` (`:58-62`). But `FarmRoom.mirror()` (`:77-92`) writes **only** `tick/time/stage/ferryTime`, `progression`, and `players`. Nothing ever calls `state.enemies.set(...)`, `state.drops.push(...)`, etc. `FarmSimulation.Snapshot` (`:84-88`) has no enemy/drop/interactable fields at all.

So the schema is a *promise*, not an implementation. That is good news — the wire contract is already sketched — but every field in §1.2 is currently a no-op.

### 1.3 NOT replicated — runs locally and divergently on every client

| System | Where it runs | Why it diverges in co-op |
|---|---|---|
| **Enemy spawning** | `src/game/EnemySwarm.ts:393 spawn()`, driven by `MonsterDirector.update` at `EnemySwarm.ts:727` | Each client owns its own `MonsterDirector` (`EnemySwarm.ts:189`, re-created `:225`) fed by its own `rng.stream('director')`. Two clients spawn *different* enemies at *different* times. |
| **Enemy AI / movement / attacks** | `EnemySwarm.fixedUpdate` `:718-816` | Chases `this.player` — a **single** `PlayerMotor` injected at construction (`EnemySwarm.ts:189`). There is no concept of "nearest of N players" anywhere. |
| **Enemy HP and death** | `EnemySwarm.hit()` `:505-544`, `Health.apply` (`src/combat/Health.ts:8-14`) | Damage numbers are computed from the *local* `this.progression.stats` (`EnemySwarm.ts:505,511`). Player B's items change Player B's damage only. |
| **Damage to players** | `EnemySwarm.ts:672,677,782,797,813` all call `this.player.applyDamage(...)` | Only ever hits the local player. In co-op every client would be attacked by its own private copy of the horde. |
| **Loot drops** | `src/run/LootDrops.ts:74 eject()`, `:115 take()` | `GroundLoot.root` is a Babylon `TransformNode` (`LootDrops.ts:14`). Pure logic and presentation are fused. |
| **Chests / shops / altars** | `src/run/RunInteractables.ts:331 update()`, `:362 buy()` | `buy()` reads `this.player.position` (`:363,367`) and mutates `this.run.credits` (`:369`) locally. Chest contents come from local `this.rng` (`:372-373`). |
| **Wave rewards** | `RunInteractables.deliverWaveReward` `:338-358`, called `PlayerScene.ts:834` | Item chosen by local `this.rewardRng` (`PlayerScene.ts:439`). |
| **Stage / wave progression** | `PlayerScene.updateExpedition` `:1963-1990`, `beginStageJourney` `:1923-1935`, `updateJourney` `:1949-1961`, `advanceLegacyStage` `:2138-2145` | Entirely client-driven. `progression.advanceStage()` fires at `PlayerScene.ts:1869` on *this* client's arrival. |
| **XP / credits / items** | `RunProgression` at `PlayerScene.ts:205` (a second, client-side instance) | The server has its own `RunProgression`, but nothing on the client reads it. HUD reads the local one. |
| **Boss lifecycle** | `PlayerScene.ts:1978-1987` (`requestBoss`/`recoverBoss`), `EnemySwarm.ts:543` | Local. |
| **Player death** | `PlayerScene.ts:702-709` `PlayerKilled` handler → `started=false`, defeat screen `:860` | Single-player game-over. No spectate, no revive. |
| **Saucer raid event** | `PlayerScene.ts:1320` `swarm.spawn(kind, at, 'normal')`, bookkeeping `:674-695` | Local. |

### 1.4 Current co-op entry point

`?online=1` (+ optional `&server=ws://host:port`) — `src/net/NetworkSession.ts:29-31`, default `ws://127.0.0.1:2567` (`:12`). Session is created at `PlayerScene.ts:556` and **refused on the planet world** (`:556-558`, radial motor is not network-replicated). Seed is the room key: `NetworkClient.connect` `:35` `client.joinOrCreate('farm', { seed: this.seed })`, and `server.define('farm', FarmRoom).filterBy(['seed'])` (`server/index.ts:8`). `seedPolicy` pins the seed under `?online=1` (`src/run/AttemptSeed.ts:64`) precisely so clients land in the same room.

**Net effect today:** four players would see each other walking correctly, sharing HP/ammo/skill state, and would each fight a *completely different, private* horde, open *different* chests, and hold *different* item inventories — while a shared `ProgressionState` sits in the schema unread.

---

## 2. Target architecture — the authority split

Guiding rule: **anything that decides an outcome moves to the server; anything that decides how an outcome looks stays on the client.** This is the split the Colyseus docs assume (https://docs.colyseus.io/netcode/determinism).

### 2.1 Enemy spawning / AI / HP / death → **server**

Extract a Babylon-free `EnemySimulation` from `EnemySwarm`. Feasibility is already proven by the repo: `MonsterDirector` (`src/run/MonsterDirector.ts`) imports only `RandomStream`; `EnemyBehaviors`/`EnemyAffixes`/`EnemyImpact` are pure tables; `AIScheduler`, `FarmNavigation` and `TacticalNavigation` (recast WASM) already run in Node (`docs/MULTIPLAYER.md` §2 asserts this, exercised by `tests/navigation-physics.test.ts`).

Server owns: `MonsterDirector` instance (one per room), spawn position selection, actor list (`id, kind, variant, scale, x,y,z, yaw, hp, maxHP, state, time, burn, stagger`), target selection across all living players, movement integration, attack windups, contact/laser/projectile damage resolution, death, `kills`, boss request/defeat, stray recycling and the population budget.

Client keeps: `TransformNode`/mesh instantiation and pooling, `CharacterVisual` skinning, `RagdollWorld` (`EnemySwarm.ts:167`), `CorpseDebris`, `FruitFragments`, `CombatPresentation` bursts, `ElementalEffects`, `EnemyLaser` beams, charge `PointLight`s (`:189`), damage labels (`:519`), audio (`:519`), shadow-caster selection, per-camera visibility fade (`:349`). All of those are driven *from the replicated actor row*, not from a local simulation.

The cleanest cut line: today `EnemySwarm` stores position in `a.root.position` (a Babylon `TransformNode`). `EnemySimulation` stores plain `Vec3`. The client's `EnemySwarm` becomes `EnemyPresentation`: it keeps `actors[]` and the visual pooling, but its `fixedUpdate` is replaced by "read `state.enemies`, lerp/reckon each row into `a.root.position`, drive the animation state machine off `state`".

### 2.2 Damage resolution → **server**

Two directions, both server-resolved:

- **Player → enemy.** Client sends `fire` intent only (it already does — `NetInput.BUTTON.FIRE`, `src/net/NetInput.ts:5`). The server already gates cadence and magazine (`FarmSimulation.ts:176`). Today it only increments `player.shots`; it must instead perform the hitscan. `DualPistols` already prefers the pure path — `src/combat/DualPistols.ts:460` falls back to `scene.pickWithRay` **only** when `this.yard.collision?.geometry` is absent, and the comment at `:444` records that the pick path "não enxerga o terreno de colisão". On the server `CollisionWorld.geometry` is always present (`FarmSimulation.ts:121` `setGeometry`), so the pure branch is the one that runs. Damage math (`EnemySwarm.ts:505-512`) uses `this.progression.stats` — on the server that becomes **the firing player's** stats (see §2.6).
- **Enemy → player.** All five call sites (`EnemySwarm.ts:672,677,782,797,813`) currently target `this.player`. Server-side they target the specific victim player resolved by the behavior, and the `DamageContext.victimId` becomes that player's numeric entity id.

Client keeps: tracers, muzzle flash, decals, hit-spark bursts, damage-number labels, hit-stop/slow-motion (`PlayerScene.ts:648,884`), screen shake, audio.

### 2.3 Loot drops → **server owns the record, client owns the card**

Split `LootDrops` into:
- `LootField` (pure, server): `{ id, itemId, icon, x, y, z, landed, age, owner }`. The landing-search logic (`LootDrops.ts:33-46 landing()`) is already pure except for its `Vector3` return — it uses `world.groundAt` and `world.nearbyBoxes`, both available on the server's `CollisionWorld`.
- `LootPresentation` (client): the `TransformNode` + `StandardMaterial` + arc/hop/spin animation (`LootDrops.ts:74-104`), keyed by drop id from the schema.

`take()` (`LootDrops.ts:115`) becomes a server-side reaction to an `interact` intent; the server validates range and applies `progression.addItem`.

### 2.4 Chests / interactables → **server**

`RunInteractables` is described in `docs/MULTIPLAYER.md` §4 as "lógica de `update/reset/buy/atRift` é pura" — mostly true. Server owns `entries[]` (`id, kind, x,y,z, cost, used, opening, uses, lootItemId`), pricing (`chestPrice`, `RunInteractables.ts:80`), `buy()` credit debit and RNG item roll (`:362-383`), altar 58% coin-flip (`:372`), contract bonus drops (`:375-382`), `deliverWaveReward` (`:338-358`), and the rift-ready gate (`atRift`, `:361`).

Client keeps: chest GLB instantiation (`:312-329`), lid animation evaluation (`:330 lid()`), the altar torus halo, the rift portal shader (`:331`), the "nearest interactable" prompt — but `nearest` becomes **per-player, computed locally for prompt display only**; the actual purchase is validated server-side against that player's own position.

Chest colliders must stay in sync: `FarmSimulation.ts:116-119` already pushes `barnChestColliders()`, `cityChestColliders()`, `frontierChestColliders()`, `rootwoodChestColliders()`, `highlandChestColliders()` into `collision.movingBoxes`.

### 2.5 Stage / wave progression → **server**

One `stage`, one `wave`, one `hordeState`, one `intermission`, one boss, one ferry clock for the whole room. The chalice/journey flow (`PlayerScene.ts:1923-1961`) becomes: server sets `phase='journey'` + `journeyTime`; each client plays its own dropship cinematic locally off those fields; the server advances the stage when `journeyTime` elapses, regardless of any single client's animation.

Consequence, stated explicitly: **the skill cinematic stops freezing the world.** Today `PlayerScene` sets `worldDt=0` and waits on `audio.voice()` (recorded in `docs/MULTIPLAYER.md` §4). In co-op the server's `SkillTimeline` (already per-player, `FarmSimulation.ts:172-174`) runs on fixed `SKILL_CUES` durations and never pauses; the cut-in, voice line and camera move stay local and cosmetic.

### 2.6 XP / credits / items → **server, shared pool, per-player stats**

Design decision, and it is a real fork in the road:

- **Credits, XP, level, totalKills: shared** — already modelled that way (`ProgressionState`, `server/schema.ts:47-50`), already mirrored (`FarmRoom.ts:80-82`). Keep it. It matches `docs/MULTIPLAYER.md` §1 ("Inventário, créditos, estágio e diretor são compartilhados").
- **Inventory: per-player.** This is a *change* from the existing schema. `ProgressionState.inventory` is a single shared `t.map('uint16')`. RoR2-style co-op gives each survivor their own item stacks; a shared inventory means one player's pickup silently buffs everyone, and `RunProgression.computeStats()` (`src/run/RunProgression.ts:108-112`) produces one `RunStats` for the room — which is exactly why `FarmSimulation.ts:158` writes `stats` from a single `this.progression.stats` into *every* player's motor. Four players with identical stats is not co-op, it is four copies of one character.

  **Therefore:** `RunProgression` becomes per-player for `inventory`/`stats`, and room-level for `credits`/`xp`/`level`/`stage`/`totalKills`. Concretely: keep one `RunProgression` for the shared counters, add a `PlayerLoadout` (its own `inventory` Map + `computeStats()` reusing the existing `ITEMS` table) per player. `RunProgression.computeStats` already reads `this.inventory` only (`:110`), so it factors cleanly.

### 2.7 Stays client-side, permanently

Ragdolls, corpse debris, fruit fragments, destruction chunks, shadow generators, LODs/region streaming, weather and rain, audio and footsteps, HUD, camera, intro/extraction cinematics, aim-arm IK, pose reviews, the QA/F1 debug surface (`PlayerScene.ts:2276-2450`). None of these affect outcomes; none need to agree between clients.

---

## 3. Schema changes

### 3.1 Bandwidth budget first (this drives every type choice)

Patch rate is `PATCH_HZ = 30` (`server/rooms/FarmRoom.ts:13,48`). Population ceiling is `PopulationBudget.maximum = 32` (`src/run/PopulationBudget.ts:3`), with `EnemySwarm.populationCap = 24` typical (`EnemySwarm.ts:152`) and `MonsterDirector` capped at 50 (`EnemySwarm.ts:189`).

Per https://docs.colyseus.io/state/optimization: a Schema field costs **1 byte + value**; a changed collection entry costs **1 byte + index + value**; `t.number()` costs **5+ bytes for a float**, `t.float32()` costs 4, and `t.quantized()` costs **2 bytes and additionally suppresses the send entirely when the value drifts inside tolerance**.

`EnemyState` as declared today (`server/schema.ts:20-25`) has 14 fields, of which 9 are `t.number()`. Worst case, all fields dirty, 32 enemies, 30 Hz:

```
current:  32 × (9 × (1+5) + 2 × (1+~8 string) + 3 × (1+1..4))  ≈ 32 × ~85 B = 2.7 kB/patch
          × 30 Hz = ~82 kB/s  ≈ 650 kbit/s per client  → ×4 clients = 2.6 Mbit/s out
```

That is survivable on a LAN but wasteful, and it is entirely avoidable. Realistically only `x,y,z,yaw,hp,state,time` change per tick (7 fields):

```
quantized: 32 × (4 × (1+2) [x,y,z,yaw] + 1 × (1+2) [hp] + 1 × (1+1) [state uint8] + 1 × (1+2) [time])
         = 32 × (12 + 3 + 2 + 3) = 32 × 20 B = 640 B/patch
         × 30 Hz = ~19 kB/s ≈ 154 kbit/s per client  → ×4 = 616 kbit/s out
```

**~4.3× reduction**, before `t.quantized()`'s drift suppression removes most of the idle rows entirely. That is the justification for every type below.

### 3.2 `server/schema.ts` — exact changes

**Convert `kind`/`variant`/`state` from `t.string()` to `t.uint8()` enums.** `EnemyKind` has 12 members (`src/run/MonsterDirector.ts:10-11`), `EnemyVariant` is a small affix set, and `state` is one of `spawn|chase|windup|recover|dead`. A string field costs 1 + length + framing every time it is dirty; `state` changes constantly. Add the ordinal tables next to the existing ones and let the client resolve names locally (exactly as `DropState.icon` already does — `server/schema.ts:46` comments "o cliente resolve ícone/nome pela tabela local").

```ts
// server/schema.ts — replaces lines 20-25
export const ENEMY_KINDS = ['eggplant','corn','watermelon','tomato','carrot','boss',
  'grey','invader','demon','predator','strutter','hound'] as const;          // ordinal = index
export const ENEMY_STATES = ['spawn','chase','windup','recover','dead'] as const;

export const EnemyState = schema({
  id:      t.uint16(),                       // stable actor id; EnemySwarm.nextId starts at 200 (EnemySwarm.ts:123)
  kind:    t.uint8().fullStateOnly(),        // never changes after spawn → excluded from patches
  variant: t.uint8().fullStateOnly(),
  scale:   t.float32().fullStateOnly(),
  x: t.quantized(0.01), y: t.quantized(0.01), z: t.quantized(0.01),   // 1 cm — below CollisionWorld tolerance
  yaw:     t.quantized(0.01),                // ~0.6°, imperceptible on a 1.2-scale mesh
  hp:      t.quantized(0.5),                 // HP range 75..3600 (MonsterDirector.ts:64-79, bossHealth :90)
  maxHP:   t.uint16().fullStateOnly(),       // set at spawn, scaled by stage/players; never ticks
  state:   t.uint8(),
  time:    t.quantized(0.02),                // drives windup/recover animation phase
  burn:    t.quantized(0.1),
  stagger: t.quantized(0.05),
}, 'EnemyState');
```

`.fullStateOnly()` on `kind/variant/scale/maxHP` is the single biggest win: those four are 100% of the per-enemy *identity* payload and 0% of the per-tick payload (https://docs.colyseus.io/state/optimization).

**Field-count guard:** 0.18 lowered the cap to **63 fields per Schema and made overflow a hard startup error** (https://docs.colyseus.io/migrating/0.18). `PlayerState` is at 21 today (`server/schema.ts:7-17`) and gains 6 below → 27. `FarmState` is at 12 (`:52-63`) and gains 5 → 17. Both comfortable; note the ceiling in a comment so nobody bulk-adds fields later.

**`PlayerState` additions** (`server/schema.ts:7-17`):

```ts
  classId:    t.uint8().fullStateOnly(),   // 0=gunslinger 1=soldier (src/run/PlayerClass.ts:18)
  name:       t.string().fullStateOnly(),  // display name from the join UI
  alive:      t.boolean(),                 // false → spectating
  entityId:   t.uint8().fullStateOnly(),   // 1..4; replaces FarmSimulation.entityId() (:226)
  reviveAt:   t.uint16(),                  // stage number on which this player returns
  inventory:  t.map('uint16'),             // PER-PLAYER stacks (see §2.6)
```

`entityId` deserves a line of its own: `FarmSimulation.entityId()` (`:226`) currently computes `1 + indexOf(playerId)` **on every call**, so ids shuffle whenever a player leaves. That is a latent bug the moment a 4th player disconnects mid-run (see §8.2). Assign it once at join and replicate it.

**`ProgressionState` change** (`server/schema.ts:47-50`): remove `inventory` (moves to `PlayerState`), keep `credits/xp/level/totalKills`, add `stageSeed: t.string().fullStateOnly()`.

**`FarmState` additions** (`server/schema.ts:52-63`):

```ts
  phase:        t.uint8(),          // 0=lobby 1=running 2=journey 3=extract 4=defeat
  journeyTime:  t.quantized(0.05),
  playerCount:  t.uint8(),          // drives the difficulty scaler (§6.1) — replicated so the HUD can show it
  bossId:       t.uint16(),         // 0 = none; avoids scanning the enemy map client-side
  kills:        t.uint32(),
```

**Switch `enemies` from `t.map(EnemyState)` to `t.stream(EnemyState)`.** Per https://docs.colyseus.io/state/streaming, streaming "spreads those additions across ticks — each client drains a bounded number of new entries per tick, in an order you control." That is precisely the `MonsterDirector` burst problem: `updateHorde` can request a wave quota of `7 + wave*3` (`MonsterDirector.ts:182`) and the final horde adds `finalHordePressure` reinforcements on top (`:103-106`).

```ts
enemies: t.stream(EnemyState),      // in FarmState
// in FarmRoom.onCreate:
this.state.enemies.maxPerTick = 8;
// in onJoin:
client.view = new StateView();
client.view.subscribe(this.state.enemies,
  e => -((e.x - spawn.x) ** 2 + (e.z - spawn.z) ** 2));   // nearest-first
```
**Mandatory gotcha:** `subscribe()` is *required* — without it new entries stop reaching clients after the first connection (https://docs.colyseus.io/state/streaming). This is a silent, late-appearing failure; put it in the step-3 verification.

**Do not** reach for `StateView` as a general area-of-interest mechanism. The docs state plainly: *"Avoid relying on StateView for large datasets: it is not optimized for that yet"* (https://docs.colyseus.io/state/view). Use it for the per-player fields it is good at, and let `t.stream()` handle enemy volume.

**`ArraySchema` note:** `warnings`, `projectiles`, `interactables`, `drops` are `t.array(...)` (`server/schema.ts:59-62`). `ArraySchema.deleteAt()` **was removed in 0.16** — use `splice(index, 1)` (https://docs.colyseus.io/migrating/0.16). `interactables` is a fixed set per stage and should stay an array; `drops` and `projectiles` churn and should become `t.map(...)` keyed by id so removals do not reindex every following entry (a positional removal dirties the whole tail). `warnings` are single-frame telegraphs — mark them `.patchOnly()`.

**New `DropState`** (`server/schema.ts:42-44`) needs an id and owner:
```ts
export const DropState = schema({
  id: t.uint16(), itemId: t.string().fullStateOnly(), icon: t.uint8().fullStateOnly(),
  x: t.quantized(0.01), y: t.quantized(0.01), z: t.quantized(0.01),
  landed: t.boolean(), owner: t.uint8().fullStateOnly(),   // 0 = free-for-all, else entityId
}, 'DropState');
```

---

## 4. Message protocol

Transport of *intent* stays on the existing input buffer. Transport of *one-frame cosmetics* stays on broadcast messages. Nothing that decides an outcome travels as a message.

### 4.1 Client → server

**A. The input buffer (per fixed tick, 60 Hz).** Unchanged shape — `src/net/NetInput.ts:11-14`:
```
NetInput { x:f32, z:f32, yaw:f32, pitch:f32, buttons:u8, interactOption:u8, seq:u32 }
buttons bits: FIRE 1 · JUMP 2 · DODGE 4 · CHARGE 8 · RELOAD 16 · INTERACT 32 · DASH 64 · STANCE 128
```
Add **declarative sanitization at the buffer level** (https://docs.colyseus.io/netcode/server-input) rather than the hand-rolled clamp at `FarmSimulation.ts:150`:
```ts
inputs = this.defineInput(NetInput, {
  seqField: 'seq', bufferMaxSize: 64,
  sanitize: { x: [-1, 1], z: [-1, 1], pitch: [-1.1, 1.1], interactOption: [0, 8] },
  idle: 'hold',     // keep last continuous movement when a packet is lost
});
```
This is the anti-cheat clamp for free, applied before anything reads the frame.

Add two fields for hit validation:
```
aimX, aimY, aimZ : f32    // normalized muzzle direction at the moment FIRE was latched
```
Rationale: `yaw`/`pitch` describe the *camera*, but `DamageContext` distinguishes them — `src/core/contracts.ts:23-36` documents at length that `forceDirection` carries the camera heading while `hitPosition` comes from the barrel ray, and that the two "divergem em graus" at close range, enough to make a weak-point test miss. `resolveWeakPoint` needs the coherent `(hitPosition, hitDirection)` pair. Send the barrel direction explicitly.

**B. Discrete requests (`room.send`), rate-limited, all server-validated:**

| Message | Payload | Server action |
|---|---|---|
| `setLoadout` | `{ classId: 'gunslinger'\|'soldier', name: string }` | Lobby phase only. Sets `PlayerState.classId/name`. |
| `ready` | `{ ready: boolean }` | Lobby only. All-ready (or host `startRun`) → `phase=1`. |
| `startRun` | `{}` | Host only (`sessionId === state.hostId`). Forces `phase=1`. |
| `interact` | `{ option: uint8 }` | Also reachable via the `INTERACT` button bit; the message form carries the shop option index. Server validates range against *that player's* position and debits shared credits. |
| `boardFerry` | `{}` | Vote/interact to start the stage journey. |
| `ping` | `{ t: number }` | Echo for the HUD. `room.getLatency()` (https://docs.colyseus.io/sdk) covers this; keep only if a per-frame number is wanted. |

**Explicitly NOT sent by the client:** enemy positions, enemy HP, kill claims, damage amounts, item grants, credit changes, stage advances. Every one of those is a server decision.

### 4.2 Server → client

**A. State patches** — `FarmState`, 30 Hz, automatic.

**B. Room-scoped messages** (one frame, cosmetic, lossy-tolerant). The existing outbox already does this: `FarmSimulation.ts:125-126` subscribes to `DamageDealt, EnemyKilled, Dodged, SkillUsed, MPCharged, MPReleased, LevelUp, BossSpawned, ItemPicked, PlayerKilled` and `FarmRoom.ts:74` re-broadcasts each. Keep the mechanism; extend the list:

| Message | Payload | Client reaction |
|---|---|---|
| `welcome` | `{ seed, tick, spawn:{x,y,z}, entityId, hostId }` | Already exists (`FarmRoom.ts:59`); add `entityId`/`hostId`. |
| `DamageDealt` | `DamageContext` (`src/core/contracts.ts:7-37`) | Damage label, hit spark, hit-stop. |
| `EnemyKilled` | `DamageContext` | Ragdoll, fragments, slow-mo (`PlayerScene.ts:648`). |
| `PlayerKilled` | `DamageContext` | Ragdoll + spectate handoff (`PlayerScene.ts:702-709`). |
| `PlayerRevived` | `{ entityId, x, y, z }` | Revive VFX, camera return. |
| `SkillUsed` | `{ entityId, skillId }` | Cut-in, voice, aura. |
| `ItemPicked` | `{ entityId, itemId }` | Pickup toast. |
| `ChestOpened` | `{ id, entityId, itemId }` | Lid animation start. |
| `BossSpawned` / `BossKilled` | `{ entityId, definitionId }` / `DamageContext` | Banner, music. |
| `StageStarted` / `StageCompleted` | `{ stageId, seed }` / `{ stageId }` | Already in `GameEvents` (`contracts.ts:54-55`). |
| `SaucerBeam` | `{ x, y, z, count }` | Beam VFX for the raid. |

Mark the purely-visual telegraphs `.patchOnly()` in state instead of messaging them where they are already state (warnings), per https://docs.colyseus.io/state/optimization.

**C. Optimistic effects.** For locally-fired shots, use `predict.spawns` and `defineEvent` (https://docs.colyseus.io/netcode/recipes) so the shooter's tracer appears instantly and auto-reverts on misprediction — no manual cleanup.

---

## 5. Migration plan

Each step is independently shippable and leaves the game playable. Single-player (`?online` absent) must keep working after **every** step — that is the non-negotiable invariant, and it is cheap to hold because `PlayerScene` already branches on `this.net` (`:767,778,860,976,2342`).

Verification vehicle already exists: `tests/net-room.test.ts` boots a real server with `@colyseus/testing`'s `boot()` and drives two real SDK clients (`:14-19,30-34`); `tests/net-simulation.test.ts` drives `FarmSimulation` headlessly with real collision JSON (`:7-17`). Every step below extends one of those two.

---

### Step 1 — Per-player identity and stats (no visible change)

**Files:** `server/FarmSimulation.ts`, `server/schema.ts`, `server/rooms/FarmRoom.ts`, `src/run/RunProgression.ts`.

**Changes:** Assign `entityId` once in `addPlayer` and store it on `Player` (replacing the recomputing `entityId()` at `FarmSimulation.ts:226`). Add `entityId`, `classId`, `name`, `alive` to `PlayerState`. Extract `PlayerLoadout` from `RunProgression` (own `inventory` + `computeStats()`; `computeStats` at `RunProgression.ts:108-112` already only reads `this.inventory`, so this is a move, not a rewrite). `FarmSimulation.step` line 158 stops reading one shared `stats` and reads `player.loadout.stats` per player.

**Verify:** extend `tests/net-simulation.test.ts` — add two players, give player A an item via the loadout, step 60 ticks with both holding `z:1`, assert A's travelled distance > B's (the `boot` item is +10% move speed, `RunProgression.ts:10`). Assert `entityId` is stable across a third player joining and leaving.

---

### Step 2 — Host, lobby phase and LAN discovery (no gameplay change)

**Files:** `server/index.ts`, `server/rooms/FarmRoom.ts`, `server/schema.ts`, `src/net/NetworkClient.ts`, new `src/net/RoomBrowser.ts`, new `src/ui/CoopMenu.ts`.

**Changes:** Add `phase`, `hostId`, `playerCount` to `FarmState`. `onJoin` assigns host to the first client; `onLeave` promotes the next. Add `setLoadout`/`ready`/`startRun` handlers. Register `LobbyRoom` and mark `farm` with `.enableRealtimeListing()` (§7). Set `publicAddress` so clients on other machines get a reachable endpoint (https://docs.colyseus.io/server). Keep `filterBy(['seed'])` for the existing `?online=1&seed=` deep-link path so nothing regresses.

**Verify:** new `tests/net-lobby.test.ts` — boot server, join lobby room, create a `farm` room from a second client, assert the lobby client receives a `"+"` message naming that room; assert a `private` room does **not** appear but *is* joinable by `joinById`. Two-instance check: two browsers on two LAN machines, one hosts, the other sees the room in the browser list and joins.

---

### Step 3 — Enemies on the server (the big one; split into 3a/3b/3c)

**3a — Extract `EnemySimulation` (server only, not yet replicated).**
**Files:** new `server/EnemySimulation.ts`, `server/FarmSimulation.ts`.
Port the pure half of `EnemySwarm.fixedUpdate` (`:718-816`) and `spawn` (`:393-...`): director tick, spawn position, actor state machine, separation, attacks, projectiles, warnings. Replace `a.root.position` (Babylon `TransformNode`) with `Vec3`. Target selection becomes "nearest living player" instead of `this.player`. Reuse `MonsterDirector`, `ENEMIES`, `ENEMY_AFFIXES`, `ENEMY_BEHAVIORS`, `AIScheduler`, `TacticalNavigation` unchanged.
**Verify:** new `tests/enemy-simulation.test.ts` (pure, no room) — seed a sim, add two players 40 m apart, spawn one `eggplant` next to player B, step 300 ticks, assert it closed distance on B and not on A; assert `director.state` advanced; assert population never exceeds `populationCap`.

**3b — Replicate enemies (read-only on the client).**
**Files:** `server/schema.ts`, `server/rooms/FarmRoom.ts`, `src/net/NetworkClient.ts`, new `src/net/RemoteEnemies.ts`.
Apply the §3.2 `EnemyState` rewrite, switch `enemies` to `t.stream()`, wire `client.view.subscribe(...)`. Client renders replicated enemies **alongside** its local swarm at first, behind a `?netenemies=1` flag, so the two can be compared live.
**Verify:** extend `tests/net-room.test.ts` — two clients, wait for `state.enemies.size > 0`, assert both clients observe the **same** set of enemy ids with positions agreeing within 0.05 m. Assert the stream gotcha is covered: join a *third* client after 30 s and assert it still receives newly-spawned enemies (this is the failure mode when `subscribe()` is missing). Two-instance check: both windows show the same enemy count in the F1 overlay.

**3c — Cut over presentation.**
**Files:** `src/game/EnemySwarm.ts`, `src/game/PlayerScene.ts`.
When `this.net` is online, `EnemySwarm.fixedUpdate` no longer simulates: it reconciles its actor pool against `state.enemies` and lerps/`reckon`s positions. Per https://docs.colyseus.io/netcode/recipes, use **`reckon`** (forward-simulation) for enemies, not `lerp`. Keep `nextStage()`, ragdolls, fragments, labels, audio intact. Offline path (`!this.net`) unchanged — it still runs the local director.
**Verify:** run the whole existing suite (single-player parity must not regress — `tests/enemy-flat-surface-parity.test.ts` is the guard named at `EnemySwarm.ts:178`). Two-instance check: both players see the same enemy die at the same moment.

---

### Step 4 — Server-side damage resolution

**Files:** `server/FarmSimulation.ts`, `server/EnemySimulation.ts`, `src/combat/DualPistols.ts`, `src/net/NetInput.ts`, `src/player/PlayerMotor.ts`.

**Changes:** Add `aimX/aimY/aimZ` to `NetInput`. Server performs hitscan on the fired tick using `CollisionWorld.sweepSphere` for obstruction plus ray-vs-sphere against actor capsules (`ENEMIES[kind].radius × affix.scale`). Apply lag compensation with the rewind buffer that is **already allocated** (`FarmRoom.ts:49`) — extend `attachAll` to the enemy collection and resolve hits against `rewind.lastSeenBy(shooterId)` (https://docs.colyseus.io/netcode/lag-compensation).

**The timeline trap, called out because it is silent:** rewind timeline mode must match how the client *renders* each group. Enemies rendered with `reckon` (step 3c) must be rewound with a `reckon` timeline, not the default `snapshot`; mismatching them double-compensates and shots land consistently ahead of target. Also raise `maxRewindMs` above RTT + interpolation delay or legitimate LAN shots get clamped — 500 ms (`FarmRoom.ts:49`) is ample for LAN.

Fix `PlayerMotor.applyDamage`'s hardcoded `context.victimId !== 1` gate (`src/player/PlayerMotor.ts:516`) — see §8.1.

**Verify:** extend `tests/net-room.test.ts` — client A fires at a spawned enemy with a known aim vector; assert `state.enemies.get(id).hp` dropped on **both** clients and that `progression.totalKills` incremented exactly once when it died (not once per client). Add a lag-comp test: delay A's input by 120 ms and assert the hit still registers.

---

### Step 5 — Chests, loot and interactables

**Files:** new `server/InteractableSimulation.ts`, `server/LootField.ts`, `src/run/RunInteractables.ts`, `src/run/LootDrops.ts`, `server/schema.ts`, `server/rooms/FarmRoom.ts`.

**Changes:** Port `buy()` (`RunInteractables.ts:362-383`), `chestPrice`/`reprice`, `deliverWaveReward` (`:338-358`) and the drop landing search (`LootDrops.ts:33-73`) to the server. Populate `interactables` and `drops` in state. Client keeps GLB/lid/portal presentation keyed by id.

**Verify:** extend `tests/net-room.test.ts` — both clients walk to the same chest, both send `interact` in the same tick; assert credits are debited **once**, exactly one `ChestOpened` is broadcast, and exactly one drop appears in state. Assert a player with 0 credits standing 10 m away cannot open it (range + funds validated server-side).

---

### Step 6 — Stage progression and the shared run

**Files:** `server/FarmSimulation.ts`, `server/rooms/FarmRoom.ts`, `src/game/PlayerScene.ts`.

**Changes:** Move the horde/expedition state machine (`PlayerScene.ts:1963-1990`), boss request (`:1978-1987`), journey (`:1923-1961`) and `advanceStage` (`:1869`) to the server; drive `phase`/`journeyTime`/`stage`/`wave` from state. Client plays cinematics off those fields without gating the simulation.

**Verify:** new `tests/net-stage.test.ts` — two clients, force the chalice condition, assert both observe `phase` → journey → `stage` incrementing **once**, and that a client that never played its local cinematic still arrives at stage 2.

---

### Step 7 — Death, spectate, revive (§6.3)

**Files:** `server/FarmSimulation.ts`, `server/schema.ts`, `src/game/PlayerScene.ts`, `src/net/NetworkSession.ts`.

**Verify:** `tests/net-death.test.ts` — kill client A via QA damage; assert `alive=false`, `reviveAt = stage+1`, that A's input no longer moves anything, that the room does **not** end (B still simulating), and that A is restored to full HP at the spawn point when `stage` increments.

---

### Step 8 — Difficulty scaling and polish (§6.1, §6.2)

**Files:** `server/EnemySimulation.ts`, `src/run/MonsterDirector.ts`, `src/combat/Health.ts`.

**Verify:** `tests/coop-scaling.test.ts` — run identical seeds at 1 and 4 players for 120 simulated seconds; assert enemy-seconds-alive scales within the target band (§6.1) and that spawn rate never exceeds `PopulationBudget.maximum`.

---

## 6. Four-player specifics

### 6.1 Difficulty scaling

`MonsterDirector` has exactly three levers and no player-count awareness (`src/run/MonsterDirector.ts:151` `constructor(rng, stage=1, cap=50, mode)`):

- **Credit income** (`:167,206`) — how fast it can afford spawns.
- **Population ceiling** (`AMBIENT_EXPLORATION_CAP=8` at `:38`; `cap` 50; `budget` from `PopulationBudget`) — how many are alive at once.
- **Wave quota** (`waveQuota = 7 + wave*3`, `:182`) and `healthMultiplier = 1.16^(wave-1)` (`:183`), `damageMultiplier = 1 + .12*(wave-1)` (`:184`).

Proposed RoR2-shaped scaler, applied **only** when `playerCount > 1`:

```
players           1      2      3      4
creditRate      ×1.0   ×1.5   ×1.9   ×2.2      // sub-linear: 4 players are >4× as strong
ambientCap       8     12     15     18        // AMBIENT_EXPLORATION_CAP × (1 + 0.42×(n-1))
waveQuota    7+3w   ×1.4   ×1.75  ×2.05
enemy maxHP     ×1.0   ×1.3   ×1.5   ×1.7      // health only; NOT damage
enemy damage    ×1.0   ×1.0   ×1.0   ×1.0      // unchanged — see below
bossHealth      ×1.0   ×1.6   ×2.1   ×2.5
killBounty      ×1.0   ×0.75  ×0.62  ×0.55     // per-kill, so shared credits grow ~sub-linearly
```

Reasoning, briefly: scaling *count* and *HP* keeps the fight readable and rewards focus fire; scaling *damage* on top of 4× incoming attacks makes every hit a near-one-shot and produces the "everyone dies at once" failure that kills co-op runs. `Health` takes `readonly maximum` (`src/combat/Health.ts:6`) so the multiplier must be applied at construction time in the spawn path, not mutated later.

`PopulationBudget.maximum = 32` (`src/run/PopulationBudget.ts:3`) is a **performance** ceiling, not a design one — `EnemySwarm.spawn` comments at `:397` that the cap is "um ORÇAMENTO DE DESEMPENHO, não regra de jogo". On the server there are no meshes, so the server ceiling can be raised to ~48 while each *client* keeps its own visual budget and retires distant bodies locally (`EnemySwarm.updateBudget`, `:342`).

`finalHordePressure` (`MonsterDirector.ts:103-106`) is keyed on player *level*, which is shared — it needs no change.

### 6.2 Shared vs per-player loot

| Resource | Sharing | Why |
|---|---|---|
| **Credits** | Shared pool | Already modelled (`ProgressionState.credits`); matches the existing chest-price ramp (`chestPrice` grows with `opened`, `RunInteractables.ts:80`), which only makes sense against one pool. |
| **XP / level** | Shared | Already shared; keeps everyone's `maxHP`/`damage` curve aligned (`RunProgression.computeStats:109`). |
| **Items** | **Per-player, instanced** | See §2.6. A chest opened with shared credits ejects **one drop per living player**, each tagged `DropState.owner = entityId` and visible/pickable only by that player. This is the RoR2 "one printer, one item" contract adapted to co-op fairness, and it avoids the ninja-looting problem entirely. |
| **Wave rewards** | Per-player instanced | Same mechanism — `deliverWaveReward` ejects N tagged drops. |
| **Altar gamble** | Shared cost, per-player result | The 58% roll (`RunInteractables.ts:372`) is rolled once per player from the server's `interactable` stream. |

Free-for-all drops (`owner = 0`) remain available for the saucer-raid rare drop (`PlayerScene.ts:690-694`), where scarcity is the point.

### 6.3 Death → spectate → revive

RoR2 contract, adapted:

1. `hp` reaches 0 → server sets `PlayerState.alive = false`, `reviveAt = state.stage + 1`, broadcasts `PlayerKilled` with the full `DamageContext`.
2. Dead player's input is still **accepted and acknowledged** (so `seq` keeps advancing and reconciliation does not stall) but produces no motor step. `FarmSimulation.step` already guards on `m.hp > 0` in places (`:171`); make that guard explicit and total.
3. Client enters spectate: camera follows the nearest living player. The ragdoll path (`PlayerScene.startPlayerRagdoll`, `:1558-1573`) already exists and plays; what changes is that `started=false` (`PlayerScene.ts:702-709`) and the defeat screen (`:860`) must be **suppressed** when `this.net` is online — the retry button is already gated on `!this.net` (`:860`), so half of this is done.
4. On `stage` increment, every player with `reviveAt <= stage` is restored: `alive = true`, `hp = maxHP`, position = stage spawn. Broadcast `PlayerRevived`.
5. **Room ends only when all four are dead simultaneously** → `phase = 4` (defeat), run summary, return to lobby. A single death is never a run-ender.

Per-player *items* survive death (they are that player's `inventory`); shared credits/XP are untouched by death.

Reconnection: use the 0.18 `onDrop`/`onReconnect` hooks (https://docs.colyseus.io/room/reconnection), **not** the old `try/catch allowReconnection` inside `onLeave`:
```ts
onDrop(client: Client, code: number) { this.allowReconnection(client, 30); }
onReconnect(client: Client) { /* player row is intact; resume */ }
```
A dropped player's `PlayerState` stays in the map for 30 s, so a Wi-Fi blip does not cost the run. `autoDispose` must be considered: if all clients drop at once the room should survive the reconnection window.

---

## 7. LAN discovery + host/join UI contract

### 7.1 Server side

`server/index.ts` today is 9 lines: one `WebSocketTransport`, one `define('farm', FarmRoom).filterBy(['seed'])`, listen on `PORT ?? 2567` (`server/index.ts:6-9`). It logs `ws://127.0.0.1:2567` (`:9`) — a loopback address, which is wrong the moment a second machine is involved.

Required changes:

```ts
// bind all interfaces and advertise the real LAN address
const server = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
  publicAddress: `${lanIPv4()}:${port}`,        // https://docs.colyseus.io/server
});
server.define('lobby', LobbyRoom);
server.define('farm', FarmRoom)
  .filterBy(['seed'])                            // preserves the existing ?seed= deep link
  .enableRealtimeListing();                      // https://docs.colyseus.io/matchmaker/lobby
```
`lanIPv4()` = first non-internal IPv4 from `os.networkInterfaces()`. Log that address, not `127.0.0.1`. Note `vite` already serves with `--host 0.0.0.0` (`package.json:11`), so the client bundle is already LAN-reachable; only the game server lags behind.

Room metadata (`room.setMetadata`) carries what the browser shows: `{ name, hostName, stage, playerCount, hasPassword, version }`. **0.18 breakage:** `setMetadata` now **replaces** the whole object instead of merging (https://docs.colyseus.io/migrating/0.18) — always spread: `this.setMetadata({ ...this.metadata, playerCount: n })`.

Visibility (https://docs.colyseus.io/matchmaker/visibility) — three distinct flags, do not conflate:
- **Public LAN game** → default (listed, joinable).
- **Friends-only / party code** → `private`: hidden from listings but **joinable by room id**. The room id *is* the party code.
- **In progress, no late join** → `locked`.
Set several at once with `setMatchmaking()`. Note `maxClients = 4` (`FarmRoom.ts:10,38`) already auto-locks at capacity.

**mDNS/Bonjour: Colyseus has no built-in support** — there is nothing in the docs. If zero-config "find games on my network" is wanted (rather than typing an IP), it must be a separate `bonjour-service` / `node-dns-sd` advertisement of a `_colyseus._tcp` service whose discovered addresses are fed into `new Client('ws://<ip>:2567')`. Treat that as optional custom work, not a config flag. The typed-IP path works on day one and should ship first.

### 7.2 What the UI needs from the net layer

New `src/net/RoomBrowser.ts` — the only thing `src/ui/CoopMenu.ts` is allowed to touch:

```ts
export interface RoomSummary {
  roomId: string; hostName: string; playerCount: number; maxClients: number;
  stage: number; locked: boolean; hasPassword: boolean; pingMs: number;
}

export class RoomBrowser {
  connect(endpoint: string): Promise<void>;        // joins LobbyRoom
  readonly rooms: ReadonlyArray<RoomSummary>;      // live, updated by "rooms"/"+"/"-"
  onChange(cb: () => void): () => void;            // unsubscribe returned

  host(opts: { name: string; seed?: string; private?: boolean }): Promise<NetworkSession>;
  join(roomId: string): Promise<NetworkSession>;   // client.joinById
  quickJoin(): Promise<NetworkSession>;            // client.joinOrCreate('farm')
  dispose(): void;
}
```

LobbyRoom message contract (https://docs.colyseus.io/matchmaker/lobby): `"rooms"` = initial array, `"+"` = added/updated, `"-"` = removed. `RoomBrowser` folds those three into the `rooms` array; the UI never sees them.

Lobby-screen contract (reads `FarmState` directly once joined):
- Roster: iterate `state.players` → `{ name, classId, ready, entityId }`.
- Host badge: `state.hostId === room.sessionId`.
- Start button: enabled for host only, or auto-start when every player is `ready`.
- Party code: `room.roomId`, shown copyable.
- Latency: `room.getLatency()` (https://docs.colyseus.io/sdk) or the existing `room.clock.smoothedRtt()` already surfaced at `src/net/NetworkClient.ts:27`.

Backward compatibility: `NetworkSession.fromLocation` (`src/net/NetworkSession.ts:28-32`) keeps working unchanged. `?online=1` still `joinOrCreate`s by seed; the menu is an *additional* entry point, not a replacement. Existing tests stay green.

`@colyseus/playground` is worth enabling for LAN debugging — it can simulate connection drops, which is the only practical way to exercise the `onDrop`/`onReconnect` path by hand. **0.18 requires auth middleware or it 404s** (https://docs.colyseus.io/tools/playground): `playground({ prefix: '/playground', use: [basicAuth({ users: { admin: 's3cret' } })] })`.

---

## 8. Traps specific to THIS codebase

**8.1 `PlayerMotor.applyDamage` hard-rejects every victim but #1.**
`src/player/PlayerMotor.ts:516`: `if (this.debugInvincible || this.hp<=0 || context.victimId !== 1 || ...) return;`
With four players, three of them are immortal. `Health.apply` has the correct form for comparison — it checks `context.victimId !== this.id` (`src/combat/Health.ts:9`). `PlayerMotor` needs the same: an `id` field set from `entityId`. Related hardcodes: `PlayerMotor.respawn` builds a context with `victimId: 1` (`:503`), `RunProgression.addItem`/`addXP` emit `entityId: 1` (`src/run/RunProgression.ts:113-114`), and `EnemySwarm` gates the harvest event on `context.attackerId === 1` (`:539`) — under co-op, only player 1 would ever trigger `FruitHarvested`. `docs/MULTIPLAYER.md` §5 flagged this class of bug; it is still present.

**8.2 `FarmSimulation.entityId()` recomputes from map order.**
`server/FarmSimulation.ts:226`: `return 1 + [...this.players.keys()].indexOf(player.id);`
Called live during skill emission (`:174`). When player #2 of 4 disconnects, players #3 and #4 silently **renumber** — mid-run, while damage contexts carrying the old ids are still in flight. Assign at join, store on `Player`, never recompute. (Step 1.)

**8.3 Every client seeds its own `RunRNG` — and *several* of them.**
`PlayerScene.ts:439` `const rng = new RunRNG(seed)`, plus per-stage RNGs built from string keys at `:1500-1501` and `:1505` (`` `${attemptSeed}:stage:${stage}:pool:${planAttempt}` ``) and a loot placement seed at `:1713`. `EnemySwarm` takes the whole `RunRNG` and pulls `director`, `elite`, `run`, `procs` streams (`EnemySwarm.ts:189`, `:393`, `:509`). Since `RandomStream` is stateful (`src/core/RunRNG.ts:12-19`), **two clients that consume a stream a different number of times diverge permanently** — and they will, because `chooseVariant` is called once per spawn (`EnemySwarm.ts:393`) and the crit roll is called once per hit (`:509`). The seed being identical is necessary but nowhere near sufficient. The mitigation is not "sync the RNG"; it is that **only the server may draw from gameplay streams**. Purely cosmetic client randomness must use a *separate, unsynchronised* generator so nobody is tempted to reuse `rng.stream('run')` for a spark.

**8.4 `PlayerScene` drives everything, in one 116-line `fixedUpdate`.**
`fixedUpdate` spans `:736-852` and `render` spans `:854-1072`, with strict ordering: input → stats → world → `net.reconcile` (`:767`) → `player.fixedUpdate` (`:776`) → `net.afterStep` (`:778`) → MP/skill (`:788-802`) → melee (`:813`) → weapons (`:819-823`) → swarm block (`:826-850`). Systems are reached through `this.` on a 2482-line class. Moving a system server-side means threading a "who owns this?" branch through that ordering without disturbing the offline path. Do it by **replacing the body of each system's update**, not by adding `if (this.net)` branches inside `PlayerScene` — otherwise the two code paths drift and single-player regresses silently.

**8.5 `EnemySwarm` is built around exactly one `PlayerMotor`.**
`EnemySwarm.ts:189` takes `private readonly player: PlayerMotor`. It is consulted for navigation (`:221,727`), separation, nearest-N selection (`:244`), retirement distance (`:255-259`), stray recycling (`STRAY_DISTANCE`, `:78`), audio panning (`:519`), and all five damage call sites (`:672,677,782,797,813`). This is not a parameter to generalise — it is an assumption threaded through ~870 lines. Budget step 3a accordingly; it is the single largest item in this plan.

**8.6 The schema already promises what the server does not deliver.**
`EnemyState`, `WarningState`, `ProjectileState`, `InteractableState`, `DropState` are declared (`server/schema.ts:20-44`) and wired into `FarmState` (`:58-62`), but `FarmRoom.mirror()` (`:77-92`) never touches them. Anyone reading the schema will reasonably assume enemies replicate. They do not. Either populate them (this plan) or delete them — do not leave the lie in the file.

**8.7 `Health.maximum` is `readonly`.**
`src/combat/Health.ts:6`. Player-count HP scaling (§6.1) therefore must be applied when the `Health` is constructed in the spawn path. Mutating it later is not possible without changing the class, and `reset()` (`:15`) restores to `maximum`, so a post-hoc multiplier would be silently undone on reuse — and actors **are** pooled and reused (`EnemySwarm.ts:409` `this.actors.find(a => !a.active && a.kind === kind)`).

**8.8 Co-op is refused on the planet world, deliberately.**
`PlayerScene.ts:556-558`: `this.net = this.radial ? undefined : NetworkSession.fromLocation(...)`, with a written notice. `Reconciliation` and `RemotePlayers` reproduce a flat-gravity motor step. Keep that refusal through every step of this plan. Radial co-op is a separate project, and `EnemySwarm` already carries a parallel radial code path (`space`/`radial`, `:174-188`) guarded by `tests/enemy-flat-surface-parity.test.ts` — doubling that surface area for the network layer now would be a mistake.

**8.9 `FixedLoop` silently drops time.**
`src/core/FixedLoop.ts:31-41`: at most `maxSteps = 5` per frame, and any remaining accumulator beyond that is **discarded** into `droppedSeconds` (`:38-40`). A client that stalls (GLB load, shader compile) loses simulated time and its prediction falls behind by exactly that much. The server's own loop has the same tuning. The reconciliation threshold is 0.12 m (`src/net/NetworkSession.ts:22`), which a 5-step drop can exceed easily — expect correction spikes after every asset hitch, and surface `droppedSeconds` in the F1 overlay (`PlayerScene.ts:2441`) so it is diagnosable rather than mysterious.

**8.10 Seed pinning is load-bearing for room identity.**
`src/run/AttemptSeed.ts:64` pins the seed under `?online=1` *specifically* so clients land in the same room, and `retrySeed` (`:74-76`) preserves it. `restartAttempt` (`PlayerScene.ts:2175`) calls `retrySeed`, so it is already safe. But once the lobby UI exists (step 2), the room is identified by **roomId**, not seed — and `filterBy(['seed'])` (`server/index.ts:8`) would still silently route a lobby-joined client to a *different* room if its URL seed disagreed. Join by `roomId` must bypass the seed filter entirely; do not let both identity mechanisms be live on the same path.

**8.11 `warnings`/`projectiles`/`drops` as `ArraySchema` reindex on removal.**
`server/schema.ts:59-62`. Removing element 0 of a 40-entry projectile array dirties all 39 following entries. Combined with 30 Hz this is a real cost. Use `t.map()` keyed by id for churning collections, `splice()` never `deleteAt()` (removed in 0.16, https://docs.colyseus.io/migrating/0.16), and `.patchOnly()` for single-frame telegraphs.

---

## 9. Open decisions (need a call before step 5)

1. **Shared vs per-player inventory** — §6.2 recommends per-player. This contradicts the current `ProgressionState.inventory` (`server/schema.ts:49`) and `docs/MULTIPLAYER.md` §1. Confirm before step 1 touches `RunProgression`.
2. **Does the skill cinematic still freeze time?** Today it does (`worldDt=0`). §2.5 says no in co-op. If a freeze is wanted it becomes a design feature (host-only, or a vote), not a default.
3. **Late join** — allow a 4th player to join a run in progress (inherits shared credits/XP, empty inventory), or `locked` once `phase=1`? Affects §7.1 visibility flags.
4. **Friendly fire** — assumed off. The `blast` proc (`EnemySwarm.ts:529`) and `RicochetFan` would otherwise need victim filtering.
