# Cálice da colheita — entrega da etapa de asset (15/09/2026)

Escopo deste turno: **somente o asset Blender e o módulo visual isolado**. Nada de
`EnemySwarm`, `PlayerScene`, `ExpeditionObjectives`, `ExpeditionSites`, `ExpeditionAnchors`,
`HarvestResonance`, `CombatHUD`/`PlayerHUD` — esses arquivos estão reservados à correção MP/FPS e
**não foram tocados**. Todos os arquivos abaixo são novos; nenhum arquivo existente foi alterado.

## O que foi entregue

| Arquivo | Papel |
| --- | --- |
| `scripts/build-harvest-chalice.py` | Autoria reproduzível no Blender 5.2: gera o `.blend` e exporta o GLB |
| `art/blender/Harvest_Chalice.blend` | Fonte editável (fora do repo por `.gitignore`, como os outros `.blend`) |
| `public/models/harvest-chalice.glb` | Asset de runtime, 839 KB (sem textura nenhuma) |
| `docs/harvest-chalice-asset.json` | Contrato medido na exportação (nós, materiais, níveis, triângulos) |
| `scripts/render-harvest-chalice-review.py` | Render offline de revisão (Cycles, headless) |
| `art/harvest-chalice-hero.png` | Revisão 3/4 com 60% de suco e gotas entrando |
| `art/harvest-chalice-ladder.png` | Os cinco níveis autorados lado a lado (0/25/50/75/100%) |
| `src/vfx/HarvestChaliceVisual.ts` | Módulo visual isolado, sem nenhuma regra de objetivo |
| `tests/harvest-chalice-asset.test.ts` | 9 testes do GLB autorado |
| `tests/harvest-chalice-visual.test.ts` | 12 testes de carga e ciclo de vida do módulo |

Reconstruir:

```
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/build-harvest-chalice.py
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/render-harvest-chalice-review.py
```

O script é determinístico (ruído de pátina por hash fixo, sem `random`), então rebuild gera o mesmo
GLB e o teste de asset continua válido.

## A malha

Referência: `public/images/objectives/harvest-chalice-concept.png`. Regra `no-procedural-3d` do
usuário respeitada — **nenhuma primitiva de runtime, e nenhuma primitiva do Blender disfarçada de
asset**. Tudo sai de perfis desenhados à mão revolucionados no eixo e de folhas geradas como
retalhos embrulhados na superfície hospedeira:

- **`ChaliceCrystalBowl`** — casca de vidro fechada (parede externa + lábio arredondado + parede
  interna), taça larga estilo *coupe* com borda recortada em 6 lóbulos, 56 segmentos. 5 488 tri.
- **`ChaliceBrassFrame`** — uma só malha juntando pé, haste, botão, berço e 25 folhas: 6 pétalas
  altas nos vales da borda, 6 curtas nas cristas, 8 em relevo no pé e 5 no botão da haste. Cada
  folha tem nervura central e nervuras laterais em relevo real, e é solidificada numa casca fina.
  19 464 tri.
- **`ChaliceJuice`** — o líquido, malha separada. 1 056 tri.
- **`ChaliceDroplet`** — gota autorada (revolução de perfil de lágrima) usada pelo módulo como
  fonte de *thin instances*. 360 tri.
- Âncoras (nós vazios): `ChaliceRimAnchor` (y 1.543), `ChaliceJuiceFloorAnchor` (y 0.672),
  `ChaliceGlowAnchor`.

Total **26 368 triângulos**, altura 1,543 m, pé com raio 0,436 m. O teste falha acima de 30 000.

### Como o líquido sobe

O suco tem **5 morph targets** (`Fill20` … `Fill100`) mais a malha base (vazio). Cada nível foi
autorado separadamente com o anel do topo calculado na altura exata, então **em todo nível o suco
encosta na parede curva do vidro** — não é escala nem corte. As alturas são proporcionais a
**volume**, não a altura: numa taça que abre para cima o nível sobe depressa no começo e devagar no
fim, como líquido de verdade.

```
fillLevels (unidades do modelo) = [0.682, 0.9246, 1.0414, 1.1366, 1.2213, 1.3]
                                   vazio  20%     40%     60%     80%     100%
```

Entre dois níveis o módulo mistura só os dois vizinhos, com influências somando 1 — isso é
interpolação linear de verdade entre duas formas válidas, e não soma aditiva sobre a base.

### Materiais

| Material | Config | Por quê |
| --- | --- | --- |
| `Chalice crystal` | `alphaMode BLEND`, alpha 0.10, rough 0.05, single-sided + `separateCullingPass` | **Sem** `KHR_materials_transmission`/`volume`: nada de refração, um único draw transparente. Vidro legível ao ar livre com custo previsível. |
| `Chalice aged brass` | metálico 1 (padrão glTF), rough 0.35, albedo inteiro em `COLOR_0` | Latão envelhecido com pátina e desgaste **sem nenhuma textura**: a variação está em cor por vértice, gerada por ruído determinístico + oclusão aproximada. Zero custo de VRAM. |
| `Harvest juice` | opaco, rough 0.26, emissivo baixo, albedo em `COLOR_0` | Opaco de propósito: suco com polpa não precisa ser translúcido, e assim só o vidro entra no passe transparente. O gradiente vermelho-melancia → laranja e as manchas de polpa estão em `COLOR_0`. |

Cores foram autoradas em sRGB e convertidas para linear na escrita (`linear()` no script), então
Blender e glTF concordam.

## API de integração

```ts
import {HarvestChaliceVisual} from '../vfx/HarvestChaliceVisual';

const chalice = new HarvestChaliceVisual(scene);      // nó vazio no mesmo quadro, nenhum proxy
chalice.place({x, y, z}, yaw);                        // vale antes da carga
void chalice.load();                                  // assíncrono; nunca lança

// por quadro, com o valor AUTORITATIVO do marco:
chalice.setFill(suco / meta);
chalice.update(dt);

// por morte creditada (só ilustração):
chalice.splash(posicaoDaMorte, pesoDaEspecie);

// ao completar:
chalice.pulse();
```

| Membro | Contrato |
| --- | --- |
| `root: TransformNode` | Existe desde o construtor. Vazio até o GLB chegar. |
| `ready`, `error` | `error` recebe a falha em texto; `load()` devolve `false` em vez de lançar. |
| `load(): Promise<boolean>` | Idempotente: chamadas simultâneas compartilham a mesma promessa. Se o objeto foi descartado durante a carga, o container é destruído e nada entra na cena. |
| `place(pos, yaw?)` | Antes ou depois da carga. |
| `setFill(fração, immediate?)` | Aceita valor fora de 0..1 e `NaN` (vira 0). Guardado e reaplicado quando o modelo chegar. `immediate` pula a suavização. |
| `fill` / `requestedFill` | Exibido (suavizado a 1.9/s) e pedido. A lógica do marco só olha o seu próprio número — o módulo nunca altera `requestedFill`. |
| `surfaceHeight(fração?)` | Altura em mundo da superfície do suco; útil para áudio/partícula de impacto. |
| `rimPoint(out?)` | Ponto de destino das gotas, em mundo. |
| `splash(origem, peso?)` | Descarta em silêncio se o modelo não carregou ou se o pool está cheio. |
| `pulse()` | Pulso de conclusão. Repetir não acumula. |
| `setVisible(v)` | Liga/desliga o nó inteiro (streaming por distrito). |
| `reset()` | Esvazia a tentativa sem recarregar o modelo. |
| `dispose()` | Destrói container (malhas + materiais) e o nó raiz. Idempotente; métodos continuam seguros depois. |
| `meshes` | Só diagnóstico/teste. |

**O módulo não sabe o que é uma morte.** Ele não conta, não credita, não decide conclusão e não lê
raio de captura. Se o GLB falhar, atrasar ou for descartado, `setFill`/`splash`/`pulse` continuam
sendo chamadas válidas e o marco avança do mesmo jeito — o requisito de "lógica independente do
VFX" fica satisfeito por construção, porque a lógica nem existe aqui.

### Custos e limites que a integração precisa saber

- **Um container por instância.** Quatro cálices = quatro cargas do mesmo URL (o cache HTTP do
  navegador resolve a rede) e quatro conjuntos de materiais. Foi escolha deliberada: no Babylon,
  `clone`/`instantiateModelsToScene` compartilha o `MorphTargetManager` por referência, e quatro
  cálices compartilhando influências encheriam todos juntos.
- **26 368 tri por cálice.** Quatro visíveis ao mesmo tempo custam ~105 k tri. Recomendo carregar
  por proximidade/distrito e usar `setVisible(false)` fora de alcance, em vez de manter os quatro
  residentes. Ainda **não há LOD** — está registrado como pendência honesta, não como pronto.
- **Pool de gotas fechado** (28 por padrão, configurável por `dropCapacity`). Estouro é descartado;
  nada é alocado depois da carga: as gotas são objetos reaproveitados e um `Float32Array` fixo de
  matrizes de *thin instance*.
- Um único material transparente por cálice; o suco desenha no passe opaco, antes do vidro.

## Render offline de revisão

`art/harvest-chalice-hero.png` e `art/harvest-chalice-ladder.png` foram renderizados em Cycles
headless a partir do próprio `.blend`, com **os materiais que o GLB exporta** — mesma opacidade de
vidro, mesmas cores por vértice, view transform `Standard` (sem curva de filme) para mostrar o
albedo que a engine vai amostrar. Nada foi embelezado para a foto.

**Isto não é aprovação visual.** Eu não abri o jogo, não usei navegador e não posso afirmar que o
cálice está aprovado — só que o asset é o que os renders mostram. Duas diferenças esperadas contra a
engine: o Cycles aplica Fresnel dielétrico completo no vidro (a taça sai mais leitosa do que deve
sair no Babylon com F0 padrão), e a iluminação aqui é de estúdio, não o céu HDR do jogo.

## Testes

```
npx vitest run tests/harvest-chalice-asset.test.ts tests/harvest-chalice-visual.test.ts   # 21 passam
npx tsc --noEmit                                                                          # limpo
```

O que eles travam:

- vaso, latão e líquido são malhas e materiais **separados**; sem skins, sem animações;
- vidro com um único material `BLEND` e **sem** extensão de transmissão/volume;
- líquido com um morph por nível autorado, com os nomes que o runtime usa e com normais morfadas;
- a superfície **sobe** nível a nível, bate com `fillLevels` e nunca passa da borda;
- em **todos** os níveis, cada vértice do suco fica dentro da parede interna do vidro (limite
  medido do próprio GLB, por setor angular);
- a gota é malha autorada de verdade (>120 tri), não primitiva;
- orçamento de triângulos e constantes do módulo batendo com `docs/harvest-chalice-asset.json`;
- módulo: nó vazio antes da carga (nenhum proxy branco), pedido de nível feito antes da carga é
  aplicado depois, mistura de só dois níveis com soma 1, clamp de `NaN`/fora de faixa, pool de
  gotas com teto e reciclagem, suavização que não altera o valor pedido, pulso que volta ao
  emissivo autorado, `reset` sem recarregar, carga única sob chamadas concorrentes, `dispose`
  duplo sem sobra de malha/material/nó, `dispose` no meio da carga sem vazamento, e GLB inválido
  reportado em `error` em vez de exceção.

## Pendências declaradas (fora deste turno, por instrução)

- Integração: gancho de morte em `EnemySwarm`, crédito por raio em `ExpeditionObjectives`, rota dos
  quatro cálices em `ExpeditionSites`, cópia de HUD e multiplicador de `HarvestResonance`.
- LOD / carga por distrito do cálice.
- Ícone PNG do HUD (a imagem de conceito já existe em
  `public/images/objectives/harvest-chalice-concept.png` e está registrada no contrato).
- Aprovação visual do usuário nos dois renders.
