/**
 * Perfil do `update(dt)` da horda — o laço de APRESENTAÇÃO — contra o mapa autoral de verdade.
 *
 * O relato de campo é `presentation 45,59 ms` com `sim 2,48 ms` e ZERO ragdolls, logo depois de uma
 * habilidade matar ~6 pragas. Isso põe o custo no que roda por QUADRO em `update`, não no passo
 * fixo. Este script monta a cena real (NullEngine + malha de 1,75 M de triângulos + `SphereSurface`
 * de produção + `EnemySwarm` original), mata inimigos de verdade para encher os pools de cacos, e
 * cronometra cada subsistema separadamente.
 *
 * Uso: npx tsx scripts/profile-enemy-presentation.mjs [--actors=12] [--frames=400]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {EventBus} from '../src/core/EventBus';
import {RunRNG} from '../src/core/RunRNG';
import {RunProgression} from '../src/run/RunProgression';
import {EnemySwarm} from '../src/game/EnemySwarm';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {SphereSurface} from '../src/physics/SphereSurface';

const MANIFEST = 'public/models/planet-archipelago.json.gz';
const FRAGMENT_MODEL = 'public/models/fruit-fragments.glb';
const argument = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : fallback;
};
const ACTORS = argument('actors', 12), FRAMES = argument('frames', 400);
const now = () => Number(process.hrtime.bigint()) / 1e6;

const manifest = JSON.parse(zlib.gunzipSync(fs.readFileSync(MANIFEST)).toString());
const collisionPlanet = new PlanetCollision();
collisionPlanet.setGeometry(manifest.positions, manifest.indices);
const frame = new PlanetFrame({
  centre: manifest.centre ?? {x: 0, y: 0, z: 0}, surfaceRadius: manifest.radius,
  voidRadius: manifest.radius - 12, ceilingRadius: manifest.radius * 1.8, islandRadius: 72,
});
const surface = new SphereSurface(frame, collisionPlanet);
console.log(`mapa: ${manifest.indices.length / 3} triângulos · R=${manifest.radius}`);

// A maior ilha é onde a horda de verdade morre.
const island = [...manifest.islands].sort((a, b) => b.radius - a.radius)[0];
const start = surface.support(island.centre, 12, 30)?.point ?? island.centre;
console.log(`ilha: ${island.id} (r=${island.radius}) · convés em |p|=${Math.hypot(start.x, start.y, start.z).toFixed(1)}`);

const engine = new NullEngine(), scene = new Scene(engine), events = new EventBus();
const collision = new CollisionWorld();
const player = new PlayerMotor(collision, events, start);
player.position.x = start.x; player.position.y = start.y; player.position.z = start.z;
const run = new RunProgression(events);
const world = {targets: [], collision, surface};
const light = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
const shadows = new ShadowGenerator(128, light);
const swarm = new EnemySwarm(scene, world, events, shadows, player, run, new RunRNG('perf'));
await swarm.load(async model => {
  const c = new AssetContainer(scene), mesh = CreateBox(model, {size: 1}, scene);
  c.meshes.push(mesh); c.populateRootNodes(); c.removeAllFromScene(); return c;
});
// Os cacos REAIS: sem o molde carregado a quebra fica na fila e o laço mediria vazio.
const bytes64 = 'data:base64,' + fs.readFileSync(FRAGMENT_MODEL).toString('base64');
swarm.fragments.useSurface(surface);
await swarm.fragments.ready.catch(() => false);
swarm.initialize(); swarm.populationCap = 60; swarm.benchmark = true; swarm.director.stopped = true;

const near = (arc, angle) => {
  const basis = frame.basisAt(player.position, {x: 0, y: 0, z: 1});
  const s = Math.sin(angle) * arc, c = Math.cos(angle) * arc;
  const guess = {
    x: player.position.x + basis.right.x * s + basis.forward.x * c,
    y: player.position.y + basis.right.y * s + basis.forward.y * c,
    z: player.position.z + basis.right.z * s + basis.forward.z * c,
  };
  return surface.support(guess, 8, 20)?.point ?? guess;
};

const kinds = ['eggplant', 'carrot', 'corn', 'tomato', 'watermelon'];
for (let i = 0; i < ACTORS; i++) swarm.spawn(kinds[i % kinds.length], near(6 + i % 5 * 2, i / ACTORS * Math.PI * 2), 'normal');
console.log(`atores vivos: ${swarm.count}`);

const hit = (actor, amount) => actor.target.onHit?.({
  attackerId: 1, victimId: actor.id, sourceId: 'dual_pistols', attackId: 'right',
  baseDamage: amount, finalDamage: amount, crit: false, procCoefficient: 1, procChainDepth: 0,
  damageTags: ['bullet'], hitPosition: actor.root.position, hitNormal: frame.up(actor.root.position),
  forceDirection: frame.basisAt(actor.root.position, {x: 0, y: 0, z: 1}).forward, forceMagnitude: 2,
});

// A habilidade 2 mata ~6 de uma vez: é esse instante que precisa ser medido.
const victims = swarm.actors.filter(a => a.active).slice(0, 6);
for (const actor of victims) hit(actor, 999999);
swarm.update(1 / 60);
console.log(`mortos de uma vez: ${victims.length} · cacos ativos: ${swarm.fragments.active}/${swarm.fragments.capacity} · ragdolls: ${swarm.ragdollCount}`);
if (!swarm.fragments.active) console.log('AVISO: nenhum caco ativo — o molde não carregou, a medida abaixo não vale para fragmentos');

const measure = (label, fn) => {
  for (let i = 0; i < 30; i++) fn();
  const t0 = now();
  for (let i = 0; i < FRAMES; i++) fn();
  const ms = (now() - t0) / FRAMES;
  console.log(`  ${label.padEnd(30)} ${ms.toFixed(3).padStart(8)} ms/quadro`);
  return ms;
};

console.log(`\n=== apresentação, ${FRAMES} quadros, pools cheios ===`);
const total = measure('swarm.update(dt) TOTAL', () => swarm.update(1 / 60));
const fragments = measure('  fragments.update', () => swarm.fragments.update(1 / 60));
const effects = measure('  effects.render', () => swarm.effects.render(1 / 60));
console.log(`  (cacos ativos durante a medida: ${swarm.fragments.active})`);

console.log(`\n=== passo fixo, para comparar ===`);
const fixed = measure('swarm.fixedUpdate(dt)', () => swarm.fixedUpdate(1 / 60));

console.log(`\nresumo: update ${total.toFixed(2)} ms · fixedUpdate ${fixed.toFixed(2)} ms`);
console.log(`fragmentos representam ${(fragments / total * 100).toFixed(0)}% do update`);
void bytes64; void LoadAssetContainerAsync;
swarm.dispose(); scene.dispose(); engine.dispose();
