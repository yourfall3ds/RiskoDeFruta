/**
 * Fonte única de verdade do foley de inimigos.
 *
 * Espelha exatamente o que `WeaponAudio.enemy()` (src/audio/RecordedAudio.ts) faz em runtime:
 * mapeamento evento -> grupo (`windup`->`growl`, `hit`->`hurt`, `dodge`->`swish`), preferência pela
 * chave por espécie (`enemy-<kind>-<grupo>`) com fallback para o grupo genérico, camada extra de
 * impacto no ataque e os ganhos/rate/gap usados na chamada de `play()`.
 *
 * A resolução é SEMPRE feita contra o manifest carregado em tempo de execução
 * (`/audio/foley-manifest.json`) — nenhuma lista de arquivos é congelada aqui, então trocar sons
 * padrão no manifest reflete no estúdio e no jogo sem tocar neste arquivo.
 */

export type EnemyAudioKind = 'eggplant' | 'corn' | 'watermelon' | 'tomato' | 'carrot' | 'boss';
/**
 * `attack-layer` é o ruído extra que o ataque soma por cima do som principal (o `heavy`/`pistol`/
 * `swish`/`charge` que muda por espécie). Ele é um evento de primeira classe para poder ser
 * trocado, silenciado e restaurado sem mexer no som principal — e vice-versa.
 */
export type EnemyAudioEvent = 'spawn' | 'windup' | 'attack' | 'attack-layer' | 'hit' | 'death' | 'dodge';
export type FoleyManifest = Readonly<Record<string, readonly string[]>>;

/** Onde o manifest vive (mesma URL usada por RecordedAudio). */
export const ENEMY_AUDIO_MANIFEST_URL = '/audio/foley-manifest.json';
/** Acima desta distância `WeaponAudio.enemy()` descarta o evento. */
export const ENEMY_AUDIO_RANGE = 32;
/** Atenuação: ganho = base / (1 + d² / 144). */
export const ENEMY_AUDIO_FALLOFF = 144;
/** `playbackRate` aplicado por espécie (o chefe soa mais grave). */
export const ENEMY_AUDIO_BOSS_RATE = 0.9;
/** Multiplicador da camada extra de impacto no ataque. */
export const ENEMY_ATTACK_LAYER_GAIN = 0.75;
/** `gap` (anti-metralhadora) da camada extra, em segundos. */
export const ENEMY_ATTACK_LAYER_GAP = 0.18;

export interface EnemyAudioSpecies {
  kind: EnemyAudioKind;
  /** Nome exibido, igual ao de ENEMIES em src/run/MonsterDirector.ts. */
  label: string;
  note: string;
}

export const ENEMY_AUDIO_SPECIES: readonly EnemyAudioSpecies[] = [
  { kind: 'eggplant', label: 'Berinjela predadora', note: 'Corpo a corpo rápido; aparece em todas as hordas.' },
  { kind: 'corn', label: 'Milho artilheiro', note: 'Atira de longe.' },
  { kind: 'watermelon', label: 'Melancia esmagadora', note: 'Tanque lento com golpe pesado.' },
  { kind: 'tomato', label: 'Tomate de praga voador', note: 'Voa e lança projéteis incendiários que deixam fogo no chão.' },
  { kind: 'carrot', label: 'Cenoura de raízes', note: 'Canaliza um laser à distância.' },
  { kind: 'boss', label: 'PRAGA ALFA (chefe)', note: 'Presença pesada e ataques de grande alcance.' },
];

export const ENEMY_AUDIO_KINDS: readonly EnemyAudioKind[] = ENEMY_AUDIO_SPECIES.map(species => species.kind);

export interface EnemyAudioEventSpec {
  event: EnemyAudioEvent;
  label: string;
  /** Texto simples, para o usuário: sem nome de classe, de grupo ou de parâmetro. */
  description: string;
  /** Grupo genérico do manifest. Vazio em `attack-layer`, que muda por espécie. */
  group: string;
  /** Ganho base a 0 m, antes da atenuação por distância. */
  gain: number;
  /** Intervalo mínimo entre duas execuções do mesmo grupo, em segundos. */
  gap: number;
  /** `false` quando a API existe mas o jogo ainda não dispara o evento. */
  wired: boolean;
}

export const ENEMY_AUDIO_EVENT_SPECS: readonly EnemyAudioEventSpec[] = [
  {
    event: 'spawn', label: 'Aparecer', group: 'spawn', gain: 0.46, gap: 0.45, wired: true,
    description: 'Quando o inimigo surge no mapa.',
  },
  {
    event: 'windup', label: 'Preparar ataque', group: 'growl', gain: 0.58, gap: 0.45, wired: true,
    description: 'O aviso de que o golpe vem — a casca rangendo, o grão chacoalhando, a chama pegando. É o som mais alto do inimigo.',
  },
  {
    event: 'attack', label: 'Atacar', group: 'attack', gain: 0.46, gap: 0.45, wired: true,
    description: 'O som do golpe ou do disparo em si.',
  },
  {
    event: 'attack-layer', label: 'Ruído do ataque', group: '', gain: 0.46 * ENEMY_ATTACK_LAYER_GAIN, gap: ENEMY_ATTACK_LAYER_GAP, wired: true,
    description: 'O barulho que acompanha o ataque (impacto, estalo, sopro ou carga, conforme a espécie). É uma peça separada: dá para trocar ou silenciar só ela.',
  },
  {
    event: 'hit', label: 'Receber dano', group: 'hurt', gain: 0.3, gap: 0.18, wired: true,
    description: 'Quando o inimigo leva dano. Toca muito, por isso é mais baixo.',
  },
  {
    event: 'death', label: 'Morrer', group: 'death', gain: 0.46, gap: 0.45, wired: true,
    description: 'O inimigo se desfazendo.',
  },
  {
    event: 'dodge', label: 'Esquivar', group: 'swish', gain: 0.46, gap: 0.45, wired: false,
    description: 'Esquiva. Todas as espécies usam o mesmo som, e o jogo ainda não dispara este evento.',
  },
];

export const ENEMY_AUDIO_EVENTS: readonly EnemyAudioEvent[] = ENEMY_AUDIO_EVENT_SPECS.map(spec => spec.event);

/**
 * Camada extra que `enemy('attack', ...)` soma por cima do som principal. Os nomes são os grupos
 * genéricos herdados; cada espécie hoje tem a própria chave (`enemy-<espécie>-<grupo>`), então o
 * milho não toca a pistola do jogador nem a cenoura o sino — só o nome do grupo é compartilhado.
 */
export const ENEMY_ATTACK_LAYERS: Readonly<Record<EnemyAudioKind, string>> = {
  eggplant: 'heavy', corn: 'throw', watermelon: 'heavy', tomato: 'swish', carrot: 'charge', boss: 'heavy',
};

const EVENT_SPECS = new Map(ENEMY_AUDIO_EVENT_SPECS.map(spec => [spec.event, spec]));
const SPECIES = new Map(ENEMY_AUDIO_SPECIES.map(species => [species.kind, species]));

export const isEnemyAudioKind = (value: unknown): value is EnemyAudioKind => typeof value === 'string' && SPECIES.has(value as EnemyAudioKind);
export const isEnemyAudioEvent = (value: unknown): value is EnemyAudioEvent => typeof value === 'string' && EVENT_SPECS.has(value as EnemyAudioEvent);

export function enemyAudioEventSpec(event: EnemyAudioEvent): EnemyAudioEventSpec {
  const spec = EVENT_SPECS.get(event);
  if (!spec) throw new Error(`Evento de áudio desconhecido: ${String(event)}`);
  return spec;
}

export function enemyAudioSpecies(kind: EnemyAudioKind): EnemyAudioSpecies {
  const species = SPECIES.get(kind);
  if (!species) throw new Error(`Espécie de áudio desconhecida: ${String(kind)}`);
  return species;
}

export interface EnemyAudioLayer {
  group: string;
  files: readonly string[];
  gain: number;
  gap: number;
}

export interface ResolvedEnemyAudio {
  kind: EnemyAudioKind;
  event: EnemyAudioEvent;
  label: string;
  /** Texto simples para o usuário. Detalhes técnicos ficam no DELIVERY. */
  description: string;
  /** Grupo do manifest que o jogo realmente usa. */
  group: string;
  /** Chave preferencial por espécie. */
  speciesGroup: string;
  /** Grupo genérico usado quando a chave por espécie não existe. */
  fallbackGroup: string;
  source: 'species' | 'fallback' | 'missing';
  files: readonly string[];
  /** Ganho base a 0 m, sem os ajustes do usuário. */
  defaultGain: number;
  rate: number;
  gap: number;
  /**
   * Só em `attack`: o ruído que o ataque soma por cima do som principal, para referência.
   * Os controles do usuário para ele ficam no evento `attack-layer` — use aquele para
   * mute/volume/arquivo, senão o ruído fica fora do alcance dos controles.
   */
  layer: EnemyAudioLayer | undefined;
}

const groupFiles = (manifest: FoleyManifest, group: string): readonly string[] => {
  const files = manifest[group];
  return Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [];
};

/** Grupo genérico do manifest para o par espécie/evento (o ruído do ataque muda por espécie). */
export const enemyAudioGroup = (kind: EnemyAudioKind, event: EnemyAudioEvent): string =>
  event === 'attack-layer' ? ENEMY_ATTACK_LAYERS[kind] : enemyAudioEventSpec(event).group;

/** Resolve evento -> grupo -> arquivos do manifest, do mesmo jeito que o runtime. */
export function resolveEnemyAudio(manifest: FoleyManifest, kind: EnemyAudioKind, event: EnemyAudioEvent): ResolvedEnemyAudio {
  const spec = enemyAudioEventSpec(event);
  const generic = enemyAudioGroup(kind, event);
  const speciesGroup = `enemy-${kind}-${generic}`;
  const species = groupFiles(manifest, speciesGroup);
  const fallback = groupFiles(manifest, generic);
  const source = species.length ? 'species' : fallback.length ? 'fallback' : 'missing';
  // O ruído é resolvido pelo mesmo caminho do evento `attack-layer` (chave da espécie primeiro,
  // grupo genérico depois) — se aqui usássemos só o grupo genérico, o estúdio mostraria um
  // arquivo e o jogo tocaria outro assim que a espécie ganhasse chave própria.
  const layer = event === 'attack' ? resolveEnemyAudio(manifest, kind, 'attack-layer') : undefined;
  return {
    kind, event, label: spec.label, description: spec.description,
    group: source === 'species' ? speciesGroup : generic,
    speciesGroup, fallbackGroup: generic, source,
    files: source === 'species' ? species : fallback,
    defaultGain: spec.gain,
    // O ruído do ataque toca na velocidade normal mesmo no chefe; só o som principal fica grave.
    rate: kind === 'boss' && event !== 'attack-layer' ? ENEMY_AUDIO_BOSS_RATE : 1,
    gap: spec.gap,
    layer: layer?.files.length ? { group: layer.group, files: layer.files, gain: spec.gain * ENEMY_ATTACK_LAYER_GAIN, gap: ENEMY_ATTACK_LAYER_GAP } : undefined,
  };
}

/** Ganho final que o runtime aplica a `distance` metros (0 fora de alcance). */
export function enemyAudioLoudness(event: EnemyAudioEvent, distance: number): number {
  if (!(distance >= 0) || distance > ENEMY_AUDIO_RANGE) return 0;
  return enemyAudioEventSpec(event).gain / (1 + distance * distance / ENEMY_AUDIO_FALLOFF);
}

/** Carrega o manifest de foley. Nunca cacheia o resultado para não congelar URLs antigas. */
export async function loadFoleyManifest(fetcher: typeof fetch = fetch, url = ENEMY_AUDIO_MANIFEST_URL): Promise<FoleyManifest> {
  const response = await fetcher(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Não foi possível carregar a lista de sons (${response.status})`);
  const manifest = await response.json() as unknown;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('A lista de sons veio num formato inesperado');
  return manifest as FoleyManifest;
}
