# Entrega — cacos recortados dos corpos reais

Rodada 2, resposta ao QA visual em `.temp/fruit-fragments-qa.md`. A rodada 1 trocou clone do corpo
inteiro por geometria autoral; o Codex viu que a forma melhorou mas a cor saiu lavada e a superfície
lisa. Esta rodada troca a geometria de runtime por **recorte real dos corpos de inimigo** e corrige o
espaço de cor. Sem QA visual aqui: nenhum navegador foi aberto. **A aprovação visual segue pendente.**

## 1. Nada mais é construído por primitiva em runtime

`src/vfx/FragmentShapes.ts` (solidPatch/lathe) foi **removido**. No lugar entra
`public/models/fruit-fragments.glb`, gerado por `scripts/build-fruit-fragments.py` com Blender 5.2.

O script importa `public/models/original-<espécie>.glb` — o mesmo corpo que o jogador enfrenta —,
aplica a escala de inimigo de `MonsterDirector` e recorta pedaços de verdade da malha:

- **Casca**: mancha de faces do tronco, crescida por adjacência com borda rasgada por ruído
  determinístico, engrossada por Solidify. Fica com a **UV e a textura de pele do corpo**; a face
  cortada recebe material próprio.
- **Polpa**: mesma mancha afundada para dentro da pele e amassada por ruído, sem pele, um material só.
- **Semente**: melancia, tomate e berinjela não têm semente na superfície, então o caroço é **modelado**
  no Blender (icosfera afilada e achatada, com relevo). Milho e cenoura usam recorte real — grão e
  lasca já existem no corpo, com textura.

45 peças (5 famílias × 3 papéis × 3 variantes), **733 KB**, 5.778 triângulos no total, no máximo 240
por peça (teto de 320 cobrado no teste e na build). Texturas reamostradas para 512 px na cor e 256 px
nos mapas não-coloridos; sem isso o arquivo passava de 4 MB por causa dos 4K originais.

| família | corpo de origem | casca (tri) | tamanho típico da casca | relevo herdado | rugosidade do corte |
| --- | --- | --- | --- | --- | --- |
| melon | original-watermelon | 104 / 96 / 88 | 0,38 × 0,35 × 0,10 m | sim | 0,46 |
| berry | original-tomato | 156 / 160 / 112 | 0,29 × 0,30 × 0,23 m | sim | 0,34 |
| bulb | original-eggplant | 180 / 196 / 220 | 0,22 × 0,23 × 0,10 m | não | 0,58 |
| cob | original-corn | 224 / 240 / 224 | 0,17 × 0,17 × 0,14 m | não | 0,62 |
| root | original-carrot | 228 / 240 / 212 | 0,24 × 0,19 × 0,13 m | não | 0,55 |

Os originais **não são tocados**: são importados, recortados em memória e descartados. O SHA-256 de
cada corpo de origem está em `docs/fruit-fragments-provenance.json` e um teste o confere contra o
arquivo em disco a cada execução.

## 2. Espaço de cor corrigido

A causa da lavagem era a rodada anterior usar `Color3.FromHexString` (valor sRGB) direto como albedo
linear. Agora **não existe mais conversão de cor em runtime**: cor base, textura e cor de vértice vêm
prontas do GLB. No script, todo hex passa por `srgb_to_linear` antes de virar cor de vértice; a textura
de pele é marcada sRGB pelo próprio glTF.

Um teste decodifica o `COLOR_0` da peça cortada direto do arquivo e compara com a paleta de
`FRUIT_PALETTES` convertida para linear: se alguém voltar a gravar sRGB como linear, a direção da cor
se desloca e o teste quebra. A paleta em TypeScript e as cores gravadas no modelo também são
comparadas contra a proveniência, então as duas pontas não separam em silêncio.

Casca berinjela, melancia rajada, milho e cenoura agora têm a cor **do próprio corpo**, porque a pele
é a textura do inimigo, não uma cor chapada.

## 3. Superfície com textura e rugosidade separadas

- **Pele**: material original do corpo (cor + rugosidade/metalicidade + relevo quando existem),
  com variação de brilho fraca (±5%) por cor de vértice para não brigar com a textura.
- **Corte**: material próprio, derivado do mesmo conjunto PBR. Sem textura de cor — a cor vem do
  vértice, com mosqueado de ±15% e leve deriva quente/fria, que é o que tira o aspecto de plástico.
  Rugosidade própria por família (0,34 a 0,62, sempre diferente da pele) e relevo herdado onde o corpo
  original tem mapa de normal (melancia e tomate). Onde não tem, não se inventa mapa.
- **Emissão removida**: os corpos de milho, cenoura e berinjela são emissivos no jogo — era daí que
  vinha o "milho quase branco luminoso". Nenhum material de caco tem emissão, e há teste para isso.
- Rugosidade da pele de quem não tinha mapa saiu de 1,0 (chapado feito papel) para 0,45–0,70.
- Borda do corte usa a cor clara da paleta (`rind`), abaixo do branco: melancia `#cfdfa2`,
  berinjela `#ddcfae`, milho `#ded0a0`, cenoura `#eec392`, tomate `#eec0a8`.

## 4. Carga e API

`FruitFragments` continua com a mesma API: `burst(kind, position, direction, body, power)`,
`update`, `clear`, `dispose`, `active`, `capacity`, `FRUIT_PALETTES`, `DEFAULT_PALETTE`,
`fruitPalette`, `FRAGMENT_BUDGET`, `FragmentRole`, `FruitPalette`. `EnemySwarm` não muda.

Acréscimos compatíveis: terceiro parâmetro **opcional** de loader no construtor (usado pelos testes),
e os getters `ready`, `loaded`, `error`, `shapeTriangles`.

- O carregamento começa **no construtor**, antes da primeira quebra.
- Quebra que chega antes do modelo vira pedido na fila (espécie, posição, direção e força — **nunca a
  malha do inimigo**, que pode ser destruída antes do modelo chegar) e sai assim que os moldes entram.
  A fila guarda no máximo 4 pedidos e é esvaziada no `clear`.
- Enquanto carrega **não aparece nenhum substituto geométrico** na cena.
- `dispose` durante o download descarta o container quando ele chega; `ready` resolve `false` e nada
  fica vivo na cena. Falha de rede vira `error` legível, sem derrubar a quebra.
- O pool continua trocando molde por espécie/papel. Cada peça pode ter duas partes (pele e corte);
  o slot recebe as duas malhas e desabilita a sobra quando o molde novo tem só uma.

## 5. Detalhes que custaram a achar

- **Exportador glTF do Blender 5.2 zera `COLOR_0` da segunda primitiva** de uma malha com dois
  materiais (reproduzido isolado, com cubo). Como a cor da polpa mora justamente na parte cortada,
  cada peça é exportada em objetos de **um material só**: `frag-<família>-<papel>-<variante>` para a
  pele e `…--corte` para o corte. Há teste garantindo uma primitiva por objeto.
- **Corpos com vértice partido na costura de UV**: sem soldar por distância antes de recortar, face
  vizinha não é vizinha e a mancha não crescia — saíam lascas de 8 triângulos.
- **Recorte dobrando sobre si mesmo**: espessura maior que o raio de curvatura local furava a
  superfície (aconteceu com uma peça de berinjela). A build agora calcula volume com sinal de cada
  peça e **falha** se ele for negativo ou menor que 2% da caixa.
- **Conversão de eixo do glTF**: as peças chegam sob o nó de conversão com determinante negativo. A
  carga assa a transformação na malha (o Babylon inverte as faces junto) para o molde poder ser
  reaproveitado em qualquer slot. Um teste soma o volume com sinal das partes já carregadas para
  garantir que nenhum caco vai para a cena do avesso.

## 6. Arquivos

- `scripts/build-fruit-fragments.py` (novo)
- `public/models/fruit-fragments.glb` (novo), `art/blender/Fruit_Fragments.blend` (novo)
- `docs/fruit-fragments-provenance.json` (novo — proveniência, SHA-256 dos originais, custo por peça)
- `src/vfx/FragmentLibrary.ts` (novo), `src/vfx/FruitFragments.ts` (reescrito)
- `src/vfx/FragmentShapes.ts` (removido)
- `tests/fruit-fragments.test.ts`, `.temp/fruit-fragments-review.html`, este arquivo

Nada foi tocado em `PlayerScene`, `DebugOverlay`, `EnemySwarm`, mundo, shader, animação, CSS, nos
modelos originais ou em qualquer arquivo de outro autor. Sem `stash`/`reset`/`commit`/`push`.

## 7. Fixture de QA

`.temp/fruit-fragments-review.html`, com `npm run dev`:
`http://127.0.0.1:5173/.temp/fruit-fragments-review.html`.

**É fixture de laboratório, não a cena final do jogo.** Piso quadriculado de 1 m, luz e câmera só para
medir. Botão por espécie, força do golpe, repetição, câmera lenta, limpar, e três vistas: **queda**
(quebra real caindo com sombra, para julgar o contato), **moldes** (os três papéis × três variantes
parados e girando, para olhar pele, borda cortada e polpa de perto) e **luz fria** (troca a iluminação
para conferir se a cor aguenta luz diferente sem lavar). O rodapé mostra pedaços vivos, teto,
triângulos em moldes e o estado da carga.

## 8. Verificação

`npx vitest run tests/fruit-fragments.test.ts tests/enemy-swarm.test.ts tests/enemy-audio-overrides.test.ts tests/telegraph-shapes.test.ts tests/render-budget.test.ts`
→ 98 testes passando, 29 do arquivo de fragmentos. O teste carrega o **GLB de verdade** (o mesmo
arquivo, como data URL sob NullEngine), não um substituto. Cobrem:

- nomes, contagem e orçamento de cada peça no arquivo; uma primitiva por objeto; tamanho em metros com
  o lado fino no eixo que o contato usa; arquivo abaixo de 1,5 MB;
- pele com textura e UV preservadas, corte com material próprio, rugosidades diferentes, relevo só
  onde o original tem, nenhuma emissão, nada de dupla face;
- cor de vértice presente em toda primitiva e **batendo com a paleta convertida de sRGB para linear**,
  em direção e em brilho;
- proveniência conferindo com a paleta e **SHA-256 dos cinco corpos originais intactos**;
- pool trocando geometria, material e número de partes ao mudar de espécie, inclusive reciclando sob
  pressão com seis espécies disputando 54 slots;
- caco não entrando na cena do avesso depois da conversão de eixo;
- assentamento exatamente sobre `piso + extensão do pedaço`, por espécie; queda no vazio; fim de vida;
- fila de espera durante a carga, sem malha na cena; `dispose` no meio do download; falha de carga.

`npx tsc --noEmit` não acusa nada em `src/vfx/FruitFragments.ts`, `src/vfx/FragmentLibrary.ts` nem
`tests/fruit-fragments.test.ts`.

## 9. Limites reais

- **Isto não é aprovação visual.** Teste prova estrutura, orçamento, cor gravada e pouso; não prova que
  a melancia parece melancia em movimento. A passada do Codex na fixture continua sendo o que decide.
- `tests/combat-assets.test.ts` falha neste clone por falta da pasta `assets/` (fora do repositório,
  conforme o combinado do projeto). É anterior a esta entrega e não tem relação com ela.
- O caco de casca não reproduz a emissão do corpo: em cena o inimigo de milho/cenoura/berinjela brilha
  um pouco mais que o próprio caco. Foi escolha explícita do QA não compensar cor com emissão.
- O recorte sai do tronco do corpo. Peça de milho e cenoura fica menor (0,17–0,24 m) que a de melancia
  (0,38 m) porque o corpo é mais estreito — é fiel, mas se a leitura ficar tímida em jogo dá para subir
  `shell_faces` no script e reexportar.
- Sem colisão entre pedaços nem contra paredes: a quebra continua cinemática, só altura de piso.
- As texturas do caco são cópias reamostradas, não compartilham VRAM com as do inimigo: ~700 KB a mais
  de download e um punhado de texturas pequenas a mais na cena.
