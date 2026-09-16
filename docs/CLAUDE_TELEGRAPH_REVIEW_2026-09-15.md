# Avisos falsos de área nos ataques inimigos — correção em patch (15/09/2026)

Tarefa técnica isolada pedida pelo usuário a partir de `docs/VISUAL_FEEDBACK_2026-09-15.md`
(seção "Bug novo — círculos falsos de área"). **Nenhum arquivo de `src/` ou `tests/` foi editado
neste checkout**: outro Claude trabalha na expansão em paralelo. A correção inteira está em

```
.temp/telegraph-fix.patch
```

pronta para `git apply`. Este documento é a revisão para o Codex aplicar depois de conferir
contra o estado atual da árvore.

## Como aplicar e conferir

```
git apply --check .temp/telegraph-fix.patch      # conferido OK às 19:52 de 15/09/2026
git apply         .temp/telegraph-fix.patch
npx tsc --noEmit
npx vitest run tests/telegraph-shapes.test.ts tests/enemy-swarm.test.ts tests/combat-feel.test.ts
```

Base do patch (conteúdo da árvore de trabalho no momento em que foi gerado — `git hash-object`):

| arquivo | blob base |
| --- | --- |
| `src/enemies/EnemyBehaviors.ts` | `7b9165f68d4a6e31d0e52b1f946290441f5d3ed9` |
| `src/game/EnemySwarm.ts` | `bd27bc6c0bf26e02f5085bdb23b08fbdfebe718b` |
| `src/vfx/CombatPresentation.ts` | `fbb25a7bad944d2f1f48ee3bc1dd243e0eed2751` |

Se algum desses blobs tiver mudado, o hunk correspondente precisa ser reconciliado à mão.
`EnemyBehaviors.ts` sai como hunk de arquivo inteiro (o arquivo tem 40 linhas e quase toda
receita mudou); os outros dois saem em hunks pequenos e localizados.

O patch cria um arquivo novo, `tests/telegraph-shapes.test.ts`, e altera só os três arquivos
acima. Nada de dano, HP, velocidade, alcance ou custo foi alterado.

## Onde a validação aconteceu

Como não podia tocar em `src/`, montei uma cópia de trabalho em `.temp/telegraph-check/`
(cópia da árvore + os arquivos já corrigidos; `vitest.config.ts` já exclui `.temp/**`). Tudo
abaixo foi executado lá, com `npx vitest run --root .temp/telegraph-check`:

- `tests/telegraph-shapes.test.ts` — **28 testes, todos passando**.
- `enemy-swarm` + `combat-feel` + `review-regressions` + `expedition-feel` + o novo: **75 passando**.
- Suíte completa comparada contra a árvore sem o patch: **8 falhas antes, 8 falhas depois**, as
  mesmas de sempre (`combat-assets`, `highland-trails`, `hordes-arsenal-catalog`) mais ruído de
  locomoção que vem das edições simultâneas do outro Claude em `PlayerMotor.ts`/`GameInput.ts`,
  não deste patch. Nenhuma regressão nova atribuível à correção.
- `npx tsc --noEmit` na cópia: zero erros nos quatro arquivos tocados (as mensagens que sobram
  vêm de `src/input/GameInput.ts`, obra em andamento do outro Claude).
- O patch foi aplicado num diretório descartável e o resultado comparado byte a byte com os
  arquivos testados: idênticos.

## Diagnóstico

1. **Anel incondicional por windup.** `EnemySwarm.think` chamava
   `effects.warning(alvo, behavior.warningRadius, ..., 'intent')` em *todo* windup, de toda
   espécie, antes de acrescentar linha ou cone. Numa multidão isso vira a pilha de círculos
   vermelhos da screenshot. Nenhum desses círculos causava dano (`damage:0`): era informação
   falsa de área, e o raio (`warningRadius`) não correspondia a efeito nenhum — 4 m no chefe,
   2.6 m na melancia, 1 m na cenoura.
2. **`line()` desenhava uma elipse.** Reaproveitava o torus do círculo e guardava
   `stretch=max(1,comprimento/2/largura)`; o `render` aplicava
   `scaling.set(raio*pulse, 1, raio*pulse*stretch)`. Resultado: um anel oval, sem largura de
   contato e sem comprimento reais, e sempre centrado no meio do caminho mesmo quando a
   investida ia mais longe.
3. **Cone só na varredura, mas o círculo aparecia nos cinco ataques.** A condição
   `attack%5===4` já era a certa para o cone; o problema era o anel de raio 4 que saía junto
   nos outros quatro ataques.
4. **`BOSS_ATTACKS` com intents falsos.** O ataque de barragem (índice 3) criava sete círculos
   de raio 1.5 sem nenhuma área de dano por trás — os projéteis só machucam por contato direto
   em voo. O de ácido (índice 2) usava `'intent'` genérico, embora o raio 4 coincida de verdade
   com a poça criada no impacto.
5. **Invocação com a mesma linguagem visual de perigo.** Os anéis de `'summon'` usavam o mesmo
   material vermelho dos círculos de dano.
6. **Vazamentos de pool.** `cone()` ligava o círculo e logo desligava para trocar o mesh, e o
   `clear()` não devolvia o slot ao mesh de círculo nem varria os pools auxiliares; qualquer
   caminho novo que trocasse `w.mesh` poderia deixar um mesh ligado para sempre.
7. **Prévia do laser dependia do socket.** O único aviso de direção honesto da cenoura só
   aparecia se o rig tivesse `RightHand`/`RightArm`.

## O que o patch faz

### Plano de aviso por ataque concreto (`EnemyBehaviors.ts`)

`warningRadius`/`warningShape` saíram. Cada espécie agora expõe `telegraph(actor)` devolvendo um
`TelegraphPlan` — uma função pura, escolhida pelo ataque que vai sair, não pela espécie:

| ataque | aviso | por quê |
| --- | --- | --- |
| Berinjela mordida (alvo a ≤ 2.3 m) | `none` | só animação/som; não há área |
| Berinjela investida | `band` largura `2·(0.8+0.55)=2.7`, alcance 9.5 | largura = o mesmo raio de contato do `recover`; alcance = 10 m/s × 0.95 s |
| Milho (3 ou 5 sementes) | `aim` 0.6 × 3.2 | direção/muzzle, sem área |
| Melancia rolamento (`attack%3===1`) | `band` largura `2·(1.45+0.55)=4`, alcance 9.35 | 11 m/s × 0.85 s |
| Melancia cuspe (`attack%3===2`) | `aim` | tiro direto |
| Melancia mordida (`attack%3===0`, alvo ≤ 3.4 m) | `none` | só preparo |
| Melancia mordida longe | `band` | o `perform` cai no ramo de investida; o aviso prevê isso |
| Tomate | `circle` raio 2.3, tipo `fire-intent` | é o **mesmo raio** da zona de fogo criada no impacto |
| Cenoura | `beam` largura 1 | linha real do feixe, largura = 2 × o raio 0.5 do teste de acerto |
| Chefe varredura (`attack%5===4`) | `cone` raio 7 | 7 m e `cos>0.5` = setor de 120°, igual ao disco `arc:1/3` |
| Chefe demais ataques | `none` | cada um já traz a própria marca no momento certo |

O comprimento da faixa é `min(alcance da investida, distância até o alvo travado)`, ou seja, o
trajeto que o bicho realmente vai varrer — não um retângulo fixo.

### Correspondência aviso ↔ execução

Para o aviso não mentir, a **escolha do ramo** no `perform` passou a usar `actor.locked` (o alvo
travado no windup) em vez da posição viva do jogador, nos dois lugares onde havia divergência:
berinjela (mordida × investida) e melancia (mordida × investida de recuperação). O teste de
*acerto* da mordida continua usando a posição viva do jogador — nada de dano mudou, só qual
ataque foi escolhido passou a ser decidido com a mesma informação que desenhou o aviso. Sem
isso, girar o jogador durante o windup transformava a faixa anunciada numa mordida (e vice-versa).

### Auditoria de `BOSS_ATTACKS`

| índice | antes | depois |
| --- | --- | --- |
| 0 invocar | 6 anéis `'summon'` vermelhos | mantidos, agora com o sinal menta de invocação |
| 1 raízes | 5 círculos `'root'` com dano 26 | mantidos sem mudança: dano de área real |
| 2 ácido | `'intent'` raio 4 | `'acid-intent'` raio 4 — o mesmo raio da poça criada no impacto |
| 3 barragem | 7 círculos raio 1.5 sem dano de área | **removidos**; sobram só as 3 marcas de invocação, exatamente onde nascem os inimigos |
| 4 varredura | nada no `perform` (o cone vem do windup) | igual |

### Faixa retangular de verdade (`CombatPresentation.ts`)

`line()` agora usa um pool próprio de 16 planos `CreateGround` (quad no plano XZ, material
translúcido, sem backface culling): posição no meio do trajeto, `rotation.y = atan2(dx,dz)`,
`scaling = (largura, 1, comprimento)`. `stretch` deixou de ser um fator de esticamento e passou
a guardar o **comprimento em metros**; o `render` só pulsa a largura e nunca mais multiplica o
raio de um círculo por ele. Círculo pulsa igual nos dois eixos — não existe mais caminho que
produza elipse.

`cone()` deixou de passar pelo círculo antes de trocar o mesh: pega o setor, reserva o slot e
fixa `rotation=(π/2, atan2(dx,dz)−π/6, 0)`. O offset de −π/6 está certo para `arc:1/3`: o disco
cobre φ∈[0,2π/3] e o bissetor precisa cair no eixo que aponta para o alvo.

Invocação ganhou material e template próprios (`summon-signal`, anel menta mais grosso, pool de
12), escolhidos dentro de `warning()` pelo `kind==='summon'`.

### Pools sem vazamento

- `attach(w, mesh)` é o único caminho para trocar o mesh de um slot e **sempre desliga o
  anterior**; `warning()`, `cone()` e `line()` passam por ele.
- Quando um pool auxiliar está cheio (ou a faixa teria comprimento < 5 cm), a chamada retorna
  **antes** de reservar o slot de aviso — nada de slot ocupado com mesh desligado.
- `clear()` devolve todo slot ao mesh de círculo, desliga cone/faixa/invocação um por um e zera
  `remaining/damage/pulses/stretch/kind`.
- Novo getter `attachedShapes` (quantos meshes auxiliares continuam ligados) existe para os
  testes provarem que o pool fecha em zero depois do windup e depois de `nextStage()`.
- Tamanho dos pools: +16 faixas e +12 anéis de invocação, todos `InstancedMesh`. `active` não
  muda (as formas auxiliares vivem nos 48 slots de aviso já existentes), então o
  `poolCapacity` do HUD de diagnóstico em `PlayerScene.ts` continua válido e não precisou mexer.

### Prévia do laser

A prévia 3D do feixe da cenoura (que é o aviso de direção real dela) deixou de exigir
`laserSocket`/`laserArm`: sem socket, `laserPath` já cai no fallback do corpo. A mira do braço
continua condicionada ao rig existir.

## Testes novos — `tests/telegraph-shapes.test.ts` (28 casos)

1. **Seleção de forma, pura** (sem Babylon): mordida → nada; investida → faixa com a largura de
   contato derivada de `ENEMIES[kind].radius+0.55`; tiro direto → direção; laser → feixe; tomate
   → círculo 2.3/`fire-intent`; chefe → cone só em `attack%5===4`. Um caso varre todas as
   espécies × 10 ataques × 4 distâncias e exige que o **único** círculo do jogo inteiro seja o
   do tomate.
2. **Geometria da faixa**: retângulo com posição no meio do caminho, `scaling=(2,1,6)`, yaw
   correto, mesh vindo do pool `band-warning-*`; depois do `render` o comprimento não muda e só
   a largura pulsa. Um caso separado garante que o círculo continua com `scaling.x===scaling.z`
   (regressão direta da elipse).
3. **Sinal de invocação** distinto do anel de perigo (mesh e material diferentes, dano 0).
4. **Cone** com `rotation.x=π/2` e `rotation.y=atan2−π/6`.
5. **Pools**: enche faixa (16), cone (8) e invocação (12), confere `attachedShapes===36`, chama
   `clear()` e exige `active===0`, `attachedShapes===0`, todo slot de volta no próprio círculo, e
   reuso funcionando logo em seguida.
6. **Receitas do chefe** com uma `CombatPresentation` real: invocação = 6 marcas `summon`;
   raízes = 5 círculos com dano 26; ácido = 1 círculo `acid-intent` raio 4; barragem = 3 marcas
   `summon` e 7 projéteis, dos quais 3 invocam; varredura = fere sem criar círculo.
7. **Integração na horda** (`EnemySwarm` com `NullEngine`), deixando o bicho chegar sozinho ao
   windup: milho mostra só `aim`; berinjela mostra uma faixa com largura 2.7 e comprimento igual
   ao trajeto travado; melancia em mordida não desenha nada; tomate mantém um único círculo 2.3
   sobre o alvo; cenoura desenha a linha do feixe até onde ele alcança; chefe desenha cone só na
   varredura e nada nos ataques 1, 2, 3 e 5; `nextStage()` devolve todos os meshes.

## Riscos e decisões para o Codex

- **Chefe sem aviso no chão em 4 dos 5 ataques.** É o que a direção pede, e cada um desses
  ataques já tem lead time próprio (0.8 s nas invocações, 0.8–1.5 s nas raízes, 1.1 s no ácido,
  projéteis visíveis na barragem). Se em teste de jogo o chefe ficar ilegível, o lugar certo de
  mexer é o clipe de `Cast` / áudio, não um anel genérico de volta.
- **Faixa de 4 m de largura da melancia** parece grande, mas é exatamente `2·(raio+0.55)` do
  teste de contato. Se for reduzida, o teste de contato precisa cair junto — caso contrário o
  aviso volta a mentir, agora para menos.
- ~~**`min(alcance, distância)`** faz a faixa parar no alvo travado.~~ Confirmado como P1 na
  revisão do Codex e corrigido no adendo abaixo.
- **A faixa é um quad plano**, colocado na média das alturas das pontas. Em rampa forte ela
  afunda ou flutua — o mesmo comportamento que o círculo já tinha. Um aviso projetado no terreno
  exigiria decal e ficou fora deste escopo.
- **`fire-intent` começa com `fire`**, então `EnemySwarm.update` emite partículas de fogo sobre
  essa marca (limite de 3 campos por frame). É proposital e verdadeiro; se incomodar, basta
  renomear o `kind` no plano do tomate.
- **Origem do cone** é a posição do chefe no início do windup, enquanto a varredura confere a
  distância a partir da posição no momento do golpe. O chefe não caminha em windup, então o
  desvio é de centímetros; não mexi para não alterar o alcance efetivo.

## Fora deste patch

Os outros itens de `VISUAL_FEEDBACK_2026-09-15.md` (mira da primeira skill, timbres de áudio,
posição da recompensa, som de hit recebido) não foram tocados. As "screenshots em multidão"
pedidas na seção original continuam pendentes: aqui a validação foi por teste automatizado e
inspeção de geometria, sem abrir o jogo. O QA visual é do Codex, via CUA.

---

# Adendo — alcance da faixa de investida (P1 da revisão)

Patch incremental: **`.temp/telegraph-range-fix.patch`**, gerado em cima do patch anterior.

> **Já está aplicado na árvore** (conferido às 20:05 de 15/09/2026:
> `git apply --check --reverse .temp/telegraph-range-fix.patch` passa, o direto não).
> Não reaplicar.

Base e resultado (`git hash-object`):

| arquivo | blob base | blob depois |
| --- | --- | --- |
| `src/game/EnemySwarm.ts` | `c326459f2318049a1f2882e8cf2bcc276467907d` | `09170782e6845e70a09d93594a1aa7197361b7e4` |
| `tests/telegraph-shapes.test.ts` | `1937d43da25809b7e2ea065f4e383b68f81de84c` | `7ce04ad72a9467a293954633a34335ddea2347f9` |

## O problema

`telegraph()` terminava a faixa em `min(plan.reach, distância até o alvo travado)`. A investida,
porém, não para no alvo: `recoverySpeed` mantém 10 m/s por 0.95 s (berinjela) e 11 m/s por 0.85 s
(melancia) e só é interrompida por contato ou parede. Jogador que recua ou desvia depois do
windup continuava dentro do trajeto real, fora da faixa desenhada — aviso subestimado, que é o
tipo de mentira que a tarefa original pedia para eliminar.

## A correção

Duas mudanças, as duas no helper de emissão do aviso em `EnemySwarm.ts` — nada em
`EnemyBehaviors.ts`, nada em `CombatPresentation.ts`, nada de dano ou balanceamento:

- `telegraph()` passa a calcular o comprimento por `rushReach(a, heading, plan.reach)` em vez de
  `min(reach, distância)`; `heading` é a direção travada, a mesma que o `aimRush` usa.
- `rushReach()` sonda o impulso inteiro com **o mesmo `move` do deslocamento do `recover`**:
  `collision.move(probe, heading·reach, raio do corpo, altura 1.8, degrau .8)`. Não é um
  `sweepSphere` genérico — é a consulta que o próprio movimento faz, então degrau baixo é
  ignorado e parede de verdade corta, com o mesmo raio
  (`ENEMIES[kind].radius × ENEMY_AFFIXES[variante].scale`, o raio do corpo registrado em
  `playerBodies`/Detour). O resultado é projetado na direção travada, para deslizamento lateral
  não inflar o comprimento, e fica limitado a `[0, reach]`.

Consequência: campo aberto mostra 9.5 m (berinjela) e 9.35 m (melancia) mesmo com o alvo a 3 m;
com parede no caminho a faixa para onde o corpo para, não onde a geometria começa.

## Testes (`tests/telegraph-shapes.test.ts`, agora 32 casos)

O caso da berinjela deixou de esperar `min(9.5, distância)` e passou a exigir 9.5. Quatro casos
novos, todos com o bicho chegando sozinho ao windup (`chargeUp(..., eager)` zera o cooldown para
o windup sair na distância escolhida):

1. **Alvo perto não encurta o aviso**: windup a 3 m do alvo → faixa de 9.5 m, mais de 3× a
   distância até o alvo inicial.
2. **Alvo que recua continua dentro da faixa**: mesmo windup, jogador sai do trajeto, simulação
   até o fim da recuperação — a distância realmente percorrida passa do alvo inicial, fica dentro
   de 0.4 m do comprimento anunciado e **nunca o ultrapassa**.
3. **Parede corta o alcance**: caixa em `z ∈ [-2,-1.8]` atrás do jogador (não bloqueia o windup,
   porque a checagem de linha vai só até o jogador). A faixa cai para 8 m (corpo de raio .8 encosta
   em `z = -1.0`), termina antes da parede, e a investida simulada para exatamente no fim
   desenhado.
4. **Melancia rolando**: faixa de 9.35 m com a largura 4 do contato.

Execução: `telegraph-shapes` **32/32** e `enemy-swarm` **14/14** (46 no total) na cópia
`.temp/telegraph-check/`, com os arquivos exatamente como o patch os deixa (conferido por `cmp`
depois de aplicar o patch num diretório descartável). `tsc --noEmit` sem erros nos dois arquivos.
Suíte completa não foi rodada de novo — os 52 do Codex continuam valendo, e este patch não sai do
helper de aviso.

## Ressalvas

- Com Detour ativo a investida anda pela crowd, não pelo `move` direto; a sonda continua sendo a
  melhor aproximação disponível e erra no máximo para menos em curva forçada pelo navmesh.
- Variante `giant` tem `scale 1.6`: o raio da sonda cresce junto, então a faixa dela corta mais
  cedo perto de parede. É coerente com o corpo que ela ocupa.
- Aviso em terreno irregular (quad plano em rampa) segue fora deste escopo, como combinado.
