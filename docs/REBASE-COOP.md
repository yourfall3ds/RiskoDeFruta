# Como rebasear em cima do branch do co-op

> Para quem está trabalhando em outra frente do `RiskoDeFruta` (mundo, props, assets, UI) e
> precisa trazer o trabalho de multiplayer sem perder nada nem criar conflito bobo.

Branch: `fix/auditoria-clone`.

---

## 1. O que mudou de estrutural — leia antes de rebasear

Três mudanças quebram premissas antigas. Se o seu código toca nelas, o rebase vai conflitar e o
conflito é **legítimo** — não resolva no automático.

### 1.1 `ProgressionState.inventory` NÃO EXISTE MAIS

O inventário deixou de ser da equipe e passou a ser de cada jogador.

| Antes | Agora |
|---|---|
| `state.progression.inventory` | `state.players[sessionId].inventory` |
| `simulation.progression.stats` | `player.loadout.stats` |

A fórmula de stats foi extraída para `computeRunStats(level, inventory)` em
`src/run/RunProgression.ts`. `computeStats()` continua existindo e delega — o comportamento
single-player é idêntico ao de antes.

**Se o seu código lia o inventário global**, ele precisa passar a dizer *de quem*.

### 1.2 `entityId` é atribuído UMA vez, na entrada

Antes era recalculado pela ordem do `Map`, então quem ficava era **renumerado** quando alguém
saía. Agora vem de `freeEntityId()` (menor vaga livre em 1..4, reusa buracos).

**Se você guardava id de jogador em algum lugar**, agora ele é estável — o que provavelmente
conserta um bug seu em vez de criar um.

### 1.3 `FarmState` ganhou o lobby

Campos novos: `phase`, `hostId`, `playerCount`, `settings`. Em `PlayerState`: `entityId`, `name`,
`classId`, `classChosen`, `ready`, `inventory`.

`phase` **ainda não bloqueia a simulação** — isso é de um bloco posterior. Se o seu código assume
que a sala só existe em jogo, continua valendo por enquanto.

---

## 2. O rebase

```bash
git fetch origin
git rebase origin/fix/auditoria-clone
```

### Se conflitar em `server/schema.ts`

Quase sempre é o seu campo novo contra os campos do lobby. **Fique com os dois** — são ortogonais.
Cuidado só com a ordem dos decoradores `@type`: a ordem define a serialização, então mantenha os
campos existentes na ordem em que já estavam e acrescente os seus **no fim**.

### Se conflitar em `src/ui/MenuShell.ts` ou `PlayerHUD.ts`

O menu ganhou `attachLobby`, `setReadyHandler`, `setReadyLabel` e `startRun`. O roster passou a
vir do servidor. **Se você mexeu em layout, fique com o seu**; se mexeu no fluxo do botão PRONTO,
fique com o nosso — o PRONTO agora anuncia prontidão quando há sala, e só começa a partida direto
no single-player.

### Se conflitar em `src/game/EnemySwarm.ts`

Pare e fale com a gente. Esse arquivo está sendo migrado para o servidor
(`server/EnemySimulation.ts`) e a regra do contrato é dura: **nunca dois donos da mesma regra**.
Resolver esse conflito sozinho no automático tende a ressuscitar a decisão local que a migração
está removendo — e o sintoma é o pior possível: dois clientes vendo mundos diferentes.

### Mensagem de commit começando com `#`

Este repositório tem commits antigos cujo texto começa com `#`. O git trata isso como comentário
e a mensagem vira vazia, então o `git rebase --continue` falha com *"could not commit staged
changes"*. Contorno:

```bash
git commit -q -m "mesma mensagem, sem o # na primeira linha"
git rebase --continue
```

---

## 3. Antes de declarar que deu certo

```bash
npx tsc --noEmit
npx tsc --noEmit -p server/tsconfig.json
npx vitest run --maxWorkers=2
```

O número de referência é **180 arquivos / 1793 testes, todos verdes**. Se caiu, alguma coisa se
perdeu no rebase.

### Duas armadilhas de ambiente, não de código

- **Node não está no PATH global** nesta máquina. Prefixe:
  `$env:Path="C:\Users\Dariox\AppData\Local\Temp\claude\rdf\tools\node;$env:Path"`
- **`2>&1` em comando nativo no PowerShell 5.1** empacota cada linha de stderr num objeto e
  estoura a memória em saídas grandes. Redirecione só o stdout.

### Se um teste de rede falhar com `EADDRINUSE`

Não é o seu código. Um servidor de teste zumbi (de outra sessão ou de uma execução interrompida)
está segurando a porta. `tests/net-lobby.test.ts` já sorteia porta alta justamente por isso;
`tests/net-room.test.ts` ainda usa a 2568 fixa. Confira com:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 2568 -ErrorAction SilentlyContinue
```

---

## 4. Onde está escrito o que vale

- `docs/coop-spec.md` — **o contrato**. Vence qualquer outro documento.
- `docs/coop-implementation-plan.md` — o plano técnico derivado dele.
- `docs/MULTIPLAYER.md` — **obsoleto no ponto do inventário** (diz "compartilhado"; agora é por
  jogador). Não siga esse trecho.

As duas regras que mais importam durante a migração, porque é onde esse tipo de trabalho costuma
morrer:

1. **Nunca dois donos da mesma regra**, nem temporariamente. Na mesma mudança em que o servidor
   assume uma responsabilidade, a decisão local antiga é **removida**.
2. **`mirror()` não é uma segunda simulação.** `FarmSimulation` é a origem, `FarmRoom` replica,
   Schema transporta, cliente apresenta. Sem gameplay dentro do `mirror()`.
