import {describe, it, expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {AssetContainer} from '@babylonjs/core/assetContainer';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3, Quaternion} from '@babylonjs/core/Maths/math.vector';
import {EventBus} from '../src/core/EventBus';
import type {DamageContext, GameEvents, Vec3} from '../src/core/contracts';
import {RunRNG} from '../src/core/RunRNG';
import {RunProgression} from '../src/run/RunProgression';
import {EnemySwarm} from '../src/game/EnemySwarm';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {ENEMIES, type EnemyKind} from '../src/run/MonsterDirector';
import {
  WEAK_POINTS, WEAK_POINT_MULTIPLIER, raySphereHit, resolveWeakPoint, weakPointDamageMultiplier, weakPointEligible,
} from '../src/combat/WeakPoints';
import type {TrainingTarget} from '../src/world/TrainingYard';

/**
 * Pontos fracos por espécie.
 *
 * As zonas saíram da medição do rig real (`.temp/rig-weak-probe.mjs` lê o `.glb` e registra, para
 * cada osso, a extensão dos vértices que ele domina). O que este arquivo prova é o CRITÉRIO: o
 * crítico direto só sai quando a linha da bala atravessa a esfera do osso, e não quando a bala
 * apenas encosta no bicho.
 *
 * LIMITE HONESTO: a integração roda com um rig de teste (uma caixa mais um nó com o nome do osso),
 * não com o GLB autoral — o `NullEngine` não carrega os 30 MB de cada praga. O que o rig de teste
 * reproduz é exatamente o que o jogo usa: um nó filho do avatar, com o nome do osso como sufixo,
 * movido pela hierarquia (escala do ator, pose e orientação radial inclusive).
 */

const KIND: EnemyKind = 'eggplant';
const BONE = 'Head';
const BASE_DAMAGE = 12;

async function setup() {
  const engine = new NullEngine(), scene = new Scene(engine), events = new EventBus<GameEvents>();
  const collision = new CollisionWorld();
  collision.surfaces.push({id: 'field', x: 0, z: 0, width: 400, depth: 400, height: 0});
  const player = new PlayerMotor(collision, events, {x: 0, y: 0, z: -30});
  player.debugInvincible = true;
  const run = new RunProgression(events);
  const world = {targets: [] as TrainingTarget[], collision};
  const light = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  const shadows = new ShadowGenerator(64, light);
  const swarm = new EnemySwarm(scene, world, events, shadows, player, run, new RunRNG('weak-points'));
  // Rig de teste: raiz + corpo + um nó com o NOME DO OSSO, exatamente como o GLB entrega.
  await swarm.load(async model => {
    const container = new AssetContainer(scene);
    const root = new TransformNode(model, scene);
    const body = CreateBox(`${model}-body`, {size: 1}, scene);
    body.parent = root;
    const bone = new TransformNode(BONE, scene);
    bone.parent = root; bone.position.set(0, 1.5, 0);
    container.transformNodes.push(root, bone);
    container.meshes.push(body);
    container.populateRootNodes();
    container.removeAllFromScene();
    return container;
  });
  swarm.initialize();
  swarm.benchmark = true; swarm.director.stopped = true;
  return {engine, scene, events, player, run, swarm, close: () => {swarm.dispose(); scene.dispose(); engine.dispose();}};
}

/** Põe um ator vivo na origem, fora do estado de nascimento, com a orientação pedida. */
function plant(swarm: EnemySwarm, rotation?: Quaternion) {
  expect(swarm.spawn(KIND, {x: 0, y: 0, z: 0}, 'normal')).toBe(true);
  const actor = swarm.actors[swarm.actors.length - 1]!;
  actor.state = 'chase'; actor.time = 1;
  actor.visual.position.set(0, 0, 0);
  if (rotation) actor.root.rotationQuaternion = rotation.clone();
  actor.root.computeWorldMatrix(true);
  return actor;
}

function bonePosition(actor: ReturnType<typeof plant>): Vector3 {
  const node = actor.visual.getChildTransformNodes().find(n => n.name.endsWith(BONE))!;
  node.computeWorldMatrix(true);
  return node.getAbsolutePosition().clone();
}

/** Um disparo REAL do jogador: `hitPosition` na entrada da caixa, `hitDirection` no raio do cano. */
function shot(victim: number, from: Vec3, direction: Vec3, tags: readonly string[] = ['bullet']): DamageContext {
  return {
    attackerId: 1, victimId: victim, sourceId: 'dual_pistols', attackId: 'right',
    baseDamage: BASE_DAMAGE, finalDamage: BASE_DAMAGE, crit: false,
    procCoefficient: 1, procChainDepth: 0, damageTags: tags,
    hitPosition: {...from}, hitNormal: {x: 0, y: 0, z: -1},
    forceDirection: {...direction}, hitDirection: {...direction}, forceMagnitude: 2,
  };
}

const lastLabel = (swarm: EnemySwarm) => swarm.labels[swarm.labels.length - 1]!;
/**
 * `Vector3` do Babylon guarda `_x/_y/_z` e expõe `x/y/z` pelo PROTÓTIPO: espalhar com `{...v}`
 * devolve um objeto sem `x`, e o teste passaria `NaN` para dentro do jogo sem reclamar.
 */
const plain = (v: Vector3): Vec3 => ({x: v.x, y: v.y, z: v.z});

describe('geometria pura do ponto fraco', () => {
  const centre = {x: 0, y: 2, z: 0};

  it('a linha da bala tem de ATRAVESSAR a esfera, não passar perto', () => {
    expect(raySphereHit({x: 0, y: 2, z: -5}, {x: 0, y: 0, z: 1}, centre, .3, 8)).toBe(true);
    // 0,4 m abaixo do centro, esfera de 0,3: passa perto e não conta.
    expect(raySphereHit({x: 0, y: 1.6, z: -5}, {x: 0, y: 0, z: 1}, centre, .3, 8)).toBe(false);
  });

  it('esfera ATRÁS do ponto de entrada não conta, e esfera fora do alcance também não', () => {
    // Olhando para −Z a partir de z = −5: a esfera em z = 0 ficou para trás.
    expect(raySphereHit({x: 0, y: 2, z: -5}, {x: 0, y: 0, z: -1}, centre, .3, 8)).toBe(false);
    expect(raySphereHit({x: 0, y: 2, z: -50}, {x: 0, y: 0, z: 1}, centre, .3, 8)).toBe(false);
  });

  it('origem DENTRO da esfera conta: a bala entrou pela própria zona', () => {
    expect(raySphereHit({x: 0, y: 2, z: -.1}, {x: 0, y: 0, z: 1}, centre, .3, 8)).toBe(true);
  });

  it('`resolveWeakPoint` devolve o índice da primeira esfera atravessada', () => {
    const spheres = [{centre: {x: 5, y: 2, z: 0}, radius: .3}, {centre, radius: .3}];
    expect(resolveWeakPoint({x: 0, y: 2, z: -5}, {x: 0, y: 0, z: 1}, spheres)).toBe(1);
    expect(resolveWeakPoint({x: 0, y: 0, z: -5}, {x: 0, y: 0, z: 1}, spheres)).toBe(-1);
  });

  it('o multiplicador do acerto direto NÃO empilha com o crítico de sorte', () => {
    expect(weakPointDamageMultiplier(true, false)).toBe(WEAK_POINT_MULTIPLIER);
    expect(weakPointDamageMultiplier(true, true)).toBe(WEAK_POINT_MULTIPLIER);
    expect(weakPointDamageMultiplier(false, true)).toBe(2);
    expect(weakPointDamageMultiplier(false, false)).toBe(1);
  });

  it('só projétil do jogador, na raiz da cadeia, disputa ponto fraco', () => {
    expect(weakPointEligible(1, 0, ['bullet'])).toBe(true);
    expect(weakPointEligible(1, 0, ['melee'])).toBe(false);                 // soco não tem linha de tiro
    expect(weakPointEligible(1, 1, ['bullet'])).toBe(false);                // explosão/queimadura derivada
    expect(weakPointEligible(7, 0, ['bullet'])).toBe(false);                // dano de inimigo
  });

  it('cada espécie da fazenda tem zona declarada e o tomate é pelas ASAS', () => {
    /**
     * As seis espécies trazidas pelos discos voadores estão de fora, explicitamente.
     *
     * Cada zona acima nasceu de uma MEDIÇÃO do rig daquele modelo: qual osso domina quantos
     * vértices, onde a silhueta se destaca, onde a asa deixa de encostar no tronco. Os alienígenas
     * são rigs de terceiros com 250 a 744 ossos e convenções de nome incompatíveis (`DEF-HEAD_08`,
     * `MCH-WGT-hips`), então declarar `bones: ['Head']` para eles seria chute — casaria com nada,
     * ou com um osso de mecanismo cuja posição não descreve o corpo.
     *
     * A lista é escrita à mão, e não derivada de `SAUCER_SPECIES`, porque o valor dela está em
     * doer: uma espécie nova da fazenda continua obrigada a ter zona, e dar ponto fraco aos
     * alienígenas é trabalho de medição pendente, com render na mão.
     */
    const SEM_ZONA_MEDIDA:readonly EnemyKind[]=['grey','invader','demon','predator','strutter','hound'];
    for (const kind of Object.keys(ENEMIES) as EnemyKind[]) {
      if (SEM_ZONA_MEDIDA.includes(kind)) {
        expect(WEAK_POINTS[kind], `${kind} não pode ter zona chutada`).toBeUndefined();
        continue;
      }
      expect(WEAK_POINTS[kind], kind).toBeDefined();
      expect(WEAK_POINTS[kind]!.bones.length, kind).toBeGreaterThan(0);
      expect(WEAK_POINTS[kind]!.radius, kind).toBeGreaterThan(0);
    }
    expect(WEAK_POINTS.tomato!.label).toBe('asas');
    // Os ossos de RAIZ da asa (042/045) ficam de fora: eles encostam no tronco.
    expect(WEAK_POINTS.tomato!.bones).toEqual(['Bone_041', 'Bone_040', 'Bone_044', 'Bone_043']);
    // A Praga Alfa reaproveita o rig da melancia, então usa a mesma coroa.
    expect(WEAK_POINTS.boss!.bones).toEqual(WEAK_POINTS.watermelon!.bones);
  });
});

describe('ponto fraco no combate real da horda', () => {
  it('acerto direto no osso vira crítico; o mesmo tiro um pouco abaixo, não', async () => {
    const t = await setup();
    try {
      const actor = plant(t.swarm), head = bonePosition(actor);
      expect(head.y).toBeCloseTo(1.5 * ENEMIES[KIND].scale, 5);

      actor.target.onHit!(shot(actor.id, {x: head.x, y: head.y, z: head.z - 2}, {x: 0, y: 0, z: 1}));
      expect(lastLabel(t.swarm).weak).toBe(true);
      expect(lastLabel(t.swarm).crit).toBe(true);
      expect(lastLabel(t.swarm).amount).toBe(Math.round(BASE_DAMAGE * WEAK_POINT_MULTIPLIER));
      expect(t.swarm.weakHits).toBe(1);
      expect(t.swarm.lastWeakPoint).toBe(WEAK_POINTS[KIND]!.label);

      // Mesma direção, 0,9 m abaixo do centro da cabeça: corpo, não cabeça.
      actor.target.onHit!(shot(actor.id, {x: head.x, y: head.y - .9, z: head.z - 2}, {x: 0, y: 0, z: 1}));
      expect(lastLabel(t.swarm).weak).toBe(false);
      expect(t.swarm.weakHits).toBe(1);
    } finally {t.close();}
  });

  it('o acerto direto continua valendo com o corpo em QUALQUER orientação radial', async () => {
    const t = await setup();
    try {
      // Quatro verticais locais diferentes — equador, polo sul e dois quadrantes da casca.
      const orientations: {label: string; rotation: Quaternion}[] = [
        {label: 'polo norte', rotation: Quaternion.Identity()},
        {label: 'equador +X', rotation: Quaternion.RotationAxis(new Vector3(0, 0, 1), -Math.PI / 2)},
        {label: 'polo sul', rotation: Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.PI)},
        {label: 'diagonal', rotation: Quaternion.RotationAxis(new Vector3(1, 0, 1).normalize(), Math.PI / 3)},
      ];
      for (const {label, rotation} of orientations) {
        const actor = plant(t.swarm, rotation), head = bonePosition(actor);
        const up = head.subtract(actor.root.position).normalize();
        // Direção de tiro perpendicular à vertical LOCAL do corpo, como um jogador de pé ao lado.
        const aim = Vector3.Cross(up, new Vector3(0, 0, 1)).length() > .1
          ? Vector3.Cross(up, new Vector3(0, 0, 1)).normalize()
          : Vector3.Cross(up, new Vector3(1, 0, 0)).normalize();
        const before = t.swarm.weakHits;
        const origin = head.subtract(aim.scale(3));
        actor.target.onHit!(shot(actor.id, plain(origin), plain(aim)));
        expect(t.swarm.weakHits, `${label} · acerto na zona`).toBe(before + 1);

        // Mesmo raio deslocado 0,9 m ao longo da vertical local: erra a zona.
        const missOrigin = origin.subtract(up.scale(.9));
        actor.target.onHit!(shot(actor.id, plain(missOrigin), plain(aim)));
        expect(t.swarm.weakHits, `${label} · tiro no corpo`).toBe(before + 1);

        actor.health.apply({...shot(actor.id, plain(origin), plain(aim)), finalDamage: 10_000});
        for (let i = 0; i < 480; i++) t.swarm.fixedUpdate(1 / 60);
      }
    } finally {t.close();}
  });

  it('não dá crítico por aproximação: soco, dano derivado e dano de inimigo ficam de fora', async () => {
    const t = await setup();
    try {
      const actor = plant(t.swarm), head = bonePosition(actor);
      const origin = {x: head.x, y: head.y, z: head.z - 2}, aim = {x: 0, y: 0, z: 1};

      actor.target.onHit!(shot(actor.id, origin, aim, ['melee']));
      expect(lastLabel(t.swarm).weak).toBe(false);

      actor.target.onHit!({...shot(actor.id, origin, aim), procChainDepth: 1, sourceProcId: 'bomb'});
      expect(lastLabel(t.swarm).weak).toBe(false);

      actor.target.onHit!({...shot(actor.id, origin, aim), attackerId: 42});
      expect(lastLabel(t.swarm).weak).toBe(false);
      expect(t.swarm.weakHits).toBe(0);
    } finally {t.close();}
  });

  it('crítico alto não multiplica o acerto direto: o dano é ×2,4, nunca ×4,8', async () => {
    const t = await setup();
    try {
      // Crítico praticamente garantido (retornos decrescentes impedem exatamente 100%).
      for (let i = 0; i < 40; i++) t.run.addItem('goggles');
      expect(t.run.stats.crit).toBeGreaterThan(.7);
      const actor = plant(t.swarm), head = bonePosition(actor);
      const direct = Math.round(BASE_DAMAGE * t.run.stats.damage * WEAK_POINT_MULTIPLIER);
      for (let i = 0; i < 40; i++) {
        actor.health.current = actor.health.maximum;
        actor.target.onHit!(shot(actor.id, {x: head.x, y: head.y, z: head.z - 2}, {x: 0, y: 0, z: 1}));
        expect(lastLabel(t.swarm).weak).toBe(true);
        expect(lastLabel(t.swarm).amount).toBe(direct);
      }
    } finally {t.close();}
  });

  it('espécie sem nó do osso no rig simplesmente não tem zona — e nada quebra', async () => {
    const t = await setup();
    try {
      // `carrot` procura `RightHand`, que o rig de teste não tem.
      expect(t.swarm.spawn('carrot', {x: 4, y: 0, z: 0}, 'normal')).toBe(true);
      const actor = t.swarm.actors[t.swarm.actors.length - 1]!;
      actor.state = 'chase'; actor.visual.position.set(0, 0, 0); actor.root.computeWorldMatrix(true);
      actor.target.onHit!(shot(actor.id, {x: 4, y: 1, z: -2}, {x: 0, y: 0, z: 1}));
      expect(lastLabel(t.swarm).weak).toBe(false);
      expect(t.swarm.weakHits).toBe(0);
    } finally {t.close();}
  });
});
