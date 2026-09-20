import {describe, it, expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {EventBus} from '../src/core/EventBus';
import type {DamageContext, GameEvents} from '../src/core/contracts';
import {RunRNG} from '../src/core/RunRNG';
import {RunProgression} from '../src/run/RunProgression';
import {EnemySwarm} from '../src/game/EnemySwarm';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import type {EnemyKind} from '../src/run/MonsterDirector';
import type {TrainingTarget} from '../src/world/TrainingYard';

/**
 * SONDA do relato "matar o último chefe trava a página".
 *
 * Não é medição de FPS: sem GPU, sem Havok e sem esqueleto real, o que isto pode provar é
 * ALGORÍTMICO — laço infinito, recursão ou custo que cresce com o número de cadáveres em volta.
 * Se a morte do chefe custar aqui o mesmo com 0 e com 120 cadáveres, o congelamento do navegador
 * está no lado que este ambiente não tem, e a investigação muda de lugar.
 */

const KINDS: readonly EnemyKind[] = ['eggplant', 'corn', 'watermelon', 'tomato', 'carrot'];

async function setup() {
  const engine = new NullEngine(), scene = new Scene(engine), events = new EventBus<GameEvents>();
  const collision = new CollisionWorld();
  collision.surfaces.push({id: 'field', x: 0, z: 0, width: 400, depth: 400, height: 0});
  const player = new PlayerMotor(collision, events, {x: 0, y: 0, z: 0});
  player.debugInvincible = true;
  const run = new RunProgression(events);
  const world = {targets: [] as TrainingTarget[], collision};
  const light = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  const shadows = new ShadowGenerator(64, light);
  const swarm = new EnemySwarm(scene, world, events, shadows, player, run, new RunRNG('boss-freeze'), 'expedition');
  await swarm.load(async model => {
    const container = new AssetContainer(scene);
    container.meshes.push(CreateBox(model, {size: 1}, scene));
    container.populateRootNodes();
    container.removeAllFromScene();
    return container;
  });
  swarm.initialize();
  swarm.benchmark = true; swarm.director.stopped = true;
  return {engine, scene, events, player, run, swarm, close: () => {swarm.dispose(); scene.dispose(); engine.dispose();}};
}

const lethal = (victim: number): DamageContext => ({
  attackerId: 1, victimId: victim, sourceId: 'dual_pistols', attackId: 'right',
  baseDamage: 9_000_000, finalDamage: 9_000_000, crit: false, procCoefficient: 1, procChainDepth: 0,
  damageTags: ['bullet'], hitPosition: {x: 0, y: 1, z: 0}, hitNormal: {x: 0, y: 0, z: -1},
  forceDirection: {x: 0, y: 0, z: 1}, hitDirection: {x: 0, y: 0, z: 1}, forceMagnitude: 2,
});

/** Semeia `count` cadáveres JÁ MORTOS num raio pequeno em volta da origem — o cenário da horda final. */
function corpsesAround(swarm: EnemySwarm, count: number, radius = 8): number {
  swarm.populationCap = count + 8;
  for (let i = 0; i < count; i++) {
    const angle = i / Math.max(1, count) * Math.PI * 2, r = radius * (.3 + (i % 7) / 10);
    swarm.spawn(KINDS[i % KINDS.length]!, {x: Math.cos(angle) * r, y: 0, z: Math.sin(angle) * r}, 'normal');
  }
  let dead = 0;
  for (const actor of swarm.actors) {
    if (actor.kind === 'boss' || !actor.active) continue;
    actor.health.current = 0; actor.state = 'dead'; dead++;
  }
  return dead;
}

async function killBossWith(corpses: number): Promise<{ms: number; corpses: number}> {
  const t = await setup();
  try {
    const dead = corpsesAround(t.swarm, corpses);
    t.swarm.populationCap = corpses + 8;
    const spawned = t.swarm.spawn('boss', {x: 0, y: 0, z: 0}, 'normal');
    expect(spawned).toBe(true);
    const boss = t.swarm.actors.find(a => a.kind === 'boss' && a.active);
    expect(boss).toBeDefined();
    boss!.state = 'chase'; boss!.time = 2;

    const started = performance.now();
    boss!.target.onHit!(lethal(boss!.id));
    // Um passo depois da morte: é aí que cadáveres lançados e cacos são simulados.
    t.swarm.fixedUpdate(1 / 60);
    const ms = performance.now() - started;
    expect(boss!.health.dead).toBe(true);
    return {ms, corpses: dead};
  } finally {t.close();}
}

describe('morte do chefe não trava o quadro', () => {
  it('custo da morte do chefe não explode com a quantidade de cadáveres em volta', async () => {
    const alone = await killBossWith(0);
    const crowded = await killBossWith(120);
    // eslint-disable-next-line no-console
    console.log(`[SONDA] chefe sozinho ${alone.ms.toFixed(1)} ms · com ${crowded.corpses} cadáveres ${crowded.ms.toFixed(1)} ms`);
    expect(crowded.ms).toBeLessThan(1000);
  }, 30_000);
});
