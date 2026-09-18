# PRISM em jogo — integração de combate

A arma transformável autorada em `docs/prism-triform.md` deixou de ser só asset e visualizador: ela
é agora a arma básica do exterminador no jogo real (`PlayerScene`, fazenda e planeta). **As pistolas
não saíram** — as duas convivem, e a troca é uma tecla.

Autoria do rig (pose, clipes, transformação, áudio) é do `PrismRig`. Este documento cobre o que o
BACKEND de jogo faz.

## Controles

| Tecla | Ação |
|---|---|
| `B` | Alterna PRISM ↔ pistolas duplas. A PRISM vem equipada por padrão assim que o rig carrega. |
| `T` | Avança a forma: Assalto → Lança de íons → Lança-granadas → Assalto. |
| `R` | Recarrega a arma que está na mão. |
| `V` | Guarda tudo e entra no combate desarmado (inalterado). |
| Clique | Dispara. |
| Botão direito | Carrega as habilidades de MP (inalterado). |

`B` e `T` não colidiam com nada: o jogo só usava `W A S D`, `Espaço`, `Shift`, `R`, `E`, `V`, `Esc`,
`Enter`, `Tab`, `F1` e `F2`. Os três atalhos também existem como botões de QA no F1
(`PRISM: trocar arma / próxima forma / recarregar`), passando pelas mesmas portas das teclas.

## As três formas

Números em `src/combat/PrismTuning.ts`.

| Forma | Cadência | Dano base | Carregador | Recarga | Comportamento |
|---|---:|---:|---:|---:|---|
| Assalto | 7,5/s automático | 9 | 36 | 2,6 s | Hitscan, um corpo por tiro, abertura de 1,7°. |
| Lança de íons | 0,85/s semiauto | 78 | 6 | 3,0 s | Hitscan PERFURANTE, sem abertura, 320 m. |
| Lança-granadas | 0,75/s semiauto | 34 + 62 de área | 5 | 3,2 s | Projétil balístico com explosão de raio 4,6 m. |

Os tempos de recarga são os dos clipes `*_Reload` do GLB, então a animação da arma termina junto com
o carregador cheio.

## Munição: uma por forma, sem refill de graça

Cada forma tem o próprio carregador (`PrismArsenal`). Trocar de forma **não toca em munição**: o
saldo fica onde estava e volta como estava. Três guardas fecham o exploit óbvio de duas armas e um
botão de troca:

1. mudar de forma CANCELA a recarga em curso, sem devolver bala;
2. trocar de ARMA (`B`) cancela a recarga da que sai, sem devolver bala;
3. a pistola escondida **congela o relógio do carregador** e não se recarrega sozinha
   (`DualPistols.concealed`) — senão as duas armas encheriam ao mesmo tempo.

O carregador vazio ainda dispara a recarga automática, como a pistola sempre fez.

## Dano, crítico, ponto fraco e MP

Nada disso foi reimplementado. A PRISM consome a porta `CombatServices`, que `DualPistols` publica:
mira, colisão de mundo (inclusive o backend radial do planeta e os triângulos derrubados pela
destruição), escolha de ator, `DamageDealt`/`onHit`, destruição de cenário e efeitos. O receptor
(`EnemySwarm.hit`) continua aplicando `stats.damage`, crítico, ponto fraco e armadura de afixo, e o
MP continua sendo pago por `EnemyHit`.

- Tiro instantâneo e **impacto direto** da cápsula entram com `damageTags: ['bullet']` — disputam
  ponto fraco e alimentam a barra de MP, como a pistola.
- O **estilhaço** da explosão entra com `['explosive']`. Não disputa ponto fraco (um raio partindo do
  centro do corpo viraria "crítico por aproximação", que `WeakPoints` recusa por escrito) e não
  alimenta MP (uma explosão em seis corpos seria uma fazenda de barra). MP continua vindo do acerto
  direto.
- `attackSpeed` da progressão multiplica a cadência das duas armas.

## Balística e explosão

`PrismGrenades` é física pura, sem Babylon: velocidade inicial na mira, queda pela vertical LOCAL
(no planeta a radial, não `+Y`) e um teste de SEGMENTO por passo. O segmento é o que garante que a
cápsula nunca atravessa cenário mesmo a 34 m/s num quadro de 60 Hz.

A explosão é limitada e honesta:

- queda linear do centro (×1) até a borda (×0,3), e **zero** fora do raio;
- cada corpo dentro do raio ainda precisa de LINHA DE VISÃO real até a explosão, medida na mesma
  colisão que barra a bala — **não há dano atrás de parede**;
- o raio de visão parte de 25 cm à frente da superfície atingida, senão a própria parede em que a
  granada bateu deixaria de bloquear quem está do outro lado;
- o cenário leva a explosão pela mesma porta de destruição do tiro e do soco;
- teto de 8 cápsulas vivas; estourado, a mais antiga DETONA (munição gasta sempre vira explosão).

Não há dano próprio: o jogador não é um alvo atingível. Nenhum modo de invulnerabilidade foi
adicionado — as guardas de QA existentes (`invincible`) continuam sendo as únicas.

## Habilidades de MP continuam nas pistolas

Leque ricocheteante, barragem com mortal e tempestade da colheita têm clipe, voz, coreografia e mira
próprios, todos autorados em cima do par de pistolas. Elas **não** foram portadas para a PRISM.
Enquanto uma delas está no ar, `PlayerScene.syncWeapons` devolve as pistolas às mãos e guarda a
PRISM — senão a cinemática tocaria com as mãos vazias e os dois canos disparariam juntos. A PRISM
também não dispara durante a habilidade.

O backend das pistolas nunca é desligado: `concealed` é apresentação, não estado de jogo.

## Apresentação

`PrismShotVisuals` usa os modelos exportados em `prism-shots.glb` (pulso, lança, cápsula, nova,
fumaça, brasa, estilhaço). Ele NÃO é a classe de prévia da oficina (`PrismShotPreview`), que inventa
o impacto a uma distância fixa porque ali não existe mundo: aqui cada posição vem do jogo — o rastro
termina no ponto que o raio realmente acertou e a cápsula é desenhada onde a balística diz que ela
está. Falhar a carga dos projéteis não derruba nada: o combate segue com os efeitos genéricos do
`ShotEffects` e o motivo aparece no F1.

## Degradação e limites conhecidos

- **Rig ausente**: se `prism-triform.glb` não subir, a PRISM não é equipável, o jogo inteiro fica nas
  pistolas e o motivo aparece no F1. O Jogar espera o RESULTADO da carga (etapa da barra), não o
  sucesso dela.
- **Co-op (`?online=1`)**: a PRISM é local. O pacote de rede não carrega troca de arma nem de forma,
  e o movimento enviado ao servidor continua olhando o carregador da PISTOLA — a simulação
  autoritativa da fazenda é a de pistolas, e mandar estado que ela não conhece só produziria
  divergência de predição.
- **Cadáver**: o corpo articulado da morte continua recebendo as PISTOLAS. A PRISM sai das mãos no
  quadro da morte.
- **Cenas legadas** (`PlanetScene`, `PlanetRun`) não foram tocadas.
