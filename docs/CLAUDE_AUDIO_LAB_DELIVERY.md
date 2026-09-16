# Estúdio de sons dos inimigos — entrega e API de integração

Painel para ouvir e substituir o foley de cada inimigo, em `/audio-lab.html`, independente da cena 3D.
Este documento é o contrato para quem integra no runtime (`RecordedAudio.ts`, manifest, `PlayerScene`).

**Arquivos desta entrega (Claude do painel):** `audio-lab.html`, `src/audio/EnemyAudioCatalog.ts`,
`src/audio/EnemyAudioOverrides.ts`, `src/ui/EnemyAudioLab.ts`, `tests/enemy-audio-overrides.test.ts`, este doc.
**Não tocados:** `src/audio/RecordedAudio.ts`, `public/audio/foley-manifest.json`, `PlayerScene`,
`src/style.css`, `vite.config.ts`, `src/ui/enemy-audio-lab.css` (Codex).

---

## 1. Resumo em uma tela

```ts
import {EnemyAudioOverrides} from './EnemyAudioOverrides';
import {isEnemyAudioKind, type EnemyAudioEvent, type EnemyAudioKind} from './EnemyAudioCatalog';

const overrides = new EnemyAudioOverrides();      // lê manifest + escolhas salvas
await overrides.ready;                            // UMA vez, fora do loop
await overrides.prepare(audioContext);            // decodifica os arquivos do usuário

// na hora do evento (tudo síncrono, sem alocar, seguro no loop):
const volume = overrides.gainFor(kind, event, distance);   // 0 = não toque
const buffer = overrides.getBuffer(audioContext, kind, event); // undefined = use o manifest
const {group, rate, gap} = overrides.lookup(kind, event);      // grupo do manifest já resolvido
```

Regra de ouro: **`gainFor` decide se toca, `getBuffer` decide o quê.**
`undefined` em `getBuffer` significa "sem arquivo do usuário, toque o padrão" — **não** significa mudo.
Mudo é `gainFor(...) === 0` (ou `isMuted(...)`).

---

## 2. Espécies e eventos

`EnemyAudioKind` = `'eggplant' | 'corn' | 'watermelon' | 'tomato' | 'carrot' | 'boss'` (igual a `ENEMIES`).

`EnemyAudioEvent` = 7 chaves. As 6 primeiras são as de `WeaponAudio.enemy()`; a sétima é nova:

| evento | rótulo no painel | grupo genérico | ganho base (0 m) | gap | rate | o jogo já dispara? |
|---|---|---|---|---|---|---|
| `spawn` | Aparecer | `spawn` | 0,46 | 0,45 s | 1 (chefe 0,9) | sim |
| `windup` | Preparar ataque | `growl` | 0,58 | 0,45 s | 1 (chefe 0,9) | sim |
| `attack` | Atacar | `attack` | 0,46 | 0,45 s | 1 (chefe 0,9) | sim |
| `attack-layer` | Ruído do ataque | muda por espécie | 0,345 (= 0,46 × 0,75) | 0,18 s | **1, inclusive no chefe** | sim, junto do `attack` |
| `hit` | Receber dano | `hurt` | 0,30 | 0,18 s | 1 (chefe 0,9) | sim |
| `death` | Morrer | `death` | 0,46 | 0,45 s | 1 (chefe 0,9) | sim |
| `dodge` | Esquivar | `swish` | 0,46 | 0,45 s | 1 (chefe 0,9) | **não** (API existe, `EnemySwarm` não chama) |

`attack-layer` é o ruído extra que `enemy('attack')` soma hoje por cima da voz:

```ts
ENEMY_ATTACK_LAYERS = {eggplant:'heavy', corn:'pistol', watermelon:'heavy', tomato:'swish', carrot:'charge', boss:'heavy'}
```

Ele é evento de primeira classe **de propósito**: o usuário precisa silenciar/trocar o ruído sem perder a
voz, e vice-versa. Se você tocar a camada por fora da API, ela volta a ser um barulho invisível aos controles.

**Silenciar `corn:attack-layer` NÃO silencia a pistola do jogador**, mesmo os dois usando o grupo `pistol`:
as escolhas são guardadas por `espécie:evento`, nunca por grupo do manifest. `shot()`/`casing()`/`reload()`
continuam passando direto por `play('player-pistol')`, fora desta API.

### Resolução de grupo (idêntica ao runtime de hoje)

1. evento → grupo genérico (`windup`→`growl`, `hit`→`hurt`, `dodge`→`swish`, `attack-layer`→ grupo da espécie);
2. tenta `enemy-<espécie>-<grupo>` no manifest (`source: 'species'`);
3. senão usa o grupo genérico (`source: 'fallback'`);
4. se nenhum existir, `source: 'missing'` e `files: []`.

A resolução é feita **sempre contra o manifest carregado em runtime**. Nenhuma URL fica congelada: troque
`foley-manifest.json` e painel e jogo mudam juntos. Se você criar `enemy-corn-pistol`, o `attack-layer` do
milho passa sozinho de `fallback` para `species`.

---

## 3. API — `src/audio/EnemyAudioCatalog.ts` (fonte única de verdade)

```ts
type EnemyAudioKind; type EnemyAudioEvent; type FoleyManifest = Readonly<Record<string, readonly string[]>>;

const ENEMY_AUDIO_MANIFEST_URL = '/audio/foley-manifest.json';
const ENEMY_AUDIO_RANGE = 32;          // acima disso enemy() ignora
const ENEMY_AUDIO_FALLOFF = 144;       // ganho = base / (1 + d² / 144)
const ENEMY_AUDIO_BOSS_RATE = 0.9;
const ENEMY_ATTACK_LAYER_GAIN = 0.75;  // multiplicador do ruído sobre o ganho do ataque
const ENEMY_ATTACK_LAYER_GAP = 0.18;

const ENEMY_AUDIO_SPECIES: readonly {kind; label; note}[];   // label = nome de ENEMIES
const ENEMY_AUDIO_KINDS: readonly EnemyAudioKind[];
const ENEMY_AUDIO_EVENT_SPECS: readonly {event; label; description; group; gain; gap; wired}[];
const ENEMY_AUDIO_EVENTS: readonly EnemyAudioEvent[];
const ENEMY_ATTACK_LAYERS: Record<EnemyAudioKind, string>;

isEnemyAudioKind(value: unknown): value is EnemyAudioKind;
isEnemyAudioEvent(value: unknown): value is EnemyAudioEvent;
enemyAudioEventSpec(event): EnemyAudioEventSpec;      // lança se desconhecido
enemyAudioSpecies(kind): EnemyAudioSpecies;           // lança se desconhecida
enemyAudioGroup(kind, event): string;                 // grupo genérico (resolve attack-layer)
resolveEnemyAudio(manifest, kind, event): ResolvedEnemyAudio;
enemyAudioLoudness(event, distance): number;          // ganho padrão já atenuado (0 fora de 32 m)
loadFoleyManifest(fetcher?, url?): Promise<FoleyManifest>;

interface ResolvedEnemyAudio {
  kind; event; label; description;
  group: string;          // chave do manifest que o jogo usa de fato
  speciesGroup: string;   // 'enemy-<kind>-<grupo>'
  fallbackGroup: string;  // grupo genérico
  source: 'species' | 'fallback' | 'missing';
  files: readonly string[];
  defaultGain: number; rate: number; gap: number;
  layer: {group; files; gain; gap} | undefined;  // só em 'attack', apenas informativo
}
```

`description` e `label` são texto de usuário (português simples, sem nome de classe/parâmetro).
Detalhe técnico mora aqui, não no painel.

---

## 4. API — `src/audio/EnemyAudioOverrides.ts` (o que o runtime consome)

### Ciclo de vida

```ts
new EnemyAudioOverrides(options?: {
  storage?: EnemyAudioStorage | null;   // null = só memória. Padrão: IndexedDB quando existir
  manifest?: FoleyManifest | (() => Promise<FoleyManifest>);  // padrão: fetch do manifest
  channel?: EnemyAudioChannelLike | null;  // null desliga a sincronia entre abas
  context?: BaseAudioContext;              // pode vir depois, em prepare()
  now?: () => number;
})

readonly ready: Promise<void>            // manifest + escolhas em memória. NUNCA rejeita
prepare(context): Promise<void>          // liga o contexto e decodifica os arquivos salvos
dispose(): void                          // listeners, buffers, blob URLs, canal e storage
```

`ready` nunca rejeita: falha de manifest vira `manifestWarning`, falha de storage vira modo memória.
Nada aqui lança dentro do loop de áudio.

### Consulta — síncrona, depois de `await ready`

```ts
lookup(kind, event): EnemyAudioLookup    // ResolvedEnemyAudio + key, muted, userGain, gain, custom, override, bufferReady
isMuted(kind, event): boolean
hasOverride(kind, event): boolean
userGain(kind, event): number            // multiplicador do usuário, 0..2 (1 = padrão)
gainFor(kind, event, distance = 0): number   // 0 se mudo, volume 0 ou fora dos 32 m
getBuffer(context, kind, event): AudioBuffer | undefined   // undefined = use o manifest
previewUrl(kind, event): string | undefined                // blob: do arquivo do usuário
get resolvedManifest(): FoleyManifest
get manifestWarning(): string | undefined
storageMode: 'indexeddb' | 'memoria'
storageNote: string                      // frase pronta para a interface
lastWarning: string | undefined
```

`gainFor` já combina: ganho base do evento × volume do usuário ÷ atenuação por distância, e devolve `0`
quando está mudo. É a única conta que o runtime precisa fazer.

### Escrita (tudo `Promise<void>`, tudo persistido)

```ts
setUserGain(kind, event, gain)     // 0..2, fora disso é limitado
setMuted(kind, event, muted)
setOverrideFile(kind, event, file: File)   // decodifica ANTES de aceitar
setOverride(kind, event, {name, type, bytes})
clearOverride(kind, event)         // volta ao manifest, mantém volume/mudo
restoreEvent(kind, event)          // zera tudo daquele evento
restoreSpecies(kind)               // zera os 7 eventos da espécie
restoreAll()
subscribe(listener: (keys: readonly string[]) => void): () => void
exportBundle(): EnemyAudioBundle                       // JSON autocontido (áudio em base64)
importBundle(input: unknown | string): Promise<{applied: string[]; skipped: {key; reason}[]}>
```

Chaves são `` `${kind}:${event}` `` (`enemyAudioKey()`), ex.: `corn:attack-layer`.

Arquivo recusado (não decodificável, vazio ou acima de 6 MB) lança `EnemyAudioError` com mensagem
pronta em português **e mantém a configuração anterior intacta**. Troca rápida A→B nunca deixa o decode
antigo vencer: cada chave tem um número de revisão e o resultado atrasado é descartado.

### Integração exata no `RecordedAudio.ts`

> Estado em 15/09/2026: o dono do `RecordedAudio.ts` **já aplicou** esta integração (campo
> `enemyOverrides`, `prepare()` no `unlock()`, `enemy()` disparando `attack` + `attack-layer` e
> `dispose()` com dono). A receita abaixo fica como contrato de referência.

```ts
import {EnemyAudioOverrides, enemyAudioKey} from './EnemyAudioOverrides';
import {isEnemyAudioKind, type EnemyAudioEvent, type EnemyAudioKind} from './EnemyAudioCatalog';

// campo da classe
readonly enemyOverrides = new EnemyAudioOverrides();

// dentro de unlock(), depois de criar this.context/this.master:
void this.enemyOverrides.prepare(this.context).catch(error => console.warn('Sons do estúdio', error));

// dispose(): this.enemyOverrides.dispose();

enemy(event:'spawn'|'windup'|'attack'|'hit'|'death'|'dodge', kind:string, distance:number, pan=0):void {
  if (distance > 32) return;
  if (!isEnemyAudioKind(kind)) return;            // espécie fora do catálogo: mantenha o caminho antigo se preferir
  this.enemyLayer(kind, event, distance, pan);
  if (event === 'attack') this.enemyLayer(kind, 'attack-layer', distance, pan);
}

private enemyLayer(kind:EnemyAudioKind, event:EnemyAudioEvent, distance:number, pan:number):void {
  const volume = this.enemyOverrides.gainFor(kind, event, distance);   // mudo/volume/distância
  if (volume <= 0) return;
  const look = this.enemyOverrides.lookup(kind, event);
  const custom = this.context ? this.enemyOverrides.getBuffer(this.context, kind, event) : undefined;
  if (custom) this.playBuffer(custom, volume, look.rate, pan, look.gap, enemyAudioKey(kind, event));
  else this.play(look.group, volume, look.rate, pan, look.gap);        // look.group já é a chave do manifest
}
```

`look.group` é exatamente o `selected` que o código atual calcula (`enemy-<kind>-<grupo>` com fallback),
então o caminho padrão continua passando pelo `play()` de hoje, com os mesmos buffers, cooldown e duck.

Para o arquivo do usuário falta só um `playBuffer` — o mesmo `play()`, recebendo buffer em vez de grupo
(a chave de cooldown separada evita que voz e ruído se cortem):

```ts
private playBuffer(buffer:AudioBuffer, volume:number, rate:number, pan:number, gap:number, key:string):void {
  const context = this.context;
  if (!context || context.state !== 'running' || !this.active || !this.enabled || this.voices >= 18) return;
  const last = this.cooldown.get(key) ?? -10;
  if (context.currentTime - last < gap) return;
  this.cooldown.set(key, context.currentTime);
  const source = context.createBufferSource(), gain = context.createGain(), stereo = context.createStereoPanner();
  source.buffer = buffer; source.playbackRate.value = rate;
  gain.gain.value = volume * (context.currentTime < this.duckUntil ? .35 : 1);
  stereo.pan.value = Math.max(-1, Math.min(1, pan));
  source.connect(gain); gain.connect(stereo); stereo.connect(this.master!);
  this.voices++;
  source.start(context.currentTime);
  source.onended = () => { this.voices--; source.disconnect(); gain.disconnect(); stereo.disconnect(); };
}
```

Parâmetros e porquês: `volume` já vem pronto de `gainFor`; `rate` é 1 (0,9 só na voz do chefe);
`gap` é 0,18 s nos eventos que repetem muito (`hit`, `attack-layer`) e 0,45 s no resto; `pan` continua
sendo seu. Não mude os padrões aqui — eles vivem em `ENEMY_AUDIO_EVENT_SPECS` e o painel mostra os mesmos.

### Atualização sem recarregar

- Mesma aba: `subscribe(keys => …)` dispara a cada mudança. Se você cachear algo derivado de `lookup`,
  invalide ali; se chamar `lookup`/`getBuffer` na hora do evento, não precisa fazer nada.
- Entre abas: `BroadcastChannel('mutant-farm-enemy-audio')`, automático. A aba que recebe recarrega a
  chave do IndexedDB e redecodifica sozinha.
- **Uma partida já aberta antes da integração não recebe nada** — não há código escutando nela. Depois de
  integrar, a primeira carga da partida lê o estado salvo; dali em diante o canal mantém as duas em dia.
  Sem IndexedDB (aba privada, cota), a sincronia entre abas não acontece: `storageMode === 'memoria'`.

---

## 5. Persistência, pacote e limites

- IndexedDB `mutant-farm-audio-lab`, store `enemy-overrides`, chave `espécie:evento`, valor
  `{kind, event, gain, muted, updatedAt, clip?: {name, type, bytes: ArrayBuffer}}`.
- Nada de rede: nenhum upload, nenhuma URL externa. O painel escreve "Salvo neste navegador".
- Sem IndexedDB → modo memória, com aviso na tela. Nunca lança nem deixa rejeição solta.
- Limites: **6 MB por som**, **48 MB somados** num pacote importado.
- Pacote: `{format:'mutant-farm-enemy-audio', version:1, exportedAt, entries:[{kind,event,gain,muted,clip?:{name,type,data:base64}}]}`.
  Importar **mescla**: entradas inválidas são ignoradas com motivo, o que já existia e não está no pacote é
  preservado, e os arquivos padrão do manifest nunca são tocados.
- Acrescentar `attack-layer` **não** mexe no que já estava salvo: é uma chave nova, os seis eventos
  antigos continuam válidos e ninguém precisa de migração.

---

## 6. O que falta (não é meu escopo)

1. **`RecordedAudio.ts`** — feito pelo dono do arquivo durante esta entrega (seção 4).
2. **`vite.config.ts`** — `audio-lab.html` só existe no `dev`. Para entrar no build:
   ```ts
   build: { target:'es2022', copyPublicDir:false,
            rollupOptions:{ input:{ main:'index.html', audioLab:'audio-lab.html' } } },
   ```
3. **Entrada no jogo** — link/atalho (F1) para `/audio-lab.html`.
4. **Manifest** — se quiser ruído de ataque próprio por espécie, basta criar
   `enemy-<espécie>-<heavy|pistol|swish|charge>`; o painel adota sozinho.
5. **`dodge`** — a API está pronta; falta `EnemySwarm` chamar `enemy('dodge', …)`.

## 7. Resposta ao QA do Codex (`docs/AUDIO_LAB_REVIEW_NOTES.md`)

| nota | o que mudou |
|---|---|
| Camada secundária sem controle próprio | virou o evento `attack-layer`, com volume/mudo/arquivo/restaurar por espécie. O ataque não toca mais nada fora do alcance dos controles. |
| `windup` marcado como desligado | corrigido para `wired: true` (a chamada existe na linha longa de ataque do `EnemySwarm`). Só `dodge` segue desligado. |
| Textos técnicos no painel | descrições reescritas em português simples; nome de classe, grupo, ganho/rate/gap e "IndexedDB" saíram da tela (o detalhe técnico ficou no `title` da linha de estado e neste doc). |
| Nota do tomate / do chefe | tomate: "projéteis incendiários que deixam fogo no chão"; chefe: "Presença pesada e ataques de grande alcance". |
| Plural "variaçãoões" | corrigido (`1 variação` / `2 variações`). |
| Fallback CSS em `audio-lab.html` | removido; o `<link>` saiu e o módulo importa `./enemy-audio-lab.css`. |
| Mute do milho calando o tiro do jogador | não acontece: as escolhas são por `espécie:evento`, e `shot()` não passa por esta API. Coberto por teste. |
| Aba de jogo antiga e BroadcastChannel | documentado na seção 4: aba carregada antes da integração não recebe nada. |

Verificação desta rodada: `npx tsc --noEmit` limpo no projeto inteiro e
`npx vitest run tests/enemy-audio-overrides.test.ts tests/recorded-audio.test.ts` com 22 testes passando
(21 do estúdio + o de regressão do `RecordedAudio`).
**Mudança concorrente registrada:** durante a entrega o `RecordedAudio.ts` esteve por alguns minutos com
dois avisos de `tsc` (`import` não usado e `ownsOverrides` não lido) enquanto o outro autor integrava;
resolvido por ele. Não toquei no arquivo.

## 8. Limitações conhecidas

- O painel não julga timbre: ele toca o que o manifest resolve. Avaliação auditiva é do usuário.
- Sem contexto de áudio liberado (nenhum clique ainda), substituir arquivo recusa com mensagem pedindo
  para tocar algo antes — decodificar exige um `AudioContext`.
- `previewUrl` cria `blob:`; elas só são revogadas no `dispose()` ou ao trocar/remover aquele som.
- Testes cobrem catálogo, overrides e pacote (Node, sem DOM). A interface foi validada pelo Codex no
  navegador; não há teste automatizado de UI porque o projeto não tem ambiente DOM no vitest.
