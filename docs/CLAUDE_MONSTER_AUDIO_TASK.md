# Som novo das pragas — plano de geração com laço de aprovação

Pedido do usuário em 19/09/2026: gerar sons novos para os monstros, com análise de verdade por trás,
porque o rendimento de geração por IA é baixo. O laço é **gerar → analisar → aprovar ou reprovar →
gerar de novo**, até todos os grupos fecharem. Só então o usuário ouve.

Produção na sessão **Gerador de som** (`C:\Users\darck\Documents\gerador de som`, RTX 3080 Ti, local).
Análise, aprovação e integração nesta sessão. O usuário dá a palavra final ouvindo em jogo.

## 1. O diagnóstico: por que o som atual cansa

Não falta arquivo. Os 89 `.ogg` de `public/audio/enemies/` estão todos ligados e não há órfão. O
defeito é outro, e é medível: **as duas amostras de cada grupo são praticamente o mesmo som.**

| Grupo | Amostra 0 | Amostra 1 | Diferença |
| --- | --- | --- | --- |
| `corn-hurt` | 0,14 s | 0,15 s | 7% |
| `eggplant-hurt` | 0,15 s | 0,17 s | 13% |
| `boss-attack` | 0,57 s | 0,61 s | 7% |
| `carrot-hurt` | 0,15 s | 0,16 s | 7% |

Isso se repete em 36 dos 38 grupos. Com dezenas de pragas na tela alternando dois clones, o cérebro
fecha o padrão em segundos. **O alvo não é "som melhor", é variação real** — e isso é mensurável.

Os dois eventos mais expostos são os piores lugares para ter duas amostras, e o próprio catálogo
(`src/audio/EnemyAudioCatalog.ts`) admite:

- `hit` (levar dano) — `gain: 0.3`, `gap: 0.18`, comentado como *"Toca muito, por isso é mais baixo"*.
  Abaixaram o volume em vez de variar o som. É o evento mais disparado do jogo.
- `windup` (preparar ataque) — comentado como *"É o som mais alto do inimigo"*.

## 2. A regra de identidade que o usuário já cravou

`docs/enemy-audio-rejected.json` cataloga por sha256 tudo que foi recusado, e o padrão é único:
`enemy-voice-beast-growl`, `enemy-voice-demon-call`, `enemy-voice-pixie`, `enemy-voice-spirit-shout`,
`enemy-voice-dieing-beast`, `enemy-voice-yucky-beast`.

**Foi recusada a paleta de VOZ inteira.** O que sobreviveu é material: fibra, casca, grão, polpa,
fogo, energia. Não são bichos — são plantas mutantes sob esforço.

Isso está embutido na nomenclatura aprovada: a chave `enemy-<espécie>-growl` aponta para arquivos
chamados `<espécie>-**strain**`. O evento "rosnado" é literalmente **tensão de fibra**, não rosnado.

> **Regra dura da geração:** nenhum prompt pode conter *growl, roar, scream, monster, demon, beast,
> creature voice*. O teste `tests/enemy-audio-assets.test.ts` barra o retorno do material recusado
> por conteúdo (sha256), não por nome — cópia renomeada não passa.

## 3. Vocabulário por espécie, com alvo medido

Números tirados dos arquivos já aprovados (`docs/enemy-audio-assets.json`).

| Espécie | Identidade em jogo | Matéria do som | `hurt` alvo | `strain` alvo |
| --- | --- | --- | --- | --- |
| **Berinjela** `eggplant` | hp 75, vel 3,5 — a mais rápida, predadora, corpo a corpo | fibra rasgando, impacto úmido curto | 0,15–0,17 s | 0,34–0,38 s |
| **Milho** `corn` | hp 100, alcance 17 — artilheiro | grão chacoalhando, palha seca, estalo | 0,14–0,15 s | `rattle` 0,32–0,34 s |
| **Melancia** `watermelon` | hp 240, raio 1,45 — quatro patas, rola, morde | casca rompendo, corpo pesado | 0,20–0,22 s | 0,50–0,54 s |
| **Tomate** `tomato` | hp 115, voa, cospe fogo | ignição, sopro, polpa | 0,16–0,18 s | `ignite` 0,38–0,42 s |
| **Cenoura** `carrot` | hp 90, raízes, feixe de energia | carga elétrica, bobina, descarga | 0,15–0,16 s | `coil` 0,41–0,44 s |
| **PRAGA ALFA** `boss` | escala 2,5, toca a **0,9×** | impacto orgânico grave, mais corpo | 0,26–0,28 s | 0,62–0,66 s |

O chefe toca a 0,9× (`ENEMY_AUDIO_BOSS_RATE`), o que **estica cada peça em ~11%**. O teste exige
`seconds / 0.9 < 1.1`. Gere o chefe já contando com isso.

## 4. Escopo e meta

Prioridade, do pior para o melhor: **`hurt` → `strain`/`growl` → `attack`**.

Meta: **8 variações por grupo** (hoje são 2). Fase 1 cobre os 12 grupos mais expostos:

`hurt` e `strain` das 6 espécies → 12 grupos × 6 peças novas = **72 sons aprovados**.

Com rendimento esperado de ~25%, isso significa **~300 candidatos gerados**. É por isso que a
triagem tem de ser automática antes de qualquer ouvido humano.

## 5. Formato — inegociável, é o que o teste cobra

| Propriedade | Valor | Quem cobra |
| --- | --- | --- |
| Taxa | 44 100 Hz | teste: `expect(row.rate).toBe(44100)` |
| Canais | **1 (mono)** | teste: `expect(row.channels).toBe(1)` |
| Pico | **entre 0,30 e 0,95** | teste: nada que clipe, nada que suma na mixagem |
| Formato no repositório | OGG Vorbis | padrão dos 89 já aprovados |
| Peso | **< 20 KB por peça** | os 89 atuais somam 820 KB (~9 KB cada) |

O jogo baixa **os 152 arquivos do manifesto de uma vez no boot** (`Promise.all` em
`RecordedAudio.ts`), sem carregamento sob demanda. Cada peça nova entra no carregamento inicial.
72 peças a 20 KB = 1,4 MB. Cabe.

**Entrega em par:** cada candidato chega como `.wav` (44,1 kHz mono, para eu analisar sem depender
de decodificador de Vorbis, que não existe neste ambiente) **e** `.ogg` (o que vai para o
repositório), gerados do mesmo buffer normalizado.

## 6. O bloqueio de procedência — resolver antes de gerar em quantidade

`tests/enemy-audio-assets.test.ts` exige que **toda** peça declare de quais amostras saiu, que cada
fonte esteja em `docs/enemy-audio-sources.json`, e que:

```ts
expect(entry.license, entry.url).toBe('CC0');
expect(['acústica','autoral'], entry.url).toContain(entry.kind);
```

Áudio saído de texto puro no Stable Audio Open **não encaixa nesse esquema**. Dois caminhos:

1. **Áudio-para-áudio a partir dos 89 aprovados** (recomendado). A linhagem CC0 é preservada, o
   teste continua verde, e o rendimento sobe muito — parte-se de um som que o usuário já aprovou e
   troca-se a textura mantendo o ataque. A sessão de som mediu erro de ritmo de 1 a 6 ms nesse modo.
2. Estender o esquema com um `kind` novo para material gerado. Só se (1) não bastar, e com aval do
   usuário, porque mexe na garantia de licença do projeto.

**Decisão: caminho 1.** Os sons atuais têm identidade certa; o problema é que são dois. Variar a
textura preservando o ataque é exatamente o pedido.

## 7. O juiz automático — 7 portões, antes de qualquer ouvido

Roda nesta sessão, sobre os `.wav` em `.temp/audio-candidates/`. Reprova sem apelo.

| # | Portão | Critério | Por quê |
| --- | --- | --- | --- |
| 1 | Formato | 44 100 Hz, mono | teste do repositório |
| 2 | Duração | dentro da banda do grupo (§3) | `hurt` 0,12–0,65 · `growl` 0,15–0,75 · `attack` 0,12–0,98 · `spawn`/`death` 0,15–1,05 |
| 3 | Pico | 0,30 < pico < 0,95 | sem clipe, sem sumir |
| 4 | Ataque | tempo até o pico **< 25 ms** nos percussivos | difusão devolve papa de ataque lento; é o defeito nº 1 da geração |
| 5 | Cauda | sem silêncio > 30 ms no fim, sem DC | trim já é feito na geração; aqui é conferência |
| 6 | **Variação real** | distância espectral mínima contra **cada irmão já aprovado** | é o objetivo inteiro. Candidato parecido demais com um irmão é reprovado mesmo sendo bom |
| 7 | Recusados | sha256 fora da lista + distância mínima da paleta recusada | impede a volta do material vetado |

O portão 6 é o que resolve o problema que motivou tudo. Um candidato bom e parecido é **reprovado**:
oito clones bons soam tão mecânico quanto dois.

## 8. O laço

```
1. Eu     → especifico o grupo, a banda de duração, a matéria e a semente de áudio-para-áudio
2. Som    → gera 4× a quantidade alvo, exporta .wav + .ogg em .temp/audio-candidates/<grupo>/
3. Eu     → rodo o juiz (7 portões) e devolvo o veredicto peça a peça, com o motivo de cada reprova
4. Som    → regenera só o que faltou, com o motivo em mãos (ajusta passos, σ, prompt ou semente)
5.        → repete 3–4 até o grupo fechar 8 aprovados
6. Eu     → registro no foley-manifest.json + enemy-audio-assets.json e rodo a suíte de áudio
7. Usuário→ ouve tudo no estúdio (/audio-lab.html) e dá a palavra final
```

**O que eu não posso fazer:** eu não escuto. Meu "aprovado" significa *dentro do formato, dentro da
banda, com ataque limpo e comprovadamente diferente dos irmãos* — não significa "soa bom". O gosto é
do usuário, no passo 7. Nenhuma peça chega ao ouvido dele sem passar pelos 7 portões, e nenhuma
entra no jogo sem ele aprovar.

## 9. Amostra de prova antes da escala

Primeiro grupo: **`eggplant-hurt`, 8 variações.** É o evento mais tocado da espécie mais comum — se
o timbre passa ali, passa em qualquer lugar. Só depois do aval do usuário nesse grupo é que os
outros 11 entram em produção.

## 10. Ganho de graça, sem gerar nada

Há WAVs de **1,3 MB cada** em `public/audio/foley/` (`enemy-boss-attack-0.wav`,
`enemy-tomato-spawn-0.wav`, `spawn-0.wav`, `enemy-voice-demon-call.wav`) e 12 FLACs de água/swish.
Convertê-los para OGG corta vários MB do carregamento inicial sem gerar um som sequer.

Atenção: `enemy-voice-demon-call.wav` está **na lista de recusados** e continua em disco de
propósito — o teste exige que os originais recusados permaneçam catalogados, senão a guarda de
hashes passaria à toa. Não apagar.
