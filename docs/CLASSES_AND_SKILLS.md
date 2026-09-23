# Classes e habilidades — Pistoleiro, Soldado e Marijuano

A expedição passou a começar com uma DECISÃO: qual exterminador vai a campo. A escolha é feita no
menu principal, antes do `PRESS START`, e vale a expedição inteira.

**Não existe troca de arma dentro de uma tentativa.** As teclas `B` (trocar arma) e `T` (próxima
forma) foram removidas do jogo — do teclado, do quadro de entrada, do painel de arma, do cartão de
controles e do F1.

| | Pistoleiro (padrão) | Soldado | Marijuano |
|---|---|---|---|
| Arma | Pistolas duplas | PRISM triforme | Submetralhadora de seda |
| `Q` nível I (0,6 s) | Leque ricocheteante (25 MP) | **Transformar a PRISM** (grátis) | Rajada de seda (25 MP) |
| `Q` nível II (1,4 s) | Barragem com mortal (55 MP) | Habilidade II **da forma** (55 MP) | Chuva de buds (55 MP) |
| `Q` nível III (2,6 s) | Tempestade da colheita (100 MP) | Habilidade III **da forma** (100 MP) | Bafo do cânhamo (100 MP) |
| Cinemática de habilidade | sim (voz, pose e coreografia autorais) | **não** | **não** |

O Pistoleiro é exatamente o jogo que já existia: nada do combate dele foi tocado.

## Onde a escolha vive

`src/run/PlayerClass.ts` — regra pura, sem DOM e sem cena.

- **Padrão**: `gunslinger` (Pistoleiro). Quem nunca escolheu entra assim.
- **Persistência**: `localStorage`, chave `risk-of-watermelon:player-class`. Gravada no instante da
  escolha. Armazenamento corrompido, bloqueado (modo privado) ou ausente cai no padrão sem estourar.
- **URL**: `?class=soldier` manda na abertura e é gravada — serve a links de revisão e ao QA.
- **Atravessa**: estágios (viagem entre biomas), `RENASCER` (a mesma expedição repetida) e o
  recarregamento da página.
- **Destranca**: só `VOLTAR AO MENU`.

`src/ui/ClassSelect.ts` desenha os dois cartões dentro do mesmo `.gate-card` do `PRESS START`, como
um `radiogroup` acessível. O bloco continua **legível** quando travado (o jogador ainda vê com o que
está jogando) e escreve o motivo; esconder o controle sumiria com a informação junto.

A trava segue dois sinais que o menu já tinha:

| Estado do menu | `entered` | `dead` | Escolha |
|---|---|---|---|
| Primeira abertura | `false` | `false` | **livre** |
| Em campo / pausado com `Esc` | `true` | `false` | travada |
| Relatório de derrota | `false`/`true` | `true` | travada |
| Depois de `VOLTAR AO MENU` | `false` | `false` | **livre** |
| Depois de `RENASCER` | `true` | `false` | travada (mesma classe) |

## As seis habilidades do Soldado

`src/combat/PrismSkills.ts` — a tabela e o relógio, puros. `PrismWeapon` executa.

Nenhuma reimplementa física: `burst` e `volley` caem no **mesmo** `hitscan` do tiro comum (só com
outro perfil de dano) e as duas de leque caem no **mesmo** `launchCapsule`, com uma *carga* na
cápsula dizendo o que a explosão vira. É por isso que mira, colisão, destruição, ponto fraco e
armadura de afixo valem para elas de graça.

### Assalto

| | Nome | Munição | Efeito |
|---|---|---|---|
| II | RAJADA CONTROLADA | 6 balas | 6 tiros a 0,07 s, **abertura zero** (o tiro normal abre 1,7°), dano ×2,4 |
| III | SOBRECARGA DE DISPARO | exige 8 carregadas | 6 s de janela: cadência ×2,4, abertura zero, dano ×1,5 |

A sobrecarga não emite tiro próprio — ela **reescreve o disparo normal** enquanto dura. Gatilho
preso continua sendo gatilho preso; o que muda é a cadência, a estabilidade e o dano. Ela não cobra
munição ao abrir: cobra em tempo real, queimando o carregador (e a recarga continua permitida
dentro da janela, senão a arma morreria no meio do ultimate).

### Lança de íons

| | Nome | Munição | Efeito |
|---|---|---|---|
| II | PERFURANTE PESADA | 2 balas | **um** tiro, dano ×3,2, perfurando a fila inteira |
| III | SALVA DE ÍONS | 4 balas | 4 feixes a 0,16 s, dano ×1,9, um por **alvo diferente** |

A salva escolhe os alvos por proximidade angular da mira, exige **linha de visão real** (a mesma
varredura que barra a bala) e nunca repete corpo. **Recuo para a frente**: quando há menos corpos
visíveis que feixes, os que sobram saem na mira — a habilidade nunca é desperdiçada por falta de
alvo nem gasta dois feixes no mesmo bicho.

O bônus de ponto fraco de ×2 do `prism_sniper` (regra existente em `EnemySwarm.hit`) continua
valendo para as duas: o `sourceId` é o da forma, e o que distingue a habilidade é o `attackId`.

### Lança-granadas

| | Nome | Munição | Efeito |
|---|---|---|---|
| II | LEQUE DE CÁPSULAS | 3 cápsulas | 3 no mesmo passo, abertas em 16° |
| III | SALVA INCENDIÁRIA | 5 cápsulas (o carregador inteiro) | 5 a 0,04 s em 26°, raio ×1,5, dano ×1,5, **incendiária** |

O leque gira em torno da vertical **local**, não do `+Y` do mundo — ele abre na horizontal do
jogador em qualquer ponto da casca do planeta.

Limites escritos, não implícitos:

- `PRISM_SKILL_BLAST_CAP = 1,5` é teto do raio. "Explosão maior" é 6,9 m, não limpeza de tela.
- A explosão da habilidade **continua sem dano atrás de parede**: o teste de linha de visão é o
  mesmo da cápsula comum. Aumentar o raio não compra direito de atravessar cobertura.
- Cinco cápsulas cabem sob o teto de oito vivas (`PRISM_GRENADE.maxLive`).
- A queimadura é a que o jogo já tem (a mesma do item *Seiva incendiária*): `INCENDIARY_SECONDS = 4`,
  aplicada com `Math.max` — acertar o mesmo bicho com cinco cápsulas **renova**, não empilha.

## Munição, MP e recusa honesta

As habilidades custam **dois** recursos ao mesmo tempo.

1. O MP é descontado na **soltura** do `Q` (`MPCharge.update`, custos `[25, 55, 100]`).
2. `PrismWeapon.releaseSkill` retira a munição do carregador **da forma**, de uma vez.
3. Se ela recusar (arma guardada, transformação, recarga, outra habilidade no ar, munição
   insuficiente), `PlayerScene` **devolve o MP** com `mp.gain(MP_COSTS[tier-1])`. Cobrar por uma
   habilidade que não aconteceu seria roubo silencioso.

Etiquetas de dano, e o que cada uma compra:

| Emissão | Tags | Ponto fraco | MP por acerto | Escala `stats.mp` |
|---|---|---|---|---|
| Tiro comum da PRISM | `bullet` | sim | sim | não |
| Rajada / pesada / salva / sobrecarga | `bullet`, `skill` | **sim** | **não** | sim |
| Contato direto de cápsula de habilidade | `bullet`, `skill` (+`incendiary`) | sim | não | sim |
| Estilhaço de habilidade | `explosive`, `skill` (+`incendiary`) | não | não | sim |

`skill` desligar o MP é deliberado: uma sobrecarga de seis segundos se pagaria sozinha e a barra
deixaria de ser um recurso.

Guardas de munição que o teste trava:

- as emissões **não** cobram de novo — a conta foi fechada em `releaseSkill`;
- o gatilho comum fica travado enquanto há emissões pendentes (os dois canos não cospem juntos);
- a recarga automática de carregador vazio **espera** a habilidade acabar, senão ela devolveria de
  graça a munição que a habilidade acabou de cobrar;
- `R` é recusado durante uma rajada, pelo mesmo motivo;
- guardar a arma no meio (punhos, morte, viagem) **corta** as emissões restantes. A munição já
  gasta não volta: é o mesmo princípio da recarga cancelada.

## O Marijuano e a submetralhadora de seda

`src/combat/SmgTuning.ts` (os números), `src/combat/SmgRig.ts` (o rig autoral),
`src/combat/BudShots.ts` (os buds desenhados) e `src/combat/MarijuanoWeapon.ts` (o backend).

A identidade dela é **volume**, não precisão: cadência 11/s, dano 5,5 por bud, carregador de 45 e
2,63 s de recarga (casados com o clipe `Reload` do GLB). Não perfura, não explode e não tem luneta
— mirar APERTA o leque (3,2° → 1,6°) em vez de aproximar.

**O projétil é o bud autoral**, `cannabis_bud_projectile.glb` do pacote, e não o rastro genérico.
Ele é DESENHO: o dano é instantâneo (o mesmo `hitscan` do assalto da PRISM, pela mesma porta
`CombatServices`). Duas escolhas existem só para ele ser VISTO, e estão escritas na tabela:
`budSpeed = 70 m/s` (lento para uma bala, legível para um olho) e `budScale = 3,2` (o modelo tem
7 cm; a 15 m, em terceira pessoa, isso é meio pixel). Nenhuma das duas toca em colisão.

| | Nome | Munição | Efeito |
|---|---|---|---|
| I | RAJADA DE SEDA | 10 buds | 10 tiros a 0,05 s, abertura zero, dano ×1,8 |
| II | CHUVA DE BUDS | 18 buds | 18 tiros a 0,035 s num leque de 24° |
| III | BAFO DO CÂNHAMO | exige 12 carregados | 6 s de janela: cadência ×2,2, abertura zero, dano ×1,5 |

As três são o MESMO disparo com outros números — nenhuma abre caminho de dano novo. O leque do
nível II gira em torno da vertical **local**, não do `+Y` do mundo: ele abre na horizontal do
jogador em qualquer ponto da casca do planeta, como o leque de cápsulas do Soldado.

O nível III segue a convenção da SOBRECARGA DE DISPARO do Soldado: não cobra munição ao abrir,
cobra em tempo real queimando o carregador, e a recarga continua **permitida** dentro da janela —
senão a arma morreria no meio do ultimate. Dentro de uma rajada dos níveis I e II, o `R` é
recusado, porque encher o carregador ali devolveria de graça a munição que a habilidade cobrou.

Etiquetas: o bud comum é `bullet` (ponto fraco e MP por acerto, como a pistola); os das habilidades
são `bullet, skill` (ponto fraco sim, MP não, dano escalando por `stats.mp`).

## Degradação

- **Rig da submetralhadora ausente**: o Marijuano joga com as pistolas, com o motivo no F1
  (`Classe MARIJUANO · SEDA: … · MARIJUANO REBAIXADO ÀS PISTOLAS`). É a mesma regra do Soldado, e
  pelo mesmo princípio: entrar em campo desarmado nunca é uma opção.
- **Rig da PRISM ausente**: o Soldado joga com as pistolas e o `Q` dele roteia pelas habilidades de
  pistola. O painel de arma e a barra de carga passam a anunciar *as de pistola* — a promessa da
  tecla acompanha a arma que está na mão, não o nome da classe. O motivo fica no F1
  (`Classe SOLDADO · PRISM: … · SOLDADO REBAIXADO ÀS PISTOLAS`).
- **Cadáver**: o corpo articulado da morte continua recebendo as PISTOLAS, para as duas classes.
  É o mesmo limite já registrado em `docs/PRISM_GAMEPLAY.md`.
- **Co-op (`?online=1`)**: a classe é local, como a PRISM sempre foi. Nada dela viaja no pacote.
- **Cenas legadas** (`PlanetScene`, `PlanetRun`) não foram tocadas.

## Testes

- `tests/player-class.test.ts` — padrão, saneamento, persistência, `?class=`, armazenamento hostil.
- `tests/prism-skills.test.ts` — as seis existem e são distintas; limites de raio, munição e
  cápsulas vivas; o relógio (rajada, leque simultâneo, janela da sobrecarga); e a integração de cada
  uma pela porta `CombatServices`, incluindo o recuo para a frente da salva, a explosão maior porém
  limitada, a etiqueta incendiária e todas as recusas.
- `tests/prism-weapon.test.ts` e `tests/weapon-ads.test.ts` — o painel não promete mais nenhuma
  tecla de troca, em estado nenhum.
- `tests/marijuano-weapon.test.ts` — o gatilho automático, a munição, a recarga casada com o clipe,
  a recusa de recarga instantânea, o bud saindo do cano até o ponto REAL do acerto, as três
  habilidades (emissões, leque simétrico, janela que reescreve o gatilho) e todas as recusas.
- `scripts/audit-smg-fit.mjs` — conferência HEADLESS do encaixe, pelo mesmo caminho do Babylon que
  o jogo usa: o gatilho cai **em cima** do `RightWeaponGrip` (0,0000 m) e o cano aponta para a
  frente do punho (produto escalar 0,991). É o que impede a arma nascer flutuando ou de costas.
