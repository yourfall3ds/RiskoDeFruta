# Entrada da nave e revisão corporal — entrega

> **Revisão 2 (após o render e o QA de menu do Codex).** O que mudou está em
> [Revisão 2](#revisão-2--resposta-ao-qa-visual-da-nave), no fim do documento. O corpo original do
> relatório descreve a primeira entrega e continua válido fora dos pontos corrigidos lá.

Implementação de `docs/CLAUDE_INTRO_PRESENTATION_TASK.md`.

**Não usei navegador, Playwright, Puppeteer nem capturas. Nenhuma avaliação visual ou auditiva
abaixo é minha** — tudo que depende de ver e ouvir precisa do QA do Codex. Não houve stash, reset,
commit, push nem remoção de asset. `src/style.css` não foi tocado. `FarmWorld`, streaming, física,
`GroundMaterials`, `StochasticGroundPlugin` e os arquivos do estúdio de áudio também não.

---

## 1. Entrada cinematográfica completa — ENTREGUE E INTEGRADA

### A nave existe como asset real

`scripts/build-dropship-deck.py` (Blender 5.2, o mesmo pipeline de `build-farm-world.py` e
`build-alien-world.py`) gera `public/models/dropship-deck.glb`, **1,0 MB**, com seis peças nomeadas:

| Peça | Conteúdo | Material |
| --- | --- | --- |
| `Dropship deck` | chapa de 19,2 × 6,8 m, nove nervuras antiderrapantes e rodapés laterais | `corrugated_iron` |
| `Dropship structure` | quilha, subestrutura, sete quadras transversais, longarinas, escoras em diagonal, casco de revolução de 14,7 m, colar de pouso, dois propulsores com pilone | `rusty_painted_metal` |
| `Dropship railings` | montantes a cada 1,6 m nos **dois lados**, barra superior, barra média e painel — parando 1,9 m antes da boca | `rusty_painted_metal` |
| `Dropship hazard marks` | faixa de perigo no lábio da saída, duas galhas em diagonal e as tomadas dos propulsores | emissivo âmbar |
| `Dropship reactor lights` | anel do reator, dez luzes de casco, balizas da saída e bocais | emissivo menta |
| `Dropship canopy` | cabine sobre o casco | vidro verde metálico |

> **Desatualizado pela Revisão 2.** Os mapas difusos saíram, as cores viraram tinta grafite/oliva, a
> marcação de perigo deixou de ser emissiva e os propulsores viraram naceles. Tabela atual no fim.

Os mapas são Poly Haven CC0 **já presentes no repositório**, reduzidos a 1K dentro do script porque
o asset carrega antes do botão Jogar. Registro em `docs/ASSET_LICENSES.md`. Nenhum asset original
foi tocado e nada disso é primitiva de runtime — o jogo só carrega o GLB.

`tests/dropship-deck.test.ts` mede o GLB real: exige as seis peças, volume de nave (>6 m de altura,
>12 m de largura, >30 m de profundidade), pista simétrica em torno do eixo de corrida, piso na altura
dos pés, casco acima e estrutura abaixo, corrimão nos dois lados **acabando antes da saída**, e o
alinhamento em quatro yaws diferentes.

> Achado do alinhamento: o carregador glTF do Babylon aplica a troca de mão como rotação de 180° em Y
> **mais** `scaling.z = -1`, o que espelha o eixo X. O deck é autorado com a saída em +X e por isso a
> rotação correta é `yaw + π/2`, não `yaw − π/2`. O teste falhava com o sinal errado.

### O fluxo

`src/player/IntroSequence.ts` — máquina de estados pura:

`standby` → `run` (1,5 s) → `leap` (0,55 s) → `dive` (4 s) → `recover` (2 s) → `done`

- **Espera:** antes do Jogar o corpo fica de pé no deck, no clipe `Idle`, com respiração e balanço.
  O relógio da espera **continua** na corrida, então a pose não dá salto no instante do Jogar.
- **Corrida:** 9,2 m de pista com aceleração real (a segunda metade cobre mais chão que a primeira —
  testado), clipe `Run`, seis passos audíveis.
- **Salto:** 3,4 m à frente com arco de 1,3 m, clipe `JumpRise`, e o corpo **vira de cabeça para
  baixo ainda no ar** — a queda continua exatamente nessa orientação.
- **Mergulho, impacto e recuperação:** são o `MeteorArrival` original, com as correções dele
  preservadas. A entrada **integra**: o deck é ancorado no topo da própria trajetória do
  `MeteorArrival`, então a corrida e o salto terminam no ponto onde a queda começava antes. Não há
  teleporte em lugar nenhum — teste exige deslocamento contínuo (<5 m por quadro a 120 Hz) do deck
  até o chão, incluindo as trocas de fase.
- **Levantar antes do controle:** `holdsControl` fica ligado em **todos** os quadros da entrada.
  `PlayerScene.fixedUpdate` retorna cedo enquanto isso, e `scene.physicsEnabled` fica desligado.

Extraí de `MeteorArrival` apenas `DESCENT_START_HEIGHT` e `flightPoint()` (a mesma conta de antes,
agora reutilizável pelo deck). Comportamento e testes existentes intactos.

### Pés no piso — correção medida

> **Números desatualizados pela Revisão 2**: a medida correta é 9,2 cm e a nervura baixou para 8 mm.
> O raciocínio abaixo continua valendo; os valores atuais estão no fim do documento.

O clipe `Run` do `gunslinger.glb` afunda a sola **7,06 cm** abaixo da origem da raiz (medi a
superfície já deformada, quadro a quadro). No terreno isso passa; numa chapa de metal a poucos metros
da câmera o pé atravessaria o piso. A entrada compensa com `deckClearance()`, derivada da
profundidade medida por clipe mais os 4 cm da nervura, e a folga entra em 0,08 s — **mais rápido que
a mistura de clipes de 0,15 s**, senão a sola raspava a chapa nos primeiros quadros. A folga se
dissolve durante o salto, para o corpo chegar exatamente no topo da queda.

`tests/intro-presentation.test.ts` roda a entrada inteira no rig real e exige, quadro a quadro, que o
ponto mais baixo da malha deformada nunca fique abaixo da chapa e nunca flutue acima de 50 cm.

### Câmera

`IntroSequence.shot()` devolve posição, alvo, peso e abertura de corrida:

- **Espera:** três quartos à frente, corpo inteiro, deslocado para a direita do cartão do menu.
- **Corrida:** gira de frente para trás do ombro enquanto o corpo dispara, com a boca aberta no
  quadro. Alimenta `camera.sprintBlendTarget`, então o FOV abre junto.
- **Salto:** abre para a lateral e desce; o alvo escorrega do corpo para o **destino**, dando
  contexto de onde a queda vai terminar.
- **Queda:** perseguição atrás e acima.
- **Recuperação:** o `weight` cai sozinho a zero — a câmera volta ao jogo sem corte e **nunca fica
  presa** numa pose de cinemática. Testado: o último quadro tem peso < 0,02 e `shot()` devolve
  `undefined` no fim.

Teste garante também que o enquadramento nunca fica a menos de 1,4 m do corpo (câmera dentro do
personagem). Tremor curto no salto (`camera.impulse`) e no impacto (`camera.hurt`).

### Pular — controle acessível

Botão real `.intro-skip` ("PULAR ENTRADA · ENTER"): clicável, focável por Tab, com `aria-label`, mais
o atalho `Enter`. Durante a entrada o Enter pula; no portão ele joga — os dois estados nunca
coexistem.

O botão fica em `document.body`, **não** dentro de `#player-hud`, porque o HUD é `pointer-events:none`
e `body.arrival-in-progress` esconde todos os filhos dele — exatamente quando o controle precisa
existir. **O estilo é do Codex:** enquanto `.intro-skip` não tiver regra em `src/style.css`, um
posicionamento mínimo inline mantém o controle utilizável; havendo regra própria, nada é sobrescrito
(o código checa `getComputedStyle(...).position === 'static'` antes de aplicar).

Pular termina com o corpo **de pé no ponto de pouso**, com o impacto ainda ouvido e visto se ainda não
tinha acontecido, e libera o controle no mesmo instante. Testado em quatro momentos (0,4 s / 2,0 s /
3,4 s / 6,2 s): exatamente um impacto, nada suspenso, e pular de novo não emite som duplicado.

### Reset, cancelamento e co-op

- `restartAttempt()` chama `intro.reset()` e desliga a nave: a entrada volta a rodar inteira na
  tentativa seguinte.
- Morte, teleporte de QA, prévia de pose e visita a região chamam `intro.abort()` — nada de corpo
  suspenso, câmera presa ou controle liberado fora de hora.
- `dt` inválido (`NaN`, negativo, `Infinity`) e pausa (`dt=0`) congelam sem mover nada. Testado.
- **Co-op:** a entrada é apresentação pura. Teste prova que ela **não toca o `PlayerMotor`**
  (posição, velocidade, yaw e HP idênticos byte a byte depois da entrada inteira) e que duas
  instâncias alimentadas com os mesmos `dt` produzem exatamente os mesmos quadros. Enquanto
  `holdsControl` está ligado, `fixedUpdate` inteiro não roda: sem motor, sem colisão, sem
  `net.afterStep` e sem `net.reconcile`. É a mesma janela que a chegada original já tinha, ~2 s mais
  longa.
- **Degradação:** se o GLB da nave falhar, `checkReady` não trava o boot e `intro.start(false)` entra
  direto no mergulho original — correr no vazio seria pior. Testado.

### Som

Só gravações já licenciadas do manifest; nenhum arquivo novo, nenhum ruído sintético, e **nenhum
caminho de substituição do estúdio do usuário foi alterado**. Dois métodos novos em `RecordedAudio`:
`arrivalWind(strength)` (grupo `swish`) e `arrivalRise()` (`grass` + `heavy`). Passos no deck usam o
`footstep('concrete')` existente; o impacto reaproveita exatamente o bloco que já existia.

---

## 2. Poses de corpo a corpo e QA — ENTREGUE, com **dois bugs reais corrigidos**

### Revisão no F1

`src/animation/MeleeReview.ts` — relógio próprio, separado do `UnarmedCombat`, então a revisão não
consome cadência de itens, não marca alvos e não conta golpes. Produz **o mesmo**
`{stepId, phase, progress, heavy}` que o combate real entrega ao rig: o que o Codex vê é a curva que
o jogo toca.

Botões novos no F1:

| Botão | Efeito |
| --- | --- |
| `Corpo a corpo: revisar combo` | entra na revisão; guarda posição, yaw, pitch e a guarda das armas |
| `Corpo a corpo: etapa anterior / próxima etapa` | percorre as cinco etapas, com volta |
| `Corpo a corpo: pose de contato` | congela no **início da janela ativa**, onde a pose chega ao pico |
| `Corpo a corpo: −1 / +1 quadro` | passo a passo de 20 ms dentro da etapa, com limites |
| `Corpo a corpo: voltar ao ciclo` | volta a rodar |
| `Corpo a corpo: trocar ritmo` | 18% → 35% → 60% → 100% do tempo real, em ciclo |
| `Corpo a corpo: sair da revisão` | saída limpa |

Na revisão as **pistolas ficam guardadas de verdade** (`weapons.holstered`, que desativa os nós das
armas), o mundo e o áudio param, e a câmera é de **corpo inteiro** — três quartos à frente, a 4,2 m,
alvo no peito, longe o bastante para pés e punhos caberem no mesmo quadro (não é a aproximação das
cinemáticas). A saída restaura posição, mira e a guarda das armas exatamente como estavam.

O painel F1 mostra `Revisão corpo a corpo · 3/5 uppercut · CONTATO 2% · 18% do ritmo · CONGELADO ·
voltas 1 · armas guardadas`, para o revisor saber sempre o que está vendo.

### Bug 1 — acúmulo de rotação nos braços (confirmado e corrigido)

`CharacterVisual.update` aplicava o filtro de mira ao clipe de locomoção
(`lower = !aiming || ... || !upper(bone)`). Com `aiming` ligado — o caso normal do combate desarmado —
**braço, antebraço, mão e ombro não eram reescritos pelo clipe**, mas `applyFlutter` continuava
multiplicando a mesma junta quadro após quadro. A rotação acumulava.

Correção: com `meleePose` ativa o clipe reescreve **todas** as juntas antes da camada aditiva.

Verificado nos dois sentidos: com a correção revertida, o teste falha com **1,017 rad (58°)** de
divergência entre o caminho "mirando" e o caminho livre na mesma pose congelada; com a correção, a
diferença é < 0,02 rad.

### Bug 2 — desvio de yaw da raiz (confirmado e corrigido)

O amortecimento de orientação lia e reescrevia `root.rotation.y`. A pose de corpo a corpo soma yaw
**depois** disso, então o desvio virava entrada do amortecedor no quadro seguinte e crescia até o
regime permanente `yaw/k`, com `k` dependente da taxa de quadros.

Correção: o amortecedor passou a integrar um campo próprio (`facingYaw`) e a raiz recebe
`facingYaw + camada aditiva`. As camadas somam por cima e desaparecem junto com o golpe.

Verificado: com a correção revertida, o teste falha com **0,771 rad (44°)** de desvio; com a correção,
o desvio é o da própria pose (< 0,3 rad), estável ao longo do tempo e **igual a 60 e a 120 Hz**.

### Pernas não são ignoradas

Teste exige que todo osso citado por `MELEE_POSES` exista no rig **e** seja coberto pelo clipe de
locomoção (a base da camada aditiva). Ao longo de uma volta completa do combo, `Hips`, `RightArm`,
`LeftForeArm` e `RightUpLeg` se movem mais de 0,12 rad cada e **nenhuma junta passa de 180°**, que é o
sintoma do empilhamento.

### O que NÃO estou afirmando

**Não afirmo que a animação está aprovada.** Os testes provam que as curvas atingem os ossos certos,
com amplitude limitada e sem acúmulo. Se as poses *parecem* soco, gancho e chute — e se a guarda das
armas lê bem — é julgamento visual, e é do Codex.

---

## 3. Revisões pequenas de apresentação — ENTREGUES

### Relatório de morte com marcos da expedição

`AttemptSummary` ganhou `objectives` (modo, marcos concluídos, total, fase, chefe). `attemptScore()`
é pura e testada:

- 100/abate + 75/item + 1/segundo vivo — **a fórmula antiga, intacta**.
- 500 por **marco concluído** na expedição; no `?mode=horde` continua sendo 500 por horda vencida.
- 1.200 por estágio já atravessado e 2.500 por derrotar a Praga Alfa.

A linha `HORDAS VENCIDAS` vira `MARCOS CONCLUÍDOS · 3 / 4` na expedição e uma linha
`ESTÁGIO ALCANÇADO` foi acrescentada. O subtítulo diz onde a tentativa parou ("3 de 4 marcos",
"diante da Praga Alfa", "fenda aberta", "fenda atravessada"). O `title` do bloco de score traz o
detalhamento por origem. **Estrutura `.defeat-report` / `.defeat-score` / `<dl><div><dt><dd>` e o CSS
do Codex preservados.** Modo horda legado sem nenhuma mudança de comportamento.

### Copy do TAB

`modeBrief(expedition, hordeMode)` (exportada e testada) escreve o texto do modo realmente ativo.
"Chefes a cada cinco ondas" agora só aparece no modo horda; a expedição fala de marcos, permanência
na área e Praga Alfa.

### `WeatherPresentation._wasDisposed`

A verificação lia `_wasDisposed`, que **não existe** no `Material` do Babylon instalado: era sempre
`undefined`, nenhum registro saía do `Map` forte e a apresentação retinha os materiais de **toda**
região descartada pelo streaming. Agora o registro sai pelo `onDisposeObservable` do próprio
material, e o `dispose()` solta os observadores além de restaurar os valores originais.
`tests/weather-presentation.test.ts` prova a liberação e a restauração.

### Chuva legível

Causa provável de as gotas quase não aparecerem: elas nasciam **14–18 m acima** da câmera com
gravidade −52 e potência 14–22. Com vida de 0,5–0,95 s, chegavam à altura do enquadramento já no fim
da vida, quando `colorDead` as levou a alpha 0. Correções:

- caixa de emissão baixada para 4–11 m e gravidade para −34, com potência 8–14: a gota cruza o quadro
  no **meio** da vida, ainda opaca;
- alpha de 0,5/0,35 para 0,72/0,5; tamanho de 0,035–0,07 para 0,09–0,17; esticamento 6–10;
- textura dedicada `/textures/weather-rain.svg` no lugar do `expedition-beam.svg` (o halo largo do
  totem deixava a chuva num borrão pálido) e `/textures/weather-mote.svg` no pólen;
- taxa de emissão de 80% para 62% da capacidade, para **não virar cortina opaca**.

A noite não foi tocada.

### Grupo `rain` do manifest

**Já existe** — `public/audio/foley-manifest.json` traz `"rain": ["/audio/weather/rain-ylmir-01.ogg"]`,
com licença em `docs/licenses/rain-ylmir.md`. O gancho `WeatherPresentation.onRain →
WeaponAudio.ambientRain` foi **preservado sem mudança**; não inventei gravação nem troquei por
respingo de passo. Única correção: `dispose()` agora manda intensidade 0 antes de soltar o gancho,
senão o laço continuava tocando depois de a apresentação sair de cena.

---

## Posições e controles de QA para o Codex

### Entrada

1. Abrir o jogo. Antes de clicar em Jogar, o corpo já está **de pé no deck da nave**, com o casco
   atrás, corrimão nas laterais e a boca aberta à frente. Conferir: silhueta de nave, não laje solta.
2. Clicar em **PRESS START · JOGAR**. Acompanhar corrida → salto → mergulho → impacto → levantar.
   O controle só volta quando o corpo está de pé. ~8,0 s no total.
3. Durante a entrada, o botão **PULAR ENTRADA** (canto inferior direito) e a tecla **Enter** encerram
   na hora, com o corpo de pé no chão.
4. F1 → **Entrada: reencenar da nave** repete a entrada inteira sem mexer no estágio nem no
   inventário. F1 → **Entrada: pular** faz o mesmo que o botão.
5. F1 mostra `Entrada <fase> · deck pronto · controle RETIDO/livre`.
6. Reiniciar pelo relatório de morte deve trazer a nave de volta do zero.
7. Pausar com Escape no meio da entrada congela tudo; continuar retoma de onde parou.

**`.intro-skip` precisa de estilo do Codex** em `src/style.css`. O posicionamento inline atual é
provisório e se desliga sozinho quando existir regra própria.

### Revisão do combo

1. F1 → **Corpo a corpo: revisar combo**. O mundo para, as pistolas somem e a câmera mostra o corpo
   inteiro.
2. **trocar ritmo** para ver o mesmo golpe a 18% e a 100%.
3. **pose de contato** + **±1 quadro** para inspecionar antecipação, contato e recuperação de cada
   etapa (direita, esquerda, gancho, chute frontal, giro) com **etapa anterior/próxima**.
4. O painel F1 mostra etapa, fase, progresso, ritmo e a guarda das armas.
5. **sair da revisão** devolve posição, mira e as pistolas como estavam.

### Clima

F1 → **Clima: chuva** para julgar a legibilidade das gotas. **Clima: noite** deve continuar como
estava (não mexi).

---

## Validação desta sessão

| Verificação | Resultado |
| --- | --- |
| `npx vitest run` | **627 aprovados / 633** |
| `npm run typecheck` | aprovado nos meus arquivos (ver ressalva) |
| `npm run server:typecheck` | aprovado |
| `npx vite build` + `scripts/link-public.mjs` | aprovado — `dist/index.html`, `dist/audio-lab.html` e `dist/models/dropship-deck.glb` (1,0 MB) |

As 6 falhas são a **linha de base já documentada**: `tests/combat-assets.test.ts` (5) e
`tests/hordes-arsenal-catalog.test.ts` (1) leem GLBs originais em `assets/` e `art/processed/`, que
não estão neste repositório.

**Ressalva de coordenação:** no fechamento, `npm run typecheck` acusa `server/FarmSimulation.ts`
contra `TerrainCollisionData` de `src/world/terrain/WorldTerrain.ts`. Esses arquivos são do Claude de
terreno/vegetação e estavam sendo editados nesse minuto (mtime posterior à minha última edição).
**Nenhum arquivo meu aparece no erro** — verifiquei listando os arquivos citados pelo `tsc`. Meu
typecheck estava limpo às 21:04, antes daquela gravação.

Suítes novas: `intro-sequence` (13), `intro-presentation` (3), `dropship-deck` (4),
`melee-review` (5), `weather-presentation` (3), `attempt-report` (4).

---

## Arquivos

**Novos:** `scripts/build-dropship-deck.py`, `public/models/dropship-deck.glb`,
`src/player/IntroSequence.ts`, `src/world/DropshipDeck.ts`, `src/animation/MeleeReview.ts`,
`tests/intro-sequence.test.ts`, `tests/intro-presentation.test.ts`, `tests/dropship-deck.test.ts`,
`tests/melee-review.test.ts`, `tests/weather-presentation.test.ts`, `tests/attempt-report.test.ts`.

**Editados:** `src/player/MeteorArrival.ts` (só extração de `DESCENT_START_HEIGHT`/`flightPoint`),
`src/animation/CharacterVisual.ts`, `src/game/PlayerScene.ts`, `src/ui/PlayerHUD.ts`,
`src/ui/CombatHUD.ts`, `src/debug/DebugOverlay.ts`, `src/world/WeatherPresentation.ts`,
`src/run/AttemptSummary.ts`, `src/audio/RecordedAudio.ts` (dois métodos novos, sem tocar nos
controles de substituição), `docs/ASSET_LICENSES.md`.

**Não tocados:** `src/style.css`, `FarmWorld`, streaming, física, `GroundMaterials`,
`StochasticGroundPlugin`, `EnemyAudioLab`/`Overrides`/`Catalog`, `src/world/terrain/*`, `server/*` e
qualquer asset original.

---

## Limitações honestas

- **Zero QA visual e auditivo meu.** A composição da nave, a leitura da corrida e do mergulho, a
  aparência das poses de golpe, o timbre dos sons novos e a legibilidade da chuva dependem do Codex.
- **Sem medição de desempenho.** O GLB da nave tem 1,0 MB e ~18 mil vértices, e carrega antes do
  Jogar; não medi o impacto no tempo de boot nem no frame.
- A folga do pé no deck vem de uma medida estática do clipe `Run` no rig. Se o clipe mudar, a
  constante `CLIP_SOLE` precisa ser remedida — o teste de superfície avisa se sair da faixa.
- A entrada completa leva ~8,0 s. Se o Codex achar longo, o ajuste é em `INTRO_RUN_SECONDS` e
  `INTRO_LEAP_SECONDS`; o mergulho em si é o `MeteorArrival` original e não mexi nele.
- Em co-op, a janela sem simulação local cresceu de ~6 s para ~8 s. Não é divergência (nada é
  enviado, nada é previsto), mas é tempo a mais parado.

---

# Revisão 2 — resposta ao QA visual da nave

Base: `docs/VISUAL_FEEDBACK_2026-09-15.md`, seção “Revisão visual real da nave — render do modelo”
(`.temp/dropship-review.png`, Cycles), mais o relato do menu no navegador: casco e corrimão com
aspecto de **madeira listrada** e **pés flutuando sobre o deck**.

**Continuo sem navegador.** Nada aqui foi visto por mim. O que eu podia medir sem ver, eu medi: as
cores e texturas agora são lidas do glTF exportado, e a altura da sola é medida quadro a quadro na
malha já deformada do rig real.

## 1. Madeira listrada → metal pintado grafite/oliva

**Causa.** Eu ligava o `Diffuse.jpg` de `rusty_painted_metal` / `corrugated_iron` no Base Color e
multiplicava por uma cor. O exportador glTF traduz isso como `baseColorFactor × baseColorTexture`,
então quem mandava na aparência era o mapa — que é marrom e tem veios longos. No disco de 14,7 m,
com UV cilíndrica esticada, isso lê como tábua.

**Correção.** Os mapas difusos **saíram do asset**. A cor agora é só `baseColorFactor`, tinta
industrial chapada, e o desgaste vem do normal e da rugosidade:

| Material | Cor exportada | Metálico | Rugosidade |
| --- | --- | --- | --- |
| `Dropship hull graphite` | sRGB(66,70,74) grafite frio | 0,78 | 0,44 × mapa |
| `Dropship deck olive` | sRGB(89,93,73) oliva | 0,60 | 0,58 × mapa |
| `Dropship rail steel` | sRGB(140,147,143) aço claro | 0,85 | 0,35 × mapa |

O canal verde do `arm.jpg` entra na rugosidade através de um MULTIPLY, que o exportador traduz como
`roughnessFactor` — sem ele o mapa mandava sozinho e o grafite saía fosco de tinta fresca. O normal
continua, com força reduzida. Também troquei a UV das peças de revolução para **comprimento de arco
real** (o `atan2×2` antigo espremia o mapa em faixas no disco).

`tests/dropship-deck.test.ts` lê os materiais do GLB real e exige: **nenhum** `albedoTexture` no
casco, no deck e no corrimão; `bumpTexture` e `metallicTexture` presentes; grafite dessaturado com
azul nunca abaixo do vermelho (a assinatura do marrom); oliva com verde acima do vermelho e azul no
fundo.

## 2. Boca branca acesa → marcação de perigo fosca

A placa emissiva de 1,5 × 6,8 m que cobria a saída foi **removida**. No lugar: 14 blocos alternados
amarelo/preto de 0,45 m, **sem emissão**, mais duas galhas em diagonal, todos no mesmo plano do
piso. A luz da boca são só as guias menta: as duas balizas nos montantes e duas tiras rentes de
0,7 m.

Verificado no GLB: `Dropship hazard yellow` sRGB(219,168,25) e `Dropship hazard black` sRGB(19,19,20)
com `emissiveFactor` **[0,0,0]**; e o teste exige que **exatamente um** material da nave seja
emissivo — `Dropship reactor glow`, verde, com o verde acima do triplo do vermelho.

## 3. Escoras penduradas → viga entre dois pontos reais

As escoras eram caixas giradas no espaço; as pontas terminavam no ar. Agora existe um helper
`strut(a, b, …)` que constrói a viga **entre dois pontos dados**, com cartela nas duas
extremidades. As quatro escoras nascem dentro da longarina lateral e terminam dentro da quilha
central.

Isso virou **asserção de build** no próprio script: cada ponta é testada contra a caixa de todas as
outras peças e a exportação falha com “escora com a ponta … pendurada no ar” se alguma ficar solta.

## 4. Caixas com face acesa → naceles com aro e recesso

Os propulsores deixaram de ser caixas. Cada um é uma **nacele de revolução** deitada no eixo de voo,
com bico, casca, flange traseira, aro e uma **cavidade de 1,1 m** cavada a partir do bocal. O disco
luminoso fica **dentro** da cavidade, não na face. Há ainda um anel de bocal menta e uma faixa
escura de tomada rente à casca (anel, não caixa — não tem como espetar para fora).

Também virou asserção de build: o disco precisa estar atrás do aro e o recesso precisa ter mais de
0,8 m, senão a exportação falha.

## 5. Pés flutuando sobre o deck

**Duas causas somadas.**

1. As nervuras do piso tinham **8,5 cm** de altura — o próprio Codex mediu “~.1 m acima do deck”.
2. A constante `DECK_TREAD_HEIGHT` no código estava em 4 cm e não correspondia a nada: nem à chapa,
   nem ao topo da nervura.

**Correção.** As nervuras baixaram para **8 mm** e a faixa de perigo e as guias da boca foram para o
mesmo plano — o script **assere** que nenhuma peça do piso passa desses 8 mm. `DECK_TREAD_HEIGHT`
virou 0,008 e agora significa exatamente “o plano onde a sola encosta”.

Remedi a profundidade da sola rodando a entrada de verdade, quadro a quadro, em vez de amostrar o
clipe isolado: o pior quadro do `Run` afunda **9,2 cm**, não os 7,1 cm que a amostragem uniforme
tinha indicado — a mistura de estados e a cadência real caem entre as amostras. `CLIP_SOLE.Run` foi
corrigido.

Medidas depois da correção, na malha deformada do rig real:

| Fase | Sola em relação à chapa |
| --- | --- |
| Espera (menu) | **+5,8 mm a +8,9 mm** — em cima do friso, sem flutuar |
| Corrida | **+0,6 mm** no pior quadro, +20,6 cm no alto da passada |

`tests/intro-presentation.test.ts` ganhou um teste dedicado à pose do menu, que é onde o defeito foi
visto, e refaz essas medidas a cada execução.

## 6. Barra de carregamento a 100% sobre o menu pronto

`ready()` tirava a classe `.loading` do portão, mas a classe só escondia controles e opções — o
bloco `.loading-progress` continuava desenhado, cheio, por cima do menu. Agora `ready()` esconde o
bloco, e um sinalizador impede que um carregamento tardio o traga de volta. **Nenhum CSS foi
tocado**: o elemento usa o atributo `hidden`, e `.loading-progress` não declara `display`.

## Estado do asset

`public/models/dropship-deck.glb` — **1,16 MB**, 26.984 vértices, 7 peças, 4 imagens (só normal e
ARM; nenhum mapa de cor). Envelope: 33,9 m de profundidade × 21,0 m de largura × 8,5 m de altura.
Fonte preservada em `scripts/build-dropship-deck.py` e `art/blender/Dropship_Insertion_Deck.blend`.

## Validação desta revisão

| Verificação | Resultado |
| --- | --- |
| Reexportação do GLB | aprovada, com as 6 asserções de build passando |
| `npm run typecheck` / `server:typecheck` | aprovados |
| Suítes focadas (11 arquivos) | **70 aprovados** |
| `npm run build` | aprovado — `dist/models/dropship-deck.glb` presente |
| `npx vitest run` | 654 aprovados / 665 |

Das 11 falhas: **6 são a linha de base já documentada** (`combat-assets` ×5 e
`hordes-arsenal-catalog` ×1, que leem GLBs em `assets/` e `art/processed/`, fora do repositório). As
outras **5 são de trabalhos em curso de outros agentes, editados nestes minutos**:
`tests/fruit-fragments.test.ts` (3) e `tests/terrain-relief.test.ts` (2). Nenhum desses arquivos
referencia qualquer arquivo meu — conferi por busca direta. Não toquei em `EnemyAudioCatalog`, no
manifest de áudio, em assets novos de inimigo nem em nada de terreno.

## O que ainda depende do Codex

- **Nova renderização e QA no jogo.** Não vi o resultado. Grafite/oliva, a leitura do recesso do
  motor, a marcação amarelo/preto e o contato do pé no menu precisam dos seus olhos.
- **`.intro-skip` continua sem estilo seu** em `src/style.css`; o posicionamento inline provisório se
  desliga sozinho quando existir regra própria.
- As cores de tinta são um chute informado (grafite frio, oliva acinzentado). Se quiser outro par,
  são duas linhas no topo do script — `HULL` e `DECK` em `painted(...)`.
- Não medi desempenho. O asset cresceu de 1,02 MB / 18.016 vértices para 1,16 MB / 26.984 (as
  naceles), e continua carregando antes do botão Jogar.
