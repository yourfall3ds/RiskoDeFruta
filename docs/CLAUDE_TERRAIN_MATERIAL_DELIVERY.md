# Entrega — chão sem repetição (`StochasticGroundPlugin`)

Subtarefa de `docs/CLAUDE_STOCHASTIC_MATERIAL_TASK.md`. Plugin pronto, testado e sem integração
feita: quem integra é o Claude principal, aplicando por whitelist nos materiais de chão.

## Estado: correção feita e fixture aprovada em GPU pelo Codex

| Rodada | Estado |
| --- | --- |
| QA #1 (Codex, CUA, WebGL2/ANGLE/RTX3080Ti) | **Reprovado.** Lado direito invisível. `FRAGMENT SHADER ERROR:0:933: albedoOpacityOut syntax error`. |
| Correção | **Feita.** Causa raiz encontrada e reproduzida localmente sem GPU; ver §6. |
| QA #2 (Codex, CUA, WebGL2/ANGLE/RTX3080Ti) | **Aprovado na fixture.** Os dois planos renderizam; brown_mud_02, brown_mud_leaves_01 e rock_face_03 foram comparados com12xUV, mesma câmera/luz. Toggle desligado devolve a amostragem original. Sem erros novos de compilação. |

**A fixture foi validada em GPU separadamente pelo Codex.** Os testes automatizados rodam o pipeline de shader real do Babylon em Node
(includes, injeção do plugin, pré-processador, conversão para GLSL ES 3.00) e conferem o texto que
o navegador mandaria para o driver — **compilação na GPU exige a revisão separada**. NullEngine não compila
shader. Falta conferir custo e aparência com o mapa inteiro carregado; a aprovação da fixture não cobre esse cenário.

A API **não mudou** nesta correção. Quem já estiver integrando pode seguir: a mudança foi só no
texto injetado no shader e nos testes. Assinaturas, nomes, campos de ajuste e padrões são os
mesmos de antes.

Arquivos criados (nenhum arquivo de outro autor foi tocado):

| Arquivo | O que é |
| --- | --- |
| `src/world/materials/StochasticGroundPlugin.ts` | O plugin e a API pública |
| `tests/stochastic-ground.test.ts` | 16 testes — âncoras de shader, geometria da grade, ciclo de vida |
| `.temp/terrain-material-review.html` | Fixture lado a lado para o Codex revisar |
| `docs/licenses/stochastic-ground.md` | Origem do algoritmo e licenças |

---

## 1. O que o plugin faz

É um `MaterialPluginBase` de verdade: ele reescreve, no fragment shader do `PBRMaterial`, os quatro
pontos onde o Babylon lê textura, e troca cada leitura por uma **mistura de três amostras da mesma
textura**, cada uma deslocada e girada por um valor determinístico vindo da célula de uma grade
triangular. O tiling some porque cada pedaço do chão está lendo uma região diferente do bitmap —
não porque a cor mudou.

Em cima disso, e só em cima disso, existe uma variação macro de cor/umidade por posição de mundo.
Ela é separada, tem chave própria (`macroStrength`) e pode ser zerada sem desligar o antitiling.

O que **não** muda: malha, colisão, UVs, resolução de textura, e o modelo de iluminação PBR. O
plugin só substitui o valor lido do sampler; toda a iluminação continua sendo a do Babylon.

### Consistência entre mapas

Albedo, normal e ARM/AO recebem o **mesmo deslocamento e a mesma rotação**, porque a grade é
calculada a partir do UV — e os três mapas de um material de chão compartilham o mesmo UV.
Quando o UV rotaciona, a normal tangente é rotacionada junto (`n.xy * R`, que é `transpose(R)·n.xy`);
sem isso o relevo apontaria para o lado errado dentro de cada retalho.

Isso depende de albedo/normal/ARM terem o mesmo `uScale/vScale/uOffset/vOffset/wAng/coordinatesIndex`.
Use `stochasticGroundUvMismatch(material)` para conferir antes de aplicar — ele devolve a lista de
mapas divergentes (`[]` = tudo certo).

---

## 2. API exata

```ts
import {
  attachStochasticGround,
  attachStochasticGroundByName,
  getStochasticGround,
  stochasticGroundUvMismatch,
  supportsStochasticGround,
  DEFAULT_STOCHASTIC_GROUND_SETTINGS,
  type StochasticGroundSettings,
} from '../materials/StochasticGroundPlugin';
```

### `attachStochasticGround(material: PBRMaterial, settings?: Partial<StochasticGroundSettings>): StochasticGroundPlugin | null`

Instala ou reconfigura. Idempotente: chamar duas vezes devolve a **mesma** instância e apenas
aplica os novos ajustes. Devolve `null` — deixando o material exatamente como estava — quando:

- a engine não é WebGL2/WebGPU (`supportsStochasticGround(engine) === false`); ou
- o material usa WGSL.

Se o material já estiver congelado, ele descongela, instala e congela de novo sozinho.

### `attachStochasticGroundByName(materials, whitelist, settings?): StochasticGroundPlugin[]`

Atalho de whitelist. `materials` é qualquer iterável (`scene.materials`, `container.materials`,
`new Set(meshes.map(m => m.material))`); `whitelist` é um iterável de nomes exatos. Só entra
material PBR cujo nome está no conjunto. Devolve os plugins efetivamente instalados.

### `getStochasticGround(material): StochasticGroundPlugin | null`

Recupera o plugin já instalado.

### `plugin.update(settings: Partial<StochasticGroundSettings>): void`

Atualiza uniformes. Satura os valores para a faixa válida. **Se o material estiver congelado, o
`update` cuida do `unfreeze → markDirty → freeze`** — sem isso o Babylon pula o bind e o valor novo
nunca chega à GPU.

### `plugin.isEnabled: boolean` (get/set)

A/B. É açúcar para `strength` 0/1 — **não recompila shader**, o desvio acontece dentro do próprio
fragment shader num branch uniforme. Serve para alternar em jogo sem engasgo de compilação.

### `plugin.settings: Readonly<StochasticGroundSettings>`

Cópia dos valores atuais (já saturados).

### `stochasticGroundUvMismatch(material): string[]`

Lista os mapas cujo transform de UV difere do albedo. Bom para um `console.warn` no dev.

### Ajustes

| Campo | Padrão | Faixa | O que é |
| --- | --- | --- | --- |
| `strength` | `1` | 0..1 | 0 = amostragem original do Babylon; 1 = só a mistura. Valores no meio fazem crossfade. |
| `patchScale` | `1.15` | > 0 | Tamanho do retalho na unidade do UV. ~1 = um retalho por repetição da textura. Fracionário de propósito: se casar com a repetição, a grade volta a aparecer. |
| `rotation` | `1` | 0..1 | Quanto cada retalho pode girar. 1 é seguro porque a normal é corrigida junto. |
| `contrast` | `4` | ≥ 1 | Expoente do peso baricêntrico. Maior = retalho mais chapado e transição mais curta; menor = transição mais longa e mais borrada. |
| `macroStrength` | `0.5` | 0..1 | Variação macro de cor/umidade. 0 desliga só a macro. |
| `macroScale` | `26` | > 0 | Tamanho da variação macro, em metros de mundo. |
| `seed` | `17` | qualquer | Semente determinística. Mesma semente = mesmo chão em toda sessão e em todo cliente. Não há termo de tempo em lugar nenhum: não cintila. |
| `moisture` | `0.6` | 0..1 | Quanto da macro também mexe na rugosidade (solo úmido fica menos áspero). |

Uniformes no shader: `vStochasticGroundParams = (strength, patchScale, rotation, contrast)` e
`vStochasticGroundMacro = (macroStrength, macroScale, seed, moisture)`. Declarados no UBO do
material e também soltos, para engine sem uniform buffer. Não há textura nova, nem render target,
nem alocação por frame — `dispose()` não tem nada a liberar e o plugin morre junto com o material.

---

## 3. Ordem de instalação (importante: freeze)

Os dois lugares que hoje congelam material congelam **depois do primeiro render**:

- `src/world/streaming/RegionPresentation.ts:38` — `scene.onAfterRenderObservable.addOnce(... material.freeze())`
- `src/world/FarmWorld.ts:108` — mesmo padrão

Então a ordem correta é: **instalar dentro do laço que já configura os materiais** (o `for` de
`RegionPresentation.ts:22`, junto do tint e do `anisotropicFilteringLevel`), que roda antes do
observador de freeze. Depois disso o plugin é só uniforme: mudanças em runtime passam por
`plugin.update(...)`, que já resolve o congelamento sozinho.

### Materiais candidatos (conferidos no código)

| Onde | Material | Recomendação |
| --- | --- | --- |
| `RegionPresentation.ts:11` / `:22` | `'Sunlit farm track'` | Aplicar. É a trilha de terra, com albedo + ARM. |
| `RegionPresentation.ts:11` / `:22` | `'Leaf litter soil'` | Aplicar. |
| `FarmWorld.ts:88` | `'Sunlit farm track'` | Mesmo material do item acima, pelo caminho não-streaming. |
| `TrainingYard.ts:27` | `'soil'` (`brown_mud_leaves_01`, 12×) | Aplicar. É o caso mais fácil: os três mapas já compartilham UV. |
| `DistantRegions.ts:27` | qualquer | **Não aplicar.** É LOD distante; o custo de fetch não se paga em pixel longe. |
| `'Barn red weathered wood'`, `'Weathered timber'`, `'Aged silo steel'`, `'Oxidized roof'`, `'Ivory trim'`, `'Tractor rubber'` | — | **Não aplicar.** Parede, porta, construção e prop precisam do UV intacto. |

Integração sugerida, dentro do laço que já existe:

```ts
const GROUND_MATERIALS = ['Sunlit farm track', 'Leaf litter soil'];
attachStochasticGroundByName(materials, GROUND_MATERIALS);
```

---

## 4. Fixture visual para o Codex

`.temp/terrain-material-review.html`. Dois planos inclinados, lado a lado:

- esquerda `ORIGINAL` — `PBRMaterial` puro do Babylon;
- direita `VARIAÇÃO NATURAL` — o mesmo material com o plugin.

Compartilham câmera, luz hemisférica + direcional, roughness, o mesmo conjunto de mapas e a mesma
escala de UV. A única diferença entre os dois lados é o plugin.

Para abrir (a config de revisão já existia no repositório):

```
npx vite --config .temp/vite-review.config.mjs
# http://127.0.0.1:5174/.temp/terrain-material-review.html
```

Controles: liga/desliga o plugin, isola o lado direito, troca a textura
(`brown_mud_02`, `brown_mud_leaves_01`, `rock_face_03` — os três existem em `public/textures/`),
muda a repetição do UV (2× a 40× — subir revela o tiling do lado esquerdo) e mexe em `strength`,
`patchScale`, `rotation`, `contrast` e `macroStrength` ao vivo. Botões de vista rasante e vista alta.

**Leia o rodapé do painel antes de julgar a imagem.** Depois do QA #1 a fixture mostra o estado do
shader do lado direito: verde `Shader do lado direito compilado e pronto`, ou o erro de compilação
em vermelho. Plano direito vazio **com** o rodapé verde é problema visual; plano direito vazio
**com** rodapé vermelho é shader quebrado, e o texto em vermelho é o diagnóstico. Como no QA #1,
vale recarregar a página uma vez depois da primeira otimização de dependências do Vite.

**Isto é um banco de teste de material, não uma captura do jogo.** A iluminação, a escala e o relevo
não são os do mundo; não use a fixture como prova de resultado em jogo.

Eu não abri navegador e não gerei captura — a inspeção visual é do Codex, via CUA.

---

## 5. Limites reais

1. **Custo de fetch.** Cada mapa tratado passa de 1 para 3 leituras, mais 1 leitura do último mip
   para a média (albedo, ARM e AO; a normal não precisa da média). Num material de chão completo
   isso é ~15 leituras contra ~4. Por isso o whitelist importa, e por isso LOD distante fica fora.
2. **Mistura no espaço de armazenamento.** O albedo é misturado em sRGB, como ele é lido, sem
   converter para linear antes. É o que as implementações práticas fazem e é o que mantém o custo
   baixo, mas é uma aproximação: tons médios ficam levemente diferentes da mistura correta em
   espaço linear.
3. **Recuperação de contraste é aproximada.** A média vem do último nível de mip. **Se a textura
   não tiver mipmap, a média vira a própria amostra** e a recuperação de contraste desaparece — o
   antitiling continua funcionando, só fica mais lavado. Os mapas do projeto (`Texture` padrão) têm
   mipmap.
4. **Sem WebGL1.** O plugin depende de `textureGrad`/`textureLod` (GLSL ES 3.00), que é o que
   mantém o mipmap correto atravessando a borda do retalho. Em WebGL1 `attachStochasticGround`
   devolve `null` e o material fica exatamente como estava.
5. **Sem WGSL.** `isCompatible` recusa WGSL, então em WebGPU o material original é preservado
   intacto. Portar exigiria reescrever os mesmos trechos em WGSL, com âncoras diferentes — não está
   nesta entrega.
6. **`OBJECTSPACE_NORMALMAP` fica de fora** de propósito: normal em espaço de objeto não tem
   tangente para girar junto com o retalho. Normal tangente (o caso do projeto) é tratada.
7. **Não combinar com `material.textureRepetitionMode`.** O modo nativo do Babylon faz a mesma
   coisa num ponto anterior do shader; ligar os dois aplica o efeito duas vezes.
8. **UV compartilhado é pré-requisito.** Se albedo e normal tiverem escalas diferentes, cada um cai
   num retalho diferente e o relevo descola da cor. `stochasticGroundUvMismatch` detecta isso.
9. **Não aumenta resolução.** Em enquadramento muito colado a textura continua tão borrada quanto
   antes; o que muda é a repetição, não o detalhe.
10. **Alfa preservado.** No albedo, o canal alfa passa por média simples, sem realce de contraste —
    realçar alfa quebraria `alphaCutOff` em material com recorte. No ARM os quatro canais mantêm o
    contraste, porque ali alfa é dado linear.

### Por que não usar o modo nativo do Babylon

O Babylon 9.25 já tem `material.textureRepetitionMode = Constants.TEXTURE_REPETITION_HEX_TILING`.
Ele resolve o antitiling e é mais barato de adotar, mas **não corrige a normal tangente**: ele gira
o UV e não gira o vetor da normal junto, então o relevo aponta para direções diferentes em cada
retalho. Também não tem variação macro. O plugin existe por causa desses dois pontos. Se em algum
momento a correção de normal entrar no Babylon, trocar por ele vira a opção mais sensata.

---

## 6. A falha do QA #1 e a correção

### Sintoma

`FRAGMENT SHADER ERROR:0:933: albedoOpacityOut syntax error`, e no shader emitido:

```glsl
vec4 albedoTexture=sgSample(albedoSampler,vAlbedoUV+uvOffset,0.0)   // <- sem ';'
albedoOpacityOut=albedoOpacityBlock(
```

### Causa raiz (três fatos do Babylon 9.25, todos medidos, não supostos)

1. **A injeção do plugin roda ANTES do pré-processador.** O `PBRBaseMaterial` passa o código dos
   plugins como `processCodeAfterIncludes` (`pbrBaseMaterial.pure.js:1194`), não como
   `processFinalCode`. Ou seja: includes já resolvidos, mas `#ifdef`, quebra de linha e conversão
   para GLSL ES 3.00 ainda não aconteceram.
2. **O `MaterialPluginManager` acrescenta `"\n"` a todo trecho injetado**
   (`injectedCode += customCode + "\n"`). Como o anchor antigo parava no `)`, o `;` da instrução
   sobrava sozinho na linha seguinte.
3. **O `ShaderCodeCursor` do Babylon descarta uma linha que é só `;`** — literalmente, com
   comentário no fonte: *"If trimmedLine == ';', we must not push, to be backward compatible with
   the old code!"* (`Engines/Processors/shaderCodeCursor.js`). O terminador órfão era apagado, e a
   instrução ficava sem fim.

O mapa de normal escapou porque ali o anchor era seguido de `.xyz`, e uma linha `.xyz,vBumpInfos.y);`
não é só `;` — então sobrevive. Por isso só o albedo quebrou.

### Correção

Cada anchor agora **engole o fim da expressão e a substituição devolve esse fim**, de modo que o
`\n` do manager sempre cai depois de uma instrução completa:

| Mapa | Anchor termina em | Substituição termina em |
| --- | --- | --- |
| albedo | `)\s*;` | `,0.0);` |
| reflectivity (ARM) | `)\s*;` | `,1.0);` |
| ambient (AO) | `)\s*\.rgb\s*;` | `.rgb;` |
| bump (normal) | `)\s*\.xyz` | `.xyz` |

Duas consequências do fato 1 que o código agora documenta e o teste vigia: o bloco injetado **não
pode conter `for(...;...;...)`** (o cabeçalho seria partido nos `;`), e comentário só em linha
própria, sem `;` dentro.

## 7. Validação local feita

```
npx tsc --noEmit                               # limpo
npx vitest run tests/stochastic-ground.test.ts # 24 passaram
```

Não rodei a suíte inteira (fora do escopo desta subtarefa). A fixture foi validada com um
`vite build` só dela, para garantir que todos os imports resolvem; o artefato foi apagado.

### Teste de pipeline real (o que faltava no QA #1)

Conferir os regex contra o shader-fonte **não bastava** — passava, e o shader emitido saía quebrado.
Agora o teste liga `webGLVersion = 2` e o `WebGL2ShaderProcessor` real num `NullEngine`, monta um
chão com albedo/normal/ARM/AO, deixa o Babylon percorrer o caminho inteiro e **captura o fragment
shader no argumento de `createShaderProgram`** — o mesmo texto que o navegador entrega ao driver.
Sobre esse texto final ele afirma:

- `vec4 albedoTexture=sgSample(albedoSampler,vAlbedoUV+uvOffset,0.0);` aparece **completo, com o
  terminador, numa linha só** — regressão direta da falha do QA #1;
- o mesmo para ARM (`...,1.0);`), AO (`....rgb;`) e normal (`....xyz`);
- nenhuma linha do shader é só `;`;
- as 13 funções `sg*` estão **definidas antes de cada uso** (pega o caso de o bloco de definições
  não ter entrado);
- `vStochasticGroundParams`/`vStochasticGroundMacro` estão declarados antes da primeira leitura
  (caminho de uniform buffer, que é o que o navegador usa em WebGL2);
- a variação macro chegou em cor (`surfaceAlbedo=sgMacroAlbedo(...)`) e em umidade
  (`sgMacroMoisture(microSurface,roughness)`);
- parênteses e chaves fecham; nenhuma leitura original sobrou nos mapas tratados;
- o bloco injetado sobreviveu à quebra por `;` e não tem `for(`;
- **sem o plugin** o shader sai sem nenhum símbolo `sg*` — a diferença é só o plugin;
- **chão só com albedo** compila o mesmo caminho, sem `sgSampleNormal` nem ARM pendurado;
- **`strength` 0 gera exatamente o mesmo shader** — prova de que o A/B é uniforme, não recompilação.

**Conferi que esses testes falham na versão com o defeito**: revertendo o anchor do albedo para a
forma antiga, 3 testes quebram, incluindo o do terminador. Não é teste que só acompanha o código.

### O que os outros testes cobrem

- **Âncoras.** Contados contra o `pbr.fragment` real (albedo 1×, reflectivity 1×, ambient 1×,
  bump 2×, microSurface/roughness 1×), mais a regra nova: nenhum anchor pode terminar em `)` solto.
- **Geometria da grade.** As cinco constantes são lidas *do próprio GLSL* e conferidas contra `√3`;
  a escala do centro do retalho tem que ser o inverso exato da escala da grade. Com esses números
  reais o teste verifica, em milhares de pontos: os três pesos somam 1 e nunca ficam negativos; os
  três retalhos são mesmo os vizinhos do ponto; e a mistura é contínua ao atravessar a borda.
- **Três amostras por mapa.** Conta as seis chamadas de `sgPatch` no shader final: garante que a
  entrega é mistura de amostras, não efeito de cor disfarçado.
- **Ciclo de vida.** Engine WebGL1 → `null` e material intocado. Instalação idempotente. Saturação
  de valores fora de faixa. Uniformes subindo como dois `vec4`. A/B via `isEnabled`. Whitelist
  ignorando material de parede. `update` em material congelado. Descarte sem textura pendurada.

### O que continua sem verificação

A **compilação na GPU** e a **aparência**. Nenhum teste aqui prova qualquer uma das duas. É o QA #2
do Codex que fecha isso.

Para ajudar nessa rodada, a fixture agora mostra na tela o estado do shader do lado direito:
`Shader do lado direito compilado e pronto` em verde, ou o erro de compilação em vermelho. Se o
plano direito sumir de novo, o motivo fica legível na própria página em vez de exigir o console.

---

## 8. Origem e licença

`docs/licenses/stochastic-ground.md`. Resumo: o GLSL foi escrito aqui, nenhuma linha copiada; o
algoritmo é o de Heitz & Neyret (HPG 2018). `.tools/references/three-hex-tiling` (MIT, commit
`b27c110`) e o `textureRepetitionFunctions` do próprio Babylon (Apache-2.0) foram lidos como
referência. Nenhuma dependência nova, nenhum repositório novo.
