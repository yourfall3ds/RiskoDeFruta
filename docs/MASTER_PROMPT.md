# ATUALIZAÇÃO DO USUÁRIO — 2026-09-06

Não usar Meshy: sem créditos. Trabalhar com os assets locais existentes e Blender. Nenhuma integração ou chave Meshy é necessária. Os arquivos locais gerados anteriormente no Meshy continuam disponíveis como assets.

Atualização visual: o usuário exige resultado ultra-realista. Priorizar qualidade de materiais, iluminação, geometria, animação e efeitos; preservar o universo de criaturas e fazendas cósmicas das referências. Realismo não está validado pela cena técnica M0 e não deve ser prometido apenas pela escolha do motor.

Workflow visual: manter prévia no navegador disponível para o usuário acompanhar a construção, além dos testes automatizados. Comparar capturas reais do jogo às referências nos marcos visuais.

---

# Atualizações de direção após o prompt original

- Sem Meshy; usar arquivos locais, Blender e assets licenciados.
- Trabalho headless autorizado. Não descartar alterações não salvas no Blender.
- Reaproveitar caminhada, corrida e rolagem; criar poses específicas de ataque e habilidade.
- Priorizar a câmera da imagem (2): personagem próximo no terço esquerdo, vista sobre o ombro. Essa instrução posterior substitui a câmera central distante especificada abaixo.
- Evitar excesso de geometria procedural, principalmente sem textura. Arte final deve buscar materiais e iluminação ultrarrealistas.

# MASTER PROMPT — MUTANT FARM ROGUELIKE
# Babylon.js + TypeScript
# THIRD-PERSON ACTION ROGUELIKE

Você é o Lead Gameplay Engineer e Technical Director deste projeto.

Sua missão é construir do zero um roguelike 3D de ação em terceira pessoa extremamente responsivo, visualmente rico, data-driven, performático e preparado para grandes quantidades de inimigos.

O jogo NÃO pode parecer:

- tech demo;
- projeto Babylon;
- arena shooter genérico;
- asset flip;
- prototype com inimigos deslizando;
- jogo de waves simples.

Ele precisa parecer um JOGO completo.

Prioridades absolutas:

1. GAME FEEL.
2. COMBATE.
3. MOVIMENTAÇÃO.
4. INIMIGOS COM PERSONALIDADES DIFERENTES.
5. ROGUELIKE / BUILDS.
6. PERFORMANCE.
7. DIREÇÃO VISUAL.
8. CONTEÚDO ESCALÁVEL.

Não sacrifique arquitetura por velocidade, mas também NÃO superengenhe sistemas que não precisamos.

---

# 1 — CONCEITO

O jogo se passa em fragmentos de antigas regiões agrícolas que agora flutuam no espaço.

A agricultura sofreu uma mutação biológica extrema.

Frutas, legumes, raízes, plantas e fungos tornaram-se criaturas predatórias.

O jogador faz parte de uma organização de exterminadores agrícolas espaciais.

A fantasia é:

COMEÇAR FRACO

→ matar criaturas

→ ganhar créditos e XP

→ comprar itens

→ empilhar itens

→ criar sinergias

→ gerar proc chains

→ aumentar mobilidade e poder

→ enfrentar hordas cada vez mais absurdas

→ derrotar a PRAGA ALFA

→ atravessar um Wormhole

→ próximo estágio.

O tom é:

CAOS AGRÍCOLA CÓSMICO.

Colorido.

Estilizado.

Muito detalhado.

Agressivo.

Absurdo, mas tratado seriamente pelo universo.

Não infantil.

Não cozy.

Não gore humano realista.

---

# 2 — STACK TÉCNICO

Utilize:

- TypeScript
- strict: true
- Vite
- Babylon.js modular
- @babylonjs/core
- @babylonjs/loaders
- Havok quando realmente necessário
- ES Modules

Render inicial:

WebGL2.

Arquitetura não deve impedir WebGPU futuramente.

Não utilizar Legacy/legacy gigantes sem necessidade.

UI principal:

HTML + CSS + DOM sobre o canvas Babylon.

World-space UI pode utilizar Babylon GUI quando apropriado.

---

# 3 — ARQUITETURA

Não crie God Objects.

PROIBIDO:

GameManager gigante.

PlayerController com milhares de linhas.

Enemy.ts contendo todos os inimigos.

ItemManager com switches gigantes.

UIManager responsável por tudo.

if/else para cada item.

if(enemyType === ...).

Arquitetura desejada:

src/
  core/
  engine/
  game/
  player/
  camera/
  input/
  combat/
  skills/
  items/
  stats/
  status/
  enemies/
  ai/
  navigation/
  director/
  stages/
  interactables/
  pickups/
  economy/
  animation/
  physics/
  vfx/
  audio/
  ui/
  world/
  rendering/
  save/
  debug/
  content/
  utils/

Usar:

entidades + componentes leves + systems.

Não implementar ECS acadêmico completo.

Separar:

ENGINE
GAMEPLAY
CONTENT

Adicionar novo inimigo deve exigir principalmente:

EnemyDefinition
AttackDefinitions
AnimationDefinition
model/animations

e NÃO alteração nos sistemas centrais.

---

# 4 — LOOP DE SIMULAÇÃO

Gameplay simulation:

fixed timestep 60 Hz.

Render desacoplado.

IA não precisa atualizar a 60 Hz.

Criar scheduler de AI update.

Exemplo:

perto do jogador:
15–20 Hz.

distância média:
8–10 Hz.

longe:
2–5 Hz.

Animation render continua visualmente suave.

Director atualiza em frequência própria.

Nunca execute lógica pesada desnecessariamente por frame para todas as entidades.

---

# 5 — PLAYER 01

ID:

player_gunslinger_01

Fantasia:

exterminador agrícola espacial humanoide.

Visual:

astronauta + trabalhador rural futurista.

Duas pistolas.

Alta mobilidade.

---

# 6 — MOVIMENTAÇÃO

Velocidade padrão:

9 m/s.

Não existe sprint.

Aceleração/desaceleração:

aproximadamente 0.08s.

Movimentação lateral e para trás:

sem penalidade.

Pulo:

apex aproximadamente 2.2m.

Gravidade inicial:

28 m/s².

Air control:

75%.

Coyote time:

130 ms.

Jump buffer:

150 ms.

Step height:

0.5m.

Slope caminhável:

aproximadamente 50°.

Terminal velocity:

70 m/s.

Sem dano normal de queda.

Double jump NÃO existe por padrão.

Itens podem conceder.

Momentum aéreo pode atingir aproximadamente 130% da velocidade normal.

---

# 7 — VAZIO

Cair do mapa NÃO mata imediatamente.

Ao entrar no kill-volume:

remover 25% do HP máximo.

recolocar jogador na última posição segura.

Registrar SafeGroundPosition aproximadamente a cada 0.5s enquanto grounded em superfície válida.

Aplicar breve proteção após respawn.

---

# 8 — CÂMERA

Third person central.

Distância:

aprox. 7m.

Pivot:

aprox. 1.7m.

FOV:

85°.

Smoothing extremamente leve:

aprox. 0.06s.

Camera collision:

spherecast.

Não permitir câmera atravessando geometria.

FOV kick somente em eventos fortes.

Camera shake configurável.

---

# 9 — INPUT

WASD:
movimento.

Mouse:
câmera / aim.

LMB:
tiro primário.

RMB HOLD:
carregar MP.

RMB RELEASE:
soltar MP.

SPACE:
jump.

SHIFT:
dodge.

E:
interagir.

F1:
Debug Menu.

---

# 10 — DUAL PISTOLS

Segurar LMB dispara automaticamente.

Alternar:

RIGHT
LEFT
RIGHT
LEFT.

Cadência inicial:

6.7 tiros/s somando as duas pistolas.

Dano inicial:

12.

Munição:

infinita.

Sem reload.

Gameplay:

hitscan.

Visual:

tracer rápido.

Não desenhar linhas longas persistentes.

Pipeline:

camera center ray
→ aimPoint
→ muzzle
→ hitPoint.

Cada arma possui muzzle próprio.

Spread:

aproximadamente 1.5°.

Sem falloff inicialmente.

Proc coefficient:

1.0.

Sem headshot inicialmente.

---

# 11 — GAME FEEL DAS ARMAS

TODO DISPARO deve produzir:

muzzle flash.

recoil procedural.

animação/recoil independente da arma correspondente.

tracer.

impact VFX.

impact audio.

hitmarker quando acertar.

camera impulse extremamente leve.

Não desenhar raycast de debug durante gameplay.

---

# 12 — DAMAGE CONTEXT

Todo dano passa por DamageContext.

Deve conter no mínimo:

attackerId
victimId
sourceId
attackId
baseDamage
finalDamage
crit
procCoefficient
procChainDepth
damageTags
hitPosition
hitNormal
forceDirection
forceMagnitude

Nenhum sistema aplica dano arbitrariamente sem DamageContext.

---

# 13 — HIT REACTION

Todo inimigo deve reagir visualmente ao dano.

LIGHT HIT:

pequeno jerk procedural.
material flash 60–100ms.
partículas.
som.

HEAVY HIT:

stagger curto.

LAUNCH:

força física / deslocamento.

KILL:

death physics.

Não interromper IA completamente a cada tiro comum.

---

# 14 — DEATH / RAGDOLL

Não utilizar:

HP <= 0
→ mesh desaparece.

Criar DeathSystem.

Dependendo do inimigo:

humanoide / skeleton complexo:
ragdoll físico quando viável.

criatura redonda:
rigidbody + torque + impulse.

criatura pequena:
death animation + physics impulse.

O último DamageContext define:

direção.
força.
ponto do impacto.

Corpos permanecem aproximadamente 5–10s.

Limite inicial:

20 cadáveres físicos.

Quando exceder:

cadáver mais antigo inicia dissolve/decomposition.

Explosões afetam cadáveres fisicamente.

---

# 15 — DODGE

SHIFT.

Roll/dive rápido.

Distância:

aprox. 6m.

Duração:

0.25s.

Duas charges.

Recarga:

aprox. 2.5s por charge.

I-frames:

aproximadamente primeiros 0.15s.

Direção:

input WASD.

Sem input:
frente.

Pode ser usado no ar uma vez por salto.

Pode atravessar gaps.

Hook obrigatório:

onDodge.

Dodge pode ser modificado por itens.

---

# 16 — MP CHARGE

Esta é uma mecânica central do jogo.

Segurar RMB começa carga.

Thresholds:

MP I:
0.6s.

MP II:
1.4s.

MP III:
2.6s.

Mover durante carga:

70% velocidade.

Não pode disparar pistolas durante carga.

Pode usar dodge.

Dodge NÃO perde carga.

Receber dano NÃO cancela carga.

Soltar antes de MP I:

cancelar sem efeito.

NÃO existe cooldown tradicional.

Depois de utilizar:

MP volta para zero.

Jogador pode carregar novamente imediatamente.

O custo do ataque é o TEMPO DE CARGA.

---

# 17 — MP UI

Próximo ao crosshair:

[ I ][ II ][ III ]

Cada threshold:

segmento acende.

flash.

som próprio.

MP III:

feedback sonoro forte.

---

# 18 — MP I

DOUBLE PIERCER.

Dois tiros simultâneos extremamente fortes.

Perfura múltiplos inimigos em linha.

Serve para testar:

piercing
multi-hit
proc
critical
hit reactions.

---

# 19 — MP II

BACKFLIP BARRAGE.

Personagem se reposiciona para trás enquanto dispara grande leque de tiros.

Serve como:

ataque
reposicionamento
crowd clear.

Não transformar em cutscene.

Player mantém controle rapidamente após execução.

---

# 20 — MP III

HARVEST STORM.

Duração aproximada:

3 segundos.

Jogador continua se movendo.

Sistema encontra alvos dentro de cone frontal amplo.

Distribui grande quantidade de tiros automaticamente.

Não atacar através de paredes.

Serve como teste máximo para:

proc chains
VFX
pooling
damage
targeting
performance.

---

# 21 — PLAYER STATS

Inicial:

HP:
130.

Regeneração:
1 HP/s.

Crit chance:
0%.

Crit multiplier:
2x.

Armor:

fórmula hiperbólica.

damageReduction =
armor / (armor + 100)

Arquitetura já deve permitir futuramente:

Shield
Barrier
AttackSpeed
MoveSpeed
Crit
Armor
Luck
Cooldown
Jump
Damage
Healing
etc.

---

# 22 — EVENT BUS

Criar eventos tipados.

No mínimo:

DamageDealt
DamageTaken
EnemyHit
EnemyKilled
PlayerHit
PlayerKilled
SkillUsed
MPCharged
MPReleased
Dodged
ItemPicked
ItemStackChanged
StageStarted
StageCompleted
BossSpawned
BossKilled
InteractableUsed
LevelUp

Itens não devem conhecer diretamente PlayerController.

Itens observam eventos.

---

# 23 — ITEM SYSTEM

Itens são data-driven.

ItemDefinition:

id
displayName
rarity
description
icon
stackBehavior
statModifiers
eventHooks
procDefinition
visualEffects

Stacking:

stats normalmente linear.

chances usam diminishing returns / curva hiperbólica quando necessário.

Proc chains:

profundidade inicial máxima 5.

DamageContext deve carregar:

procChainDepth
sourceProcId

Itens declaram:

canTriggerProcs.

Impedir loops infinitos.

---

# 24 — 12 ITENS DO VERTICAL SLICE

Criar itens temporários com nomes editáveis, cobrindo:

1 dano.
2 attack speed.
3 movement speed.
4 dodge.
5 jump.
6 crit.
7 healing.
8 defense.
9 on-hit.
10 on-kill.
11 AoE.
12 MP modifier.

Todo item precisa possuir efeito VISÍVEL.

Exemplo:

attack speed:
animação/muzzle aceleram.

fire proc:
fogo real no inimigo.

onKill:
explosão física.

chain:
arco visual.

MP modifier:
mudança visual no ataque.

Não criar upgrades que existem somente como números invisíveis.

---

# 25 — ECONOMIA

Inimigo morto entrega:

XP
créditos.

Créditos entram automaticamente.

Não exigir pegar moedas.

Mas criar feedback:

partículas/fragmentos de energia saem do inimigo e voam visualmente para HUD.

Ouro restante ao trocar estágio:

converter em XP.

---

# 26 — INTERACTABLES

Primeiros três:

SUPPLY CONTAINER

paga → item aleatório.

MULTI SHOP

três opções visíveis → compra uma.

RISK ALTAR

paga → chance de recompensa → custo aumenta.

Todos implementam interface comum:

Interactable.

---

# 27 — DIRECTOR

Não utilizar waves discretas simples.

Criar MonsterDirector.

Trabalha com créditos.

Cada inimigo possui:

directorCost
spawnWeight
minimumDifficulty
maximumCount
spawnGroup
stageTags

Director acumula créditos.

Pode guardar créditos para unidades mais caras.

Director escolhe COMPOSIÇÕES.

Não somente inimigo aleatório.

Exemplos:

6 Broccoli + 1 Corn.

2 Watermelon + 5 Broccoli.

2 FireTomato + 1 Corn + swarm.

Objetivo:

encontros parecem intencionais.

---

# 28 — HORDE STATES

Internamente existem:

HordeState1
HordeState2
HordeState3
FinalHorde
Boss

Transição híbrida:

tempo fornece piso.

kills aceleram.

tempo máximo impede jogador de estacionar indefinidamente.

Não mostrar:

WAVE 1 COMPLETE.

A pressão muda organicamente.

FinalHorde:

aprox. 2.5x pressão inicial.

Depois dela:

spawnar boss.

---

# 29 — POPULAÇÃO

Vertical slice:

target de 50 inimigos simultâneos.

Arquitetura:

preparada para aproximadamente 300 entidades hostis sem reescrita.

Isto NÃO significa obrigatoriamente renderizar 300 modelos complexos agora.

---

# 30 — SPAWN

Enemy spawn mínimo:

aprox. 30m.

Máximo:

aprox. 90m.

Spawn PODE acontecer dentro do campo de visão porque nossa ficção possui animação de nascimento.

Mas nunca:

inimigo aparece instantaneamente.

Todo inimigo possui SpawnPresentation.

Duração aproximada:

0.7–1.2s.

Inimigos podem receber dano durante spawn.

---

# 31 — REGRA FUNDAMENTAL DOS INIMIGOS

TODOS OS INIMIGOS DEVEM PARECER DIFERENTES EM GAMEPLAY.

É PROIBIDO fazer:

mesma AI
+ mesh diferente
+ velocidade diferente.

Cada espécie deve possuir:

silhueta própria.
locomoção própria.
idle próprio.
spawn próprio.
windup próprio.
ataques próprios.
recovery próprio.
hit reaction próprio.
death behavior próprio.
áudio próprio.

Pode reutilizar infraestrutura.

Não reutilizar personalidade.

---

# 32 — STATE MACHINE UNIVERSAL

Todos utilizam estados conceituais:

SPAWNING
IDLE
SEEK
POSITION
WINDUP
ATTACK
RECOVERY
STAGGER
DEAD

Cada inimigo define comportamento específico dentro desses estados.

---

# 33 — TELEGRAPH SYSTEM

Criar sistema universal.

Tipos:

CircleTelegraph
ConeTelegraph
LineTelegraph
ArcTelegraph
TargetPositionGhost

Propriedades:

size
duration
opacity
color
followTarget
dangerTime

Ataques fortes SEMPRE possuem antecipação visual.

Jogador deve pensar:

"eu devia ter esquivado"

e não:

"o que me acertou?"

---

# 34 — INIMIGO 01: BROCCOLI

ID:

enemy_broccoli_01

Função:

SWARM / MELEE / RUNNER.

Spawn:

brota rapidamente do chão.

Locomoção:

corrida curta, rápida, corpo balançando.

Spawn group:

5–8.

Ataque 1:

QUICK BITE.

pequeno windup.
mordida rápida.

Ataque 2:

PACK LUNGE.

quando vários estão próximos, alguns executam salto curto em direção ao player.

Animações mínimas:

spawn
idle
run
bite
lunge
hit
death.

Personalidade:

agressivo, numeroso, simples.

---

# 35 — INIMIGO 02: BANANA

ID:

enemy_banana_01

Função:

JUMPER.

Corpo:

casca abre como mandíbula.

Locomoção:

saltos curtos / corrida irregular.

Ataque 1:

LEAP CRUSH.

windup visível.

TargetPositionGhost aparece no solo.

Banana salta.

impacta área.

Ataque 2:

PEEL SNAP.

mordida frontal curta caso jogador esteja perto.

Animações:

spawn
idle
locomotion
leap_prepare
leap_air
landing
bite
hit
death.

---

# 36 — INIMIGO 03: CORN

ID:

enemy_corn_01

Função:

RANGED.

Mantém distância.

Ataque 1:

SEED BURST.

dispara sequência de grandes grãos lentos.

Projectiles são pooled.

Ataque 2:

CORN FAN.

dispara 5 projéteis em pequeno leque.

Projéteis precisam ser desviáveis.

Não usar hitscan.

Animações:

spawn
idle
walk
aim
burst
fan
hit
death.

---

# 37 — INIMIGO 04: WATERMELON

ID:

enemy_watermelon_01

Função:

TANK / SPACE DENIAL.

Grande.

Lento.

Ataque 1:

ROLLING CHARGE.

telegraph de linha.

transforma movimento em rolagem rápida.

colisão causa dano + knockback.

Ataque 2:

GROUND SLAM.

salto/impacto curto.

onda circular.

Animações:

spawn
idle
walk
charge_prepare
roll
slam
stagger
death.

Death:

rigidbody grande com torque.

---

# 38 — INIMIGO 05: FIRE TOMATO

ID:

enemy_fire_tomato_01

Função:

FLYING ARTILLERY.

Corpo:

tomate mutante esférico voador.

Animação de voo pode usar:

hover procedural
bob
pitch
roll

reduzindo necessidade de muitas animações esqueléticas.

Ataque 1:

FIRE SPIT.

tomate prepara ataque.

círculo aparece no chão.

cospe projétil balístico em arco.

impacto:

explosion
fire zone temporária.

Ataque 2:

BURNING DIVE.

telegraph curto.

mergulha em direção ao jogador e volta a subir.

Animações:

spawn
hover
move
spit_prepare
spit
dive
hit
death.

---

# 39 — INIMIGO 06: LETTUCE

ID:

enemy_lettuce_01

Função:

FAST MELEE / EVASIVE.

Corpo:

baixo e largo.

Locomoção:

zigzag.

Ataque 1:

LEAF LUNGE.

comprime folhas.

pausa curta.

dash de mordida.

Ataque 2:

SIDE CUT.

ataque rápido lateral ao passar pelo jogador.

Animações:

spawn
idle
run
compress
lunge
side_attack
hit
death.

---

# 40 — INIMIGO 07: CARROT

ID:

enemy_carrot_01

Função:

MOBILE ARTILLERY.

Locomoção:

pequenos pulos / corrida apoiada em raízes.

Ataque 1:

ROOT SPEAR.

marca pequena região.

raiz/espinho surge do chão.

Ataque 2:

CARROT THROW.

dispara fragmento em arco.

Animações:

spawn
idle
run
cast
throw
hit
death.

---

# 41 — INIMIGO 08: CHILI

ID:

enemy_chili_01

Função:

EXPLOSIVE RUNNER.

Muito rápido.

Ataque 1:

SELF DETONATE.

fica brilhante.

aumenta som gradualmente.

CircleTelegraph cresce.

explode.

Ataque 2:

FIRE DASH.

dash linear deixando pequeno rastro de fogo.

Animações:

spawn
idle
run
charge
dash
explode.

Pode morrer explodindo de forma menor.

---

# 42 — INIMIGO 09: ONION

ID:

enemy_onion_01

Função:

SUPPORT.

Ataque 1:

TEAR GAS.

cria área de gás.

Jogador dentro:

pequena redução visual/percepção ou debuff configurável.

Ataque 2:

SPROUT SUMMON.

gera 2–4 pequenas cebolas temporárias.

Animações:

spawn
idle
walk
gas_cast
summon
hit
death.

Prioridade AI:

manter distância de player.

permanecer próximo de aliados.

---

# 43 — INIMIGO 10: CASSAVA

ID:

enemy_cassava_01

Função:

BURROWER.

Ataque 1:

UNDERGROUND HUNT.

entra no solo.

movimento subterrâneo indicado visualmente.

TargetPositionGhost aparece próximo ao jogador.

emerge atacando.

Ataque 2:

ROOT SWIPE.

ataque curto após emergir.

Animações:

spawn
idle
walk
burrow_enter
burrow_move procedural
emerge
swipe
death.

---

# 44 — BOSS 01

ID:

boss_fruit_abomination_01

Nome provisório:

PRAGA ALFA.

Visual:

gigantesco humanoide formado por múltiplas frutas mutantes.

Uvas.

Milho.

Bananas.

Maçãs.

Folhas.

Raízes.

Frutas fundidas formando musculatura.

Extremamente bravo.

Muito maior que player.

Objetivo:

parecer uma entidade criada pelo ecossistema, e não somente "uma fruta grande".

---

# 45 — BOSS ATTACK 01

FRUIT VOLLEY.

Boss arranca/dispara gomos/frutos de seu próprio corpo.

Projéteis voam em arco.

Ground ghosts mostram posições de impacto.

Quando atingem o solo:

alguns explodem.

outros GERAM MOBS.

Spawn mínimo:

Broccoli
Banana
ou pequenos minions configuráveis.

---

# 46 — BOSS ATTACK 02

CORROSIVE SPIT.

Boss prepara a boca.

Mira no player.

Ghost aparece no chão mostrando área futura.

Boss cospe grande quantidade de líquido mutante.

Impacto:

dano
poça temporária
negação de área.

---

# 47 — BOSS ATTACK 03

MASSIVE SWIPE.

Ataque corpo a corpo.

ConeTelegraph.

Grande knockback.

---

# 48 — BOSS ATTACK 04

ROOT ERUPTION.

Múltiplos círculos aparecem no solo.

Depois de delay:

raízes/frutas emergem verticalmente.

---

# 49 — BOSS ATTACK 05

SUMMON STORM.

Boss entra em animação própria.

Vários gomos são lançados.

4–8 mobs aparecem.

Director reduz spawns normais temporariamente para evitar excesso injusto.

---

# 50 — BOSS HIT REACTION

Não stagger a cada bala.

Possui:

surface impact.
fruit particles.
juice fragments.
material flash localizado.
damage numbers.

Heavy attack pode gerar micro reaction.

---

# 51 — BOSS DEATH

Evento grande.

Não desaparecer.

Sequência:

HP zero.

Boss perde equilíbrio.

partes vegetais começam a romper.

frutas se soltam.

ragdoll / scripted fall.

impacto no chão.

radial impulse em props e cadáveres.

grande VFX.

música resolve.

Director para.

Wormhole começa formação após aproximadamente 5s.

---

# 52 — NAVIGATION

Usar Recast ou solução apropriada do Babylon.

Navmesh para unidades terrestres.

Flying enemies:

não usam navmesh tradicional.

Usar steering 3D simples com:

desiredAltitude
distanceFromPlayer
obstacleRaycasts
separation.

Ground enemies devem evitar precipícios.

Navmesh deve impedir caminhos que terminam no vazio.

---

# 53 — WORLD 01

ID:

stage_mutant_farm_01

Tema:

MUTANT FARM.

Antiga fazenda terrestre dividida em enormes ilhas flutuantes no espaço.

Estrutura aproximada:

350 × 350m de footprint.

1 ilha principal.

5 ilhas satélites.

aprox. 60m de diferença vertical.

Elementos:

barn.
silos.
windmill.
fields.
fences.
tractors.
irrigation.
bridges.
jump pads.
small cave.
mutant roots.
purple corruption.

Mapa é autoral.

Proceduralidade somente em:

player spawn.
enemy spawn.
interactables.
loot.
boss candidates.
exit.

---

# 54 — SKY / DIORAMA

Não utilizar fundo preto vazio.

Criar DioramaSkySystem.

CAMADA 1:

sky infinito.

estrelas.
nebulosas.
grande planeta/lua.

CAMADA 2:

ilhas 3D extremamente distantes.

600–1500m.

fazendas.
silos.
moinhos.
raízes.
quedas de água/escombros.

CAMADA 3:

ilhas médias.

250–600m.

maior parallax.

CAMADA 4:

asteroides.
partículas.
fragmentos.

Objetos de diorama:

sem physics.
sem collision.
sem picking.
sem AI.
sem navmesh.

Materiais simplificados.

FreezeWorldMatrix quando possível.

---

# 55 — LIGHTING

Criar WorldLightingSystem.

Preset:

mutantFarmLightingPreset.

Key Light:

DirectionalLight quente.

intensity inicial aprox. 3.

direction:
[-0.6, -1, 0.4]

color:
aprox.
[1.0, 0.82, 0.65]

Fill:

HemisphericLight fria.

intensity:
aprox. 0.25.

sky:
azul frio.

ground:
roxo escuro.

---

# 56 — PBR / ENVIRONMENT

Utilizar environmentTexture apropriada para IBL.

scene.environmentIntensity inicial:

aprox. 0.6.

Materiais importantes devem responder corretamente ao ambiente.

Especialmente:

visor.
armas.
metal.
frutas.
líquidos.
partes mutantes.

---

# 57 — POST PROCESSING

ACES tone mapping.

exposure inicial:

1.15.

contrast:

1.20.

FXAA.

Bloom sutil.

threshold:
aprox. 0.85.

weight:
aprox. 0.18.

Não transformar tela inteira em bloom.

Bloom principalmente em:

corruption.
fire.
MP.
wormhole.
elite effects.
projectiles.
pickups.

---

# 58 — FOG / DEPTH

Fog atmosférica artística muito sutil.

Objetivo:

separar:

foreground.
midground.
diorama.
sky.

Não criar neblina branca.

Cor azul-marinho/roxa extremamente escura.

---

# 59 — SHADOWS

Usar CascadedShadowGenerator quando apropriado.

Não colocar 100 inimigos em shadow casting de alta qualidade.

Prioridade de sombras:

player.
boss.
inimigos próximos.
props grandes próximos.

Distantes:

sem shadow ou shadow simplificada.

Adicionar contact shadow/blob barato quando necessário para colar criaturas pequenas ao chão.

---

# 60 — TRANSIENT LIGHTS

Criar TransientLightPool.

Usado para:

muzzle.
explosões.
fire.
MP.
wormhole.

Limitar quantidade simultânea.

Não criar uma PointLight permanente para cada projétil.

---

# 61 — VFX POOLING

Pooling obrigatório para:

tracers.
muzzle flashes.
impact particles.
explosions.
damage numbers.
telegraphs.
fire zones.
enemy spawn effects.
death particles.

Nenhum efeito frequente deve ficar usando:

new
dispose
new
dispose

a cada ataque.

---

# 62 — PROJECTILE POOLING

Projéteis reais apenas quando gameplay exige travel time.

Exemplo:

Corn seed.
Fire Tomato projectile.
boss fruits.

Pistola:

hitscan.

Pool obrigatório.

---

# 63 — ENEMY POOLING

Criar pooling por espécie quando possível.

Spawn deve resetar completamente:

HP
status
AI
animation
physics
transform
target
cooldowns
visual state.

Nunca reaproveitar estado antigo acidentalmente.

---

# 64 — ANIMATION PERFORMANCE

Cada espécie possui animações próprias.

Mas performance importa.

Implementar AnimationLOD.

Próximo:

animação completa.

Médio:

redução de update rate quando possível.

Muito distante:

animação simplificada / update reduzido.

Inimigos fora da visão por grande período:

podem reduzir drasticamente updates.

Não gastar o mesmo custo de animação com mob a 80m e mob a 5m.

---

# 65 — STATIC WORLD OPTIMIZATION

Para mundo:

freezeWorldMatrix em objetos estáticos.

merge meshes quando apropriado.

thin instances para:

vegetação repetida.
pedras.
plantas pequenas.
props repetidos.

LOD para assets grandes.

Utilizar KTX2/compressão quando pipeline permitir.

Evitar milhares de materiais distintos.

---

# 66 — ENEMY COLLISION

Inimigos vivos não devem formar engarrafamentos.

Evitar colisão rígida cara entre todos.

Utilizar:

separation steering
soft avoidance

e colisão simplificada.

Cadáveres próximos podem receber física por tempo limitado.

---

# 67 — AUDIO

Gameplay precisa funcionar auditivamente.

Sons distintos:

dual pistols.
impact vegetal.
critical.
kill.
dodge.
MP threshold I.
MP threshold II.
MP threshold III.
MP attacks.
Broccoli.
Banana jump.
Corn fire.
Watermelon charge.
Fire Tomato charge.
Lettuce lunge.
Chili explosion.
Onion gas.
Cassava emerge.
boss attacks.
boss death.
credits.
level up.
wormhole.

Criar AudioManager com pooling de emitters.

Não tocar centenas de sons idênticos simultaneamente.

Voice limiting.

---

# 68 — OFFSCREEN THREATS

Ataques realmente perigosos fora da câmera precisam:

audio cue

e quando necessário:

small edge indicator.

Não mostrar indicadores para cada ataque pequeno.

---

# 69 — DAMAGE NUMBERS

Existem.

Utilizar pooling.

Agrupar hits extremamente rápidos.

MP III não deve mostrar centenas de números independentes cobrindo a tela.

Implementar damage number aggregation.

---

# 70 — XP

Inimigo morto fornece XP.

Barra de XP.

Level up:

som.
pulse.
particle burst.
pequena feedback animation.

Level aumenta stats conforme configuração.

---

# 71 — HUD

Inferior esquerdo:

HP.
XP.
Level.

Centro:

crosshair.
MP segmented bar.

Inferior direito:

Dodge charges.

Superior esquerdo:

inventory icons.

Superior direito:

timer.
difficulty.
stage.
credits.

Superior centro:

mission / objective.

Boss:

barra superior própria.

World:

interaction prompts.
wormhole marker.
attack telegraphs.

Debug HUD NÃO faz parte do HUD normal.

---

# 72 — MISSION

Primeiro objetivo:

LOCALIZE A PRAGA ALFA.

Mas o boss aparece ao concluir pressão/horde states.

Texto pode mudar conforme progresso.

Exemplo:

CONTENHA A INFESTAÇÃO.

SOBREVIVA AO SURTO.

ELIMINE A PRAGA ALFA.

ENTRE NA FENDA.

---

# 73 — WORMHOLE

Após boss death:

aguardar cerca de 5s.

formar Wormhole.

Som forte.

Luz.

VFX.

marcador HUD.

Não esconder saída.

Interação:

[E] ENTER RIFT.

Após entrar:

converter créditos restantes em XP.

próximo stage.

---

# 74 — RNG

Nunca usar Math.random() espalhado.

Criar RunRNG.

Seed reproduzível.

Streams independentes:

run.
director.
loot.
scene.
spawn.
boss.
elite.
interactable.

Abrir um container não pode mudar aleatoriamente qual boss seria selecionado.

---

# 75 — DEBUG MENU

F1.

Requisito obrigatório desde cedo.

Funções:

God Mode.
Infinite HP.
Give Credits.
Give XP.
Give Item.
Set Item Stack.
Clear Items.
Spawn Enemy.
Spawn 10.
Spawn 50.
Spawn Elite.
Spawn Boss.
Kill All.
Set Horde State.
Set Difficulty.
Complete Horde.
Teleport.
Show Navmesh.
Show Colliders.
Show Spawn Regions.
Show AI State.
Show Director Credits.
Show Entity Count.
Show Projectile Count.
Show Pool Usage.
Show FPS.
Show Frame Time.
Show Seed.
Restart Same Seed.
Restart New Seed.

---

# 76 — PERFORMANCE HUD

Debug deve mostrar:

FPS.
frame time.
draw calls.
active meshes.
triangles se disponível.
enemies active.
enemies rendered.
AI ticks.
projectiles.
particles.
corpses.
pool capacity.
pool active.
director credits.

---

# 77 — PERFORMANCE BUDGET

Objetivo inicial:

60 FPS com 50 inimigos simultâneos em hardware de referência.

Arquitetura não pode depender de quantidade extremamente baixa de entidades.

Priorizar:

pooling.
AI LOD.
animation LOD.
instancing.
material reuse.
shadow budgets.
distance updates.
event-driven systems.

Não otimizar cegamente.

Medir.

---

# 78 — PRIMEIRO VERTICAL SLICE

O vertical slice só está aprovado quando existir uma run completa:

spawn aleatório.

movimentação.

camera.

dual pistols.

dodge.

MP I.
MP II.
MP III.

Director.

pelo menos:

Broccoli.
Banana.
Corn.
Watermelon.
Fire Tomato.
Lettuce.

todos com comportamento e ataques distintos.

economia.

XP.

level.

3 interactables.

12 items.

stacking.

procs.

3 HordeStates.

FinalHorde.

Praga Alfa.

boss summons.

boss spit telegraph.

boss death.

wormhole.

restart/new seed.

HUD funcional.

áudio funcional.

VFX funcional.

ragdoll/death physics.

sky/diorama.

lighting.

post processing.

debug menu.

---

# 79 — ORDEM DE IMPLEMENTAÇÃO

Não tente fazer tudo simultaneamente.

Execute milestones.

M0 FOUNDATION

project.
engine bootstrap.
scene lifecycle.
fixed timestep.
event bus.
RNG.
debug overlay.
content registry.

M1 PLAYER

movement.
camera.
jump.
dodge.
aim.
dual pistols.

M2 COMBAT

DamageContext.
health.
hit reactions.
death.
ragdoll.
VFX.
audio.

M3 MP

charge.
UI.
MP I.
MP II.
MP III.

M4 ENEMY FRAMEWORK

state machine.
navigation.
attacks.
telegraphs.
spawn presentation.
pooling.

M5 FIRST ENEMIES

Broccoli.
Banana.
Corn.
Watermelon.

M6 ADVANCED ENEMIES

Fire Tomato.
Lettuce.
Carrot.
Chili.
Onion.
Cassava.

M7 DIRECTOR

budget.
combat packs.
horde states.
difficulty.

M8 ROGUELIKE

XP.
credits.
interactables.
items.
stacking.
proc chains.

M9 BOSS

Praga Alfa.
all attacks.
summons.
death.
wormhole.

M10 WORLD PRESENTATION

diorama.
lighting.
IBL.
shadows.
ACES.
bloom.
fog.
ambient animation.

M11 PERFORMANCE

profiling.
pool validation.
AI LOD.
animation LOD.
shadow budgets.
stress test 50/100/150 enemies.

---

# 80 — WORKFLOW OBRIGATÓRIO

Antes de alterar código de um milestone:

1. explique em poucas linhas o objetivo.
2. identifique arquivos afetados.
3. identifique dependências.
4. implemente.
5. execute typecheck/build.
6. corrija TODOS os erros.
7. teste o fluxo afetado.
8. registre qualquer TODO real.
9. somente então avance.

Não acumular erros para "corrigir depois".

---

# 81 — NÃO IMPROVISAR DESIGN

Quando um valor ainda não estiver definido:

usar config.

Marcar:

TUNING_REQUIRED.

Exemplo:

PLAYER_MOVE_SPEED = 9 // TUNING_REQUIRED

Não espalhar magic numbers.

Todos os números relevantes devem estar em:

PlayerTuning.
CombatTuning.
DirectorTuning.
EnemyDefinitions.
LightingPreset.
CameraTuning.

---

# 82 — PLACEHOLDERS

Placeholder técnico é permitido.

Exemplo:

capsule.
box.
primitive.

Mas deve ser marcado:

TEMP_ASSET_REQUIRED.

Gameplay nunca pode depender da geometria artística do placeholder.

Quando model final chegar:

trocar asset.

não reprogramar sistema.

---

# 83 — QUALIDADE DOS INIMIGOS

Nenhum inimigo é considerado terminado somente porque:

anda.
segue player.
causa dano.

Checklist de DONE:

spawn animation.
idle.
locomotion.
attack 1.
attack 2 quando definido.
windup.
telegraph.
recovery.
hit reaction.
death.
sound.
VFX.
AI.
pool reset.
performance validation.

---

# 84 — QUALIDADE DO COMBATE

O combate só está pronto quando:

tiro parece arma real.

enemy reage no mesmo instante do hit.

há som.

há impacto.

há feedback visual.

há death physics.

há ameaça legível.

há diferença real entre inimigos.

há build visível.

há proc chains.

há caos sem perder legibilidade.

---

# 85 — DIRETRIZ FINAL

O objetivo NÃO é apenas fazer sistemas tecnicamente funcionarem.

O objetivo é fazer o jogador sentir:

"estou exterminando uma infestação viva."

Cada ação precisa gerar consequência.

TIRO
→ recoil
→ tracer
→ impacto
→ inimigo reage.

KILL
→ corpo voa
→ partículas
→ XP
→ créditos.

ITEM
→ mudança visível no combate.

DODGE
→ movimento + trail + invulnerabilidade.

MP
→ charge + áudio + transformação clara do ataque.

INIMIGO
→ spawn + antecipação + ataque + recuperação.

BOSS
→ presença + summons + telegraphs + destruição.

Nunca aceitar uma implementação que simplesmente "funciona".

Ela precisa parecer GAMEPLAY.

---

# SUA PRIMEIRA TAREFA

Crie o projeto do zero e execute somente M0.

Antes de escrever código, apresente:

1. arquitetura final de pastas;
2. dependências exatas;
3. interfaces centrais;
4. Game Loop;
5. fluxo das entidades;
6. estratégia de pooling;
7. estratégia de AI scheduling;
8. estratégia de animações;
9. estratégia de performance.

Depois implemente M0 completamente.

Rode build/typecheck.

Corrija os problemas.

Mostre o estado final e indique exatamente qual requisito habilita M1.

NÃO pule diretamente para inimigos, mapa ou UI bonita.
