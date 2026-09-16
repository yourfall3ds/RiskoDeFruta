import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ENEMY_AUDIO_EVENTS, ENEMY_AUDIO_EVENT_SPECS, ENEMY_AUDIO_KINDS, ENEMY_ATTACK_LAYERS, resolveEnemyAudio,
  type EnemyAudioEvent, type EnemyAudioKind, type FoleyManifest,
} from '../src/audio/EnemyAudioCatalog';
import {
  EnemyAudioError, EnemyAudioOverrides, MemoryEnemyAudioStorage, MAX_CLIP_BYTES,
  type EnemyAudioChannelLike, type EnemyAudioStorage,
} from '../src/audio/EnemyAudioOverrides';

/** Manifest real do projeto: o painel precisa representar o jogo, não uma cópia velha. */
const MANIFEST = JSON.parse(readFileSync(new URL('../public/audio/foley-manifest.json', import.meta.url), 'utf8')) as FoleyManifest;

const fake = (marker: string) => ({ duration: 0.25, length: 12_000, numberOfChannels: 1, sampleRate: 48_000, marker } as unknown as AudioBuffer);
const markerOf = (buffer: AudioBuffer | undefined): string | undefined => (buffer as unknown as { marker?: string } | undefined)?.marker;

/** Contexto de áudio de mentira: só decodifica bytes que comecem com "OK:". */
class FakeContext {
  manual = false;
  readonly pending: { marker: string; settle: () => void }[] = [];
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    const marker = new TextDecoder().decode(data);
    if (!marker.startsWith('OK:')) return Promise.reject(new Error('formato não suportado'));
    if (!this.manual) return Promise.resolve(fake(marker));
    return new Promise<AudioBuffer>(resolve => { this.pending.push({ marker, settle: () => resolve(fake(marker)) }); });
  }
  release(marker: string): void {
    const index = this.pending.findIndex(item => item.marker === marker);
    if (index >= 0) this.pending.splice(index, 1)[0]!.settle();
  }
  get asContext(): BaseAudioContext { return this as unknown as BaseAudioContext; }
}

const clip = (name: string, decodable = true, size = 0) => {
  const head = new TextEncoder().encode(`${decodable ? 'OK:' : 'XX:'}${name}`);
  const bytes = new Uint8Array(Math.max(head.length, size));
  bytes.set(head);
  return { name, type: 'audio/wav', bytes: bytes.buffer as ArrayBuffer };
};

const lab = (options: { storage?: EnemyAudioStorage | null; context?: FakeContext; channel?: EnemyAudioChannelLike | null } = {}) => {
  const context = options.context ?? new FakeContext();
  const overrides = new EnemyAudioOverrides({
    manifest: MANIFEST,
    storage: options.storage === undefined ? new MemoryEnemyAudioStorage() : options.storage,
    channel: options.channel === undefined ? null : options.channel,
    context: context.asContext,
    now: () => 1_700_000_000_000,
  });
  return { overrides, context };
};

class FakeChannel implements EnemyAudioChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(private readonly bus: Set<FakeChannel>) { bus.add(this); }
  postMessage(message: unknown): void { for (const peer of this.bus) if (peer !== this && !peer.closed) peer.onmessage?.({ data: message }); }
  close(): void { this.closed = true; this.bus.delete(this); }
}

it('resolve a chave da espécie e cai no grupo genérico quando ela não existe', async () => {
  const { overrides } = lab();
  try {
    await overrides.ready;
    const attack = overrides.lookup('corn', 'attack');
    expect(attack.source).toBe('species');
    expect(attack.group).toBe('enemy-corn-attack');
    expect(attack.files).toEqual(MANIFEST['enemy-corn-attack']);

    // windup -> growl e hit -> hurt, exatamente como RecordedAudio faz.
    expect(overrides.lookup('corn', 'windup').group).toBe('enemy-corn-growl');
    expect(overrides.lookup('corn', 'hit').group).toBe('enemy-corn-hurt');

    // esquiva não tem variação por espécie: o jogo usa o grupo swish.
    const dodge = overrides.lookup('watermelon', 'dodge');
    expect(dodge.source).toBe('fallback');
    expect(dodge.group).toBe('swish');
    expect(dodge.speciesGroup).toBe('enemy-watermelon-swish');
    expect(dodge.files).toEqual(MANIFEST['swish']);

    expect(overrides.lookup('boss', 'attack').rate).toBe(0.9);
    expect(overrides.lookup('carrot', 'attack').rate).toBe(1);
  } finally { overrides.dispose(); }
});

it('o ruído do ataque é um evento próprio, com o grupo da espécie e sem a gravidade do chefe', () => {
  for (const kind of ENEMY_AUDIO_KINDS) {
    const layer = resolveEnemyAudio(MANIFEST, kind, 'attack-layer');
    expect(layer.fallbackGroup, kind).toBe(ENEMY_ATTACK_LAYERS[kind]);
    expect(layer.speciesGroup, kind).toBe(`enemy-${kind}-${ENEMY_ATTACK_LAYERS[kind]}`);
    // Mesma escolha que RecordedAudio faz: chave da espécie quando existe, genérico quando não.
    expect(layer.files, kind).toEqual(MANIFEST[layer.speciesGroup] ?? MANIFEST[layer.fallbackGroup]);
    expect(layer.defaultGain, kind).toBeCloseTo(0.46 * 0.75, 6);
    expect(layer.gap, kind).toBe(0.18);
    // O som principal do chefe fica mais grave; o ruído dele não.
    expect(layer.rate, kind).toBe(1);
    expect(layer.layer, kind).toBeUndefined();
  }
  expect(resolveEnemyAudio(MANIFEST, 'boss', 'attack').rate).toBe(0.9);
  // O ataque e o ruído do milho apontam para grupos diferentes do manifest, e o ruído do milho
  // tem chave própria: mexer nele não mexe na pistola do jogador, que continua no grupo `pistol`.
  expect(resolveEnemyAudio(MANIFEST, 'corn', 'attack').group).toBe('enemy-corn-attack');
  expect(resolveEnemyAudio(MANIFEST, 'corn', 'attack-layer').group).toBe('enemy-corn-pistol');
  expect(MANIFEST['enemy-corn-pistol']).not.toEqual(MANIFEST['pistol']);
});

it('voz e ruído do ataque são silenciados e trocados de forma independente', async () => {
  const { overrides, context } = lab();
  try {
    await overrides.ready;
    // Tirar só o ruído: a voz continua.
    await overrides.setMuted('corn', 'attack-layer', true);
    expect(overrides.gainFor('corn', 'attack-layer', 0)).toBe(0);
    expect(overrides.gainFor('corn', 'attack', 0)).toBeCloseTo(0.46, 6);

    // Tirar só a voz: o ruído volta sozinho.
    await overrides.setMuted('corn', 'attack-layer', false);
    await overrides.setMuted('corn', 'attack', true);
    expect(overrides.gainFor('corn', 'attack', 0)).toBe(0);
    expect(overrides.gainFor('corn', 'attack-layer', 0)).toBeCloseTo(0.345, 6);

    // Arquivo próprio em cada peça, sem um encostar no outro.
    await overrides.setOverride('corn', 'attack-layer', clip('meu-tiro.wav'));
    expect(markerOf(overrides.getBuffer(context.asContext, 'corn', 'attack-layer'))).toBe('OK:meu-tiro.wav');
    expect(overrides.getBuffer(context.asContext, 'corn', 'attack')).toBeUndefined();
    await overrides.setOverride('corn', 'attack', clip('minha-voz.wav'));
    expect(markerOf(overrides.getBuffer(context.asContext, 'corn', 'attack'))).toBe('OK:minha-voz.wav');
    expect(markerOf(overrides.getBuffer(context.asContext, 'corn', 'attack-layer'))).toBe('OK:meu-tiro.wav');

    await overrides.restoreEvent('corn', 'attack-layer');
    expect(overrides.hasOverride('corn', 'attack-layer')).toBe(false);
    expect(markerOf(overrides.getBuffer(context.asContext, 'corn', 'attack'))).toBe('OK:minha-voz.wav');
  } finally { overrides.dispose(); }
});

it('silenciar o ruído de uma espécie não atinge quem compartilha o mesmo grupo', async () => {
  const { overrides } = lab();
  try {
    await overrides.ready;
    // Berinjela, melancia e chefe caem todos no grupo "heavy"; o milho divide "pistol" com a pistola do jogador.
    await overrides.setMuted('watermelon', 'attack-layer', true);
    await overrides.setOverride('corn', 'attack-layer', clip('outro-tiro.wav'));

    expect(overrides.gainFor('watermelon', 'attack-layer', 0)).toBe(0);
    expect(overrides.gainFor('eggplant', 'attack-layer', 0)).toBeCloseTo(0.345, 6);
    expect(overrides.gainFor('boss', 'attack-layer', 0)).toBeCloseTo(0.345, 6);
    expect(overrides.hasOverride('eggplant', 'attack-layer')).toBe(false);

    // As escolhas são guardadas por espécie:evento, nunca por grupo do manifest — é isso que
    // impede o mute do milho de calar a pistola do jogador, que nem passa por esta API.
    expect(overrides.exportBundle().entries.map(entry => `${entry.kind}:${entry.event}`).sort())
      .toEqual(['corn:attack-layer', 'watermelon:attack-layer']);
  } finally { overrides.dispose(); }
});

it('acrescentar o ruído do ataque não descarta as escolhas dos seis eventos antigos', async () => {
  // Estado gravado antes de "attack-layer" existir.
  const storage = new MemoryEnemyAudioStorage();
  const legacy: EnemyAudioEvent[] = ['spawn', 'windup', 'attack', 'hit', 'death', 'dodge'];
  for (const event of legacy) await storage.save({ kind: 'eggplant', event, gain: 0.5, muted: event === 'hit', updatedAt: 1 });

  const { overrides } = lab({ storage });
  try {
    await overrides.ready;
    for (const event of legacy) {
      expect(overrides.userGain('eggplant', event), event).toBeCloseTo(0.5, 6);
      expect(overrides.isMuted('eggplant', event), event).toBe(event === 'hit');
    }
    // A chave nova começa limpa, sem migração nem perda.
    expect(overrides.userGain('eggplant', 'attack-layer')).toBe(1);
    expect(overrides.isMuted('eggplant', 'attack-layer')).toBe(false);
    expect(overrides.hasOverride('eggplant', 'attack-layer')).toBe(false);
  } finally { overrides.dispose(); }
});

it('marca corretamente quais eventos o jogo já dispara', () => {
  const wired = new Map(ENEMY_AUDIO_EVENT_SPECS.map(spec => [spec.event, spec.wired]));
  // EnemySwarm chama spawn, windup, attack, hit e death; dodge ainda não existe no jogo.
  expect(wired.get('windup')).toBe(true);
  expect(wired.get('attack-layer')).toBe(true);
  expect([...wired.entries()].filter(([, value]) => !value).map(([event]) => event)).toEqual(['dodge']);
});

it('espelha a camada extra de impacto do ataque de cada espécie', () => {
  for (const kind of ENEMY_AUDIO_KINDS) {
    const attack = resolveEnemyAudio(MANIFEST, kind, 'attack');
    // A prévia mostrada no evento `attack` tem de ser o mesmo grupo que o evento `attack-layer`
    // resolve — é esse que o runtime toca. Ver tests/enemy-audio-assets.test.ts.
    const played = resolveEnemyAudio(MANIFEST, kind, 'attack-layer');
    expect(attack.layer?.group).toBe(played.group);
    expect(attack.layer?.files).toEqual(played.files);
    expect(attack.layer?.gain).toBeCloseTo(0.46 * 0.75, 6);
    // Só o ataque soma camada.
    for (const event of ENEMY_AUDIO_EVENTS) if (event !== 'attack') expect(resolveEnemyAudio(MANIFEST, kind, event).layer).toBeUndefined();
  }
  expect(ENEMY_ATTACK_LAYERS.corn).toBe('pistol');
  expect(ENEMY_ATTACK_LAYERS.tomato).toBe('swish');
  expect(ENEMY_ATTACK_LAYERS.carrot).toBe('charge');
  expect(ENEMY_ATTACK_LAYERS.eggplant).toBe('heavy');
});

it('todo par espécie/evento do painel resolve arquivos que existem no manifest real', () => {
  for (const kind of ENEMY_AUDIO_KINDS) for (const event of ENEMY_AUDIO_EVENTS) {
    const resolved = resolveEnemyAudio(MANIFEST, kind, event);
    expect(resolved.source, `${kind}/${event}`).not.toBe('missing');
    expect(resolved.files.length, `${kind}/${event}`).toBeGreaterThan(0);
  }
  // Nenhuma chave enemy-<espécie>-* do manifest fica fora do painel.
  const reachable = new Set(ENEMY_AUDIO_KINDS.flatMap(kind => ENEMY_AUDIO_EVENTS.map(event => resolveEnemyAudio(MANIFEST, kind, event).speciesGroup)));
  for (const key of Object.keys(MANIFEST)) {
    const [prefix, kind] = key.split('-');
    if (prefix !== 'enemy' || !ENEMY_AUDIO_KINDS.includes(kind as EnemyAudioKind)) continue;
    expect(reachable.has(key), `${key} não aparece no estúdio`).toBe(true);
  }
});

it('atenua o ganho por evento e por distância como o runtime', async () => {
  const { overrides } = lab();
  try {
    await overrides.ready;
    expect(overrides.gainFor('eggplant', 'hit', 0)).toBeCloseTo(0.3, 6);
    expect(overrides.gainFor('eggplant', 'windup', 0)).toBeCloseTo(0.58, 6);
    expect(overrides.gainFor('eggplant', 'spawn', 12)).toBeCloseTo(0.46 / (1 + 144 / 144), 6);
    expect(overrides.gainFor('eggplant', 'spawn', 33)).toBe(0);
    await overrides.setUserGain('eggplant', 'spawn', 0.5);
    expect(overrides.gainFor('eggplant', 'spawn', 0)).toBeCloseTo(0.23, 6);
    expect(overrides.gainFor('eggplant', 'death', 0)).toBeCloseTo(0.46, 6);
  } finally { overrides.dispose(); }
});

it('silenciar um evento não silencia os outros e se distingue de "sem substituição"', async () => {
  const { overrides, context } = lab();
  try {
    await overrides.ready;
    await overrides.setMuted('corn', 'attack', true);
    expect(overrides.isMuted('corn', 'attack')).toBe(true);
    expect(overrides.gainFor('corn', 'attack', 0)).toBe(0);

    for (const event of ENEMY_AUDIO_EVENTS) if (event !== 'attack') expect(overrides.isMuted('corn', event), event).toBe(false);
    for (const kind of ENEMY_AUDIO_KINDS) if (kind !== 'corn') expect(overrides.isMuted(kind, 'attack'), kind).toBe(false);

    // Sem override: nada de buffer, mas também nada de mute — o runtime usa o som padrão.
    const untouched = overrides.lookup('corn', 'hit');
    expect(untouched.muted).toBe(false);
    expect(untouched.custom).toBe(false);
    expect(overrides.getBuffer(context.asContext, 'corn', 'hit')).toBeUndefined();
    expect(overrides.gainFor('corn', 'hit', 0)).toBeGreaterThan(0);

    await overrides.setMuted('corn', 'attack', false);
    expect(overrides.gainFor('corn', 'attack', 0)).toBeCloseTo(0.46, 6);
  } finally { overrides.dispose(); }
});

it('aceita o arquivo só depois de decodificar e volta ao manifest ao restaurar', async () => {
  const { overrides, context } = lab();
  try {
    await overrides.ready;
    await overrides.setUserGain('tomato', 'death', 0.4);
    await overrides.setOverride('tomato', 'death', clip('meu-tomate.wav'));

    const custom = overrides.lookup('tomato', 'death');
    expect(custom.custom).toBe(true);
    expect(custom.override?.name).toBe('meu-tomate.wav');
    expect(custom.userGain).toBeCloseTo(0.4, 6);
    expect(markerOf(overrides.getBuffer(context.asContext, 'tomato', 'death'))).toBe('OK:meu-tomate.wav');
    // O manifest continua listado para comparação, sem ser sobrescrito.
    expect(custom.files).toEqual(MANIFEST['enemy-tomato-death']);

    await overrides.clearOverride('tomato', 'death');
    expect(overrides.hasOverride('tomato', 'death')).toBe(false);
    expect(overrides.getBuffer(context.asContext, 'tomato', 'death')).toBeUndefined();
    expect(overrides.userGain('tomato', 'death')).toBeCloseTo(0.4, 6);

    await overrides.restoreEvent('tomato', 'death');
    expect(overrides.userGain('tomato', 'death')).toBe(1);
  } finally { overrides.dispose(); }
});

it('arquivo ilegível é recusado com erro claro e mantém a configuração anterior', async () => {
  const { overrides, context } = lab();
  try {
    await overrides.ready;
    await overrides.setUserGain('carrot', 'attack', 1.5);
    await overrides.setOverride('carrot', 'attack', clip('bom.wav'));

    await expect(overrides.setOverride('carrot', 'attack', clip('quebrado.txt', false))).rejects.toBeInstanceOf(EnemyAudioError);
    await expect(overrides.setOverride('carrot', 'attack', clip('gigante.wav', true, MAX_CLIP_BYTES + 1))).rejects.toThrow(/limite/);

    expect(markerOf(overrides.getBuffer(context.asContext, 'carrot', 'attack'))).toBe('OK:bom.wav');
    expect(overrides.lookup('carrot', 'attack').override?.name).toBe('bom.wav');
    expect(overrides.userGain('carrot', 'attack')).toBeCloseTo(1.5, 6);
  } finally { overrides.dispose(); }
});

it('troca rápida A -> B: a decodificação antiga não vence a nova', async () => {
  const context = new FakeContext();
  context.manual = true;
  const { overrides } = lab({ context });
  try {
    await overrides.ready;
    const first = overrides.setOverride('boss', 'attack', clip('A.wav'));
    const second = overrides.setOverride('boss', 'attack', clip('B.wav'));
    await vi.waitFor(() => expect(context.pending.length).toBe(2));
    context.release('OK:B.wav');   // B termina primeiro...
    context.release('OK:A.wav');   // ...e A chega depois, atrasado.
    await Promise.all([first, second]);

    expect(markerOf(overrides.getBuffer(context.asContext, 'boss', 'attack'))).toBe('OK:B.wav');
    expect(overrides.lookup('boss', 'attack').override?.name).toBe('B.wav');
  } finally { overrides.dispose(); }
});

it('volume, mute e áudio próprio voltam numa nova instância (persistência)', async () => {
  const storage = new MemoryEnemyAudioStorage();
  const first = lab({ storage });
  try {
    await first.overrides.ready;
    await first.overrides.setUserGain('eggplant', 'hit', 0.25);
    await first.overrides.setMuted('eggplant', 'windup', true);
    await first.overrides.setOverride('eggplant', 'spawn', clip('nascimento.wav'));
  } finally { first.overrides.dispose(); }

  const second = lab({ storage });
  try {
    await second.overrides.ready;
    expect(second.overrides.userGain('eggplant', 'hit')).toBeCloseTo(0.25, 6);
    expect(second.overrides.isMuted('eggplant', 'windup')).toBe(true);
    await second.overrides.prepare(second.context.asContext);
    expect(markerOf(second.overrides.getBuffer(second.context.asContext, 'eggplant', 'spawn'))).toBe('OK:nascimento.wav');
    expect(second.overrides.lookup('eggplant', 'spawn').bufferReady).toBe(true);
  } finally { second.overrides.dispose(); }
});

it('sem armazenamento o painel segue funcionando em modo memória, sem rejeição solta', async () => {
  const broken: EnemyAudioStorage = {
    load: () => Promise.reject(new Error('IndexedDB negado')),
    save: () => Promise.reject(new Error('cota estourada')),
    remove: () => Promise.reject(new Error('cota estourada')),
    clear: () => Promise.reject(new Error('cota estourada')),
    close: () => {},
  };
  const rejections: unknown[] = [];
  const onRejection = (error: unknown) => rejections.push(error);
  process.on('unhandledRejection', onRejection);
  const { overrides, context } = lab({ storage: broken });
  try {
    await overrides.ready;
    expect(overrides.storageMode).toBe('memoria');
    await overrides.setMuted('watermelon', 'attack', true);
    await overrides.setOverride('watermelon', 'attack', clip('melancia.wav'));
    // Continua valendo nesta aba, e o painel tem o que avisar ao usuário.
    expect(overrides.isMuted('watermelon', 'attack')).toBe(true);
    expect(markerOf(overrides.getBuffer(context.asContext, 'watermelon', 'attack'))).toBe('OK:melancia.wav');
    expect(overrides.storageNote).toMatch(/aba/);
    expect(overrides.lastWarning).toMatch(/cota|negado/);
    await new Promise(resolve => setImmediate(resolve));
    expect(rejections).toEqual([]);
  } finally { overrides.dispose(); process.off('unhandledRejection', onRejection); }
});

it('exporta pacote autocontido e importa preservando o que já existia', async () => {
  const source = lab();
  let bundle: unknown;
  try {
    await source.overrides.ready;
    await source.overrides.setOverride('corn', 'attack', clip('tiro-novo.wav'));
    await source.overrides.setUserGain('corn', 'attack', 1.2);
    await source.overrides.setMuted('eggplant', 'hit', true);
    // JSON puro: o pacote atravessa serialização levando o áudio embutido.
    bundle = JSON.parse(JSON.stringify(source.overrides.exportBundle()));
  } finally { source.overrides.dispose(); }

  const target = lab();
  try {
    await target.overrides.ready;
    await target.overrides.setOverride('carrot', 'death', clip('cenoura.wav'));
    const report = await target.overrides.importBundle(bundle);
    expect(report.skipped).toEqual([]);
    expect(report.applied.sort()).toEqual(['corn:attack', 'eggplant:hit']);

    expect(markerOf(target.overrides.getBuffer(target.context.asContext, 'corn', 'attack'))).toBe('OK:tiro-novo.wav');
    expect(target.overrides.userGain('corn', 'attack')).toBeCloseTo(1.2, 6);
    expect(target.overrides.isMuted('eggplant', 'hit')).toBe(true);
    // Preservado: não estava no pacote.
    expect(markerOf(target.overrides.getBuffer(target.context.asContext, 'carrot', 'death'))).toBe('OK:cenoura.wav');
    // E o padrão do manifest segue intocado.
    expect(target.overrides.lookup('corn', 'attack').files).toEqual(MANIFEST['enemy-corn-attack']);
  } finally { target.overrides.dispose(); }
});

it('importação valida formato, limites e áudio ilegível sem derrubar o que já estava', async () => {
  const { overrides, context } = lab();
  try {
    await overrides.ready;
    await overrides.setOverride('boss', 'death', clip('chefe.wav'));

    await expect(overrides.importBundle('{"nada":1}')).rejects.toThrow(/pacote de sons/i);
    await expect(overrides.importBundle('nao é json')).rejects.toThrow(/JSON/);
    await expect(overrides.importBundle({ format: 'mutant-farm-enemy-audio', version: 99, entries: [] })).rejects.toThrow(/versão/);
    await expect(overrides.importBundle({ format: 'mutant-farm-enemy-audio', version: 1, entries: 'x' })).rejects.toThrow(/entries/);

    const base64 = (name: string, decodable = true) => Buffer.from(new Uint8Array(clip(name, decodable).bytes)).toString('base64');
    const report = await overrides.importBundle({
      format: 'mutant-farm-enemy-audio', version: 1, exportedAt: '2026-09-15T00:00:00.000Z',
      entries: [
        { kind: 'batata', event: 'attack', gain: 1, muted: false },
        { kind: 'corn', event: 'explodir', gain: 1, muted: false },
        { kind: 'corn', event: 'hit', gain: 1, muted: false, clip: { name: 'ruim.txt', type: 'text/plain', data: base64('ruim.txt', false) } },
        { kind: 'corn', event: 'spawn', gain: 1, muted: false, clip: { name: 'corrompido.wav', type: 'audio/wav', data: '!!!não é base64!!!' } },
        { kind: 'tomato', event: 'attack', gain: 5, muted: false, clip: { name: 'ok.wav', type: 'audio/wav', data: base64('ok.wav') } },
      ],
    });

    expect(report.applied).toEqual(['tomato:attack']);
    expect(report.skipped.map(item => item.key)).toEqual(['batata:attack', 'corn:explodir', 'corn:hit', 'corn:spawn']);
    expect(report.skipped.every(item => item.reason.length > 0)).toBe(true);

    // Aplicado com o volume limitado a 200%, e o que já existia continua de pé.
    expect(overrides.userGain('tomato', 'attack')).toBe(2);
    expect(markerOf(overrides.getBuffer(context.asContext, 'tomato', 'attack'))).toBe('OK:ok.wav');
    expect(markerOf(overrides.getBuffer(context.asContext, 'boss', 'death'))).toBe('OK:chefe.wav');
    expect(overrides.hasOverride('corn', 'hit')).toBe(false);
    expect(overrides.hasOverride('corn', 'spawn')).toBe(false);
  } finally { overrides.dispose(); }
});

it('restaurar espécie limpa só aquela espécie', async () => {
  const { overrides } = lab();
  try {
    await overrides.ready;
    await overrides.setMuted('corn', 'attack', true);
    await overrides.setUserGain('corn', 'hit', 0.2);
    await overrides.setMuted('tomato', 'attack', true);
    await overrides.restoreSpecies('corn');

    for (const event of ENEMY_AUDIO_EVENTS) {
      expect(overrides.isMuted('corn', event), event).toBe(false);
      expect(overrides.userGain('corn', event), event).toBe(1);
    }
    expect(overrides.isMuted('tomato', 'attack')).toBe(true);

    await overrides.restoreAll();
    expect(overrides.isMuted('tomato', 'attack')).toBe(false);
    expect(overrides.exportBundle().entries).toEqual([]);
  } finally { overrides.dispose(); }
});

it('avisa mudanças na mesma aba, propaga entre abas e limpa tudo no dispose', async () => {
  const bus = new Set<FakeChannel>();
  const storage = new MemoryEnemyAudioStorage();
  const panel = lab({ storage, channel: new FakeChannel(bus) });
  const game = lab({ storage, channel: new FakeChannel(bus) });
  const seen: string[][] = [];
  try {
    await Promise.all([panel.overrides.ready, game.overrides.ready]);
    const unsubscribe = game.overrides.subscribe(keys => { seen.push([...keys]); });

    await panel.overrides.setOverride('carrot', 'windup', clip('cenoura-rosnado.wav'));
    // Sem recarregar: a outra aba recarrega a chave e decodifica sozinha.
    await vi.waitFor(() => expect(game.overrides.hasOverride('carrot', 'windup')).toBe(true));
    await vi.waitFor(() => expect(markerOf(game.overrides.getBuffer(game.context.asContext, 'carrot', 'windup'))).toBe('OK:cenoura-rosnado.wav'));
    expect(seen.flat()).toContain('carrot:windup');

    unsubscribe();
    const before = seen.length;
    await panel.overrides.setMuted('carrot', 'windup', true);
    await vi.waitFor(() => expect(game.overrides.isMuted('carrot', 'windup')).toBe(true));
    expect(seen.length).toBe(before);
  } finally {
    panel.overrides.dispose();
    game.overrides.dispose();
    expect([...bus].length).toBe(0);
  }
});

it('lookup não explode quando o manifest não carrega', async () => {
  const overrides = new EnemyAudioOverrides({
    manifest: () => Promise.reject(new Error('404')),
    storage: new MemoryEnemyAudioStorage(),
    channel: null,
    now: () => 0,
  });
  try {
    await overrides.ready;
    // Aviso em português simples: nada de "manifest" na mensagem que chega ao usuário.
    expect(overrides.manifestWarning).toMatch(/lista de sons/i);
    expect(overrides.manifestWarning).not.toMatch(/manifest/i);
    const lookup = overrides.lookup('corn', 'attack');
    expect(lookup.source).toBe('missing');
    expect(lookup.files).toEqual([]);
    expect(lookup.muted).toBe(false);
    // Ainda dá para silenciar/ajustar sem manifest (o jogo resolve depois).
    await overrides.setMuted('corn', 'attack', true);
    expect(overrides.gainFor('corn', 'attack', 0)).toBe(0);
  } finally { overrides.dispose(); }
});

it('a espécie e o evento inválidos são rejeitados pelos validadores do catálogo', () => {
  const kinds: unknown[] = ['corn', 'boss', 'batata', 42, null];
  expect(kinds.filter(value => ENEMY_AUDIO_KINDS.includes(value as EnemyAudioKind))).toEqual(['corn', 'boss']);
  const events: unknown[] = ['windup', 'dodge', 'explodir', undefined];
  expect(events.filter(value => ENEMY_AUDIO_EVENTS.includes(value as EnemyAudioEvent))).toEqual(['windup', 'dodge']);
});
