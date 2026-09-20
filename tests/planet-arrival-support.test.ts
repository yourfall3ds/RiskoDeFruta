import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {describe, expect, it} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import {parsePlanetManifest} from '../src/planet-game/PlanetManifest';
import {findSpawnPoint} from '../src/stages/StageSpawn';
import {PLAYER_TUNING} from '../src/player/PlayerTuning';

/**
 * Onde a chegada REALMENTE termina, no manifesto de verdade.
 *
 * O QA de navegador viu o corpo pousar no vazio e a recuperação de emergência disparar sozinha
 * (1 retorno, 46 de dano). Um teste de função isolada não pega isso: o que importa é o ponto que a
 * cena entrega ao motor, medido contra a casca autoral. Por isso aqui o manifesto é o do jogo —
 * `public/models/planet-archipelago.json.gz`, 38 ilhas, 1,75 M de triângulos.
 *
 * Lê o `.gz`, que é o arquivo VERSIONADO e o mesmo que o jogo baixa (`PLANET_MANIFEST_URL`). A
 * versão descompactada `.json` está no `.gitignore`, então ler dela só funcionava em máquina que
 * já tivesse uma cópia solta — num clone limpo este arquivo inteiro falhava com ENOENT. Todos os
 * outros consumidores (`scripts/audit-planet-*`, `bake-island-navmeshes`) já liam o `.gz`.
 */
const manifest = parsePlanetManifest(
  JSON.parse(gunzipSync(readFileSync('public/models/planet-archipelago.json.gz')).toString('utf8')),
);

const frame = new PlanetFrame({
  centre: manifest.centre,
  surfaceRadius: manifest.radius,
  voidRadius: manifest.radius * 0.84,
  ceilingRadius: manifest.radius * 1.6,
  islandRadius: Math.max(...manifest.islands.map(island => island.radius), 1),
});

const world = new CollisionWorld();
const mesh = new PlanetCollision();
mesh.setGeometry(manifest.positions, manifest.indices);
world.configurePlanet(frame, mesh);
const surface = world.surface;

const anchors = manifest.islands.map(island => ({
  island,
  anchor: {
    id: island.id, name: island.name,
    x: island.centre.x, y: island.centre.y, z: island.centre.z,
    width: island.radius * 2, depth: island.radius * 2,
  },
}));

describe('ponto de chegada no planeta real', () => {
  it('acha pouso em todas as ilhas do manifesto', () => {
    const missing = anchors.filter(({anchor}) => !findSpawnPoint(surface, anchor)).map(({island}) => island.id);
    expect(missing).toEqual([]);
  }, 120_000);

  /**
   * O que o QA viu: o corpo cair sozinho. Um pouso só é pouso se, DEPOIS de assentado, a sonda de
   * apoio do motor ainda encontrar chão logo abaixo dos pés — e se o ponto não estiver no vazio.
   */
  it('todo pouso tem apoio caminhável sob os pés e está fora do vazio', () => {
    const bad: string[] = [];
    for (const {island, anchor} of anchors) {
      const spawn = findSpawnPoint(surface, anchor);
      if (!spawn) continue;
      if (surface.belowVoid(spawn)) {bad.push(`${island.id}: no vazio`); continue;}
      // A mesma janela que `PlayerMotor` usa no primeiro passo de quem já está apoiado.
      const step = PLAYER_TUNING.stepHeight;
      const support = surface.support(spawn, step, step + 0.02, PLAYER_TUNING.maxSlopeDegrees);
      if (!support) {bad.push(`${island.id}: sem apoio sob os pés`); continue;}
      if (Math.abs(support.offset) > step) bad.push(`${island.id}: apoio a ${support.offset.toFixed(2)} m`);
      if (surface.insideSolid(spawn, PLAYER_TUNING.height)) bad.push(`${island.id}: dentro da geometria`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('o raio do pouso fica na casca, não no miolo do planeta', () => {
    for (const {island, anchor} of anchors) {
      const spawn = findSpawnPoint(surface, anchor);
      if (!spawn) continue;
      const radius = frame.radius(spawn);
      expect(radius, island.id).toBeGreaterThan(frame.voidRadius);
      expect(radius, island.id).toBeLessThan(frame.ceilingRadius);
    }
  }, 120_000);
});
