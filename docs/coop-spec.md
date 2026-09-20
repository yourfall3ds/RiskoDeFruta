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

### 18.11 Alvo do inimigo — "mais próximo" NÃO é a regra universal

`nearestLivingPlayer()` pode ser fallback inicial, candidato ou política de **alguns** arquétipos.
Nunca a regra única: com 4 jogadores, 30 inimigos colapsariam no mesmo alvo e a pressão viraria
uma pilha — muito abaixo da sensação do RoR2, onde a IA tem alvo próprio com vida útil e cada
arquétipo avalia distância, linha de visão, mira, cooldown e estado.

**`EnemyState` carrega o alvo:** `targetPlayerId`, `targetLockTime`, `lastTargetSwitchTime`,
`aggroSource?`, além de `archetype`, `state`, `hp`, `position`, `velocity`, `alive`.

**Aquisição:** pegar `livingPlayers` → descartar inválidos → avaliar candidatos → selecionar pela
política do arquétipo → gravar → **manter enquanto válido**. Não reselecionar a cada tick.

**Invalidação:** alvo morreu · desconectou e deixou de ser elegível · ficou inalcançável por tempo
suficiente · IA entrou em estado explícito de retarget · regra do arquétipo · aggro de outro.

**Políticas que a arquitetura precisa comportar:** `NEAREST`, `RANDOM_LIVING`, `STICKY_NEAREST`,
`THREAT`, `DIRECTOR_ASSIGNED`. Nem todas em uso desde já, mas nenhuma pode ser impossível depois.
**`STICKY_NEAREST` é o padrão dos comuns** — é o que evita jitter quando dois jogadores se cruzam
em distância.

**Director ≠ alvo.** "Jogador usado como referência de spawn" não é "alvo definitivo". O Director
considera todos os `livingPlayers` e varia a referência ao longo do tempo; depois de nascer, a IA
adquire o próprio alvo.

**O alvo é só uma ENTRADA.** `targetPlayerId = B` não é "correr reto até B":
corpo a corpo → longe persegue, perto ataca · à distância → longe aproxima, ideal flanqueia e
atira, perto recua · saltador → alcance + linha de visão dispara o salto · voador → mantém
altitude e alcance.

### 18.12 Os dois testes que revelam autoridade escondida

**Teste do desligamento.** *"Se eu desligar completamente a renderização de um cliente, o servidor
ainda completa a run corretamente?"* Se não, ainda existe gameplay client-authoritative escondido.

**Teste do observador.** Dois clientes: A fica **parado**; B anda, atira, mata, abre baú, pega
item e ativa o objetivo. A deve apenas observar e chegar **exatamente** ao mesmo estado de mundo.
Depois **inverter**. Isso detecta qualquer dependência de "jogador local".

## 19. REGRA DE REFATORAÇÃO

Ao encontrar implementação que contradiz esta especificação: **não contorne com um boolean.**
Refatore a responsabilidade para o lugar certo.

## 20. ADENDO DO BLOCO E — RNG, EVENTO DE COMBATE E MORTE ÚNICA

> Nasceu durante o bloco E, no momento em que o RNG de combate ia ser consolidado num fluxo único
> `combat`. Vence o §6 onde for mais específico.

### 20.1 Separação semântica de RNG

O servidor ser autoridade elimina divergência entre clientes. **Não** resolve determinismo nem
testabilidade. Um fluxo único consumido por crítico, proc, spread, variante e efeitos faz com que
uma mudança boba na ORDEM DE AVALIAÇÃO altere resultados de combate posteriores.

Domínios separados, equivalentes a: `run`, `stage`, `director`, `interactable`, `loot`,
`combatCrit`, `combatProc`, `combatSpread`, `enemyVariant`. Não precisam ser exatamente oito
objetos se a abstração existente (`RunRNG.stream`) servir melhor. A regra é o que vale:

- acrescentar uma rolagem de spread **não** altera a sequência futura de loot;
- acrescentar um proc **não** muda qual elite o Director escolhe;
- efeito **cosmético nunca** consome RNG autoritativo.

### 20.2 O evento de combate tem identidade

Do cliente: `attackerId`, `inputSequence`, `abilityId`, `clientTimestamp`, `aim`.
Do servidor: `combatEventId`, `attackerId`, `targetId`, `baseDamage`, `crit`, `procCoefficient`,
`finalDamage`, `hitPosition`, `tick`.

O cliente **nunca** envia dano, crítico, resultado de proc nem HP resultante. Se enviar, ignora-se.

O `combatEventId` existe para que retransmissão, reconciliação e mensagem duplicada não produzam
dano duas vezes, proc duas vezes, nem som e muzzle duplicados.

### 20.3 Crítico e proc

Ordem fixa: validar ataque → resolver alvo e hit → rolar crítico → calcular dano → aplicar →
gravar evento. **Um** crit roll por evento que, pela regra da habilidade, tem um. Cliente não rola;
`mirror()` não rola; apresentação não rola.

Proc é **consequência do hit autoritativo**: hit confirmado → avaliação → RNG do servidor → efeito
autoritativo. Se o proc cria míssil, explosão, cura ou cadeia, a consequência também existe no
servidor. O cliente representa.

### 20.4 Uma entrada central de dano

`applyDamage({attackerId, victimId, damage, damageType, source, combatEventId})`, cuidando de
invulnerabilidade, armadura, escudo, vida, death guard, atribuição, `onHit` e `onKill`.

Proibido espalhar `hp -= amount` por `EnemySimulation`, `FarmSimulation`, habilidades e projéteis.

### 20.5 Morte exatamente uma vez

Quando `hp > 0` vira `hp <= 0`, o servidor gera **uma** transição de morte. Depois disso, outro
projétil no mesmo tique, outro proc ou outra mensagem do cliente não podem gerar de novo
recompensa, loot, XP, `onKill` nem evento de morte. Guarda autoritativa de estado, não um booleano
no fim do fluxo.

### 20.6 Dano no jogador vale para qualquer vítima

A mesma arquitetura serve a qualquer `victimId`. O bug `victimId !== 1` — que tornava os jogadores
2, 3 e 4 **imortais** — mostrou o custo de assumir a vítima. Teste os quatro explicitamente; não
deduza do padrão `entityId = 1`.

### 20.7 Rewind e projéteis

Hitscan: `clientTimestamp`/`inputSequence` → **clamp** para a janela permitida → rewind → raycast e
validação no servidor → **restaurar** o estado atual → aplicar dano. Nunca aceitar timestamp
ilimitado; nunca deixar o rewind alterar permanentemente o estado atual.

Projétil lento **não** entra no modelo de hitscan: é entidade autoritativa evoluindo no tempo.

### 20.8 O que o cliente pode prever

Muzzle flash, recuo, som, tracer e feedback preliminar de mira. HP real e hit final vêm do
servidor; previsão errada reconcilia.

### 20.9 Provas obrigatórias do bloco

- **Trapaça.** Atirar sem munição, antes da cadência, habilidade em cooldown, timestamp velho
  forjado, vítima forjada, dano forjado, mesmo evento duas vezes. O servidor rejeita ou torna
  inofensivo.
- **Isolamento de RNG.** Mesma semente, mesma sequência de pedidos, resultado reproduzível. Depois
  intercalar uma rolagem de **outro** domínio (loot): a sequência de críticos não muda. E o
  inverso.
- **Rede.** Dois clientes reais: mesmo `enemyId`, mesmo `hpAfter`, mesma morte, mesma recompensa.
  Nenhum cliente roda HP local.
- **Morte simultânea — o teste assassino.** Inimigo com 10 de vida, A e B acertam 20 no mesmo tique
  ou em janela próxima: **uma** morte, **uma** recompensa, **um** drop roll, **um** `onKill`
  conforme a posse, zero duplicação. Qualquer duplicação aqui significa lógica escapando do
  servidor.
- **Proc.** Ataque confirmado gera proc; os dois clientes veem a mesma consequência; nenhum RNG no
  cliente.

### 20.10 "Pulado" não é verde

Medido nesta base: `tests/net-enemies.test.ts` pendurava 60 s no `beforeAll` por disputa da porta
2568 e tinha os três casos **pulados** — a suíte fechava sem jamais executar a única prova
fim-a-fim do co-op. Isolado passava; junto, não rodava.

Todo portão final imprime **passed / failed / skipped / todo** e exige `failed = 0` e
`skipped inesperados = 0`. Skip deliberado tem de estar documentado e **fora** dos testes que
constituem prova do co-op. Teste de rede usa porta sorteada e garante teardown em `afterAll`, para
não deixar servidor zumbi para a execução seguinte.

### 20.11 Não aumentar a dívida

`EnemySimulation` (servidor) e o caminho local de `EnemySwarm` (offline) ainda são duas
implementações das mesmas regras — dívida real, registrada no §2. Não é preciso interromper o
trabalho para refatorá-la, mas **nenhum sistema novo pode nascer implementado duas vezes**. O
padrão daqui em diante é núcleo de simulação compartilhável, usado pelo servidor online e pelo
runtime local. A migração saudável é:

```text
antes:   EnemySwarm = decisão + visual
depois:  EnemySimulation = decisão  |  EnemySwarm = visual
```

e nunca:

```text
EnemySimulation = decisão nova  |  EnemySwarm = decisão velha "só por garantia"
```

### 20.12 A prova cruel do isolamento de RNG

Os testes de isolamento do §20.9 são fracos sozinhos. Uma implementação que *parece* ter fluxos
separados — objetos distintos, nomes distintos — mas que em algum ponto cai num gerador
compartilhado passa neles. Uma ou duas chamadas extras podem não deslocar nada visível.

A prova que pega isso: rodar o **mesmo** combate duas vezes, mesma semente e mesma sequência de
pedidos; na segunda execução, **antes de cada hit**, consumir dezenas ou centenas de números de
**outro** domínio. Crítico e dano têm de sair **bit a bit idênticos**. E o inverso: consumir
centenas do domínio de combate e provar que a sequência de loot não se move.

### 20.13 Ausência de autoridade não é licença

Em modo autoritativo, **proibido** em qualquer variação:

```ts
if (!serverDecisionAvailable) {
  runOldEnemyDecision();   // "só por segurança"
}
```

Isso recria dois donos exatamente onde o §18.8 os eliminou. Ausência de decisão do servidor é
**ausência ou atraso de autoridade**: manter a última amostra conhecida, interpolar, ou não
apresentar. Nunca reativar a decisão local, aplicar dano, decidir morte ou fazer nascer corpo.
Vale para todo sistema — horda, dano, proc, projétil, drop.

### 20.14 O gate do bloco, item a item

`tsc` verde e testes existentes verdes **não** fecham o bloco. Fecham estes:

1. RNG por domínio, provado pelo §20.12.
2. `combatEventId` sobrevivendo a request → resolução → aplicação → registro, com deduplicação e
   idempotência reais.
3. Pipeline único sem caminho alternativo pulando etapa.
4. `applyDamage` como entrada única — a busca por `hp -=`, `.hp = `, `hp--` e mutações diretas
   equivalentes dá **zero** fora do núcleo permitido.
5. Morte exatamente uma vez sob dois danos concorrentes capazes de matar.
6. P1, P2, P3 e P4 tomando dano em teste **executado**; parametrização aparentemente genérica não
   conta.
7. Rewind restaurando o snapshot clampado de verdade, não apenas calculando posição histórica
   enquanto outra parte do fluxo segue no estado atual.
8. Projétil lento que não virou hitscan diferido para caber no sistema.
9. Previsão do cliente antecipando feedback permitido sem criar verdade de combate.
10. `skipped` e `todo` impedindo o verde.

### 20.15 Espelho não vira fonte de verdade depois

`FarmRoom`, `RemotePlayers` e o HUD podem escrever e copiar HP replicado — isso é o trabalho deles.
O buraco não é a escrita, é a **leitura**: nenhum sistema pode ler o valor espelhado para decidir
**morte, proc, alvo, drop ou dano**. Se ler, a mutação é inocente e a leitura recria autoridade
lateral — o mesmo defeito por outro caminho.

Decisão lê o estado da simulação. Apresentação lê o espelho. Nunca o contrário.

### 20.16 `applyDamage` é idempotente em replay

O mesmo `combatEventId` chegando duas vezes: a primeira aplicação altera o estado; a segunda é
**no-op observável** — sem dano, sem morte, sem drop, sem proc duplicado. "Observável" significa que
o teste afirma que nada mudou, não que a segunda chamada foi engolida em silêncio.

### 20.17 A morte simultânea é hostil, não simpática

A matriz mínima, toda executada:

- dois atacantes no mesmo tique;
- dois hits letais **diferentes** — não o mesmo evento repetido;
- mesma vítima;
- **ordens de chegada invertidas**, com o mesmo resultado exigido nas duas;
- **replay de uma das resoluções** no meio da corrida;
- resultado: exatamente **1** transição alive→dead, **1** evento de morte, **1** recompensa/drop.

### 20.18 Determinismo depois de reinicializar o runtime

A terceira perna da prova do §20.12: mesma semente, mesmos ids de domínio e mesma sequência de
eventos, **depois de reinicializar o runtime** — resultado idêntico.

Isso prova determinismo reprodutível, não só isolamento. Dependência acidental de ordem de criação
de objetos, de relógio, de `Math.random()` residual ou de contador global aparece **só** aqui.

### 20.19 O ledger, não a contagem

A entrega do item 4 do §20.14 não é "caiu de 22 para 7". É um ledger com **proprietário semântico
explícito** para cada mutação de vida restante, mais a afirmação de que nenhuma constitui decisão
autoritativa fora do núcleo. Sobreviveu uma? Diga qual, por quê, e o que a impede de ser autoridade.

Linha de base medida nesta base antes do bloco E — 22 mutações em 10 arquivos:

```text
Health.ts           1    núcleo permitido
PlayerHUD.ts        1    apresentação
RemotePlayers.ts    1    réplica
FarmRoom.ts         2    espelho
PlayerScene.ts      4    ??? classificar ou eliminar
PlayerMotor.ts      4    ??? classificar ou eliminar
EnemySwarm.ts       1    ??? suspeito
MPCharge.ts         1    ??? suspeito
FarmSimulation.ts   1    ??? suspeito
PlanetScene.ts      6    ??? classificar
```

O alvo nunca foi "regex = zero". É **zero mutação que represente decisão de vida fora do núcleo
autoritativo**.

### 20.20 Os três números que fecham o bloco

1. mutações autoritativas fora do núcleo = **0**
2. duplicações de morte/recompensa sob corrida = **0**
3. divergências de RNG cruzando domínios = **0**

Com esses três e os dez itens do §20.14, o bloco deixa de ser implementação plausível e passa a ser
autoridade de combate fechada. Sem eles, não fecha — por mais verde que a suíte esteja.

### 20.21 Os irmãos do acoplamento — auditoria medida

`PlayerScene:2033` mostrou progressão e economia acopladas à observação **visual** de morte. Esse
tipo de acoplamento tem irmãos, e a auditoria dos consumidores de `onBossKilled`, `rewardsPending`,
`deliverWaveReward`, `bossSpawned`, `totalKills` e `credits` encontrou estes. São fatos medidos, não
suspeitas:

| local | o que decide | estado |
|---|---|---|
| `PlayerScene:2033` | morte espelhada → objetivo → `rewardsPending` → loot com RNG do cliente | violação, expedição |
| `PlayerScene:877` | `director.rewardsPending` → `deliverWaveReward(this.rewardRng, …)` | mesmo padrão, na fazenda; **inerte hoje** só porque o diretor local está desligado sob autoridade |
| `RunInteractables:368‑369` | `run.credits < cost` e `run.credits -= cost` | compra de baú decidida no cliente, **na fazenda** |
| `PlanetRun:165‑168` | idem para o planeta | mesmo padrão |
| `RunProgression:146` | `advanceStage()` converte crédito em XP e sobe estágio | decisão de corrida no cliente |

E o fato que amarra tudo: **`FarmRoom:193` publica `credits`, `xp`, `level` e `totalKills` no
schema, e nada no cliente os adota.** Não existe leitor. A carteira autoritativa é calculada,
transportada — e ignorada.

Consequência medida do estado atual, com a autoridade da horda já migrada: online o cliente **não
ganha** crédito (o caminho local está desligado pelo portão) e **não adota** o do servidor (não há
leitor), então a carteira fica parada; e `RunInteractables` valida a compra contra essa carteira não
autoritativa.

Isso é escopo do bloco de economia, não regressão do bloco D — mas fica registrado aqui para não ser
redescoberto como bug misterioso. A regra que fecha a classe inteira: **`health.dead` pode existir
como derivação conveniente para apresentação, nunca como evidência de que "uma morte aconteceu"**.
Lógica precisa de transição autoritativa explícita — algo com `victimId`, `combatEventId`,
`deathEventId` — e `objectives.onBossKilled()` deve nascer daí. Se `deliverWaveReward()` representa
recompensa real, o **roll** também nasce da autoridade, não do aviso de que o chefe morreu.

### 20.22 Pré-condição de protocolo não se lê do espelho

Proibido, quando `dead` é estado replicado:

```ts
if (actor.health.dead) return;
sendCombatRequest();
```

O modelo correto é o cliente poder mandar um pedido **possivelmente obsoleto** e o servidor
responder "inválido". Estado local controla animação e UI; não é pré-condição de correção do
protocolo. Isso resolve a latência nos dois sentidos: o cliente achar vivo quem já morreu vira uma
rejeição barata, e o cliente achar morto quem está vivo deixa de silenciar um ataque legítimo por
causa de um espelho atrasado.

### 20.23 A matriz de replicação fora de ordem

**Caso A — `hp = 0` com `alive = true`.** `health.dead` pode derivar verdadeiro para o visual, e
nada mais: nenhuma progressão, nenhum reward, nenhum drop, nenhum evento autoritativo, nenhuma
mudança de objetivo.

**Caso B — `hp > 0` com `alive = false`.** `presentDeath` exatamente uma vez, nenhuma autoridade
criada localmente, e HP posterior pode convergir sem recriar a morte.

Depois: `alive=false` repetido vinte vezes, HP alternando ou duplicado, snapshot repetido — nada
reaparece.

O teste que existe hoje prova contagem de abate e ausência de pagamento, mas **não** protege a
guarda estrutural contra refatoração futura. Ele precisa de contadores explícitos: `presentDeath`,
ragdoll, som de morte, VFX de morte e limpeza visual, todos exatamente **1**.

## 21. ECONOMIA AUTORITATIVA — A SEGUNDA FRONTEIRA

O §20 fechou uma fronteira. A auditoria do §20.21 revelou outra, do mesmo formato:

```text
COMBATE    estado replicado  ≠  verdade de combate
ECONOMIA   saldo replicado   ≠  verdade econômica
```

Metade da arquitetura autoritativa **já existe**: o servidor calcula e publica o estado certo. O
trabalho não é "fazer crédito aparecer" — é impedir que o cliente siga tratando seus objetos locais
como fonte da verdade.

### 21.1 A correção proibida

Não resolva adotando o espelho e mantendo a mutação local:

```ts
run.credits = row.credits;            // adota
...
if (run.credits < cost) return;       // e então decide com ele
run.credits -= cost;                  // e o muta
```

Isso conserta a carteira visualmente e cria um problema pior: o espelho vira **pré-condição** e
depois é mutado localmente. É exatamente o defeito do §20.22, com saldo no lugar de `health.dead`.

### 21.2 A separação

```text
Autoritativo (servidor)          Apresentação (cliente)
credits, xp, level, stage        displayedCredits, displayedXp
totalKills, purchases            displayedLevel, displayedKills
rewards, progressão de estágio
```

### 21.3 Compra é protocolo, não checagem local

`ChestPurchaseRequest { interactableId, playerId, requestId }`.

O cliente pode exibir "custa 25" e até fazer UX otimista, mas `if (credits < cost) return;` **não é
regra de protocolo**. Ele manda a tentativa. O servidor: validar jogador → validar baú → validar
distância e estado → validar custo → debitar a carteira autoritativa → marcar o baú consumido →
rolar a recompensa no domínio de RNG correto → publicar o resultado.

### 21.4 Crédito, XP, nível e estágio são UM agregado

`RunProgression:146` — `advanceStage()` converte crédito em XP e sobe o estágio. Logo os quatro não
são campos independentes: tratá-los como quatro resolveria a carteira no bloco de economia e
deixaria a progressão sendo derivada localmente.

```text
Nenhuma alteração em credits, xp, level ou stage
pode nascer de estado replicado ou de código cliente.

Cliente:  exibe, anima, prevê sem commit, envia intenção.
Servidor: valida, debita, recompensa, converte, sobe nível e estágio, publica.
```

### 21.5 Ledger de economia — linha de base medida

**48 mutações e chamadas econômicas em 14 arquivos** (contra 22 de vida):

```text
RunProgression 10 · MonsterDirector 8 · PlayerScene 6 · PlanetScene 5 · PlanetRun 4
RunInteractables 2 · PlayerLoadout 2 · DestructionModel 2 · MPCharge 2 · FarmRoom 2
EnemySimulation 2 · EnemySwarm 1 · index 1 · HarvestResonance 1
```

**Armadilha da contagem, registrada para ninguém "consertar" a coisa errada:** as 8 de
`MonsterDirector` são `credits` do **orçamento de spawn do diretor**, não a carteira do jogador.
Mesmo nome, agregado diferente, dono diferente. Um gate por regex as marcaria como violação.

Como no §20.19, a entrega é o ledger com dono semântico por linha — `servidor permitido`,
`apresentação`, `orçamento do diretor` ou `cliente — violação` — e o alvo é **zero decisão econômica
fora do núcleo autoritativo**, não regex zerado.

### 21.6 Os dois testes que cobrem metade da dívida

**Caminho feliz.** Servidor com 100, espelho do cliente em 0. Replica 100 → cliente tenta comprar
de 30 → pedido chega → servidor aceita e publica 70 → cliente converge para 70. Assertivas: o
cliente **nunca** debitou autoridade localmente; exatamente **uma** compra; exatamente **uma**
recompensa; saldo autoritativo final 70; saldo apresentado 70.

**Caminho hostil — o equivalente econômico do espelho atrasado.** O cliente vê 100, o servidor já
está em 20, o cliente tenta comprar de 30. O servidor rejeita: nenhum débito, nenhum item, e o
cliente converge para 20.

Espelho atrasado não autoriza ação. É a mesma frase do §20.22, com saldo no lugar de morte.

## 22. `MULTIPLAYER_JOGAVEL_01` — O MARCO QUE MANDA A PARTIR DE AGORA

**Regra do projeto: tudo que não impede 2–4 pessoas de entrarem na mesma partida e jogarem juntas
fica para depois.**

A auditoria dos §20 e §21 já cumpriu o papel: tirou as bombas que fariam o multiplayer parecer
funcionar por cinco minutos e depois virar desync. O risco agora é o oposto — achar dívida
infinitamente e nunca jogar. Os §20 e §21 passam a ser **direção e dívida registrada**, não lista de
tarefas.

**Bloco E** fecha com os três números do §20.20 e nada mais.

**Bloco F** é economia **mínima**, só este fluxo:

```text
matar → servidor recompensa → credits/xp/level replicados → cliente exibe
→ comprar baú vira request → servidor valida e debita → servidor gera recompensa → cliente recebe
```

Fora de escopo agora, por decisão explícita: `MonsterDirector.credits` (é orçamento da horda),
`PlanetRun`, expedição, `PlanetScene`, `PlayerScene:2033`, e as demais das 48 mutações.

### 22.1 O marco

Quatro clientes, em sequência: entrar na mesma sala → ver os outros andando → ver a mesma horda →
atirar nos mesmos inimigos → dar e receber dano → matar o mesmo inimigo **uma vez** → ganhar crédito
→ comprar item ou baú → ver o resultado nos outros clientes → morrer → continuar a partida sem
desync.

### 22.2 O teste que fecha o marco

Host + P2 + P3 + P4, 30 a 60 s de horda: P1 atira, P2 dá melee, P3 toma dano, P4 mata inimigo; dois
jogadores atacam o **mesmo** inimigo simultaneamente; um compra baú; um morre; a partida continua.

Ao final:

```text
enemy count   servidor == P1 == P2 == P3 == P4
alive/dead    servidor == todos
credits       servidor == dono
xp/level      servidor == dono
baús usados   servidor == todos
kills         servidor == todos
```

**Não precisa** estar bonito, ter lobby definitivo, reconnect perfeito, `PlanetScene` migrada, as 48
mutações corrigidas nem a dívida conhecida resolvida. **Precisa dar para jogar.**
