/**
 * Substituições de áudio de inimigo escolhidas pelo usuário (volume, silenciar, arquivo próprio).
 *
 * Desenhado para ser consultado DENTRO do loop de áudio: depois de `await ready` (uma vez, fora do
 * loop) tudo é síncrono e vem de cache em memória. Nada aqui faz rede, nem sobe arquivo para
 * lugar algum: os áudios ficam em IndexedDB no navegador do usuário.
 *
 * Integração: veja docs/CLAUDE_AUDIO_LAB_DELIVERY.md.
 */

import {
  ENEMY_AUDIO_EVENTS, ENEMY_AUDIO_KINDS, ENEMY_AUDIO_RANGE, ENEMY_AUDIO_FALLOFF,
  enemyAudioEventSpec, isEnemyAudioEvent, isEnemyAudioKind, loadFoleyManifest, resolveEnemyAudio,
  type EnemyAudioEvent, type EnemyAudioKind, type FoleyManifest, type ResolvedEnemyAudio,
} from './EnemyAudioCatalog';

export const ENEMY_AUDIO_CHANNEL = 'mutant-farm-enemy-audio';
export const ENEMY_AUDIO_DB = 'mutant-farm-audio-lab';
export const ENEMY_AUDIO_STORE = 'enemy-overrides';
export const ENEMY_AUDIO_BUNDLE_FORMAT = 'mutant-farm-enemy-audio';
export const ENEMY_AUDIO_BUNDLE_VERSION = 1;
/** Limite por som substituído (6 MB). */
export const MAX_CLIP_BYTES = 6 * 1024 * 1024;
/** Limite somado de um pacote importado (48 MB). */
export const MAX_BUNDLE_BYTES = 48 * 1024 * 1024;
/** Volume do usuário: 0 a 2 (200%). */
export const MAX_USER_GAIN = 2;

/** Erro com mensagem pronta para mostrar ao usuário. */
export class EnemyAudioError extends Error {
  constructor(message: string, readonly cause?: unknown) { super(message); this.name = 'EnemyAudioError'; }
}

export interface EnemyAudioClip { name: string; type: string; bytes: ArrayBuffer }
export interface EnemyAudioRecord {
  kind: EnemyAudioKind;
  event: EnemyAudioEvent;
  /** Multiplicador do usuário (1 = padrão). */
  gain: number;
  muted: boolean;
  updatedAt: number;
  clip?: EnemyAudioClip;
}

export interface EnemyAudioStorage {
  load(): Promise<EnemyAudioRecord[]>;
  save(record: EnemyAudioRecord): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

export interface EnemyAudioChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface EnemyAudioBundleEntry {
  kind: string;
  event: string;
  gain: number;
  muted: boolean;
  clip?: { name: string; type: string; data: string };
}
export interface EnemyAudioBundle {
  format: string;
  version: number;
  exportedAt: string;
  entries: EnemyAudioBundleEntry[];
}
export interface EnemyAudioImportReport {
  applied: string[];
  skipped: { key: string; reason: string }[];
}

/** O que o runtime precisa saber na hora do evento. */
export interface EnemyAudioLookup extends ResolvedEnemyAudio {
  key: string;
  muted: boolean;
  /** Multiplicador escolhido pelo usuário. */
  userGain: number;
  /** `defaultGain * userGain` (0 m). Não inclui a atenuação por distância. */
  gain: number;
  /** `true` quando existe arquivo próprio do usuário para este evento. */
  custom: boolean;
  override: { name: string; type: string; size: number; updatedAt: number } | undefined;
  /** `true` quando o arquivo já está decodificado e `getBuffer` devolve algo. */
  bufferReady: boolean;
}

export interface EnemyAudioOverridesOptions {
  /** `null` força modo memória (sem persistência). Padrão: IndexedDB quando disponível. */
  storage?: EnemyAudioStorage | null;
  /** Manifest pronto ou carregador. Padrão: fetch em /audio/foley-manifest.json. */
  manifest?: FoleyManifest | (() => Promise<FoleyManifest>);
  /** `null` desliga a sincronia entre abas. */
  channel?: EnemyAudioChannelLike | null;
  /** Contexto usado para decodificar. Pode ser informado depois em `prepare()`. */
  context?: BaseAudioContext;
  now?: () => number;
}

export const enemyAudioKey = (kind: EnemyAudioKind, event: EnemyAudioEvent): string => `${kind}:${event}`;

const PERSISTENT_NOTE = 'Salvo neste navegador. Os arquivos ficam no seu computador.';
const MEMORY_NOTE = 'Somente nesta aba: o navegador não deixou salvar, então as escolhas somem ao recarregar. Exporte o pacote para não perder.';

const clampGain = (value: unknown): number => {
  const gain = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  return Math.max(0, Math.min(MAX_USER_GAIN, gain));
};

const toBase64 = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
};

const fromBase64 = (data: string): ArrayBuffer => {
  const binary = atob(data);
  const view = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return view.buffer;
};

const validRecord = (value: unknown): value is EnemyAudioRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<EnemyAudioRecord>;
  if (!isEnemyAudioKind(record.kind) || !isEnemyAudioEvent(record.event)) return false;
  return typeof record.muted === 'boolean' && typeof record.gain === 'number';
};

class IndexedDbStorage implements EnemyAudioStorage {
  private readonly db: Promise<IDBDatabase>;
  private handle: IDBDatabase | undefined;
  constructor(factory: IDBFactory) {
    this.db = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(ENEMY_AUDIO_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ENEMY_AUDIO_STORE)) db.createObjectStore(ENEMY_AUDIO_STORE);
      };
      request.onsuccess = () => { this.handle = request.result; resolve(request.result); };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponível'));
      request.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba'));
    });
  }
  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.db;
    return db.transaction(ENEMY_AUDIO_STORE, mode).objectStore(ENEMY_AUDIO_STORE);
  }
  private done<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB falhou'));
    });
  }
  async load(): Promise<EnemyAudioRecord[]> {
    const rows = await this.done((await this.store('readonly')).getAll());
    return (rows as unknown[]).filter(validRecord);
  }
  async save(record: EnemyAudioRecord): Promise<void> {
    await this.done((await this.store('readwrite')).put(record, enemyAudioKey(record.kind, record.event)));
  }
  async remove(key: string): Promise<void> {
    await this.done((await this.store('readwrite')).delete(key));
  }
  async clear(): Promise<void> {
    await this.done((await this.store('readwrite')).clear());
  }
  close(): void { this.handle?.close(); void this.db.catch(() => {}); }
}

/** Fallback quando o navegador nega IndexedDB (aba privada, cota, etc.). */
export class MemoryEnemyAudioStorage implements EnemyAudioStorage {
  private readonly rows = new Map<string, EnemyAudioRecord>();
  load(): Promise<EnemyAudioRecord[]> { return Promise.resolve([...this.rows.values()]); }
  save(record: EnemyAudioRecord): Promise<void> { this.rows.set(enemyAudioKey(record.kind, record.event), record); return Promise.resolve(); }
  remove(key: string): Promise<void> { this.rows.delete(key); return Promise.resolve(); }
  clear(): Promise<void> { this.rows.clear(); return Promise.resolve(); }
  close(): void {}
}

export class EnemyAudioOverrides {
  /** Resolve quando manifest + escolhas salvas estão em memória. Nunca rejeita. */
  readonly ready: Promise<void>;
  /** 'indexeddb' = "Salvo neste navegador"; 'memoria' = só nesta aba. */
  storageMode: 'indexeddb' | 'memoria' = 'memoria';
  /** Explicação curta do modo de armazenamento, pronta para a interface. */
  storageNote = MEMORY_NOTE;
  /** Último erro não fatal (storage/decodificação em segundo plano). */
  lastWarning: string | undefined;

  private manifest: FoleyManifest = {};
  private manifestError: string | undefined;
  private readonly records = new Map<string, EnemyAudioRecord>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<(keys: readonly string[]) => void>();
  private readonly urls = new Map<string, string>();
  private readonly storage: EnemyAudioStorage;
  private readonly channel: EnemyAudioChannelLike | undefined;
  private readonly now: () => number;
  private context: BaseAudioContext | undefined;
  private disposed = false;

  constructor(options: EnemyAudioOverridesOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    if (options.context) this.context = options.context;
    this.storage = options.storage === null ? new MemoryEnemyAudioStorage() : options.storage ?? this.openStorage() ?? new MemoryEnemyAudioStorage();
    const persistent = !(this.storage instanceof MemoryEnemyAudioStorage);
    this.storageMode = persistent ? 'indexeddb' : 'memoria';
    this.storageNote = persistent ? PERSISTENT_NOTE : MEMORY_NOTE;
    this.ready = this.boot(options.manifest);
    this.channel = this.openChannel(options.channel);
  }

  private openStorage(): EnemyAudioStorage | undefined {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return undefined;
      return new IndexedDbStorage(indexedDB);
    } catch (error) {
      this.lastWarning = `Armazenamento local indisponível: ${String(error)}`;
      return undefined;
    }
  }

  private openChannel(provided: EnemyAudioChannelLike | null | undefined): EnemyAudioChannelLike | undefined {
    if (provided === null) return undefined;
    let channel = provided;
    if (!channel) {
      try { channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(ENEMY_AUDIO_CHANNEL) as unknown as EnemyAudioChannelLike; }
      catch { channel = undefined; }
    }
    if (!channel) return undefined;
    channel.onmessage = event => {
      const data = event.data as { type?: unknown; keys?: unknown } | null;
      if (!data || typeof data !== 'object' || data.type !== 'changed') return;
      const keys = Array.isArray(data.keys) ? data.keys.filter((key): key is string => typeof key === 'string') : [];
      void this.refresh(keys);
    };
    return channel;
  }

  private async boot(manifest: EnemyAudioOverridesOptions['manifest']): Promise<void> {
    try {
      this.manifest = typeof manifest === 'function' ? await manifest() : manifest ?? await loadFoleyManifest();
    } catch (error) {
      this.manifestError = `Não foi possível carregar a lista de sons: ${String(error)}`;
      this.lastWarning = this.manifestError;
      this.manifest = {};
    }
    try {
      for (const record of await this.storage.load()) this.records.set(enemyAudioKey(record.kind, record.event), record);
    } catch (error) {
      this.storageMode = 'memoria';
      this.storageNote = MEMORY_NOTE;
      this.lastWarning = `Escolhas salvas não puderam ser lidas: ${String(error)}`;
    }
    if (this.context) await this.decodePending(this.context);
  }

  /** Manifest efetivo (vazio se falhou). */
  get resolvedManifest(): FoleyManifest { return this.manifest; }
  /** Mensagem de erro do manifest, se houver. */
  get manifestWarning(): string | undefined { return this.manifestError; }

  // ---------------------------------------------------------------- consulta

  /** Síncrono. Depois de `await ready`, pode ser chamado na hora do evento. */
  lookup(kind: EnemyAudioKind, event: EnemyAudioEvent): EnemyAudioLookup {
    const resolved = resolveEnemyAudio(this.manifest, kind, event);
    const key = enemyAudioKey(kind, event);
    const record = this.records.get(key);
    const userGain = record ? clampGain(record.gain) : 1;
    return {
      ...resolved, key,
      muted: record?.muted === true,
      userGain,
      gain: resolved.defaultGain * userGain,
      custom: Boolean(record?.clip),
      override: record?.clip ? { name: record.clip.name, type: record.clip.type, size: record.clip.bytes.byteLength, updatedAt: record.updatedAt } : undefined,
      bufferReady: this.buffers.has(key),
    };
  }

  /** `true` só para este par espécie/evento — nunca silencia os demais. */
  isMuted(kind: EnemyAudioKind, event: EnemyAudioEvent): boolean {
    return this.records.get(enemyAudioKey(kind, event))?.muted === true;
  }

  /** `true` quando o usuário trocou o arquivo deste evento. */
  hasOverride(kind: EnemyAudioKind, event: EnemyAudioEvent): boolean {
    return Boolean(this.records.get(enemyAudioKey(kind, event))?.clip);
  }

  /** Multiplicador do usuário (1 = padrão), independente de mute. */
  userGain(kind: EnemyAudioKind, event: EnemyAudioEvent): number {
    const record = this.records.get(enemyAudioKey(kind, event));
    return record ? clampGain(record.gain) : 1;
  }

  /**
   * Ganho final já com atenuação por distância. 0 = não toque
   * (silenciado, volume zerado ou fora dos 32 m de alcance).
   */
  gainFor(kind: EnemyAudioKind, event: EnemyAudioEvent, distance = 0): number {
    if (this.isMuted(kind, event)) return 0;
    if (!(distance >= 0) || distance > ENEMY_AUDIO_RANGE) return 0;
    return enemyAudioEventSpec(event).gain * this.userGain(kind, event) / (1 + distance * distance / ENEMY_AUDIO_FALLOFF);
  }

  /**
   * Buffer personalizado já decodificado, ou `undefined` para "use o som padrão do manifest".
   * Síncrono e sem alocar: seguro no loop de áudio. Se o contexto mudou, agenda a decodificação
   * em segundo plano e devolve o que já existe.
   */
  getBuffer(context: BaseAudioContext, kind: EnemyAudioKind, event: EnemyAudioEvent): AudioBuffer | undefined {
    if (this.context !== context) { this.context = context; void this.decodePending(context).catch(() => {}); }
    return this.buffers.get(enemyAudioKey(kind, event));
  }

  /** URL local (blob:) do arquivo do usuário, para prévia em `<audio>`. Revogada no dispose. */
  previewUrl(kind: EnemyAudioKind, event: EnemyAudioEvent): string | undefined {
    const key = enemyAudioKey(kind, event);
    const clip = this.records.get(key)?.clip;
    if (!clip) { this.releaseUrl(key); return undefined; }
    const existing = this.urls.get(key);
    if (existing) return existing;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Blob === 'undefined') return undefined;
    const url = URL.createObjectURL(new Blob([clip.bytes], { type: clip.type || 'audio/wav' }));
    this.urls.set(key, url);
    return url;
  }

  /** Liga um contexto e decodifica tudo que já estava salvo. Chame no `unlock()`. */
  async prepare(context: BaseAudioContext): Promise<void> {
    this.context = context;
    await this.ready;
    if (this.disposed) return;
    await this.decodePending(context);
  }

  // ------------------------------------------------------------------ escrita

  async setUserGain(kind: EnemyAudioKind, event: EnemyAudioEvent, gain: number): Promise<void> {
    await this.write(kind, event, record => ({ ...record, gain: clampGain(gain) }));
  }

  async setMuted(kind: EnemyAudioKind, event: EnemyAudioEvent, muted: boolean): Promise<void> {
    await this.write(kind, event, record => ({ ...record, muted }));
  }

  /**
   * Troca o som deste evento. Decodifica ANTES de aceitar: se o arquivo não for decodificável a
   * configuração anterior continua intacta e o erro sobe como EnemyAudioError.
   */
  async setOverrideFile(kind: EnemyAudioKind, event: EnemyAudioEvent, file: { name: string; type: string; size?: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<void> {
    if ((file.size ?? 0) > MAX_CLIP_BYTES) throw new EnemyAudioError(`"${file.name}" tem ${Math.round((file.size ?? 0) / 1024 / 1024)} MB; o limite por som é ${MAX_CLIP_BYTES / 1024 / 1024} MB.`);
    let bytes: ArrayBuffer;
    try { bytes = await file.arrayBuffer(); }
    catch (error) { throw new EnemyAudioError(`Não foi possível ler "${file.name}".`, error); }
    await this.setOverride(kind, event, { name: file.name, type: file.type, bytes });
  }

  async setOverride(kind: EnemyAudioKind, event: EnemyAudioEvent, clip: EnemyAudioClip): Promise<void> {
    if (clip.bytes.byteLength === 0) throw new EnemyAudioError(`"${clip.name}" está vazio.`);
    if (clip.bytes.byteLength > MAX_CLIP_BYTES) throw new EnemyAudioError(`"${clip.name}" passa do limite de ${MAX_CLIP_BYTES / 1024 / 1024} MB por som.`);
    const key = enemyAudioKey(kind, event);
    const revision = this.bump(key);
    const buffer = await this.decodeClip(clip);
    // Uma troca mais nova (A -> B) invalida o decode antigo: ele não pode vencer a corrida.
    if (this.disposed || this.revisions.get(key) !== revision) return;
    this.buffers.set(key, buffer);
    this.releaseUrl(key);
    await this.write(kind, event, record => ({ ...record, clip }), revision);
  }

  /** Volta ao som padrão do manifest, mantendo volume/mute do evento. */
  async clearOverride(kind: EnemyAudioKind, event: EnemyAudioEvent): Promise<void> {
    const key = enemyAudioKey(kind, event);
    this.bump(key);
    this.buffers.delete(key);
    this.releaseUrl(key);
    await this.write(kind, event, record => ({ kind, event, gain: record.gain, muted: record.muted, updatedAt: record.updatedAt }));
  }

  /** Restaura um evento por completo (arquivo + volume + mute). */
  async restoreEvent(kind: EnemyAudioKind, event: EnemyAudioEvent): Promise<void> {
    const key = enemyAudioKey(kind, event);
    this.bump(key);
    this.buffers.delete(key);
    this.releaseUrl(key);
    this.records.delete(key);
    await this.persistRemoval(key);
    this.announce([key]);
  }

  /** Restaura todos os eventos de uma espécie. */
  async restoreSpecies(kind: EnemyAudioKind): Promise<void> {
    const keys: string[] = [];
    for (const event of ENEMY_AUDIO_EVENTS) {
      const key = enemyAudioKey(kind, event);
      if (!this.records.has(key)) continue;
      this.bump(key);
      this.buffers.delete(key);
      this.releaseUrl(key);
      this.records.delete(key);
      keys.push(key);
      await this.persistRemoval(key);
    }
    if (keys.length) this.announce(keys);
  }

  /** Restaura tudo. */
  async restoreAll(): Promise<void> {
    const keys = [...this.records.keys()];
    for (const key of keys) { this.bump(key); this.releaseUrl(key); }
    this.records.clear();
    this.buffers.clear();
    try { await this.storage.clear(); }
    catch (error) { this.degrade(error); }
    if (keys.length) this.announce(keys);
  }

  /** Avisa mudanças (mesma aba). Devolve a função de cancelamento. */
  subscribe(listener: (keys: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // -------------------------------------------------------- exportar/importar

  /** Pacote autocontido (JSON com os áudios em base64). Nada sai do computador do usuário. */
  exportBundle(): EnemyAudioBundle {
    const entries: EnemyAudioBundleEntry[] = [];
    for (const record of this.records.values()) {
      const entry: EnemyAudioBundleEntry = { kind: record.kind, event: record.event, gain: clampGain(record.gain), muted: record.muted };
      if (record.clip) entry.clip = { name: record.clip.name, type: record.clip.type, data: toBase64(record.clip.bytes) };
      entries.push(entry);
    }
    return { format: ENEMY_AUDIO_BUNDLE_FORMAT, version: ENEMY_AUDIO_BUNDLE_VERSION, exportedAt: new Date(this.now()).toISOString(), entries };
  }

  /**
   * Importa um pacote. Entradas inválidas são ignoradas e relatadas; as escolhas que já existiam e
   * não aparecem no pacote são preservadas, e os sons padrão do manifest nunca são tocados.
   */
  async importBundle(input: unknown): Promise<EnemyAudioImportReport> {
    let data = input;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); }
      catch (error) { throw new EnemyAudioError('O arquivo não é um JSON válido.', error); }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new EnemyAudioError('Pacote inválido: esperava um objeto JSON.');
    const bundle = data as Partial<EnemyAudioBundle>;
    if (bundle.format !== ENEMY_AUDIO_BUNDLE_FORMAT) throw new EnemyAudioError('Este JSON não é um pacote de sons do Mutant Farm.');
    if (typeof bundle.version !== 'number' || bundle.version > ENEMY_AUDIO_BUNDLE_VERSION) throw new EnemyAudioError(`Pacote da versão ${String(bundle.version)}: esta página lê até a ${ENEMY_AUDIO_BUNDLE_VERSION}.`);
    if (!Array.isArray(bundle.entries)) throw new EnemyAudioError('Pacote inválido: "entries" precisa ser uma lista.');

    const report: EnemyAudioImportReport = { applied: [], skipped: [] };
    let total = 0;
    for (const [index, raw] of bundle.entries.entries()) {
      const entry = raw as Partial<EnemyAudioBundleEntry> | null;
      const label = entry && typeof entry.kind === 'string' && typeof entry.event === 'string' ? `${entry.kind}:${entry.event}` : `entrada ${index + 1}`;
      if (!entry || typeof entry !== 'object') { report.skipped.push({ key: label, reason: 'entrada não é um objeto' }); continue; }
      if (!isEnemyAudioKind(entry.kind) || !isEnemyAudioEvent(entry.event)) { report.skipped.push({ key: label, reason: 'espécie ou evento desconhecido' }); continue; }
      const kind = entry.kind, event = entry.event, key = enemyAudioKey(kind, event);
      const gain = clampGain(entry.gain);
      const muted = entry.muted === true;
      if (entry.clip === undefined) {
        await this.write(kind, event, record => ({ ...record, gain, muted }));
        report.applied.push(key);
        continue;
      }
      const clip = entry.clip as Partial<{ name: string; type: string; data: string }> | null;
      if (!clip || typeof clip.data !== 'string' || typeof clip.name !== 'string') { report.skipped.push({ key, reason: 'áudio do pacote está mal formado' }); continue; }
      let bytes: ArrayBuffer;
      try { bytes = fromBase64(clip.data); }
      catch { report.skipped.push({ key, reason: 'áudio em base64 inválido' }); continue; }
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_CLIP_BYTES) { report.skipped.push({ key, reason: `áudio fora do limite de ${MAX_CLIP_BYTES / 1024 / 1024} MB` }); continue; }
      if (total + bytes.byteLength > MAX_BUNDLE_BYTES) { report.skipped.push({ key, reason: `pacote passou de ${MAX_BUNDLE_BYTES / 1024 / 1024} MB somados` }); continue; }
      try { await this.setOverride(kind, event, { name: clip.name, type: typeof clip.type === 'string' ? clip.type : '', bytes }); }
      catch (error) { report.skipped.push({ key, reason: error instanceof EnemyAudioError ? error.message : 'áudio não pôde ser decodificado' }); continue; }
      total += bytes.byteLength;
      await this.write(kind, event, record => ({ ...record, gain, muted }));
      report.applied.push(key);
    }
    return report;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    for (const key of [...this.urls.keys()]) this.releaseUrl(key);
    this.buffers.clear();
    this.revisions.clear();
    if (this.channel) { this.channel.onmessage = null; try { this.channel.close(); } catch { /* aba fechando */ } }
    try { this.storage.close(); } catch { /* nada a fazer */ }
    this.context = undefined;
  }

  // ------------------------------------------------------------------ interno

  private bump(key: string): number {
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);
    return revision;
  }

  private async decodeClip(clip: EnemyAudioClip): Promise<AudioBuffer> {
    const context = this.context;
    if (!context) throw new EnemyAudioError('Áudio ainda não liberado: toque qualquer som uma vez antes de substituir.');
    try { return await context.decodeAudioData(clip.bytes.slice(0)); }
    catch (error) { throw new EnemyAudioError(`"${clip.name}" não pôde ser decodificado. Use WAV, MP3, OGG ou FLAC que o navegador entenda.`, error); }
  }

  private async decodePending(context: BaseAudioContext): Promise<void> {
    const changed: string[] = [];
    for (const [key, record] of this.records) {
      if (!record.clip || this.buffers.has(key)) continue;
      const revision = this.revisions.get(key) ?? this.bump(key);
      try {
        const buffer = await context.decodeAudioData(record.clip.bytes.slice(0));
        if (this.disposed || this.revisions.get(key) !== revision) continue;
        this.buffers.set(key, buffer);
        changed.push(key);
      } catch (error) {
        this.lastWarning = `O som salvo de ${key} não pôde ser decodificado (${String(error)}); esse evento voltou ao padrão.`;
        this.records.delete(key);
        await this.persistRemoval(key);
        changed.push(key);
      }
    }
    if (changed.length && !this.disposed) this.notify(changed);
  }

  private async write(kind: EnemyAudioKind, event: EnemyAudioEvent, mutate: (record: EnemyAudioRecord) => EnemyAudioRecord, revision?: number): Promise<void> {
    if (this.disposed) return;
    const key = enemyAudioKey(kind, event);
    if (revision !== undefined && this.revisions.get(key) !== revision) return;
    const current = this.records.get(key) ?? { kind, event, gain: 1, muted: false, updatedAt: this.now() };
    const next = { ...mutate(current), kind, event, updatedAt: this.now() };
    this.records.set(key, next);
    try { await this.storage.save(next); }
    catch (error) { this.degrade(error); }
    this.announce([key]);
  }

  private async persistRemoval(key: string): Promise<void> {
    try { await this.storage.remove(key); }
    catch (error) { this.degrade(error); }
  }

  private degrade(error: unknown): void {
    this.storageMode = 'memoria';
    this.storageNote = 'Somente nesta aba: o navegador recusou salvar (espaço cheio ou janela privada). Exporte o pacote para não perder.';
    this.lastWarning = `Não foi possível salvar no navegador: ${String(error)}`;
  }

  private releaseUrl(key: string): void {
    const url = this.urls.get(key);
    if (!url) return;
    this.urls.delete(key);
    try { URL.revokeObjectURL(url); } catch { /* ambiente sem URL */ }
  }

  /** Notifica localmente e avisa as outras abas. */
  private announce(keys: readonly string[]): void {
    this.notify(keys);
    try { this.channel?.postMessage({ type: 'changed', keys: [...keys] }); }
    catch (error) { this.lastWarning = `Sincronia entre abas indisponível: ${String(error)}`; }
  }

  private notify(keys: readonly string[]): void {
    for (const listener of [...this.listeners]) {
      try { listener(keys); }
      catch (error) { console.warn('Ouvinte de áudio de inimigo falhou', error); }
    }
  }

  /** Recarrega as chaves indicadas do armazenamento (usado pela sincronia entre abas). */
  private async refresh(keys: readonly string[]): Promise<void> {
    if (this.disposed) return;
    const wanted = new Set(keys.length ? keys : ENEMY_AUDIO_KINDS.flatMap(kind => ENEMY_AUDIO_EVENTS.map(event => enemyAudioKey(kind, event))));
    let rows: EnemyAudioRecord[];
    try { rows = await this.storage.load(); }
    catch (error) { this.degrade(error); return; }
    if (this.disposed) return;
    const found = new Map(rows.map(record => [enemyAudioKey(record.kind, record.event), record]));
    const changed: string[] = [];
    for (const key of wanted) {
      const record = found.get(key);
      this.bump(key);
      this.buffers.delete(key);
      this.releaseUrl(key);
      if (record) this.records.set(key, record); else this.records.delete(key);
      changed.push(key);
    }
    if (this.context) await this.decodePending(this.context);
    if (!this.disposed && changed.length) this.notify(changed);
  }
}
