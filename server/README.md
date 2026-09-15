# Servidor cooperativo (Colyseus 0.18)

Servidor autoritativo em Node. Reutiliza os sistemas puros de `src/` (movimento, colisão, balsa, progressão, carga MP, pente, timeline de skill). Sem Babylon e sem GLB: a colisão vem dos mesmos JSONs que o cliente busca — `farm-collision.json`, `world-collision-mesh.json`, `solid-island-collision.json` e, quando existir, `farm-city-collision.json` (fundidos com o mesmo deslocamento de índices de `FarmWorld.load`).

Princípio: **cliente envia intenção, servidor decide resultado, Babylon apresenta.** Câmera, cinemática, VFX, áudio e ragdoll ficam locais. Desenho e mapa completo do estado: `docs/MULTIPLAYER.md`.

## Rodar

```powershell
# no D:\Riskodefruta2, com TEMP/TMP no .temp como o Iniciar-Jogo.ps1 faz
$env:TEMP = "$PWD\.temp"; $env:TMP = $env:TEMP
npm run server            # tsx --tsconfig server/tsconfig.json server/index.ts
npm run server:typecheck  # tsc -p server/tsconfig.json
```

Sobe em `ws://127.0.0.1:2567` (`PORT` muda). O cliente entra na sala `farm` com `{ seed }`; salas com a mesma seed são agrupadas (`filterBy(['seed'])`). O `onCreate` monta o índice de raios da colisão por malha (`CollisionWorld.prepareRaycasts`): ~1,3 s em Node pelo caminho síncrono, uma vez por sala.

## Netcode (APIs nativas do 0.18, sem netcode artesanal)

- `defineInput(NetInput, { seqField: 'seq' })` — buffer de entrada por cliente; um input consumido por cliente por passo (`inputs.get(sid).next()`).
- `setFixedTimestep(step, 60)` — simulação a 60 Hz (calibração do `FixedLoop`/`PlayerMotor` e dos testes do jogo).
- `patchRate = 1000/30` — estado na rede a 30 Hz; o cliente interpola.
- `allowRewindState({ maxRewindMs: 500 })` + `attachAll(state.players, { fields: [x,y,z] })` — histórico para o hitscan "o que o atirador viu" (Fase 3).

## Entrada (cliente → servidor)

`NetInput` (Schema Builder): `x z yaw pitch` (`float32`), `buttons` (`uint8`, bits `FIRE=1 JUMP=2 DODGE=4 CHARGE=8 RELOAD=16 INTERACT=32`), `interactOption` (`uint8`), `seq` (`uint32`).

No cliente com `@colyseus/sdk`:

```ts
const input = room.input({ type: NetInput });
input.data.x = 0; input.data.z = 1; input.data.buttons = BUTTON.FIRE; input.data.seq++;
input.send();
```

O servidor descarta `seq` repetido/atrasado e aplica cadência, pente e recarga por conta própria: dez pacotes de FIRE em 160 ms viram ~3 tiros, não dez.

## Estado (servidor → clientes)

`FarmState` via Schema Builder (`schema()` + `t.*`, sem decorators): `seed tick time stage wave hordeState intermission bossDeadTime ferryTime`, `progression` (créditos, xp, nível, abates, `inventory: map<uint16>` com os 90 ids), `players` (posição, yaw/pitch, `seq`, vida, esquiva, pente, MP, timeline de skill), e coleções para inimigos, avisos, projéteis, interativos e drops (Fases 4–5).

Mensagens (cosméticas de um frame, reencaminhadas do `GameEvents`): `DamageDealt EnemyKilled Dodged SkillUsed MPCharged MPReleased LevelUp BossSpawned ItemPicked PlayerKilled`; `welcome` `{ seed, tick, spawn }` ao entrar.

## Arquivos

- `FarmSimulation.ts` — simulação pura, testável sem rede.
- `schema.ts` — estado publicado.
- `rooms/FarmRoom.ts` — adaptador de sala (entrada, passo fixo, espelho no schema, eventos).
- `index.ts` — bootstrap.

## Testes

- `tests/net-simulation.test.ts` — 7 testes em Node sem DOM: spawn, ordem de pacotes, 50 balas/recarga, skill sem pausa global, determinismo por seed, balsa, índice de raios.
- `tests/net-room.test.ts` — sala real com `@colyseus/testing` e dois clientes do SDK: movimento autoritativo e mesma posição nos dois clientes; `seq` repetido ignorado e cadência imposta pelo servidor.

## Cliente (Fase 2)

`?online=1` (e `&server=ws://host:2567` opcional) liga o `NetworkSession` no `PlayerScene`: o jogador local continua simulado pelo mesmo `PlayerMotor` (predição), cada passo envia a intenção com `seq` e grava a pose prevista; quando o servidor confirma um `seq`, `src/net/Reconciliation.ts` compara — erro acima de 12 cm corrige e reaplica as entradas pendentes. Os outros jogadores vêm do `Predict` do SDK (interpolação nativa, `lerp` com atraso de render) e são apresentados por `src/net/RemotePlayers.ts` com um `CharacterVisual` por remoto. O painel F1 mostra sala, sessão, RTT, jitter, seq confirmado, pendentes, correções e replays.

## Etapa atual

Fase 2 concluída: predição local, reconciliação e remotos interpolados. Verificado por `tests/net-reconciliation.test.ts`, `tests/net-room.test.ts` e duas abas reais na mesma sala. Próximas: hitscan com rewind (Fase 3), `EnemySimulation` puro (Fases 4–5) — ver `docs/MULTIPLAYER.md` §8.
