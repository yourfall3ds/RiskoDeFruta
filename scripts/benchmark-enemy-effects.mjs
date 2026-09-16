/**
 * Onde o quadro do planeta está indo, medido contra a malha AUTORAL de 1,75 M de triângulos.
 *
 * O relato de campo: depois de uma habilidade matar ~6 pragas, a apresentação salta para ~45 ms por
 * quadro com a simulação em 2,5 ms e ZERO ragdolls. Apresentação sem ragdoll = os laços de efeito
 * que rodam em `update(dt)`: cacos de fruta, cacos de cadáver, grãos elementais e casquilhos.
 *
 * No plano cada um desses laços faz `groundAt(x,z)` numa grade. Na esfera faz `support(p, acima,
 * abaixo)`, que é um RAIO na BVH do planeta. Este script mede o preço desse raio em função do
 * comprimento, e depois o custo agregado do quadro com os pools cheios.
 *
 * Uso: npx tsx scripts/benchmark-enemy-effects.mjs
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import {PlanetFrame} from '../src/planet/PlanetFrame.ts';
import {PlanetCollision} from '../src/planet/PlanetCollision.ts';
import {SphereSurface} from '../src/physics/SphereSurface.ts';

const MANIFEST = 'public/models/planet-archipelago.json.gz';
const mb = b => (b / 1024 / 1024).toFixed(1);
const now = () => Number(process.hrtime.bigint()) / 1e6;

console.log('=== malha autoral ===');
let t0 = now();
const manifest = JSON.parse(zlib.gunzipSync(fs.readFileSync(MANIFEST)).toString());
console.log(`manifesto lido em ${(now() - t0).toFixed(0)} ms · ${manifest.indices.length / 3} triângulos`);

const before = process.memoryUsage().heapUsed;
t0 = now();
const collision = new PlanetCollision();
collision.setGeometry(manifest.positions, manifest.indices);
const buildMs = now() - t0;
console.log(`BVH construída em ${buildMs.toFixed(0)} ms · heap +${mb(process.memoryUsage().heapUsed - before)} MB`);

const frame = new PlanetFrame({
  centre: manifest.centre ?? {x: 0, y: 0, z: 0}, surfaceRadius: manifest.radius,
  voidRadius: manifest.radius - 12, ceilingRadius: manifest.radius * 1.8, islandRadius: 72,
});
const surface = new SphereSurface(frame, collision);

// Pontos de amostra: no convés das ilhas grandes, que é onde a horda morre.
const deck = [];
for (const island of manifest.islands) {
  for (let i = 0; i < 12; i++) {
    const basis = frame.basisAt(island.centre, {x: 0, y: 0, z: 1});
    const a = i / 12 * Math.PI * 2, r = Math.min(island.radius * .6, 18);
    const guess = {
      x: island.centre.x + basis.right.x * Math.sin(a) * r + basis.forward.x * Math.cos(a) * r,
      y: island.centre.y + basis.right.y * Math.sin(a) * r + basis.forward.y * Math.cos(a) * r,
      z: island.centre.z + basis.right.z * Math.sin(a) * r + basis.forward.z * Math.cos(a) * r,
    };
    const support = surface.support(guess, 8, 20);
    if (support) deck.push({x: support.point.x, y: support.point.y, z: support.point.z});
  }
}
console.log(`${deck.length} pontos de convés amostrados`);

const bench = (label, run, iterations) => {
  run(Math.min(200, iterations)); // aquecimento
  const start = now();
  run(iterations);
  const ms = now() - start;
  console.log(`  ${label.padEnd(34)} ${(ms / iterations * 1000).toFixed(1).padStart(7)} µs/chamada · ${ms.toFixed(0)} ms / ${iterations}`);
  return ms / iterations;
};

console.log('\n=== custo de `support` por COMPRIMENTO da sonda (é o raio na BVH) ===');
const costs = {};
for (const below of [2, 4, 8, 16, 32, 60, 80]) {
  costs[below] = bench(`support(p, 2, ${below})`, n => {
    for (let i = 0; i < n; i++) {
      const p = deck[i % deck.length];
      // Um metro acima do convés: a altura típica de um caco que ainda está caindo.
      const up = frame.up(p);
      surface.support({x: p.x + up.x, y: p.y + up.y, z: p.z + up.z}, 2, below);
    }
  }, 4000);
}
const ratio = costs[80] / costs[4];
console.log(`  sonda de 80 m custa ${ratio.toFixed(1)}× a de 4 m`);

console.log('\n=== custo agregado do quadro, com os pools CHEIOS ===');
// Contagens reais dos pools: 54 cacos de fruta, 48 grãos elementais, 48 casquilhos, 12 cacos de corpo.
const pools = [
  {label: 'FruitFragments 54 × support(2,80)', count: 54, above: 2, below: 80},
  {label: 'ElementalEffects 48 × support(.2,20)', count: 48, above: .2, below: 20},
  {label: 'ShellCasings 48 × support(.1,20)', count: 48, above: .1, below: 20},
  {label: 'CorpseDebris 12 × support(.5,60)', count: 12, above: .5, below: 60},
];
let frameMs = 0;
for (const pool of pools) {
  const per = bench(pool.label, n => {
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < pool.count; k++) {
        const p = deck[(i * pool.count + k) % deck.length];
        const up = frame.up(p);
        surface.support({x: p.x + up.x, y: p.y + up.y, z: p.z + up.z}, pool.above, pool.below);
      }
    }
  }, 120);
  frameMs += per;
}
console.log(`  TOTAL por quadro com tudo cheio: ${frameMs.toFixed(1)} ms  →  ${(1000 / (frameMs + 16.7)).toFixed(0)} fps de teto`);

console.log('\n=== quanto sobra encurtando a sonda para o caso comum ===');
const shortened = 54 * costs[4] + 48 * costs[4] + 48 * costs[4] + 12 * costs[4];
console.log(`  mesmos pools com sonda de 4 m: ${shortened.toFixed(1)} ms/quadro (${(frameMs / shortened).toFixed(1)}× mais barato)`);
