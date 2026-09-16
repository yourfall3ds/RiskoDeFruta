# Custo de DOM da horda no HUD de combate — entrega

Tarefa: `docs/CLAUDE_HUD_PERF_TASK.md`. Escopo executado: **somente** `src/ui/CombatHUD.ts` e testes/fixture
próprios. Nada de CSS, `PlayerHUD`, `PlayerScene`, mundo, animação, áudio, commit, stash, reset ou browser.

## O que estava caro

`RunHUD.update` roda a cada frame e é liberada ~10×/s (portão de `.1 s` de tempo de run, preservado).
A cada liberação a versão anterior:

1. fazia **18 `querySelector` no HUD inteiro** por atualização (mais dois condicionais) — um por painel,
   mais os internos de `.run-xp` e `.run-boss`;
2. atribuía `innerHTML` a **até 14 painéis**, mesmo quando o texto era byte a byte idêntico (relógio parado,
   missão parada, contrato parado, painel TAB fechado e inalterado);
3. reconstruía o painel TAB inteiro — incluindo uma busca linear em `ITEMS` (92 itens) por item do
   inventário — 10×/s, com o painel fechado;
4. reconstruía por `innerHTML` **todos os marcadores projetados**: até 12 barras de vida (4 nós cada = 48
   nós), até 32 números de dano e as caixas de suprimento. Todo nó destruído e recriado, 10×/s;
5. selecionava as 12 barras com `filter().sort()`, alocando um array por atualização e recalculando
   `Vector3.DistanceSquared` **dentro do comparador** — O(n log n) distâncias para ficar com doze;
6. alocava `Matrix.Identity()` e um `Vector3` novo por marcador projetado;
7. usava `insertAdjacentHTML('beforeend')` no painel de contrato, o que impedia qualquer cache do painel.

## O que mudou

Tudo em `src/ui/CombatHUD.ts`:

- **Referências resolvidas uma vez** no construtor. Nenhum `querySelector` durante a atualização.
- **`HtmlSlot`**: cada painel lembra o último HTML escrito e só escreve quando o texto muda de fato.
  Troca um parse de HTML por uma comparação de string.
- **`MarkerPool`**: barras de vida, números de dano e caixas de suprimento viram nós persistentes. Cada
  atualização só mexe em `left`/`top`/`opacity`/`width`/`className`/`aria-label`; os marcadores que sobram
  vão para `display:none` e voltam a ser usados no quadro seguinte. O pool para no pico real de marcadores
  simultâneos (`swarm.labels` tem teto 32, barras têm teto 12, suprimentos param no número de baús), então
  não cresce indefinidamente — há teste para isso.
- **Escritas guardadas**: helpers `css`/`text`/`attr`/`classes`/`shown` comparam antes de escrever.
- **Painel TAB por chave**: só é reconstruído quando nível, modo, atributos ou inventário mudam. A busca em
  `ITEMS` some do caminho quente.
- **Seleção das 12 barras por inserção** num buffer reaproveitado: cada ator é medido **uma** vez. Mesmo
  critério de antes (recorte 2D em 28 m, ordem por distância 3D à câmera), mesma ordem no DOM.
- **Projeção sem alocação**: `Vector3.ProjectToRef` com matriz identidade e `Vector3` de rascunho fixos.
- **Dica de recompensa concatenada** no mesmo `innerHTML` do contrato — DOM idêntico ao do
  `insertAdjacentHTML` anterior, e o painel volta a caber numa comparação só.
- **Percentuais com 2 casas** (`pct`): 0,01% da tela é menos de meio pixel em 4K e 0,01% de uma barra de
  118px é invisível; evita reescrever `style` por ruído de ponto flutuante.

### O que foi preservado de propósito

Aparência, classes, ordem dos nós e semântica: as barras continuam `<div class="enemy-health variant-X
[damaged]" role="img" aria-label="…">` com uma trilha `.health-trail` e o preenchimento; o nome e os números
continuam só no rótulo acessível. Teto de 12 barras próximas, raio de 28 m, posições em **porcentagem**
(responsivo), painéis `hidden`, atalho TAB, `setVisible`, e o portão de `.1 s` — **a cadência das barras não
foi reduzida**. `dispose()` continua abortando o ouvinte de teclado e removendo o HUD inteiro. `modeBrief`
segue exportado e no mesmo lugar; a organização por painel (`renderStats`, `renderExpedition`,
`expeditionMission`) ficou mais separada justamente para a tarefa do cálice trocar copy e rota sem mexer no
caminho quente.

## Medição

Não há `jsdom`/`happy-dom` no projeto e o pedido era não trazer dependência pesada. `tests/support/counting-dom.ts`
é um DOM mínimo escrito à mão (com parse de HTML de verdade, senão `querySelector` não acharia nada) que
**conta** escritas e nós. `tests/hud-dom-churn.test.ts` roda o `RunHUD` real sobre ele, com uma câmera
determinística feita com a matemática real do Babylon (`Matrix.LookAtLH` + `PerspectiveFovLH`), sem engine.

`npx vitest run tests/hud-dom-churn.test.ts` → **11 testes, todos passando**. Saída da medição:

```
[hud-dom] 30 atualizações com 12 barras + câmera e pragas em movimento
  nós criados/parseados agora: 12 (0.4/atualização)
  só as barras, pelo markup anterior: 1440 (48/atualização)
  escritas de DOM agora: 589 (19.6/atualização: posição das barras, dos rótulos e da bússola)
```

Os 12 nós dos 30 quadros são as viradas de segundo do relógio; nenhum marcador é recriado.

O que os testes provam, item a item:

| Teste | Garante |
|---|---|
| “monta o HUD uma vez e não escreve nada enquanto nada muda” | 9 atualizações seguidas com estado idêntico ⇒ **zero** escritas e **zero** nós, em todos os contadores |
| “em dez segundos parados só o relógio é reescrito” | 100 atualizações ⇒ exatamente 10 `innerHTML` (as viradas de segundo) e 0 de todo o resto |
| “dano numa praga muda largura e rótulo da barra” | tomar dano ⇒ exatamente **1** escrita de `style` e **1** de atributo, 0 nós, 0 `innerHTML`; e o valor certo chega ao DOM |
| “girar a câmera reposiciona as barras” | as 12 barras andam sem criar nó e sem reescrever HTML de marcador |
| “o pool não vaza” | horda 20↔0 sessenta vezes ⇒ 0 nós novos, 12 marcadores no pool, e as barras somem por `display:none` e voltam |
| “números de dano e caixas de suprimento reusam os mesmos nós” | rótulos que expiram e baús usados apagam o nó em vez de destruí-lo; o texto dos remanescentes está certo |
| “reescreve painéis quando os valores mudam de verdade” | inventário, toast, chefe, XP e a dica de recompensa (último filho do contrato) atualizam corretamente |
| “o painel TAB só é reconstruído quando …” | fica parado enquanto nada muda; acompanha modo, nível e atributos quando mudam |
| “TAB alterna o painel e dispose solta o ouvinte” | atalho funciona, `dispose()` zera ouvintes e tira o HUD do `body` |
| “recomeço de tentativa com o tempo zerado” | `run.reset()` volta a desenhar em vez de travar no portão de tempo, e as barras antigas somem |

### Limites honestos

Isto **não é FPS** e não deve ser vendido como tal. O DOM de contagem não faz layout, style recalc, composite
nem paint — mede quantas escritas e quantos nós o HUD produz por atualização, que é o eixo que o HUD controla.
O `.temp/horde-perf-browser-baseline.md` é um snapshot com outros processos rodando, não um benchmark
controlado: nele o crescimento da horda pesa mais em *presentation*/renderer do que em IA, e nada aqui mede
GPU, draw calls ou skinning. **Não há número de FPS medido depois desta mudança.** O ganho comprovado é de
churn de DOM; se o HUD não era o gargalo na máquina do usuário, a diferença em FPS pode ser pequena — quem
fecha essa conta é o QA de browser.

## Fixture para o QA de browser (Codex)

`docs/hud-perf-fixture.html` — página isolada, servida pelo Vite (`npm run dev` → `/docs/hud-perf-fixture.html`).
Nenhum browser foi iniciado aqui. Ela instancia o `RunHUD` real com uma câmera determinística e controles
visíveis: número de pragas, vida, giro da câmera, números de dano, baús, itens no inventário, modo horda,
expedição, Praga Alfa, “1 atualização” passo a passo, “zerar contadores” e “simular morte + retry”. Nenhuma
posição usa `Math.random`; com “Animar” desligado o HUD só se mexe quando você mexe.

Leitura: **“Nós dentro de `#run-hud`”** é a métrica central — deve subir até o pico de marcadores
simultâneos e **parar**. Se voltar a crescer a cada atualização, o pool regrediu. “Mutações de DOM/s” vem de
um `MutationObserver` em subárvore. A fixture também não mede FPS: não há cena 3D nela.

Sugestão de roteiro: 40 pragas + animação ligada → conferir que os nós estabilizam; arrastar a vida para ver
a barra e o rótulo acessível acompanharem; ligar expedição e horda para conferir rota, ressonância e a dica
de recompensa dentro do painel de contrato; “simular morte + retry” para conferir que o HUD volta limpo.

## Estado

- `npm run typecheck` (`tsc --noEmit`) — **limpo**.
- `npx vitest run tests/hud-dom-churn.test.ts` — 11/11.
- `npx vitest run tests/attempt-report.test.ts` (única suíte pré-existente que importa `CombatHUD`) — 4/4.
- `npx vitest run` (suíte inteira, com outros agentes editando em paralelo) — **724 passaram, 6 falharam**.
  As 6 são `ENOENT` de GLB em `assets/` e `art/processed/`, que não existem neste clone
  (`tests/combat-assets.test.ts`, `tests/hordes-arsenal-catalog.test.ts`); nenhuma toca o HUD.

Arquivos tocados: `src/ui/CombatHUD.ts` (reescrito), `tests/hud-dom-churn.test.ts` (novo),
`tests/support/counting-dom.ts` (novo), `docs/hud-perf-fixture.html` (novo), este documento.
Nenhum outro arquivo do repositório foi alterado.
