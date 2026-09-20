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
import {RunRNG, RandomStream} from '../src/core/RunRNG';
import {RunProgression} from '../src/run/RunProgression';
import {EnemySwarm, RAGDOLL_SPAWNS_PER_STEP} from '../src/game/EnemySwarm';
import {ItemProcs} from '../src/items/ItemProcs';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import type {EnemyKind} from '../src/run/MonsterDirector';
import type {TrainingTarget} from '../src/world/TrainingYard';

/**
 * Cascata de procs e carga prolongada.
 *
 * A captura de tela do relato mostra a horda final com muitos procs, explosões, rótulos e frutas ao
 * mesmo tempo. Dois riscos concretos nesse quadro, e é o que este arquivo cobra:
 *
 * 1. **recursão de proc** — uma explosão que dispara outra explosão não teria fim;
 * 2. **trabalho de morte sem teto** — uma explosão que mata cinco pragas no MESMO passo pedia cinco
 *    cadáveres articulados de Havok (~19 corpos rígidos cada) dentro de um quadro.
 *
 * LIMITE HONESTO: sem GPU, sem esqueleto e sem Havok, isto NÃO é uma medição de FPS. O que prova é
 * que a quantidade de trabalho pedida por quadro parou de crescer com o número de mortes simultâneas
 * e que nada acumula ao longo de um minuto de combate.
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
  const swarm = new EnemySwarm(scene, world, events, shadows, player, run, new RunRNG('cascade'), 'expedition');
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

function populate(swarm: EnemySwarm, count: number, radius = 6): void {
  swarm.populationCap = count + 4;
  for (let i = 0; i < count; i++) {
    const angle = i / count * Math.PI * 2;
    swarm.spawn(KINDS[i % KINDS.length]!, {x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius}, 'normal');
  }
  for (const actor of swarm.actors) {actor.state = 'chase'; actor.time = 2;}
}

const lethal = (victim: number): DamageContext => ({
  attackerId: 1, victimId: victim, sourceId: 'dual_pistols', attackId: 'right',
  baseDamage: 9_000, finalDamage: 9_000, crit: false, procCoefficient: 1, procChainDepth: 0,
  damageTags: ['bullet'], hitPosition: {x: 0, y: 1, z: 0}, hitNormal: {x: 0, y: 0, z: -1},
  forceDirection: {x: 0, y: 0, z: 1}, hitDirection: {x: 0, y: 0, z: 1}, forceMagnitude: 2,
});

describe('procs não entram em cascata', () => {
  it('dano derivado nunca dispara um novo proc primário', () => {
    const run = new RunProgression(new EventBus<GameEvents>());
    for (let i = 0; i < 40; i++) {run.addItem('bomb'); run.addItem('fire');}
    // Fluxo viciado no zero: TODO sorteio passa, então o único freio possível é a regra de cadeia.
    const procs = new ItemProcs(run, {next: () => 0, range: () => 0, pick: <T>(a: readonly T[]) => a[0]!} as unknown as RandomStream);
    let blasts = 0, burns = 0;
    const hooks = {blast: () => blasts++, burn: () => burns++};

    const primary: DamageContext = {...lethal(7), procCoefficient: 1, procChainDepth: 0};
    procs.onHit(primary, hooks);
    expect(blasts).toBe(1);
    expect(burns).toBe(1);

    // O contexto que a explosão gera (profundidade 1) não pode gerar uma segunda explosão.
    procs.onHit({...primary, procChainDepth: 1, sourceProcId: 'bomb'}, hooks);
    // Nem dano sem coeficiente de proc (contato de inimigo, queimadura).
    procs.onHit({...primary, procCoefficient: 0}, hooks);
    expect(blasts).toBe(1);
    expect(burns).toBe(1);
  });

  it('uma explosão real mata em área sem recursão, sem NaN e sem estourar os rótulos', async () => {
    const t = await setup();
    try {
      for (let i = 0; i < 60; i++) t.run.addItem('bomb');
      populate(t.swarm, 12, 3);
      for (const actor of t.swarm.actors) actor.health.current = 1;
      let killed = 0;
      t.events.on('EnemyKilled', () => killed++);
      const first = t.swarm.actors[0]!;
      first.target.onHit!(lethal(first.id));
      expect(killed).toBeGreaterThanOrEqual(1);
      expect(t.swarm.labels.length).toBeLessThanOrEqual(32);
      expect(t.swarm.actors.every(a => Number.isFinite(a.root.position.x) && Number.isFinite(a.root.position.y))).toBe(true);
      // Cada morte pagou exatamente uma vez.
      expect(t.run.totalKills).toBe(killed);
    } finally {t.close();}
  });
});

describe('orçamento de cadáver articulado', () => {
  it('cinco mortes no mesmo passo pedem um cadáver articulado, não cinco', async () => {
    const t = await setup();
    try {
      populate(t.swarm, 5, 10);
      const before = t.swarm.ragdollsSkipped;
      for (const actor of t.swarm.actors) actor.target.onHit!(lethal(actor.id));
      expect(t.swarm.kills).toBe(5);
      expect(t.swarm.ragdollsSkipped - before).toBe(5 - RAGDOLL_SPAWNS_PER_STEP);
    } finally {t.close();}
  });

  it('a vaga volta no passo seguinte: mortes espaçadas não são penalizadas', async () => {
    const t = await setup();
    try {
      populate(t.swarm, 6, 10);
      const before = t.swarm.ragdollsSkipped;
      for (const actor of t.swarm.actors) {
        t.swarm.fixedUpdate(1 / 60);
        actor.target.onHit!(lethal(actor.id));
      }
      expect(t.swarm.kills).toBe(6);
      expect(t.swarm.ragdollsSkipped).toBe(before);
    } finally {t.close();}
  });

  it('o chefe fura o teto: o cadáver dele é a cena que o jogador está esperando', async () => {
    const t = await setup();
    try {
      populate(t.swarm, 2, 10);
      expect(t.swarm.spawn('boss', {x: 0, y: 0, z: 12}, 'normal')).toBe(true);
      const boss = t.swarm.boss!;
      boss.state = 'chase';
      const before = t.swarm.ragdollsSkipped;
      // Uma praga comum gasta a vaga do passo; o chefe morre logo depois e não é recusado.
      t.swarm.actors[0]!.target.onHit!(lethal(t.swarm.actors[0]!.id));
      boss.target.onHit!(lethal(boss.id));
      expect(boss.health.dead).toBe(true);
      expect(t.swarm.ragdollsSkipped).toBe(before);
    } finally {t.close();}
  });
});

describe('carga prolongada da horda final', () => {
  it('um minuto de combate contínuo não acumula rótulos, atores nem efeitos', async () => {
    const t = await setup();
    try {
      for (let i = 0; i < 30; i++) t.run.addItem('bomb');
      for (let i = 0; i < 10; i++) t.run.addItem('fire');
      populate(t.swarm, 24, 9);
      t.swarm.director.stopped = false;

      const actorPeak = {value: 0};
      for (let frame = 0; frame < 3600; frame++) {
        t.swarm.fixedUpdate(1 / 60);
        t.swarm.update(1 / 60);
        // Seis tiros por segundo no alvo vivo mais próximo — é a cadência real da pistola dupla.
        if (frame % 10 === 0) {
          const victim = t.swarm.actors.find(a => a.active && !a.health.dead);
          if (victim) victim.target.onHit!({...lethal(victim.id), baseDamage: 26, finalDamage: 26});
        }
        actorPeak.value = Math.max(actorPeak.value, t.swarm.actors.length);
        expect(t.swarm.labels.length).toBeLessThanOrEqual(32);
      }

      // O pool de atores é reciclado por espécie: ele não cresce com o número de abates.
      expect(actorPeak.value).toBeLessThanOrEqual(t.swarm.populationCap + KINDS.length + 4);
      expect(t.swarm.kills).toBeGreaterThan(0);
      expect(t.swarm.effects.attachedShapes).toBeLessThanOrEqual(36);
      expect(t.swarm.fragments.active).toBeLessThanOrEqual(t.swarm.fragments.capacity);
      expect(t.swarm.actors.every(a => Number.isFinite(a.root.position.x) && Number.isFinite(a.root.position.z))).toBe(true);
      // Ninguém ficou com dívida de posição infinita nem com vida negativa acumulando.
      expect(t.swarm.actors.every(a => a.health.current >= 0)).toBe(true);
    } finally {t.close();}
  }, 120_000);
});
