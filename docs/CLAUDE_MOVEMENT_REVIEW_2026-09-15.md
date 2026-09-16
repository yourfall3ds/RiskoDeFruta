# Revisão técnica — dash, apoio/deslizamento, cargas e bônus (15/09/2026)

Escopo: apenas as mudanças não commitadas de `PlayerMotor`, `PlayerTuning`, `CollisionWorld`,
`TriangleGround`, `MPCharge`, `RunProgression` e a integração em `PlayerScene`/servidor.
Revisão por leitura; **nenhum código foi alterado e nenhuma suíte foi executada** (outro autor está editando).

---

## 1. `sprintSpeed` e `skillCharges` não existem no servidor → correção constante em coop
- `src/game/PlayerScene.ts:214` aplica `player.sprintMultiplier=stats.sprintSpeed` e `mp.setMaxCharges(stats.skillCharges)`.
- `server/FarmSimulation.ts:140-141` aplica `moveSpeed`, `jump`, `extraJumps`, `dodgeRecharge`, `armor`,
  `regeneration`, `attackSpeed` e `mp` — **não aplica `sprintSpeed` nem `setMaxCharges`**.

Repro: em partida em rede, pegar 1 `turbine` e correr em linha reta. Cliente = 8·1,12 = 8,96 m/s,
servidor = 8,0 m/s. O limiar de reconciliação é 0,12 m (`src/net/Reconciliation.ts:29`), logo a divergência
estoura em ~0,13 s de corrida e o jogador sofre snap-back contínuo enquanto segurar sprint.

## 2. A carga extra de especial nunca é consumida — o item `reservoir` não faz nada
- `MPCharge.consumeCharge()` (`src/combat/MPCharge.ts:26`), `chargeProgress` (`:23`) e `chargeSecondsLeft` (`:24`)
  **não têm nenhum chamador** em `src/`, `server/` ou `tests/` (grep feito nos três).
- O item está no pool de loot e promete efeito real: `src/run/RunProgression.ts:12`
  ("permite emendar uma continuação na janela final e recarrega sozinha").
- O HUD só desenha as cargas de esquiva (`src/ui/PlayerHUD.ts:96`); não há leitura de `mp.charges`.

Repro: pegar `reservoir`, carregar e soltar MP1/2/3 e pressionar de novo na janela final — nada acontece,
e `charges` permanece no máximo para sempre (nada decrementa). Pelo critério do próprio briefing
("não marcar recurso feito se existe apenas classe sem integração"), o item 8/9 está incompleto.
`setMaxCharges` é chamado todo frame com o mesmo valor; é idempotente, mas só porque nada consome.

## 3. `respawn()` e a recuperação de sólido não zeram o dash
- `PlayerMotor.resetAt` (`:51`) limpa `dashRemaining/dashCooldown/dashAirUsed/tapClock/lastAxis` — correto.
- `PlayerMotor.respawn()` (`:188-195`) zera `dodgeRemaining`, mas **não** `dashRemaining`.
- A recuperação de "dentro do sólido" (`:57-59`) zera `dodgeRemaining` e `retreatRemaining`, **não** `dashRemaining`.

Repro A (sólido, mais fácil): dash contra uma emenda de geometria até `insideSolid` disparar. O corpo volta
para `safe`, mas o dash continua pelos frames restantes na mesma direção e empurra de volta para a emenda —
`solidRecoveries` incrementa repetidamente até os 0,26 s acabarem.
Repro B (vazio): cair de uma ilha e dar o dash aéreo já em queda, cruzando `voidHeight` (-25) dentro dos
0,26 s. O respawn coloca em `safe` e o resto do deslocamento do dash (até ~5,2 m) é aplicado a partir dali.

## 4. Esquiva iniciada durante o dash é cobrada e não desloca
`PlayerMotor.ts:78` não exclui `dashRemaining>0` da condição de esquiva, e o bloco do dash (`:111-118`)
faz `dx=` / `dz=` (atribuição, não soma), sobrescrevendo o deslocamento calculado pelo bloco da esquiva (`:103-104`).

Repro: iniciar o dash e apertar esquiva dentro dos 0,26 s. Gasta carga, incrementa `dodges`, dá i-frames,
mas o trecho inicial da curva do rolamento é descartado (≈1,9 m dos 6 m); só o resto é percorrido depois.
O mesmo acontece com `barrageRetreat()` (`:107-110`), cujo recuo é anulado enquanto o dash roda.

## 5. `TriangleGround.sample` não enxerga faces acima de ~75,5° — justo o pior caso do deslizamento
O construtor descarta a face antes de indexar: `if(length<1e-8||Math.abs(ny)/length<.25)continue`
(`src/physics/TriangleGround.ts:10`). `.25` ⇒ inclinação máxima indexada ≈ **75,52°**.
Portanto `sample()` (`:17-27`) contraria o próprio comentário: a faixa que realmente escorrega é 50°–75,5°.
Acima disso `surfaceAt` devolve o piso de baixo (ou nada), `resolveSteepSlope` cai no `return` da linha
`PlayerMotor.ts:176` e a cápsula volta a poder ficar apoiada/suspensa contra a parede — o sintoma que o
item 3 do briefing pede para corrigir. O `Math.min(85,support.slopeDegrees)` em `PlayerMotor.ts:177` é
código morto por causa desse filtro.

## 6. Escorregar nunca marca `grounded` — sem saída e sem leitura
`resolveSteepSlope` (`:173-187`) fixa `position.y` e acelera ladeira abaixo, mas mantém `grounded=false`:
- `coyote` decai a 0 (`:63`) ⇒ **não dá para pular para sair do declive**;
- `airJumpsUsed`/`airDodged`/`dashAirUsed` só são restaurados no snap da linha `:136` ⇒ quem escorrega
  chega embaixo sem pulo aéreo e sem dash aéreo;
- `sliding`/`slideSeconds` não são lidos por ninguém (grep: nenhum consumidor) — sem animação, som ou HUD;
- `sliding` também não entra no snapshot de rede (`server/FarmSimulation.ts:174`), então remotos não escorregam.
- `respawn()` também não reseta `sliding`/`slideSeconds`.

## 7. Dash em rede depende de uma borda de input que o servidor pode perder
`FarmSimulation.applyInput` (`:123-127`) guarda **apenas o último pacote** e descarta `seq<=player.seq`;
não há fila de inputs não simulados. O detector de duplo toque (`PlayerMotor.ts:153-158`) depende da
transição `x/z: 0 → 1`. Se dois pacotes chegarem entre dois ticks do servidor, o do meio (a soltura, `z=0`)
é sobrescrito e o segundo toque nunca vira borda: o cliente dá dash, o servidor não, e a correção é de até 5,2 m.
Além disso `dashRemaining/dashCooldown/dashAirUsed` não estão no snapshot (`:174`) nem em `Pose`
(`src/net/Reconciliation.ts:13`), então após um snap o estado de dash local fica dessincronizado.

## 8. Som do dash usa o áudio de especial pesado
`PlayerScene.ts:206` encaminha todo `SkillUsed` para `audio.skill(id)`, e
`src/audio/RecordedAudio.ts:81` só trata `jump|wall_jump|air_jump` como swish leve; `'dash'`
(`PlayerMotor.ts:167`) cai no `else` e toca `swish .65 @0.7 + heavy .25 @0.75`, o mesmo timbre de ultimate.

## 9. Cobertura e dados mortos
- Nenhum teste menciona `dash`, deslizamento, `surfaceAt`, `sprintSpeed`, `skillCharges`, `turbine` ou
  `reservoir` (a única ocorrência de "slides" é `tests/player.test.ts:64`, teste antigo de esquiva em parede).
  O item 3 do briefing pede explicitamente testes de degrau, teto, borda, pedra e declive.
- `tests/hordes-arsenal-catalog.test.ts` só verifica que o número do stat sobe; não prova efeito.
- Sem consumidor algum (grep em `src/`+`server/`+`tests/`): `MELEE_TUNING`, `CAMERA_TUNING.lookAheadMeters`,
  `lookAheadSmoothing`, `sprintFovDegrees`, `fovSmoothing`, `PlayerMotor.dashYaw`, `PlayerMotor.dashes`.
  Itens 10 (corpo a corpo) e 12 (câmera) ainda são só tabela.

## 10. Observação de balanceamento (item 8 do briefing)
`WALK_SPEED 5.5` / `SPRINT_SPEED 8` (`src/player/PlayerTuning.ts:3-6`) deixam a caminhada **2% mais rápida**
que antes (5,4) e a corrida 1% mais lenta (8,1 → 8,0). O único ajuste realmente "mais lento" foi a pistola
(6,7 → 3,3 tiros/s). Se a intenção era desacelerar o deslocamento, os números atuais não fazem isso.

---

### Prioridade sugerida
Bloqueantes de jogo: 2 (item sem efeito), 3 (dash sobrevive ao respawn), 5 (deslizamento não cobre o pior caso).
Bloqueantes de coop: 1 e 7. Polimento: 4, 6, 8. Dívida: 9, 10.
