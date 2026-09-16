# Substituição da paleta de áudio dos inimigos — entrega

Pedido: `docs/CLAUDE_ENEMY_SOUND_REPLACEMENT_TASK.md`, mais a revisão em
`.temp/enemy-audio-review.md` e a nota de fontes final em `.temp/enemy-audio-sources.md`. O
usuário auditou o estúdio de sons e recusou a paleta vocal inteira (rosnados de bicho, chamados de
demônio, voz de fada) mais os quatro impactos `heavy`. Esta entrega troca todos eles por impactos
orgânicos de fruta feitos de amostras CC0, e fecha os caminhos pelos quais o material recusado
poderia voltar.

Houve duas passadas. A segunda atende à revisão: **timbre retrô fora**, **peso físico de verdade
nos impactos** e **procedência descrita sem exagero**. O que mudou está em
[Segunda passada](#segunda-passada-o-que-a-revisão-mudou).

**Não ouvi nenhum clipe.** Não tenho saída de áudio nem navegador neste ambiente. A seleção foi
feita por origem (pacotes de impacto molhado/quebra, fogo e feixe) e por medida de forma de onda
(duração, envelope, pico, centroide espectral). O julgamento estético é do usuário, no estúdio.

## O que foi trocado

89 peças novas em `public/audio/enemies/*.ogg` (mono, 44,1 kHz, Vorbis, 596 KB no total),
cobrindo todos os 36 grupos de inimigo do manifest: 6 espécies × 5 eventos (nascer, preparar,
atacar, apanhar, morrer) + 6 camadas de ruído de ataque + 6 grupos genéricos de rede de segurança.

| Espécie | Direção sonora | Grupos |
|---|---|---|
| Berinjela | estalo fibroso leve com respingo úmido | `enemy-eggplant-*` |
| Milho | casca seca e grão chacoalhando | `enemy-corn-*` |
| Melancia | casca grossa rachando, polpa pesada | `enemy-watermelon-*` |
| Tomate | **ataque = sopro curto de bola de fogo + cuspe molhado**, como o projétil incendiário | `enemy-tomato-*` |
| Cenoura | **preparo = carga curta e controlada, depois soltura (feixe)** — sem voz de fada e sem bipe retrô | `enemy-carrot-*` |
| Chefe | impacto pesado em camadas conduzido por soco, **sem rugido** | `enemy-boss-*` |

Os dois itens que o usuário apontou por nome foram tratados diretamente: o ataque do tomate
(`enemy-voice-demon-call-one-voice.wav`, marcado como o pior) agora é o recorte do sopro da bola
de fogo com uma camada úmida curta; o preparo da cenoura (`enemy-voice-pixie.wav`, "parece gato")
agora é uma carga de energia com soltura, sem nenhum material vocal.

### Camada de ruído por espécie (usa o resolvedor que já existia)

Antes, as seis espécies dividiam os grupos genéricos `heavy` / `pistol` / `swish` / `charge` — o
milho tocava literalmente a pistola do jogador e a cenoura, o sino. Agora cada espécie tem chave
própria (`enemy-<espécie>-<grupo>`), que `RecordedAudio.enemyEvent` já preferia sobre o genérico:

| Espécie | Chave nova | O que é |
|---|---|---|
| Berinjela | `enemy-eggplant-heavy` | pancada úmida leve |
| Milho | `enemy-corn-pistol` | estalo seco de grão |
| Melancia | `enemy-watermelon-heavy` | casca rachando com peso |
| Tomate | `enemy-tomato-swish` | sopro de ar do projétil |
| Cenoura | `enemy-carrot-charge` | carga e soltura curtas |
| Chefe | `enemy-boss-heavy` | peso grave em camadas |

`ENEMY_ATTACK_LAYERS` **não mudou** (o milho continua com o nome de grupo `pistol`), então o teste
que garante que silenciar o ruído do milho não silencia a pistola do jogador continua valendo — e
agora os arquivos também são diferentes.

### Grupos genéricos

`growl`, `attack`, `spawn`, `hurt`, `death` e `heavy` também foram refeitos. Eles eram cópias
byte-a-byte das mesmas gravações recusadas (o `prepare-foley.mjs` copiava `Beast Growl 1` para
`growl-0.wav`, etc.), então serviam de porta dos fundos: bastava uma espécie ficar sem chave
própria para o material recusado voltar a tocar. `heavy` é o caso mais sensível porque o jogador
também o usa (`player-hit`, `fatalImpact`, golpes de skill) — os quatro substitutos são impactos
sólidos de casca/polpa, não vozes.

### Preservado, sem tocar

`pistol`, `reload`, `casing`, passos (`grass`/`wood`/`concrete`/`water`), `swish`, `charge`,
`impact`, `voice-skill1..3`, `rain`, `player-death`, `enemy-earth-impact`, `enemy-wood-snap`.
Conferido por diff de chaves contra o `HEAD`: 0 chaves removidas, 6 adicionadas, 16 intactas.

As escolhas do usuário no IndexedDB continuam valendo: `EnemyAudioOverrides` indexa por
`espécie:evento`, não por caminho de arquivo, e nem as espécies nem os eventos mudaram.

## Segunda passada: o que a revisão mudou

**1. Timbre retrô eliminado da cenoura.** As fontes `laserRetro_001`, `laserRetro_003` e
`laserSmall_001` saíram do script — não estão mais nem declaradas em `SOURCES`, então não é
questão de estarem "inaudíveis no fundo": não existem mais na receita. A cenoura agora é
`forceField` invertido (o decaimento virado do avesso vira crescendo, é o que dá a carga
controlada) + ar de bambu texturizado + `laserLarge` como soltura, com corte de agudos
(5,6–6,5 kHz) e rampa de 8–10 ms para a borda não ficar em ponta. O ataque ainda leva uma camada
do fogo real por baixo, para ter calor em vez de brilho de arcade. Há teste barrando as três
fontes aposentadas.

**2. Peso físico de verdade nos impactos.** A família `impactPunch` entrou (corpo e soco) — é
material diferente do `impactSoft_heavy` que você recusou. Onde foi usada:

| Grupo | Antes | Agora |
|---|---|---|
| `heavy` (4 peças, também o dano do jogador) | 4 variações do mesmo par casca+polpa | 4 pesos distintos: soco grave+fibra, soco+madeira, soco médio+polpa, batida de madeira+pedra |
| `enemy-boss-*` (nascer, atacar, apanhar, morrer, camada) | polpa+casca+sub | soco como corpo, polpa recuada para textura |
| `enemy-watermelon-*` (atacar, apanhar, camada) | casca+polpa | soco por baixo da rachadura, mais um estilhaço seco |

**3. Menos esguicho repetido.** O `chop` (corte seco) conduz o golpe da berinjela, a morte da
cenoura e uma das peças genéricas de ataque; batidas secas do pacote do rubberduck entraram nos
genéricos de dano e na camada da berinjela; quebras secas entraram na morte do milho e na camada
da melancia. Os três `hurt` genéricos eram três esguichos — agora são polpa, batida seca e
madeira. Há teste exigindo que as quatro peças de `heavy` tenham conjuntos de origem diferentes.

**4. Procedência corrigida.** A versão anterior do script dizia "gravações reais" para tudo, o que
é impreciso: os pacotes da Kenney e o do rubberduck são SFX produzido/desenhado, não captação de
campo. Usar amostra autoral licenciada é legítimo; descrevê-la errado não. Cada entrada de
`docs/enemy-audio-sources.json` passou a ter um campo `kind` (`acústica` | `autoral`), e o teste
exige que ele esteja preenchido. A classificação segue o que cada página declara — não auditei o
método de produção de ninguém.

Não mexi no tomate: a nota de fontes diz que o fogo e as gravações orgânicas continuam bons
candidatos, e o ataque do tomate era o item que você apontou como pior. Também não comecei
nenhum trabalho de áudio fora do escopo (ambiente, animais de fazenda, passos, armas).

Shapeforms e Sonniss não foram usados — a nota final diz para não esperar por eles.

## Origem e licença

Tudo CC0. `docs/enemy-audio-sources.json` traz autor, URL, tipo e o sha256 de cada amostra.

| Autor | Material | Tipo | Uso |
|---|---|---|---|
| Independent.nu / qubodup | 8 wet squish/slurp impacts | acústica | polpa molhada (nascer, apanhar, morrer, camadas úmidas) |
| Independent.nu / qubodup | 5 break/crunch impacts | acústica | casca, fibra e farelo (estalos, rachaduras, preparo) |
| Julien Matthey | Fireball | acústica | sopro do incendiário do tomate; calor na cauda do feixe |
| qubodup | Bamboo swishes (já no repo) | acústica | ar texturizado do tomate e corpo da carga da cenoura |
| GryffDavid | Casquinhas em piso (já no repo) | acústica | estalos de grão do milho |
| Kenney | Sci-Fi Sounds | autoral | carga e feixe da cenoura (só `laserLarge`), reforço grave do chefe |
| Kenney (espelho ETdoFresh/kenney.nl @`45df48c4`) | Impact Sounds + RPG Audio | autoral | `impactPunch_heavy_000/001`, `impactPunch_medium_000`, `impactWood_medium_000`, `chop` — corpo dos impactos pesados e o corte da berinjela |
| rubberduck | 75 CC0 breaking/falling/hit SFX | autoral | batidas e quebras secas, para a paleta não ser só esguicho |

Nada foi sintetizado: cada peça é recorte + reafinação (resample) + filtro + mixagem + rampas
curtas das amostras acima.

## Como regerar

```
python scripts/prepare-enemy-audio.py [--sources .temp/enemy-audio-sources]
python scripts/prepare-enemy-audio.py --check     # confere sha256 sem escrever nada
```

A receita inteira (camadas, recortes, taxas, filtros, ganhos, picos-alvo) está em `RECIPES`, no
script. Interpretador usado: `C:\Users\darck\AppData\Local\Programs\Python\Python312\python.exe`
com numpy + scipy + soundfile — **não** o runtime do codex, que tem numpy mas não scipy nem
soundfile (instalei `soundfile` no Python 3.12 via pip; o runtime do codex ficou intacto).

Os pacotes de origem estão em `.temp/enemy-audio-sources/` (baixados pelo Codex, extraídos com o
`tar.exe` do Windows — o do rubberduck também). `.temp/` é rascunho: para regerar do zero é preciso
rebaixar pelas URLs do `docs/enemy-audio-sources.json` — os sha256 registrados permitem conferir
que veio o mesmo arquivo.

## Impedindo a volta do material recusado

1. **`scripts/prepare-species-audio.py` virou stub.** Era ele que montava a paleta recusada a
   partir de "Monsters or Beasts" e reescrevia os grupos `enemy-*`. Agora sai com código 2 e
   explica o motivo. (Também aplicava um patch de texto em `RecordedAudio.ts` que já não
   corresponde ao código atual.) A receita antiga continua no histórico do git.
2. **`scripts/prepare-foley.mjs` parou de produzir voz de monstro e o `heavy` recusado**, e passou
   a **mesclar** no manifest em vez de sobrescrever — antes, rodá-lo apagava todos os grupos
   `enemy-*` e o `rain`.
3. **Teste por checksum.** `docs/enemy-audio-rejected.json` guarda o sha256 de 24 arquivos
   recusados (as vozes, os `heavy-*.ogg` e os aliases genéricos). O teste percorre todo grupo que
   o jogo consegue resolver e falha se algum apontar para um arquivo com esses hashes — pega
   inclusive cópia renomeada.

Os arquivos originais **não** foram apagados do disco: continuam em `public/audio/foley/`, fora de
qualquer grupo ativo. Apagá-los quebraria a guarda por checksum (ela precisa dos originais para
saber o que barrar) e o pedido era para não remover assets originais.

## Correção de divergência encontrada no caminho

`resolveEnemyAudio(..., 'attack').layer` — a prévia do ruído que o estúdio mostra — resolvia
**só** pelo grupo genérico, enquanto o runtime (`RecordedAudio.enemyEvent`) resolve o evento
`attack-layer` preferindo a chave da espécie. Enquanto nenhuma espécie tinha chave própria os dois
coincidiam por acidente; ao adicionar as chaves, o painel passaria a mostrar um arquivo e o jogo a
tocar outro. A prévia agora delega para `resolveEnemyAudio(..., 'attack-layer')`, e há teste
comparando os dois caminho a caminho.

## Verificação

Rodado e conferido:

- `npx vitest run tests/enemy-audio-assets.test.ts tests/enemy-audio-overrides.test.ts
  tests/enemy-audio-integration.test.ts tests/recorded-audio.test.ts` → **44/44 passam** (dois
  testes novos na segunda passada: o que barra a família retrô e o que exige quatro pesos
  distintos em `heavy`).
- `npx tsc --noEmit` → **limpo**. (Na primeira passada havia 16 erros, todos do job de
  `FruitFragments`; o módulo que faltava foi adicionado por aquele job nesse meio-tempo.)
- `npx vitest run` (suíte inteira, primeira passada) → 575 passam, 13 falham, nenhuma em áudio:
  `combat-assets` e `hordes-arsenal-catalog` falham por GLB ausente em `art/processed/` (pasta
  `art/` não faz parte deste clone); `fruit-fragments`/`telegraph-shapes`/`enemy-swarm` colapsavam
  pelo módulo `FragmentShapes` em construção — `enemy-swarm` e `telegraph-shapes` passam quando
  rodados isolados; `terrain-relief` é do job de relevo. Na segunda passada rodei só os testes de
  áudio, como pedido; os arquivos que toquei não têm relação com nenhuma dessas suítes.
- `python scripts/prepare-enemy-audio.py --check` → OK (sha256 dos 89 arquivos batem com o
  relatório).
- Diff de chaves do manifest contra o `HEAD`, refeito após a segunda passada: 0 removidas, 6
  adicionadas, 16 intactas; e **nenhum** grupo aponta para material com hash recusado.
- Decodificação independente dos 89 `.ogg` com soundfile, após a segunda passada: durações de
  **0,14 s a 0,87 s**, picos de **0,64 a 0,947** (teto de 0,95, nenhum clipe), todos mono a
  44,1 kHz, sem NaN. **Nenhuma ponta acima de 0,02** — a rampa de 8 ms no feixe da cenoura tirou o
  degrau de 0,021 que a primeira passada tinha no início de `carrot-beam-*`.
- Limites de duração conferidos no teste: acertos frequentes (dano, camada de ruído) 0,12–0,65 s;
  preparo 0,15–0,75 s; ataque ≤ 0,98 s; nascer/morrer ≤ 1,05 s. O chefe toca a 0,9×, e o teste
  confere que mesmo esticado nenhuma peça dele passa de 1,1 s.

O codec Vorbis devolvia pico acima de 1,0 em duas peças brilhantes (`carrot-beam-0` chegou a
1,078). O script agora escreve, mede o arquivo **decodificado** e recua o ganho até caber no teto
— por isso as medidas acima são do `.ogg` final, não do buffer antes de codificar.

Não verificado: como soa, e se o `AudioContext` do navegador decodifica exatamente igual ao
libsndfile. O estúdio é o lugar de conferir as duas coisas — o Codex é quem tem navegador.

## Arquivos

| Arquivo | O que houve |
|---|---|
| `public/audio/enemies/*.ogg` | 89 peças novas |
| `public/audio/foley-manifest.json` | 36 grupos reescritos, 6 chaves de camada adicionadas, resto intacto |
| `scripts/prepare-enemy-audio.py` | novo — preparação reproduzível |
| `scripts/prepare-species-audio.py` | aposentado (stub que recusa rodar) |
| `scripts/prepare-foley.mjs` | não produz mais voz de monstro nem `heavy`; mescla em vez de sobrescrever |
| `src/audio/EnemyAudioCatalog.ts` | descrições neutras + prévia da camada alinhada ao runtime |
| `tests/enemy-audio-assets.test.ts` | novo — guarda de checksum, resolução, duração, pico, timbre retrô e variedade de peso |
| `tests/enemy-audio-overrides.test.ts` | 2 asserções passaram a comparar com o runtime em vez de fixar o grupo genérico |
| `docs/enemy-audio-assets.json` | medidas e sha256 de cada peça |
| `docs/enemy-audio-sources.json` | procedência e licença das gravações |
| `docs/enemy-audio-rejected.json` | sha256 do material recusado |

Não toquei em `RecordedAudio.ts`, `EnemyAudioOverrides.ts`, `EnemyAudioLab.ts`, CSS, `PlayerScene`
nem no mundo — são de outros jobs. Nada foi commitado, empurrado ou resetado.

### Uma coisa para outro dono decidir

`src/ui/EnemyAudioLab.ts:342` ainda tem um comentário que chama as duas peças do ataque de "a voz
e o ruído". As descrições que aparecem na tela vêm do catálogo e já estão neutras; só esse
comentário interno ficou. O arquivo é do job do estúdio, então não mexi.
