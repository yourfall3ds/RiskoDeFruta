# PRISM em jogo — integração de combate

A arma transformável autorada em `docs/prism-triform.md` deixou de ser só asset e visualizador: ela
é a arma do **Soldado** no jogo real (`PlayerScene`, fazenda e planeta).

> **A arma agora é da CLASSE.** A escolha entre Pistoleiro (pistolas duplas, padrão) e Soldado
> (PRISM) é feita no menu principal e vale a expedição inteira. **Não existe troca de arma dentro de
> uma tentativa**, e as teclas `B`/`T` foram removidas. As seis habilidades `Q` II/III do Soldado
> estão documentadas em **`docs/CLASSES_AND_SKILLS.md`**, que é o documento canônico desse assunto.

Autoria do rig (pose, clipes, transformação, áudio) é do `PrismRig`. Este documento cobre o que o
BACKEND de jogo faz.

## Controles

| Tecla | Ação |
|---|---|
| `R` | Recarrega a arma que está na mão. |
| `V` | Guarda tudo e entra no combate desarmado (inalterado). |
| Clique | Dispara. |
| Botão direito | Mira apurada (ver *Atualização: mira e Q*). |
| `Q` segurado | Carrega o especial. No Soldado, o nível I **transforma** a PRISM: Assalto → Lança de íons → Lança-granadas → Assalto. |

`B` (trocar de arma) e `T` (próxima forma) **não existem mais**: saíram do teclado, do `InputFrame`,
do painel de arma e do cartão de controles. No F1 restam `PRISM: próxima forma (Q I)`,
`PRISM: recarregar (R)` e os dois novos `PRISM: habilidade II/III da forma`, todos passando pelas
mesmas portas das teclas.

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
saldo fica onde estava e volta como estava. As guardas que fecham o exploit óbvio:

1. mudar de forma CANCELA a recarga em curso, sem devolver bala;
2. a pistola escondida **congela o relógio do carregador** e não se recarrega sozinha
   (`DualPistols.concealed`) — o Soldado nunca ganha um par de pistolas cheias de graça;
3. as habilidades `Q` II/III cobram a munição **de uma vez** na soltura, e a recarga automática de
   carregador vazio espera a habilidade acabar (ver `docs/CLASSES_AND_SKILLS.md`).

A guarda antiga "trocar de ARMA cancela a recarga da que sai" perdeu o motivo de existir junto com a
tecla `B`: não há mais troca de arma em campo.

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

## Habilidades de MP: cada classe com as suas

Leque ricocheteante, barragem com mortal e tempestade da colheita têm clipe, voz, coreografia e mira
próprios, todos autorados em cima do par de pistolas. Elas são do **Pistoleiro** e continuam
exatamente como estavam. Enquanto uma delas está no ar, `PlayerScene.syncWeapons` mantém as pistolas
nas mãos e a PRISM guardada.

O **Soldado** tem seis habilidades próprias da PRISM — `Q` II e III, diferentes por forma — e
**nunca dispara uma cinemática de pistola**: `PlayerScene` roteia o `Q` dele direto para
`PrismWeapon.releaseSkill`, sem voz, sem `SkillTimeline` e sem `requestSkill`. A tabela, os números
e as guardas estão em `docs/CLASSES_AND_SKILLS.md`.

Com o Soldado em campo as pistolas ficam escondidas o tempo todo (e não só quando a PRISM está no
ar): sem isso elas reapareceriam nas mãos durante a entrada pela nave e a viagem, que é justamente
quando a PRISM está suprimida. O backend delas nunca é desligado — `concealed` é apresentação, não
estado de jogo, e é o que permite ao cadáver continuar recebendo o par.

## Apresentação

`PrismShotVisuals` usa os modelos exportados em `prism-shots.glb` (pulso, lança, cápsula, nova,
fumaça, brasa, estilhaço). Ele NÃO é a classe de prévia da oficina (`PrismShotPreview`), que inventa
o impacto a uma distância fixa porque ali não existe mundo: aqui cada posição vem do jogo — o rastro
termina no ponto que o raio realmente acertou e a cápsula é desenhada onde a balística diz que ela
está. Falhar a carga dos projéteis não derruba nada: o combate segue com os efeitos genéricos do
`ShotEffects` e o motivo aparece no F1.

## Degradação e limites conhecidos

- **Rig ausente**: se `prism-triform.glb` não subir, a PRISM não é equipável; o **Soldado é rebaixado
  às pistolas**, com o `Q` roteado para as habilidades de pistola e o painel anunciando essas, não as
  da PRISM. O motivo aparece no F1. O Jogar espera o RESULTADO da carga (etapa da barra), não o
  sucesso dela.
- **Co-op (`?online=1`)**: a PRISM e a classe são locais. O pacote de rede nunca carregou troca de
  arma nem de forma, e o movimento enviado ao servidor continua olhando o carregador da PISTOLA — a
  simulação autoritativa da fazenda é a de pistolas, e mandar estado que ela não conhece só
  produziria divergência de predição.
- **Cadáver**: o corpo articulado da morte continua recebendo as PISTOLAS. A PRISM sai das mãos no
  quadro da morte.
- **Cenas legadas** (`PlanetScene`, `PlanetRun`) não foram tocadas.


## Atualização: mira e Q (18/09)

- Botão direito segurado: mira; esquerdo pode disparar simultaneamente (eventos de mouse por botão).
- Q segurado/solto no nível I transforma a PRISM sem custo de MP, inclusive com MP zero. Pistolas mantêm o especial I antigo e seu custo.
- Pistolas: 1,18× sem luneta; assalto: 1,32× com retículo compacto; sniper: luneta 3×, scroll 1,8–8×; granada: previsão de trajetória e contato sem zoom.
- A previsão usa o mesmo passo e colisão da granada, sem dispersão aleatória. Mesmo parado, o indicador consulta novamente o cenário a cada 0,35 s para refletir inimigos e destruição.
- Dano base local: assalto 7 por tiro a 9/s; sniper 140 a 0,65/s, 280 no ponto fraco antes de itens/armadura; granada 20 de contato mais até 55 de explosão (queda com distância), 0,6/s.

## Atualização: classes e habilidades por forma (18/09)

As skills II e III específicas por forma **existem** e são seis, uma por (forma, nível). A
integração deixou de conservar as coreografias de pistola para o Soldado — ele tem as próprias, e o
Pistoleiro ficou com as três autorais intactas. O documento canônico é
**`docs/CLASSES_AND_SKILLS.md`**; o resumo:

| Forma | `Q` II (55 MP) | `Q` III (100 MP) |
|---|---|---|
| Assalto | RAJADA CONTROLADA — 6 tiros mirados, sem abertura, ×2,4 | SOBRECARGA DE DISPARO — 6 s a 2,4× de cadência, ×1,5 |
| Lança de íons | PERFURANTE PESADA — 1 tiro ×3,2, perfurando a fila | SALVA DE ÍONS — 4 feixes multi-alvo ×1,9, com recuo para a frente |
| Lança-granadas | LEQUE DE CÁPSULAS — 3 cápsulas abertas em 16° | SALVA INCENDIÁRIA — 5 cápsulas em 26°, raio ×1,5, incendiária |

A escolha de classe vive no menu principal (`src/ui/ClassSelect.ts`), é persistida
(`src/run/PlayerClass.ts`), atravessa estágios e `RENASCER`, e só `VOLTAR AO MENU` a destranca.
