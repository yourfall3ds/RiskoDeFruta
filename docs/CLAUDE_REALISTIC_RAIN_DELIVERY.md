# Chuva refeita — entrega

Implementação de `docs/CLAUDE_REALISTIC_RAIN_TASK.md`, depois de o usuário reprovar a versão
anterior: *"A chuva tá procedural e não uma chuva realista."*

**Não usei navegador, Playwright, Puppeteer nem capturas. Nenhuma avaliação visual abaixo é minha** —
tudo que depende de ver precisa do QA do Codex. Sem commit, stash, reset ou push. Não toquei
`PlayerScene`, `EnemySwarm`, terreno, `CharacterVisual`, áudio nem CSS.

---

## O diagnóstico

A versão reprovada era **uma** caixa de 900 partículas em volta da câmera, todas com o mesmo ícone
SVG geométrico, a mesma escala, a mesma opacidade e a mesma velocidade aparente, mais um
escurecimento global do chão. Quatro coisas faziam o olho ler "efeito", não "chuva":

1. **Um único desenho repetido.** Chuva real não tem duas gotas iguais.
2. **Zero profundidade.** Sem perto, meio e longe, tudo cai no mesmo plano mental.
3. **Zero interação com o mundo.** A gota atravessava o chão sem acontecer nada.
4. **Umidade sem memória.** O chão secava no mesmo ritmo em que a nuvem passava.

Cada um desses pontos tem um módulo correspondente abaixo. O ganho **não** veio de aumentar
contagem nem brilho: o orçamento somado hoje é **menor** que o anterior.

---

## 1. Atlas autorais, com procedência honesta

`scripts/build-rain-atlas.py` (numpy dentro do Blender, o mesmo Blender dos GLBs do projeto) gera
três PNG RGBA em `public/textures/weather/`. **O script é a fonte editável** — não existe binário
sem origem no repositório.

| Arquivo | Conteúdo | Tamanho |
| --- | --- | --- |
| `rain-streaks.png` | 512² · 4×4 células · **16 rastros distintos** | 21,6 KB |
| `rain-splash.png` | 512² · 4×4 células · flipbook de coroa de respingo | 98,6 KB |
| `rain-haze.png` | 256² · véu distante, hastes fracas | 29,7 KB |

**Isto não é fotografia e não finge ser.** O que separa este atlas do ícone anterior é a variedade:
cada rastro sorteia comprimento, espessura, afinamento, ondulação lateral e *encordoamento* — a
modulação longitudinal que faz o rastro ler como gotas emendadas, que é o que uma câmera registra.
Dez rastros contínuos, quatro quebrados (com falhas ao longo do risco) e duas gotas grandes de
primeiro plano com cabeça redonda. O RGB é branco: a cor vem do material, como no feixe dos marcos.

O respingo é um flipbook de verdade — ponto de impacto, coluna central, coroa que **abre entalhada**
(não um anel perfeito) e dez gotículas saindo em ângulos e velocidades diferentes, tudo sumindo no
fim.

Verificação, em `tests/rain-atlas.test.ts`, que **decodifica os PNG de verdade** (leitor RGBA8 com
`zlib`, sem dependência nova) e olha os pixels:

- as 16 células existem, têm tinta e a maior tem >2,5× a tinta da menor;
- **todos os 120 pares de células diferem pixel a pixel** — é a afirmação que importa: banco de
  variações, não um ícone repetido;
- RGB é branco em 100% dos pixels com alfa;
- quase nada é totalmente opaco (<0,2%), senão a borda volta a ler como recorte;
- o flipbook do respingo abre no meio e cai para <35% do pico no fim, e a coroa **cresce** (raio do
  quadro 8 > raio do quadro 2);
- o véu é fraco (alfa médio <0,14, quase nenhum pixel forte) e tem **variação horizontal maior que
  vertical**, ou seja, são hastes — não ruído.

O próprio script também assere isso na geração e **relê o arquivo gravado** para conferir o alfa
médio, em vez de confiar no buffer em memória.

---

## 2. Profundidade em três camadas — `src/world/rain/RainLayers.ts`

| Camada | Teto | Raio | Tamanho | Vida | Queda | Alfa | Papel |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `near` | 170 | 5,5 m | 0,16–0,30 | 0,26–0,44 s | 23 m/s | 0,50 | poucas gotas grandes, quase na lente |
| `mid` | 390 | 17 m | 0,055–0,11 | 0,55–0,95 s | 18 m/s | 0,40 | o corpo do aguaceiro |
| `far` | 260 | 44 m | 1,1–2,6 | 2,4–4,2 s | 5,5 m/s | 0,11 | véu distante |

**820 gotas contra as 900 anteriores.** O véu distante é um cartão *no mundo*, com paralaxe, e não
um quad de tela cheia — a tarefa proíbe folha chapada como substituto, e não há nenhuma.

As camadas **não acendem juntas**: `layerIntensity` faz o véu entrar primeiro (o horizonte fecha
antes de a chuva chegar em cima), o corpo depois e as gotas de perto só com o aguaceiro formado.
Sem isso, 800 partículas apareceriam de uma vez na transição.

`near` e `mid` usam `BILLBOARDMODE_STRETCHED`: o cartão se estica ao longo da **velocidade**, então
é o vento que inclina o rastro, e não um ângulo fixo escrito à mão.

Teste exige separação real de escala, raio, opacidade, queda e vida, entrada monotônica sem degrau,
e — importante para não piscar — que **nenhuma camada emita mais do que o próprio teto aguenta**
(`emitRate × vida média < 90% da capacidade`). Foi por isso que `mid` e `far` baixaram de 520/95
para 455/66: nas medidas originais as duas saturavam e reciclavam partícula viva.

---

## 3. Vento coerente — `src/world/rain/RainWind.ts`

Uma função pura alimenta **todas** as camadas e o respingo. Antes cada sistema derivava sozinho e a
chuva lia como três efeitos sobrepostos.

Direção com volta lenta (47 s) mais uma segunda harmônica, rajada com dois períodos (7,4 s e 3,0 s).
Contínuo por construção, limitado a 5,8 m/s e determinístico — o mesmo relógio dá o mesmo vento, o
que também vale para dois clientes de co-op.

Teste percorre **10 minutos simulados a 60 Hz** exigindo: nenhum salto de direção (>0,02) ou de
velocidade (>0,06) entre quadros, direção sempre unitária, velocidade dentro do teto, passagem pelos
quatro quadrantes ao longo de uma volta, e — nas três camadas — a **mesma direção** com forças
diferentes (o véu deriva menos que a gota de perto). A gota sempre cai: a deriva horizontal nunca
supera a componente vertical.

---

## 4. Respingos em superfície REAL — `src/world/rain/RainSurface.ts`

O problema é custo: um respingo por gota seriam centenas de raycasts por quadro. Aqui o respingo é
**amostrado**, não derivado das gotas.

- Um **orçamento fixo de 46 consultas/segundo** sorteia colunas num raio de 14 m (distribuição por
  raiz da uniforme, então mais respingos perto, onde são lidos).
- Cada coluna pergunta ao mundo `surfaceAt(x, z)` e a coroa vai **no topo daquela coluna**.
- Medido com chuva cheia: **27,6 consultas/s**, 24 respingos/s, teto de 56 vivos.

Consequências que o QA vai notar:

- **O respingo cai no telhado, não no piso debaixo dele.** É por isso que não aparece coroa dentro
  de um interior coberto.
- **Rampa íngreme não ganha coroa** (`normal.y < 0,82`): a água escorre, não espirra.
- **Vazio entre ilhas não ganha coroa**, e telhado muito acima da câmera também não — estaria fora
  de quadro e não vale gastar o efeito.
- **Sem `RainWorldQuery` ligada, não existe respingo nenhum.** Não inventei plano de chão falso.

A coroa é um cartão **deitado no chão** (`isBillboardBased=false` com direção para cima), posicionado
um a um pela fila do amostrador via `startPositionFunction` — nunca no emissor genérico.

Teste (13 casos) cobre: posição exatamente na altura devolvida pelo mundo, raio, escala por
distância, orçamento de consultas contra o número real de chamadas, telhado, vazio, rampa, cobertura,
`insideSolid`, teto por quadro mesmo com engasgo de 250 ms, `dt` inválido e `reset`.

---

## 5. Supressão sob cobertura

Uma consulta a cada 0,28 s pergunta se há superfície acima da cabeça (`SHELTER_HEAD_ROOM` 1,6 m) ou
se a câmera está dentro de sólido. Estando coberta:

- `near` e `mid` **param** — não chove na sua cara dentro do celeiro;
- `far` **continua** — a chuva lá fora não parou, e some o véu seria pior;
- o respingo cessa junto, e o custo cai para a consulta de cobertura (≈3,6/s).

Voltando ao aberto, tudo retorna sozinho. Testado nos dois sentidos, com a taxa de emissão de volta
ao valor exato de antes.

---

## 6. Molhado que seca devagar — `src/world/rain/WetnessField.ts`

Duas correções sobre o `state.wetness` aplicado direto:

1. **Histerese.** Molhar leva ~11 s, secar leva ~110 s. Depois que a chuva passa o chão **continua**
   escuro e liso por um tempo — é o rastro que a versão anterior não tinha.
2. **Variação por material.** A absorvência sai de um hash **estável** do nome (terra e folhagem
   0,82; pedra, chapa e madeira 0,22; trilha 0,55), com uma pequena dispersão para dois materiais da
   mesma família não responderem idênticos. Absorvente encharca mais e demora bem mais a soltar.

Resposta: rugosidade original × (1 − 0,5·w), albedo original × (1 − 0,32·w) e, quando o material
expõe `metallicF0Factor`, um reforço de 35% no especular — o brilho do filme de água.

**PBR e plugin do terreno intactos:** só escrevo escalares e cor no `PBRMaterial` que já existia.
Nenhuma substituição de material, nenhum passe extra, nenhum SSR, nenhuma sonda de reflexão. O
`StochasticGroundPlugin` continua por cima, como estava. O `dispose` devolve os três valores
originais — testado com igualdade exata.

Também mantida a correção do streaming: o registro sai pelo `onDisposeObservable` do material (a
verificação antiga lia `_wasDisposed`, que não existe no `Material` do Babylon instalado, e o `Map`
forte retinha os materiais de toda região descartada).

---

## 7. Integração opcional com o mundo — para o dono da cena

`WeatherPresentation.world` aceita qualquer objeto com a interface abaixo. **O `CollisionWorld` do
jogo já a satisfaz estruturalmente** — não é preciso adaptador.

```ts
export interface RainWorldQuery {
  surfaceAt(x:number,z:number,maxHeight?:number):{height:number;normal:Vec3}|undefined;
  insideSolid?(p:Vec3,height?:number):boolean;   // opcional
}
```

Ligar é **uma linha**, em `PlayerScene` (que eu não posso editar), junto de onde `onRain` já é
configurado:

```ts
this.weatherView=training?undefined:new WeatherPresentation(this.scene);
if(this.weatherView){
  this.weatherView.onRain=intensity=>this.audio.ambientRain(intensity);
  this.weatherView.world=this.collision;   // ← respingos e supressão sob cobertura
}
```

Sem essa linha a chuva roda inteira — camadas, vento, véu e umidade — apenas **sem respingo e sem
supressão sob cobertura**, e sem gastar consulta nenhuma. Não há degradação silenciosa: o QA
consegue distinguir os dois estados por `weatherView.viewerCovered` e `weatherView.worldQueries`.

Leituras expostas para QA e diagnóstico: `layerStatus`, `currentWind`, `worldQueries`,
`viewerCovered`, `splashCapacity`, `trackedMaterials`, `wetness`.

---

## 8. Áudio — preservado, sem alteração

O gancho `onRain → WeaponAudio.ambientRain` continua exatamente como estava, e o
`public/audio/weather/rain-ylmir-01.ogg` já licenciado (`docs/licenses/rain-ylmir.md`) segue sendo a
fonte. **Não gravei nada e não afirmo ter gravado.** Não toquei em `RecordedAudio`,
`EnemyAudioCatalog` nem no manifest. Mantida também a correção de `dispose()` mandar intensidade 0
antes de soltar o gancho.

---

## Orçamento de desempenho

| Item | Valor |
| --- | --- |
| Teto de partículas (3 camadas + respingo) | **876** — contra 900 só de gotas antes |
| População em regime, chuva cheia | ≈684 (near 115, mid 341, far 218, respingo ~10) |
| Sistemas de partículas | 4 de chuva + 1 de pólen = **5 lotes** |
| Consultas ao mundo | teto 46/s · **medido 27,6/s** com chuva cheia · 3,6/s sob cobertura |
| Texturas novas | 150 KB somados (21,6 + 98,6 + 29,7) |
| Escrita em material | 2 escalares + 1 cor por material de chão por quadro; varredura a cada 4 s |
| Passes de tela cheia | **zero** |

Os números de partícula e de consulta são **medidos** (sonda rodando a apresentação real por 10 s em
`NullEngine`), não tetos declarados. O custo de GPU por partícula eu **não** medi — não tenho como
sem navegador.

---

## Validação

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | aprovado nos meus arquivos (ver ressalva) |
| `tests/rain-atlas.test.ts` | 3 aprovados — decodifica os PNG e olha os pixels |
| `tests/rain-model.test.ts` | 18 aprovados — vento, camadas, respingo, umidade |
| `tests/weather-presentation.test.ts` | 9 aprovados — integração Babylon, ciclo de vida, dispose |
| `tests/weather-cycle.test.ts` | 16 aprovados, **sem alteração** — o ciclo foi preservado |
| `npx vite build` + `link-public.mjs` | aprovado — os três PNG em `dist/textures/weather/` |
| `npx vitest run` | 713 aprovados / 719 |

**Ressalva de coordenação:** o `tsc` acusa `src/game/EnemySwarm.ts` e a suíte acusa
`tests/hud-dom-churn.test.ts`, ambos do dono de MP/desempenho e editados nestes minutos (mtimes
posteriores à minha última edição). Nenhum arquivo meu aparece nesses erros. As 6 falhas restantes
são a **linha de base já documentada** (`combat-assets` ×5 e `hordes-arsenal-catalog` ×1, que leem
GLBs em `assets/` e `art/processed/`, fora do repositório).

---

## Arquivos

**Novos:** `scripts/build-rain-atlas.py`, `public/textures/weather/rain-streaks.png`,
`public/textures/weather/rain-splash.png`, `public/textures/weather/rain-haze.png`,
`src/world/rain/RainAtlas.ts`, `src/world/rain/RainWind.ts`, `src/world/rain/RainLayers.ts`,
`src/world/rain/RainSurface.ts`, `src/world/rain/WetnessField.ts`, `tests/rain-atlas.test.ts`,
`tests/rain-model.test.ts`.

**Reescrito:** `src/world/WeatherPresentation.ts` (assinatura pública preservada: `update`, `apply`,
`onRain`, `wetness`, `dispose`, `WET_MATERIAL_PATTERN`, `RAIN_CAPACITY`, `MOTE_CAPACITY`,
`RAIN_RADIUS` — `PlayerScene` não precisa mudar nada para continuar funcionando).
**Reescrito:** `tests/weather-presentation.test.ts`.

**Não tocados:** `PlayerScene`, `EnemySwarm`, `WeatherCycle`, terreno, `CharacterVisual`, áudio, CSS,
`src/style.css` e qualquer asset original.

---

## Limitações honestas

- **Zero QA visual meu.** Se a chuva agora *parece* chuva é julgamento do Codex e do usuário. Os
  testes provam variedade, profundidade, coerência de vento, colocação em superfície real e ciclo de
  vida — não provam que o resultado convence.
- **Gota atravessando telhado ainda é possível em um caso.** O que está resolvido: o respingo nunca
  aparece sob cobertura, e o teste de profundidade da cena esconde a gota que está *atrás* do
  telhado. O que **não** está: olhando de fora para um interior de frente aberta (um celeiro sem
  porta), as gotas do volume continuam desenhadas ali dentro. Resolver isso exigiria oclusão por
  partícula — exatamente o raycast por gota que a tarefa proíbe. Documentado, não disfarçado.
- **Supressão sob cobertura é da CÂMERA, não por coluna.** Ela é binária: ou a câmera está coberta
  ou não. Numa varanda de meia cobertura a chuva some inteira em vez de sumir só do lado abrigado.
- **Não há poça acumulando.** A tarefa proíbe espalhar objetos primitivos de poça, e eu não criei
  nenhum. O molhado é resposta de material; não há volume de água.
- **Reflexo é só resposta PBR** (rugosidade, albedo, F0). Sem SSR, sem sonda, sem plano espelhado —
  era condição explícita para preservar o plugin do terreno e o desempenho.
- **Custo de GPU não medido.** Contagem de partículas, lotes e consultas ao mundo eu medi; ms de
  GPU por quadro, não.
- **O atlas é gerado, não capturado.** Está escrito no cabeçalho do script, aqui e em
  `docs/ASSET_LICENSES.md`.
