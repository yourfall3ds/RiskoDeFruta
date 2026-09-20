# Pontos fracos físicos por espécie

Fonte da verdade no código: `src/combat/WeakPoints.ts`. Integração: `EnemySwarm.weakPointOf`.
Testes: `tests/weak-points.test.ts`.

## Como as zonas foram escolhidas

Nada foi estimado a olho. O script `.temp/rig-weak-probe.mjs` lê cada `.glb` autoral em
`public/models/`, aplica a matriz de bind (`inverseBindMatrices × matriz de mundo do osso`) para
reconstruir a POSE DE REPOUSO real e registra, para cada osso, a caixa dos vértices em que aquele
osso tem peso maior que 0,5. A saída bruta fica em `.temp/rig-weak-probe.json`.

Os cinco modelos chegam normalizados com **1,7 unidade de altura em repouso**. Por isso os raios da
tabela abaixo estão em unidades de MODELO: em jogo eles são multiplicados por
`ENEMIES[kind].scale × ENEMY_AFFIXES[variant].scale`, que é a escala viva da raiz do ator. É também
por isso que a Praga Alfa (melancia a 2,5×) ganha uma coroa proporcionalmente maior sem número
separado nenhum.

## Tabela

| Espécie | Zona | Ossos do rig | Centro em repouso (modelo) | Raio (modelo) | Raio em jogo |
|---|---|---|---|---|---|
| Berinjela | cabeça | `Head` | (0,015 · 1,360 · 0,086) | 0,26 | 0,31 m (×1,2) |
| Milho | cabeça | `Head` | (−0,003 · 1,379 · 0,071) | 0,18 | 0,23 m (×1,3) |
| Cenoura | mão-canhão direita | `RightHand` | (−0,350 · 0,538 · 0,152) | 0,22 | 0,28 m (×1,25) |
| Tomate voador | **asas** | `Bone_041` `Bone_040` `Bone_044` `Bone_043` | ±(0,97…1,24 · 1,12…1,50 · −0,18) | 0,28 | 0,35 m (×1,25) |
| Melancia | coroa (hastes/olhos no topo) | `Bone_006` `Bone_007` `Bone_008` `Bone_009` | (−0,36…0,59 · 1,40…1,58 · −0,14…0,18) | 0,19 | 0,26 m (×1,35) |
| PRAGA ALFA | coroa da Praga Alfa | os mesmos da melancia | idem | 0,19 | 0,48 m (×2,5) |

Justificativa de cada escolha, com o número que a sustenta:

- **Berinjela / milho** usam o rig humanoide de 24 ossos (`Hips … Head`, confirmado no glTF). `Head`
  domina 1 345 e 1 323 vértices e é a silhueta reconhecível das duas. O raio é menor que a
  meia-altura da cabeça de propósito: a extensão vertical de `Head` é 0,80, mas a horizontal é
  0,44 — uma esfera de 0,40 pegaria ombro.
- **Cenoura**: `RightHand` domina 1 576 vértices e já é o socket do laser em `EnemySwarm`
  (`carrot-right-palm-muzzle`). É a mão robótica — o objeto destacado do modelo, e a arma que ela
  usa contra o jogador.
- **Tomate voador**: pedido explicitamente. As cadeias são `Bone_042 → 041 → 040` (esquerda) e
  `Bone_045 → 044 → 043` (direita) — exatamente os ossos que a batida de asa já anima
  (`/Bone_04[012345]$/` em `EnemySwarm.update`). **Os ossos de raiz (042 e 045) ficam de fora**:
  eles cobrem vértices até |x| = 0,40, dentro do tronco, e incluí-los transformaria tiro no corpo em
  acerto na asa. Os quatro usados vivem em |x| ≥ 0,73 e o tronco (`Bone_000`) termina em |x| = 0,63,
  então a esfera de 0,28 não encosta no corpo.
- **Melancia e Praga Alfa**: o corpo é uma casca sobre quatro patas (`Bone_016/019/022/025`, os
  quatro grupos de 1 300 a 2 200 vértices nas quinas). A casca (`Bone_000`) termina em y = 1,479;
  os quatro ossos da coroa vivem entre y = 1,269 e y = 1,700, ou seja, são a ÚNICA saliência acima
  da casca. O chefe reaproveita o mesmo rig, então herda a mesma zona.

## Regra de acerto

O teste é o **segmento da bala**, não a proximidade do corpo:

```
origem    = context.hitPosition   (entrada na caixa envolvente, sobre a linha do tiro)
direção   = context.hitDirection  (direção do raio que saiu do CANO)
acerto    ⟺ o segmento atravessa a esfera do osso, dentro de WEAK_POINT_REACH (8 m)
```

`hitDirection` é um campo NOVO e OPCIONAL de `DamageContext` (`src/core/contracts.ts`). Ele existe
porque `forceDirection` carrega o rumo da CÂMERA enquanto `hitPosition` sai do raio do CANO — a
poucos metros os dois divergem em graus, o bastante para o teste errar de lado. Quem não preencher
`hitDirection` cai em `forceDirection` e nada quebra.

O centro de cada esfera sai de `node.getAbsolutePosition()` do nó do rig. Isso já compõe raiz radial
do planeta → escala do ator → pose do clipe, então a zona acompanha a animação e qualquer
orientação da casca **sem nenhuma conversão manual de espaço**. O teste de orientações radiais
cobre polo norte, equador, polo sul e uma diagonal.

## Quem PODE abrir ponto fraco

Só `damageTags` com `bullet`, `attackerId === 1` e `procChainDepth === 0`
(`weakPointEligible`). Ficam de fora:

- corpo a corpo — não tem linha de tiro para testar;
- queimadura, explosão de item e qualquer dano derivado — dar crítico a eles seria o "crítico em
  todo acerto por aproximação" que o pedido recusa, e abriria cascata de multiplicadores;
- dano de inimigo.

## Dano e retorno

`WEAK_POINT_MULTIPLIER = 2,4`, acima do crítico comum (×2) para o acerto mirado valer mais que a
sorte. **Não empilha**: quando a zona acerta, o dado do crítico aleatório nem chega a ser rolado
(`EnemySwarm.hit`), então o multiplicador é 2,4 e nunca 4,8.

Retorno na tela: o rótulo de dano ganha a classe `weak` (ciano, maior, com `✦`) em vez do `crit`
dourado, e sai um estalo de energia no ponto de impacto — reaproveitando o pool
`CombatPresentation.burst`, sem arte nova. `EnemySwarm.weakHits` e `lastWeakPoint` ficam expostos
para diagnóstico.

## Limites honestos

- Para atores a mais de 24 m a pose é amostrada a 1/30 ou 1/15 s (LOD de animação). A esfera pode
  estar até um quadro de animação atrasada; a essa distância a asa ocupa poucos pixels.
- As zonas são **esferas**, não a malha. Uma asa é fina em Z e a esfera cobre um pouco mais que ela
  nesse eixo. A escolha foi deixar a zona claramente separada do tronco (ver a conta de |x| acima)
  em vez de perseguir a silhueta exata.
- A prévia esférica `?mode=planet-preview` (`PlanetScene` + `PlanetEnemies`) **não** tem pontos
  fracos: ela resolve tiro por cápsula e não instancia o rig por osso. O jogo real (`PlayerScene`,
  com ou sem `world=planet`) tem.
- Nenhum teste automatizado prova que a zona coincide com o que o olho reconhece na tela. Isso
  depende de uma revisão visual no navegador, que não foi feita nesta entrega.
