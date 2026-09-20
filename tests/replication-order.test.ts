import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/contracts';
import { RunRNG } from '../src/core/RunRNG';
import { RunProgression } from '../src/run/RunProgression';
import { EnemySwarm, type ReplicatedEnemy } from '../src/game/EnemySwarm';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerMotor } from '../src/player/PlayerMotor';
import type { TrainingTarget } from '../src/world/TrainingYard';

/**
 * AUTORIDADE LATERAL POR ORDEM DE REPLICAÇÃO.
 *
 * `hp` e `alive` são dois campos e podem chegar em tiques diferentes. A janela entre eles é onde um
 * cliente seria tentado a deduzir a morte da vida espelhada — e uma dedução dessas é decisão, não
 * apresentação: dois clientes com jitter diferente declarariam a morte em instantes diferentes, e o
 * que viesse pendurado nela (recompensa, objetivo, drop) sairia duas vezes ou nenhuma.
 *
 * A regra travada aqui: **só `alive` transiciona**. `hp` é adotado e desenhado, nunca interpretado.
 */
async function setup() {
  const engine = new NullEngine(), scene = new Scene(engine), events = new EventBus<GameEvents>(), collision = new CollisionWorld();
  collision.surfaces.push({ id: 'field', x: 0, z: 0, width: 200, depth: 200, height: 0 });
  const player = new PlayerMotor(collision, events, { x: 0, y: 0, z: 0 });
  const run = new RunProgression(events), world = { targets: [] as TrainingTarget[], collision };
  const light = new DirectionalLight('sun', new Vector3(0, -1, 0), scene), shadows = new ShadowGenerator(128, light);
  const swarm = new EnemySwarm(scene, world, events, shadows, player, run, new RunRNG('replication-order'));
  await swarm.load(async model => {
    const c = new AssetContainer(scene), mesh = CreateBox(model, { size: 1 }, scene);
    c.meshes.push(mesh); c.populateRootNodes(); c.removeAllFromScene(); return c;
  });
  swarm.initialize(); swarm.benchmark = true; swarm.director.stopped = true;
  return { swarm, run, events, close: () => { swarm.dispose(); scene.dispose(); engine.dispose(); } };
}

function row(over: Partial<ReplicatedEnemy> = {}): ReplicatedEnemy {
  return {
    id: 7, kind: 'eggplant', variant: 'normal', scale: 1.2,
    x: 0, y: 0, z: 10, yaw: 0, hp: 75, maxHP: 75,
    state: 'chase', time: 0, burn: 0, stagger: 0, targetPlayerId: 1, alive: true, ...over,
  };
}
const DT = 1 / 60;

describe('hp e alive chegando em tiques diferentes', () => {
  it('CENÁRIO A: hp=0 chega antes de alive=false — nada além do visual acontece', async () => {
    const t = await setup();
    try {
      t.swarm.replicate([row()], DT);
      const a = t.swarm.actors.find(x => x.serverId === 7)!;
      let killed = 0;
      t.events.on('EnemyKilled', () => { killed++; });

      // A vida espelhada já é zero, mas o servidor ainda não declarou a morte.
      for (let i = 0; i < 20; i++) t.swarm.replicate([row({ hp: 0, alive: true })], DT);
      expect(a.health.current).toBe(0);            // adotada, porque é o número que a barra mostra
      expect(a.health.dead).toBe(true);            // e o getter deriva dela — por isso ninguém pode lê-lo
      // Nenhuma consequência: sem abate, sem recompensa, sem cadáver.
      expect(a.state).not.toBe('dead');
      expect(t.swarm.kills).toBe(0);
      expect(t.run.totalKills).toBe(0);
      expect(t.run.credits).toBe(0);
      expect(killed).toBe(0);

      // E quando o servidor declara, aí sim — uma vez só.
      t.swarm.replicate([row({ hp: 0, alive: false, state: 'dead' })], DT);
      expect(a.state).toBe('dead');
      expect(t.swarm.kills).toBe(1);
      expect(t.run.totalKills).toBe(0);            // recompensa continua sendo do servidor
    } finally { t.close(); }
  });

  it('CENÁRIO B: alive=false chega antes do hp final — a transição é UMA, e é a do servidor', async () => {
    const t = await setup();
    try {
      t.swarm.replicate([row()], DT);
      const a = t.swarm.actors.find(x => x.serverId === 7)!;

      // Morte declarada com a vida ainda por baixar: quem manda é `alive`.
      t.swarm.replicate([row({ hp: 31, alive: false, state: 'dead' })], DT);
      expect(a.state).toBe('dead');
      expect(t.swarm.kills).toBe(1);

      // O hp final chega depois. Ele é adotado e não redispara nada.
      for (let i = 0; i < 20; i++) t.swarm.replicate([row({ hp: 0, alive: false, state: 'dead' })], DT);
      expect(a.health.current).toBe(0);
      expect(t.swarm.kills).toBe(1);
      expect(t.run.totalKills).toBe(0);
      expect(t.run.credits).toBe(0);
    } finally { t.close(); }
  });

  it('e uma vida espelhada que SOBE não ressuscita ninguém', async () => {
    const t = await setup();
    try {
      t.swarm.replicate([row()], DT);
      const a = t.swarm.actors.find(x => x.serverId === 7)!;
      t.swarm.replicate([row({ hp: 0, alive: false, state: 'dead' })], DT);
      expect(a.state).toBe('dead');
      // Um pacote fora de ordem traz vida cheia de novo. Só o servidor decide quem está vivo, e ele
      // continua dizendo `alive:false`.
      for (let i = 0; i < 10; i++) t.swarm.replicate([row({ hp: 75, alive: false, state: 'dead' })], DT);
      expect(a.state).toBe('dead');
      expect(t.swarm.kills).toBe(1);
    } finally { t.close(); }
  });
});
