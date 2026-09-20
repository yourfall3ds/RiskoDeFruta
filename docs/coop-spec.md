# RISCO DE FRUTA — ESPECIFICAÇÃO DO CO-OP COMPLETO

> Referência funcional: Risk of Rain 2. **Não** copiamos código proprietário — reproduzimos os
> princípios observáveis do co-op dele, sobre uma stack de rede mais blindada (Colyseus 0.18, que
> já oferece fixed timestep, predição, reconciliação, interpolação, rewind e reconexão com reserva
> de assento). Objetivo: **comportamento de gameplay do RoR2 + netcode melhor que o do RoR2.**

Este documento é o **contrato**. `docs/coop-implementation-plan.md` é o plano técnico derivado
dele. Onde os dois divergirem, **este vence**.

---

## 0. A FRASE QUE RESOLVE A CONFUSÃO CENTRAL

**A run é compartilhada. O jogador não é.**

Mundo, inimigos, chefe, tempo, objetivo, seed e dificuldade são **únicos**.
Personagem, vida, dinheiro, itens, equipamento e build pertencem **a cada jogador**.

Quando quatro pessoas jogam, não existem quatro universos quase iguais. Existe **uma** run, e
dentro dela **quatro jogadores independentes**.

## 1. PRINCÍPIO FUNDAMENTAL — o servidor é a verdade do gameplay

```
CLIENTE → INPUT → SIMULAÇÃO NO SERVIDOR → ESTADO AUTORITATIVO → APRESENTAÇÃO NO CLIENTE
```

O cliente envia **input**. O cliente **não** envia "estou aqui", "matei", "causei 400 de dano",
"peguei o item", "abri o baú", "ganhei ouro", "morri", "o chefe morreu", "o teleporter completou".

O cliente **pode prever** para ficar responsivo. **Não pode decidir** o estado final.

## 2. UM JOGO SÓ, NÃO DOIS

Proibido manter `SinglePlayerSimulation` e `MultiplayerSimulation` com regras diferentes — isso
diverge inevitavelmente. A simulação base é a mesma:

- **Single-player = servidor com 1 jogador.**
- **Multiplayer = servidor com N jogadores.**

`FarmSimulation` é o núcleo autoritativo. `maxPlayers = 4` é configuração, não premissa: nada de
`if player2 / if player3 / if player4`.

## 3. O QUE É COMPARTILHADO / INDIVIDUAL / SÓ VISUAL

| Compartilhado (a RUN) | Individual (o JOGADOR) | Só visual (local) |
|---|---|---|
| run, stage, timer, dificuldade | survivor, loadout | partículas |
| mundo, inimigos, chefe | posição, vida, munição, MP | tremor de câmera |
| teleporter/evento, objetivos | cooldowns, buffs/debuffs | ragdoll sem gameplay |
| baús, interactables, drops existentes | **carteira de dinheiro** | recuo visual da arma |
| XP de equipe | **inventário e equipamento** | efeitos de tela |
| autoridade do RNG | estatísticas de dano, vivo/morto | áudio, blending de animação |

**Nunca local:** spawn de inimigo, rolagem de loot, dano, crítico, proc, vida, morte, dinheiro,
XP, coleta, estado do chefe, progresso do teleporter, progressão de estágio.

## 4. IDENTIDADE

`playerId` estável, atribuído na entrada. **Nunca** índice de array, ordem do Map ou `length`.
Se outro jogador sai, ninguém é renumerado.

`PlayerRunState`: playerId, sessionId, displayName, connected, ready, survivorId, loadout,
alive/dead/spectator, health, shield, level, experience, money, inventory, equipment, stats,
position, rotation, currentStage, kills, damageDealt, damageTaken, ping.

## 5. LOBBY — unanimidade estrita

- `phase`: LOBBY → STARTING → LOADING → PLAYING → GAME_OVER → RESULTS.
- Começa **só** quando **todos** os conectados escolheram personagem e marcaram `ready`.
- Entrar, desmarcar ou cair **aborta** de volta ao lobby.
- Dois jogadores **podem** escolher o mesmo personagem. Não bloquear classe.
- **Votação de regras** (dificuldade, modificadores) é por jogador — não "host escolhe".
- **Ações administrativas** (privacidade, kick, permissões) são do líder. Votação ≠ administração.
- Ao iniciar, `lock` de entradas novas; **reconexões reservadas continuam permitidas**.

## 6. COMBATE E RNG

- Servidor decide munição, cadência, cooldown, acerto, dano, crítico, proc e morte.
- **Proibido** aceitar dano do cliente. Cliente manda `fire {inputSequence, weapon, aim, timestamp}`.
- **Lag compensation** pelo rewind buffer que já existe (`allowRewindState`), com clamp no
  timestamp — nada de acertar alguém através do tempo.
- **RNG de gameplay só no servidor.** Seed igual **não** basta: os clientes consomem o RNG em
  ordens diferentes (crítico, variante). Streams separados: `runRng`, `stageRng`,
  `enemyDirectorRng`, `interactableRng`, `lootRng`, `combatProcRng`.

## 7. ECONOMIA

- **Dinheiro é por jogador.** Não existe carteira única. A compra debita só quem comprou.
- **Recompensa de kill normal é distribuída à equipe**; efeito de item pessoal é só do dono.
- **XP é compartilhado.** Nível calculado no servidor; morto não fica condenado a ficar para trás.
- **Ouro restante vira XP na transição de estágio**, e a carteira zera.

## 8. ITENS

- **Inventário 100% individual.** Um item no chão é pego por **um** jogador — não replica para
  todos. É isso que faz builds divergirem.
- `DropState` é entidade autoritativa (entityId, itemId, rarity, posição, available, sourceId).
- Coleta é pedido validado: existe? disponível? jogador vivo? distância aceitável? Então atribui
  e marca indisponível **atomicamente** — corrida entre dois jogadores nunca gera dois itens.
- **Baú é compartilhado no mundo**: um paga, abre para todos, o item nasce no mundo e qualquer um
  pode pegar. Loot rolado no servidor.

## 9. INIMIGOS E DIRECTOR

- `EnemySimulation` no servidor. Cliente **apresenta**, não decide IA — senão o mesmo alien ataca
  jogadores diferentes em telas diferentes.
- IA mira em `getLivingPlayers()`, com `targetPlayerId` por inimigo e retarget periódico.
- **Director por créditos**, não "spawna a cada X segundos": créditos acumulam por coeficiente de
  dificuldade × tempo × nº de jogadores × estágio, e são gastos em inimigos. Teto explícito de
  inimigos ativos.
- **Coeficiente de dificuldade** (princípio, não número sagrado):
  `playerFactor = 1 + 0.3 × (players − 1)`;
  `timeFactor = 0.0506 × difficulty × players^0.2`;
  `stageFactor = 1.15 ^ stagesCompleted`;
  `coeff = (playerFactor + minutos × timeFactor) × stageFactor`.
  Alimenta: orçamento de spawn, stats de inimigo, custo de interactable, elites e recompensas.
- `runParticipantCount` é fixado no início e **conta desconectados** durante a janela de
  reconexão — senão "entra com 4, todos saem antes do chefe" vira exploit.

## 10. INTERACTABLES E OBJETIVO

- Orçamento de interactables cresce **sublinearmente** com jogadores (~+50% por jogador:
  1.0× / 1.5× / 2.0× / 2.5×). Mais loot total, **não** 4× loot.
- `InteractableState` precisa ser **realmente escrito** em `FarmRoom.mirror()` — hoje é declarado
  e nunca preenchido.
- **Teleporter/evento central**: qualquer jogador vivo ativa (não só o host), uma vez só, com
  transição atômica. Carga proporcional a `jogadoresNaZona / jogadoresVivos`. Morto **não**
  bloqueia a carga.
- **Chefe** é `EnemyState` especial: mesmo HP, fases, ataques e morte para todos. Escala com nº de
  jogadores. Recompensa: uma por participante, **inclusive mortos**; pickups continuam individuais.

## 11. MORTE, ESPECTADOR, RENASCIMENTO

- Morte é **individual**. A run **não** acaba porque um morreu.
- Run acaba quando **todos** os elegíveis estão mortos e não há revive pendente.
- Morto vira **espectador**: câmera nos vivos, troca de alvo, HUD própria, vê o progresso.
- Arquitetura aceita `allowRemoteOperation` (morto controla entidade aliada) sem ressuscitar.
- **Renasce no próximo estágio** com inventário, build, nível e loadout preservados.

## 12. DESCONEXÃO E RECONEXÃO

- `CONNECTED` / `DROPPED_RECONNECTABLE` / `DISCONNECTED_PERMANENT`. Queda de rede **não** é morte.
- `allowReconnection()` com janela razoável; cliente guarda `reconnectionToken`.
- Ao voltar: **mesmo** playerId, survivor, inventário, dinheiro, vida, run. **Nunca duplicar**.
- Recarregar a página usa o token persistido e re-sincroniza o snapshot completo.

## 13. REDE

- Tick fixo para gameplay; patch rate pode diferir do tick.
- Locais: predição + reconciliação por `inputSequence`. Remotos: snapshots + **interpolação**
  (renderizados ligeiramente no passado) — nunca a última posição crua.
- Estado persistente em Schema; eventos pontuais em mensagens com `eventId` (idempotência).
- Replicar posição/yaw/estado essencial — **não** matriz 4×4 nem dados de render.
- Animação **não** é autoridade: sincroniza estado (RUN/IDLE/ATTACK/DODGE/DEAD), o cliente escolhe
  o clipe.

## 14. MÁQUINAS DE ESTADO EXPLÍCITAS

`RunPhase`, `PlayerPhase`, `EnemyState`, `InteractableState`, `EventState` — estados nomeados, não
dezenas de booleanos.

## 15. VALIDAÇÃO — DEFINITION OF DONE

Não está pronto porque "dois jogadores se enxergam". Está pronto quando dois clientes conseguem:
entrar na mesma sala; escolher personagens; ficar prontos; começar juntos; carregar o mesmo
estágio; andar; atirar; ver o outro; **matar o mesmo inimigo**; receber recompensa; comprar baús;
pegar itens **diferentes**; ter builds **diferentes**; ver os mesmos drops; ativar o objetivo;
lutar contra o **mesmo** chefe; morrer individualmente; espectar; terminar o estágio; reviver; ir
juntos para o próximo; desconectar; reconectar; **continuar a MESMA run**.

Depois validar com **3 e 4** jogadores. "2 funciona, então 4 funciona" é dedução proibida.

Testar com latência artificial (50/100/200 ms, jitter, perda) — não só localhost a 0 ms.

**Os 1783 testes atuais não podem regredir.** Testes de multiplayer são acrescentados, não
substitutos.

### Tabela de prova exigida no final

| SISTEMA | AUTORITATIVO? | REPLICADO? | 2P | 4P | RECONNECT | PASS |
|---|---|---|---|---|---|---|

Linhas: Lobby, Ready, Character, Loadout, Movement, Health, Ammo, MP, Abilities, Enemies,
Enemy AI, Damage, Lag compensation, RNG, Crit, Drops, Inventory, Money, XP, Chests,
Interactables, Director, Boss, Objective, Death, Spectator, Respawn, Stage transition,
Disconnect, Reconnect, Results.

## 16. ARMADILHAS JÁ MEDIDAS NESTE CÓDIGO

1. `PlayerMotor.applyDamage` recusa `victimId !== 1` → jogadores 2/3/4 seriam **imortais**.
2. Streams de RNG são consumidos em ordens diferentes por cliente → seed igual é necessário mas
   **longe de suficiente**.
3. `EnemySwarm` carrega a premissa de **um** `PlayerMotor` por ~870 linhas.
4. `FarmRoom.mirror()` não escreve `EnemyState`/`DropState`/`InteractableState`, embora o schema
   os declare — **o schema promete o que não entrega**.
5. `server/index.ts` anuncia `127.0.0.1`, errado entre máquinas na LAN.
6. `FarmSimulation` escreve um `stats` **compartilhado** no motor de todos → quatro jogadores
   mecanicamente idênticos.

## 17. ORDEM DE EXECUÇÃO

A. schema/identidade · B. lobby · C. players · D. enemies · E. damage · F. RNG ·
G. interactables · H. drops/items · I. economia/XP · J. director · K. teleporter/chefe ·
L. morte/espectador · M. transição de estágio · N. reconexão · O. escala 1–4 · P. polimento/testes

**Não parar depois de A ou B.** Commits pequenos e verdes; se um bloco grande quebrar, corrigir
antes do próximo.

## 18. PRECISÕES QUE NÃO PODEM SER SIMPLIFICADAS

Estas corrigem simplificações erradas. Onde contradisserem qualquer seção acima, **estas valem**.

### 18.1 Ouro tem DUAS regras, não uma

Não existe "gold sharing" como regra única. São duas naturezas distintas:

| TEAM-DISTRIBUTED | OWNER-ONLY |
|---|---|
| kills normais | efeitos pessoais de item |
| barris | efeitos disparados por um jogador |
| fontes de equipe equivalentes | recompensas específicas do dono |

As carteiras continuam **individuais** em ambos os casos. Exemplo concreto:

```
inimigo normal morre  →  A +20, B +20, C +20
A compra baú de 50    →  A −50; B e C intactos
item pessoal de B     →  somente B +25
```

**Não criar `TeamWallet`.** Distribuir ≠ compartilhar carteira.

### 18.2 Teleporter: o denominador são os VIVOS

```
4 participantes: A vivo, B vivo, C morto, D morto
A e B dentro  → 100%
só A dentro   →  50%
```

Mortos **não** reduzem a velocidade de carga — mas continuam pertencendo à run para as regras de
recompensa e participação.

### 18.3 Recompensa do chefe conta os mortos

`rewardCount = participantes da run` — **mortos incluídos**. Os drops são **entidades físicas
individuais no mundo**, não atribuição automática (`player1Item`, `player2Item`). Um jogador pode
fisicamente pegar mais de um se os outros deixarem.

### 18.4 XP compartilhado ≠ inventário compartilhado

São sistemas **independentes**. Nunca derivar um do outro. Dois jogadores no mesmo nível **não**
têm os mesmos stats, porque survivor + inventário + equipamento + buffs são individuais.

### 18.5 Jogador morto

Não participa da carga do teleporter · não recebe dano · não é alvo normal da IA · **continua
pertencendo à run** · continua contando para regras de recompensa quando apropriado · mantém
inventário e build · renasce no próximo estágio.

### 18.6 Director trabalha sobre `livingPlayers`

Nunca `localPlayer`, `players[0]` ou `host` como referência. O alvo/referência de spawn deve
**variar** entre os jogadores vivos.

### 18.7 Desconectado ≠ morto

Durante a janela de reconexão o participante continua pertencendo à run. Preservar: playerId,
inventário, dinheiro, vida, equipamento, survivor, stats, participação no estágio.

### 18.8 NUNCA DOIS DONOS DA MESMA REGRA

Durante a migração, para cada subsistema, a ordem é atômica:

```
SERVIDOR vira autoridade → CLIENTE vira apresentação → REMOVER a decisão local antiga
```

Proibido, nem temporariamente: `EnemySimulation` no servidor decidindo spawn **enquanto**
`EnemySwarm` ainda cria inimigo localmente. Isso duplica entidade e diverge mundo.

### 18.9 `mirror()` NÃO é uma segunda simulação

A hierarquia é única e não admite atalho:

```
INPUT → FarmSimulation → estado autoritativo → FarmRoom/Schema → rede → apresentação no cliente
```

`FarmSimulation` é a **origem** do estado. `FarmRoom` **replica**. Schema **transporta**. Cliente
**apresenta**. Não colocar gameplay dentro de `mirror()` — preencher os Schemas não pode virar
desculpa para uma segunda simulação.

O anti-padrão a evitar: `FarmSimulation` + `FarmRoom` fazendo gameplay + `EnemySwarm` ainda
decidindo + cliente rolando RNG.

### 18.10 Schema vs evento

**Persistente (Schema):** HP do jogador, HP do inimigo, posição, inventário, dinheiro, fase do
estágio, progresso do evento, estado de interactable.
**Efêmero (mensagem):** tiro, feedback de acerto, feedback de coleta, FX de morte, ping, deixa de
som, FX de câmera.

### 18.11 Os dois testes que revelam autoridade escondida

**Teste do desligamento.** *"Se eu desligar completamente a renderização de um cliente, o servidor
ainda completa a run corretamente?"* Se não, ainda existe gameplay client-authoritative escondido.

**Teste do observador.** Dois clientes: A fica **parado**; B anda, atira, mata, abre baú, pega
item e ativa o objetivo. A deve apenas observar e chegar **exatamente** ao mesmo estado de mundo.
Depois **inverter**. Isso detecta qualquer dependência de "jogador local".

## 19. REGRA DE REFATORAÇÃO

Ao encontrar implementação que contradiz esta especificação: **não contorne com um boolean.**
Refatore a responsabilidade para o lugar certo.
