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
 * O CLIENTE VIROU APRESENTAÇÃO.
 *
 * Estes testes afirmam o outro lado do contrato §18.8: depois que o servidor assume, a decisão
 * local não roda "também" — ela não roda. Cada `expect` abaixo é uma decisão que o `EnemySwarm`
 * tomava sozinho e que agora tem de ser recusada.
 */
async function setup() {
  const engine = new NullEngine(), scene = new Scene(engine), events = new EventBus<GameEvents>(), collision = new CollisionWorld();
  collision.surfaces.push({ id: 'field', x: 0, z: 0, width: 200, depth: 200, height: 0 });
  const player = new PlayerMotor(collision, events, { x: 0, y: 0, z: 0 });
  const run = new RunProgression(events), world = { targets: [] as TrainingTarget[], collision };
  const light = new DirectionalLight('sun', new Vector3(0, -1, 0), scene), shadows = new ShadowGenerator(128, light);
  const swarm = new EnemySwarm(scene, world, events, shadows, player, run, new RunRNG('replica-test'));
  await swarm.load(async model => {
    const c = new AssetContainer(scene), mesh = CreateBox(model, { size: 1 }, scene);
    c.meshes.push(mesh); c.populateRootNodes(); c.removeAllFromScene(); return c;
  });
  swarm.initialize(); swarm.benchmark = true; swarm.director.stopped = true;
  return { engine, scene, events, player, run, swarm, close: () => { swarm.dispose(); scene.dispose(); engine.dispose(); } };
}

/** Uma linha autoritativa, como a sala a entrega depois de decodificar o schema. */
function row(over: Partial<ReplicatedEnemy> = {}): ReplicatedEnemy {
  return {
    id: 7, kind: 'eggplant', variant: 'normal', scale: 1.2,
    x: 0, y: 0, z: 10, yaw: 0, hp: 75, maxHP: 75,
    state: 'chase', time: 0, burn: 0, stagger: 0, targetPlayerId: 2, alive: true, ...over,
  };
}
const DT = 1 / 60;

describe('EnemySwarm replicado: apresenta, não decide', () => {
  it('adota a linha do servidor, com a VIDA e o ALVO dele — não com os calculados aqui', async () => {
    const t = await setup();
    try {
      t.swarm.replicate([row({ hp: 40, maxHP: 900, targetPlayerId: 3 })], DT);
      expect(t.swarm.replicated).toBe(true);
      const a = t.swarm.actors.find(x => x.serverId === 7)!;
      expect(a).toBeDefined();
      // 900 não é a vida que `healthFor` daria a uma berinjela: ela veio do servidor.
      expect(a.health.maximum).toBe(900);
      expect(a.health.current).toBe(40);
      // O alvo é transportado, nunca deduzido por distância no cliente.
      expect(a.targetPlayerId).toBe(3);
    } finally { t.close(); }
  });

  it('RECUSA nascer, bater e aposentar por conta própria depois da virada', async () => {
    const t = await setup();
    try {
      t.swarm.replicate([row()], DT);
      // Nascimento local: o caminho antigo (represália, invocação, QA) para de funcionar.
      expect(t.swarm.spawn('corn', { x: 5, y: 0, z: 5 })).toBe(false);
      expect(t.swarm.actors.filter(a => a.active)).toHaveLength(1);

      // Dano local: a barra não pode descer no atirador e ficar cheia no companheiro.
      const a = t.swarm.actors.find(x => x.serverId === 7)!;
      a.target.onHit?.({
        attackerId: 1, victimId: a.id, sourceId: 'dual_pistols', attackId: 'right',
        baseDamage: 9999, finalDamage: 9999, crit: false, procCoefficient: 1, procChainDepth: 0,
        damageTags: ['bullet'], hitPosition: { x: 0, y: 1, z: 0 }, hitNormal: { x: 0, y: 0, z: 1 },
        forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 2,
      });
      expect(a.health.current).toBe(75);
      expect(t.run.totalKills).toBe(0);

      // Orçamento: um cliente lento não pode sumir com um corpo que o outro continua vendo.
      t.swarm.benchmark = false;
      for (let i = 0; i < 300; i++) t.swarm.updateBudget(DT, 60);
      expect(t.swarm.actors.filter(x => x.active)).toHaveLength(1);
    } finally { t.close(); }
  });

  it('não move, não persegue e não ataca por si: fixedUpdate deixa de simular', async () => {
    const t = await setup();
    try {
      t.swarm.replicate([row({ z: 10 })], DT);
      const a = t.swarm.actors.find(x => x.serverId === 7)!;
      // Deixa a interpolação terminar no ponto do servidor.
      for (let i = 0; i < 10; i++) t.swarm.replicate([row({ z: 10 })], DT);
      const resting = a.root.position.z;
      // 5 segundos de `fixedUpdate` sem nenhuma linha nova: nada pode acontecer.
      for (let i = 0; i < 300; i++) t.swarm.fixedUpdate(DT);
      expect(a.root.position.z).toBe(resting);
      expect(a.state).toBe('chase');
      expect(t.player.hp).toBe(130);               // nenhum ataque foi decidido aqui
      expect(t.swarm.effects.projectiles.every(p => !p.active)).toBe(true);
    } finally { t.close(); }
  });

  it('interpola: o corpo é desenhado no PASSADO, sem teleportar para a última amostra crua', async () => {
    const t = await setup();
    try {
      t.swarm.replicate([row({ z: 10 })], DT);
      const a = t.swarm.actors.find(x => x.serverId === 7)!;
      for (let i = 0; i < 4; i++) t.swarm.replicate([row({ z: 10 })], DT);   // estabelece o intervalo
      const start = a.root.position.z;
      t.swarm.replicate([row({ z: 20 })], DT);                               // salto de 10 m
      // Um quadro depois de uma amostra nova, o corpo está no caminho — não no destino.
      expect(a.root.position.z).toBeGreaterThan(start);
      expect(a.root.position.z).toBeLessThan(20);
      for (let i = 0; i < 12; i++) t.swarm.replicate([row({ z: 20 })], DT);
      expect(a.root.position.z).toBeCloseTo(20, 3);                          // e chega, sem estourar
    } finally { t.close(); }
  });

  it('a morte é UMA transição: o cliente não a decide e não a repete', async () => {
    const t = await setup();
    try {
      t.swarm.replicate([row()], DT);
      const a = t.swarm.actors.find(x => x.serverId === 7)!;
      expect(t.swarm.kills).toBe(0);
      // O servidor declara a morte. É o único momento em que a cena de morte pode disparar.
      t.swarm.replicate([row({ hp: 0, alive: false, state: 'dead' })], DT);
      expect(a.state).toBe('dead');
      expect(t.swarm.kills).toBe(1);
      expect(a.body.isPickable).toBe(false);
      // Repetir a mesma linha não conta um segundo abate nem monta um segundo cadáver.
      for (let i = 0; i < 20; i++) t.swarm.replicate([row({ hp: 0, alive: false, state: 'dead' })], DT);
      expect(t.swarm.kills).toBe(1);
      // Recompensa, XP e ouro são do servidor: a apresentação não paga nada.
      expect(t.run.totalKills).toBe(0);
      expect(t.run.credits).toBe(0);
      // E quando o servidor tira o corpo de campo, ele sai.
      t.swarm.replicate([], DT);
      expect(a.active).toBe(false);
    } finally { t.close(); }
  });

  it('dois clientes com a MESMA lista chegam ao mesmo mundo, tenham feito o que fizerem antes', async () => {
    const one = await setup(), two = await setup();
    try {
      // O cliente "B" andou e disparou antes; o "A" ficou parado (o teste do observador, §18.11).
      two.player.position.x = 30; two.player.position.z = -25;
      const feed: ReplicatedEnemy[][] = [
        [row({ id: 11, z: 12 }), row({ id: 12, kind: 'corn', x: 6, z: 14, hp: 100, maxHP: 100, targetPlayerId: 1 })],
        [row({ id: 11, z: 13 }), row({ id: 12, kind: 'corn', x: 6, z: 15, hp: 60, maxHP: 100, targetPlayerId: 1 })],
        [row({ id: 11, z: 14, hp: 0, alive: false, state: 'dead' }), row({ id: 12, kind: 'corn', x: 6, z: 16, hp: 60, maxHP: 100, targetPlayerId: 1 })],
      ];
      for (const frame of feed) { one.swarm.replicate(frame, DT); two.swarm.replicate(frame, DT); }
      for (let i = 0; i < 30; i++) { one.swarm.replicate(feed[2]!, DT); two.swarm.replicate(feed[2]!, DT); }

      const describeWorld = (swarm: EnemySwarm) => swarm.actors.filter(a => a.active)
        .map(a => `${a.serverId}:${a.kind}:${a.health.current}/${a.health.maximum}:${a.state}:${a.targetPlayerId}:${a.root.position.z.toFixed(4)}`)
        .sort().join('|');
      expect(describeWorld(one.swarm)).toBe(describeWorld(two.swarm));
      expect(one.swarm.kills).toBe(two.swarm.kills);
      expect(one.swarm.kills).toBe(1);
    } finally { one.close(); two.close(); }
  });
});

describe('sem sala, nada muda', () => {
  it('a fazenda de um jogador continua decidindo tudo localmente', async () => {
    const t = await setup();
    try {
      expect(t.swarm.replicated).toBe(false);
      expect(t.swarm.spawn('eggplant', { x: 0, y: 0, z: 10 })).toBe(true);
      const a = t.swarm.actors[0]!;
      a.target.onHit?.({
        attackerId: 1, victimId: a.id, sourceId: 'dual_pistols', attackId: 'right',
        baseDamage: 9999, finalDamage: 9999, crit: false, procCoefficient: 1, procChainDepth: 0,
        damageTags: ['bullet'], hitPosition: { x: 0, y: 1, z: 0 }, hitNormal: { x: 0, y: 0, z: 1 },
        forceDirection: { x: 0, y: 0, z: 1 }, forceMagnitude: 2,
      });
      // Morte, abate e recompensa locais: exatamente o comportamento anterior ao bloco.
      expect(a.health.dead).toBe(true);
      expect(t.run.totalKills).toBe(1);
      expect(t.run.credits).toBeGreaterThan(0);
    } finally { t.close(); }
  });
});
