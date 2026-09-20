import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ENEMY_AUDIO_EVENTS, ENEMY_AUDIO_KINDS, ENEMY_ATTACK_LAYERS, enemyAudioGroup, resolveEnemyAudio,
  type EnemyAudioEvent, type EnemyAudioKind, type FoleyManifest,
} from '../src/audio/EnemyAudioCatalog';

/**
 * Guarda do banco de sons de inimigos.
 *
 * O usuário ouviu e recusou a paleta antiga inteira (vozes de bicho/demônio/fada e os quatro
 * impactos pesados). Estes testes existem para que ela não volte — nem pelo nome do arquivo, nem
 * por uma cópia renomeada, nem por um grupo genérico servindo de rede de segurança.
 *
 * Nada aqui afirma que o som é bom: isso só o usuário decide, ouvindo no estúdio. O que dá para
 * verificar por máquina é o que está verificado — origem, duração, pico e caminho de resolução.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)));
const json = <T>(relative: string): T => JSON.parse(read(relative).toString('utf8')) as T;
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const MANIFEST = json<FoleyManifest>('public/audio/foley-manifest.json');
const REJECTED = json<{ hashes: Record<string, string[]> }>('docs/enemy-audio-rejected.json').hashes;
const REPORT = json<{
  assets: Record<string, { seconds: number; peak: number; rate: number; channels: number; sha256: string; group: string; sources: string[] }>;
}>('docs/enemy-audio-assets.json').assets;

/** Caminho público (`/audio/...`) -> caminho no repositório. */
const onDisk = (url: string) => `public${url}`;

/** Todo grupo que o jogo pode resolver: preferido por espécie, genérico de fallback e camada. */
function activeGroups(): Set<string> {
  const groups = new Set<string>();
  for (const kind of ENEMY_AUDIO_KINDS) {
    for (const event of ENEMY_AUDIO_EVENTS) {
      const generic = enemyAudioGroup(kind, event);
      groups.add(generic);
      groups.add(`enemy-${kind}-${generic}`);
    }
  }
  return new Set([...groups].filter(group => (MANIFEST[group]?.length ?? 0) > 0));
}

describe('banco de sons de inimigos', () => {
  it('todo arquivo citado pelo manifest existe no disco', () => {
    const missing = Object.entries(MANIFEST)
      .flatMap(([group, files]) => files.filter(file => !existsSync(fileURLToPath(new URL(`../${onDisk(file)}`, import.meta.url)))).map(file => `${group}: ${file}`));
    expect(missing).toEqual([]);
  });

  it('nenhum grupo que o inimigo resolve aponta para o material recusado', () => {
    // Por conteúdo, não por nome: uma cópia renomeada do mesmo áudio tem o mesmo sha256.
    const offenders: string[] = [];
    for (const group of activeGroups()) {
      for (const file of MANIFEST[group] ?? []) {
        const hash = sha256(read(onDisk(file)));
        if (REJECTED[hash]) offenders.push(`${group}: ${file} == ${REJECTED[hash]!.join('/')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('o material recusado continua catalogado, senão o teste acima não guarda nada', () => {
    // Se alguém apagar os originais, a lista de hashes vira vazia e o teste passaria à toa.
    const names = Object.values(REJECTED).flat();
    expect(names.length).toBeGreaterThanOrEqual(20);
    for (const name of ['heavy-0.ogg', 'enemy-voice-demon-call-one-voice.wav', 'enemy-voice-pixie.wav', 'enemy-voice-demon-growl.wav']) {
      expect(names, name).toContain(name);
    }
  });

  it('cada espécie e cada evento resolvem para as peças novas', () => {
    for (const kind of ENEMY_AUDIO_KINDS) {
      for (const event of ENEMY_AUDIO_EVENTS) {
        const resolved = resolveEnemyAudio(MANIFEST, kind, event);
        expect(resolved.source, `${kind}/${event}`).not.toBe('missing');
        // `dodge` é o único que ainda usa um grupo compartilhado (os swishes de bambu).
        if (event === 'dodge') continue;
        for (const file of resolved.files) {
          expect(file, `${kind}/${event}`).toMatch(/^\/audio\/enemies\//);
          expect(REPORT[file.split('/').pop()!], file).toBeDefined();
        }
      }
    }
  });

  it('todas as seis espécies têm a própria camada de ruído, sem herdar a do jogador', () => {
    for (const kind of ENEMY_AUDIO_KINDS) {
      const layer = resolveEnemyAudio(MANIFEST, kind, 'attack-layer');
      expect(layer.source, kind).toBe('species');
      expect(layer.group, kind).toBe(`enemy-${kind}-${ENEMY_ATTACK_LAYERS[kind]}`);
    }
    // Os grupos compartilhados com o jogador ficaram intactos.
    expect(MANIFEST['pistol']).toEqual(['/audio/pistol-1.wav', '/audio/pistol-2.wav', '/audio/pistol-3.wav', '/audio/pistol-4.wav']);
    expect(MANIFEST['reload']).toEqual(['/audio/foley/reload.wav']);
    for (const group of ['swish', 'charge', 'impact', 'casing', 'grass', 'wood', 'concrete', 'water', 'rain', 'voice-skill1', 'voice-skill2', 'voice-skill3']) {
      expect(MANIFEST[group]?.length, group).toBeGreaterThan(0);
    }
  });

  it('o que o estúdio mostra como ruído do ataque é o que o jogo toca', () => {
    // RecordedAudio dispara `attack-layer` como evento próprio; o campo `layer` do evento
    // `attack` é só a prévia. Se os dois divergirem, o painel mente sobre o jogo.
    for (const kind of ENEMY_AUDIO_KINDS) {
      const preview = resolveEnemyAudio(MANIFEST, kind, 'attack').layer;
      const played = resolveEnemyAudio(MANIFEST, kind, 'attack-layer');
      expect(preview?.group, kind).toBe(played.group);
      expect(preview?.files, kind).toEqual(played.files);
      expect(preview?.gap, kind).toBe(played.gap);
      expect(preview?.gain, kind).toBeCloseTo(played.defaultGain, 6);
    }
  });

  it('as peças novas batem com o relatório de preparação', () => {
    // O relatório é gerado medindo o .ogg já codificado; conferir o sha256 impede que ele
    // envelheça e passe a atestar arquivos que não existem mais.
    for (const [name, row] of Object.entries(REPORT)) {
      expect(sha256(read(`public/audio/enemies/${name}`)), name).toBe(row.sha256);
    }
    expect(Object.keys(REPORT).length).toBeGreaterThanOrEqual(80);
  });

  it('durações e ganhos ficam dentro dos limites combinados', () => {
    // Acertos frequentes (dano, camada de ruído) são curtos; ataques ficam abaixo de 1 s.
    const limits: Record<string, [number, number]> = {
      hurt: [0.12, 0.65], heavy: [0.12, 0.65], pistol: [0.12, 0.65], swish: [0.12, 0.65], throw: [0.12, 0.65], charge: [0.12, 0.65],
      growl: [0.15, 0.75], attack: [0.12, 0.98], spawn: [0.15, 1.05], death: [0.15, 1.05],
    };
    for (const [name, row] of Object.entries(REPORT)) {
      const [low, high] = limits[row.group.split('-').pop()!]!;
      expect(row.seconds, `${name} (${row.group})`).toBeGreaterThanOrEqual(low);
      expect(row.seconds, `${name} (${row.group})`).toBeLessThanOrEqual(high);
      expect(row.peak, name).toBeLessThan(0.95); // margem de sobra antes do clipe
      expect(row.peak, name).toBeGreaterThan(0.3); // e nada tão baixo que suma na mixagem
      expect(row.channels, name).toBe(1);
      expect(row.rate, name).toBe(44100);
    }
  });

  it('o chefe continua abaixo de um segundo mesmo com a queda de velocidade', () => {
    // O runtime toca o chefe a 0.9x, o que estica cada peça em ~11%.
    for (const event of ['spawn', 'windup', 'attack', 'hit', 'death'] as EnemyAudioEvent[]) {
      for (const file of resolveEnemyAudio(MANIFEST, 'boss' as EnemyAudioKind, event).files) {
        expect(REPORT[file.split('/').pop()!]!.seconds / 0.9, file).toBeLessThan(1.1);
      }
    }
  });

  it('a procedência de cada amostra de origem está registrada e classificada', () => {
    const sources = json<{ author: string; license: string; kind: string; url: string; files: string[]; use: string; sha256: Record<string, string> }[]>('docs/enemy-audio-sources.json');
    expect(sources.length).toBeGreaterThan(0);
    const declared = new Set(sources.flatMap(entry => entry.files));
    for (const entry of sources) {
      expect(entry.license, entry.url).toBe('CC0');
      expect(entry.url).toMatch(/^https:\/\//);
      // 'acústica' x 'autoral': o pacote sci-fi da Kenney e o do rubberduck são SFX produzido,
      // não captação de campo — usar é legítimo, descrever errado não.
      expect(['acústica', 'autoral'], entry.url).toContain(entry.kind);
      expect(Object.keys(entry.sha256).sort()).toEqual([...entry.files].sort());
    }
    // Toda peça gerada declara de quais amostras saiu, e todas elas estão no arquivo de licenças.
    for (const [name, row] of Object.entries(REPORT)) {
      expect(row.sources.length, name).toBeGreaterThan(0);
      for (const source of row.sources) expect(declared, `${name} -> ${source}`).toContain(source);
    }
  });

  it('nada usa a família de feixe retrô que o usuário recusou', () => {
    // O usuário pediu explicitamente nada de bipe retrô/8-bit. A cenoura ficou só com laserLarge
    // (filtrado e com rampa), forceField invertido e ar texturizado.
    const retired = ['beamR1', 'beamR3', 'beamS'];
    const offenders = Object.entries(REPORT)
      .filter(([, row]) => row.sources.some(source => retired.includes(source)))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
    for (const event of ['windup', 'attack', 'attack-layer'] as EnemyAudioEvent[]) {
      for (const file of resolveEnemyAudio(MANIFEST, 'carrot' as EnemyAudioKind, event).files) {
        expect(REPORT[file.split('/').pop()!]!.sources.some(source => /^beamL/.test(source)), file).toBe(true);
      }
    }
  });

  it('os impactos pesados têm pesos físicos distintos, não a mesma textura repetida', () => {
    // O grupo `heavy` é o que mais toca em sequência (é também o dano que o jogador leva): se as
    // quatro peças saírem das mesmas amostras, vira uma só repetida.
    const heavy = Object.values(REPORT).filter(row => row.group === 'heavy');
    expect(heavy.length).toBe(4);
    expect(new Set(heavy.map(row => row.sources.join('+'))).size).toBe(4);
    // E a base é a família impactPunch/impactWood, não a impactSoft_heavy recusada.
    for (const row of heavy) expect(row.sources.some(source => /^(punch|knock)/.test(source))).toBe(true);
  });
});
