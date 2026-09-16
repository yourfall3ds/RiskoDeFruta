import {describe, it, expect, vi, beforeEach} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import {CreateSphere} from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import {EventBus} from '../src/core/EventBus';
import {RunRNG} from '../src/core/RunRNG';
import type {DamageContext, GameEvents} from '../src/core/contracts';
import {DualPistols, type CombatCamera, type CombatWorld} from '../src/combat/DualPistols';
import {MPCharge} from '../src/combat/MPCharge';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetDestructionLedger, type DestructionHit, type DestructionOutcome, type DestructionPort} from '../src/planet-game/PlanetDestruction';
import {PISTOL_TUNING} from '../src/player/PlayerTuning';
import type {CharacterVisual} from '../src/animation/CharacterVisual';
import type {TrainingTarget} from '../src/world/TrainingYard';
import type {WeaponAudio} from '../src/audio/WeaponAudio';

/**
 * As pistolas AUTORAIS contra os destrutíveis do planeta.
 *
 * Nada aqui é encenado com dublê de colisão: a geometria passa pela `PlanetCollision` de verdade
 * (mesma BVH, mesma máscara de triângulo) e a contabilidade pela `PlanetDestructionLedger` de
 * verdade. O que os testes provam é o contrato do lado do TIRO — quem leva dano, quem NÃO leva, e
 * que cenário nenhum paga MP.
 */

// --------------------------------------------------------------------------------------------
// Mundo de teste: uma parede de terreno em z=6 e um prop logo atrás, em z=12.
// --------------------------------------------------------------------------------------------

/** Um quad vertical perpendicular a Z, virado para o jogador. Dois triângulos. */
function quad(z: number, half = 4, top = 4): {positions: number[]; indices: number[]} {
  return {
    positions: [-half, 0, z, half, 0, z, half, top, z, -half, top, z],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

/** Terreno (triângulos 0-1) e prop (triângulos 2-3) na mesma malha, como no planeta real. */
function field(): PlanetCollision {
  const wall = quad(6), prop = quad(12);
  const positions = [...wall.positions, ...prop.positions];
  const indices = [...wall.indices, ...prop.indices.map(i => i + 4)];
  const collision = new PlanetCollision();
  collision.setGeometry(positions, indices);
  return collision;
}

const TERRAIN = {start: 0, count: 2}, PROP = {start: 2, count: 2};

/**
 * Fachada de destruição sobre a `PlanetDestructionLedger` real.
 *
 * Só assume os triângulos do PROP. O terreno (0-1) devolve `undefined`, que é exatamente o que a
 * fachada real faz com um triângulo que não pertence a nenhum corpo do manifesto.
 */
class PropField implements DestructionPort {
  readonly ledger: PlanetDestructionLedger;
  /** Acertos que eram DESTE prop. */
  readonly seen: DestructionHit[] = [];
  /** TODO acerto de cenário oferecido, prop ou terreno — é a janela para o que o `worldPick` viu. */
  readonly offers: DestructionHit[] = [];
  private health: number;
  private readonly port;
  constructor(collision: PlanetCollision, private readonly hp = 40) {
    this.ledger = new PlanetDestructionLedger(collision);
    this.port = this.ledger.collisionPort();
    this.health = hp;
  }
  get broken(): boolean {return this.health <= 0;}
  hit(hit: DestructionHit): DestructionOutcome | undefined {
    this.offers.push(hit);
    const t = hit.triangle;
    if (t === undefined || t < PROP.start || t >= PROP.start + PROP.count) return undefined;
    this.seen.push(hit);
    const wasBroken = this.health <= 0;
    this.health = Math.max(0, this.health - hit.damage);
    const broke = !wasBroken && this.health <= 0;
    const removedTriangles = broke ? this.port.disableTriangles(PROP.start, PROP.count) : 0;
    return this.ledger.record({
      id: 'caixote-de-teste', kind: 'crate', broke, stage: broke ? 3 : 1,
      fraction: 1 - this.health / this.hp, felled: [], removedTriangles,
    });
  }
  update(): void {}
  reset(): void {this.ledger.restore(); this.health = this.hp;}
}

// --------------------------------------------------------------------------------------------
// Bancada
// --------------------------------------------------------------------------------------------

interface RigOptions {
  /** Liga o backend radial (`spherical`). Ausente ⇒ mundo plano de hoje, sem colisão. */
  collision?: PlanetCollision;
  /** Alvos vivos. */
  targets?: TrainingTarget[];
  destruction?: DestructionPort;
}

function rig(options: RigOptions = {}) {
  const engine = new NullEngine(), scene = new Scene(engine), events = new EventBus<GameEvents>();
  const eye = new FreeCamera('destruction-camera', new Vector3(0, 1.7, -3), scene);
  const visual = {ready: true, position: Vector3.Zero(), hands: [], grips: [], fire: vi.fn(), release: vi.fn(), stormAim: vi.fn()} as unknown as CharacterVisual;
  const camera: CombatCamera = {forward: new Vector3(0, 0, 1), camera: eye, impulse: vi.fn()};
  const audio = {shot: vi.fn(), reload: vi.fn(), skillImpact: vi.fn()} as unknown as WeaponAudio;
  // Só a porta radial: é EXATAMENTE o que o `CollisionWorld.configurePlanet` publica — `spherical`
  // ligado e `planet.collision`, sem `geometry` nenhuma. Era esta a combinação que a guarda antiga
  // mandava calada para o picking de cena.
  const world: CombatWorld | undefined = options.collision && {
    spherical: true,
    planet: {collision: options.collision},
    raycast: () => undefined,
  };
  const targets = options.targets ?? [];
  const weapons = new DualPistols(scene, camera, visual, {targets, ...(world ? {collision: world} : {})},
    new RunRNG('destruction').stream('run'), events, audio);
  if (options.destruction) weapons.destruction = options.destruction;
  weapons.updatePose(0);
  const damage: DamageContext[] = [];
  events.on('DamageDealt', context => damage.push(context));
  return {weapons, scene, events, damage, targets,
    dispose: () => {weapons.dispose(); scene.dispose(); engine.dispose();}};
}

/** Um inimigo real (malha Babylon com bounding box viva), como o `TrainingYard` entrega. */
function enemy(scene: Scene, id: number, z: number): TrainingTarget {
  const mesh = CreateSphere(`enemy-${id}`, {diameter: 1.6, segments: 8}, scene);
  mesh.position.set(0, 1.7, z); mesh.computeWorldMatrix(true);
  return {id, mesh, hits: 0};
}

const step = (weapons: DualPistols, frames: number, fire = false) => {
  for (let i = 0; i < frames; i++) {weapons.fixedUpdate(1 / 60, fire); weapons.updatePose(1 / 60);}
};

let collision: PlanetCollision;
beforeEach(() => {collision = field();});

// --------------------------------------------------------------------------------------------

describe('detecção do backend radial no worldPick', () => {
  it('um mundo esférico SEM geometry ainda é sólido para bala — era aqui que a bala vazava', () => {
    const props = new PropField(collision);
    const r = rig({collision, destruction: props});
    try {
      // Isca: uma malha de cena a z=9, ATRÁS do terreno de colisão (z=6) e invisível para a
      // `PlanetCollision`. Só o `scene.pickWithRay` a enxerga. Se a guarda antiga (`geometry`)
      // ainda decidisse, seria ELA a responder e o nome dela apareceria em `lastImpact`.
      const decoy = CreateSphere('isca-so-de-cena', {diameter: 6, segments: 8}, r.scene);
      decoy.position.set(0, 1.7, 9); decoy.computeWorldMatrix(true);
      step(r.weapons, 12, true);
      expect(r.weapons.lastImpact).toBe('céu');        // a isca NÃO respondeu: o backend radial venceu
      expect(props.offers.length).toBeGreaterThan(0);
      const first = props.offers[0]!;
      expect(first.point.z).toBeCloseTo(6, 4);         // parou no terreno de colisão, a 6 m
      expect(first.triangle).toBeLessThan(PROP.start); // com índice de triângulo REAL do planeta
      expect(props.seen).toHaveLength(0);              // terreno não é prop: nada foi quebrado
    } finally {r.dispose();}
  });

  it('sem backend radial o caminho plano continua idêntico (picking de cena)', () => {
    const props = new PropField(collision);
    const r = rig({destruction: props});               // sem `collision`: mundo plano
    try {
      step(r.weapons, 12, true);
      expect(r.weapons.lastImpact).toBe('céu');
      expect(props.seen).toHaveLength(0);
      expect(r.weapons.sceneryHits).toBe(0);
    } finally {r.dispose();}
  });
});

describe('os quatro emissores danificam o cenário certo', () => {
  /** Abre caminho até o prop removendo o terreno, como um buraco já aberto na parede. */
  const openPath = () => collision.disableTriangles(TERRAIN.start, TERRAIN.count);

  it('tiro básico entrega o dano da arma e o índice do triângulo do prop', () => {
    openPath();
    const props = new PropField(collision);
    const r = rig({collision, destruction: props});
    try {
      step(r.weapons, 12, true);
      expect(props.seen.length).toBeGreaterThan(0);
      const first = props.seen[0]!;
      expect(first.damage).toBe(PISTOL_TUNING.damage);           // dano original da pistola
      expect(first.triangle).toBeGreaterThanOrEqual(PROP.start); // resolvido por intervalo, sem busca
      expect(first.point.z).toBeCloseTo(12, 5);
      expect(r.weapons.sceneryHits).toBe(props.seen.length);
    } finally {r.dispose();}
  });

  it.each([
    {tier: 1 as const, id: 'leque (MP I)', damage: 18, frames: 60},
    {tier: 2 as const, id: 'fuzilaria (MP II)', damage: 24, frames: 60},
    {tier: 3 as const, id: 'tempestade (MP III)', damage: 18, frames: 60},
  ])('$id entrega dano $damage ao prop', ({tier, damage, frames}) => {
    openPath();
    const props = new PropField(collision, 10_000);   // não quebra: mede o dano de cada acerto
    const r = rig({collision, destruction: props});
    try {
      r.weapons.releaseSkill(tier);
      step(r.weapons, frames);
      expect(props.seen.length).toBeGreaterThan(0);
      for (const hit of props.seen) {
        expect(hit.damage).toBe(damage);
        expect(hit.triangle).toBeGreaterThanOrEqual(PROP.start);
      }
    } finally {r.dispose();}
  });

  it('o prop quebra, sai da colisão de verdade e a bala seguinte passa por onde ele estava', () => {
    openPath();
    const props = new PropField(collision, 24);        // dois tiros básicos de 12
    const r = rig({collision, destruction: props});
    try {
      step(r.weapons, 40, true);
      expect(props.broken).toBe(true);
      expect(props.ledger.breaks).toBe(1);
      expect(props.ledger.removedTriangles).toBe(PROP.count);   // o ledger só conta o que ELE tirou
      expect(props.ledger.defects).toEqual([]);        // quebrou na tela E saiu da colisão
      // O buraco aberto por `openPath` (terreno) mais o prop que acabou de quebrar.
      expect(collision.disabledCount).toBe(TERRAIN.count + PROP.count);
      // O mundo ficou vazio nessa direção: nada mais responde ao raio.
      expect(collision.raycast({x: 0, y: 1.35, z: 0}, {x: 0, y: 0, z: 1}, 60)).toBeUndefined();
    } finally {r.dispose();}
  });
});

describe('o obstáculo mais próximo vence — nada é destruído atrás de cobertura', () => {
  it('terreno na frente do prop: o prop nunca recebe um acerto sequer', () => {
    const props = new PropField(collision);
    const r = rig({collision, destruction: props});
    try {
      step(r.weapons, 40, true);                       // vários tiros básicos contra a parede
      r.weapons.releaseSkill(2); step(r.weapons, 60);   // e a fuzilaria inteira
      expect(props.seen).toHaveLength(0);
      expect(r.weapons.sceneryHits).toBe(0);
      expect(collision.disabledCount).toBe(0);         // o prop continua inteiro na colisão
    } finally {r.dispose();}
  });

  it('inimigo na frente do prop consome o tiro: dano vai para ele, não para o cenário', () => {
    collision.disableTriangles(TERRAIN.start, TERRAIN.count);
    const props = new PropField(collision);
    const engineRig = rig({collision, destruction: props});
    try {
      const target = enemy(engineRig.scene, 10, 8);    // entre o cano (z≈0) e o prop (z=12)
      engineRig.targets.push(target);
      step(engineRig.weapons, 40, true);
      expect(target.hits).toBeGreaterThan(0);          // o inimigo levou
      expect(props.seen).toHaveLength(0);              // o prop atrás dele, não
      expect(engineRig.weapons.sceneryHits).toBe(0);
    } finally {engineRig.dispose();}
  });

  it('o leque do MP I também respeita o inimigo como cobertura do prop', () => {
    collision.disableTriangles(TERRAIN.start, TERRAIN.count);
    const props = new PropField(collision);
    const r = rig({collision, destruction: props});
    try {
      const target = enemy(r.scene, 11, 8);
      target.mesh.scaling.setAll(6); target.mesh.computeWorldMatrix(true);  // tapa a frente inteira
      r.targets.push(target);
      r.weapons.releaseSkill(1);
      step(r.weapons, 60);
      expect(target.hits).toBeGreaterThan(0);
      for (const hit of props.seen) expect(hit.point.z).toBeGreaterThan(8);  // nunca através do corpo
    } finally {r.dispose();}
  });
});

describe('cenário NUNCA paga MP nem conta como acerto', () => {
  it('quebrar props não move a barra, não emite dano e não incrementa `hits`', () => {
    collision.disableTriangles(TERRAIN.start, TERRAIN.count);
    const props = new PropField(collision, 10_000);
    const r = rig({collision, destruction: props});
    const mp = new MPCharge(r.events);
    mp.current = 0;
    const enemyHits: DamageContext[] = [];
    r.events.on('EnemyHit', context => enemyHits.push(context));
    try {
      step(r.weapons, 40, true);
      r.weapons.releaseSkill(1); step(r.weapons, 60);
      r.weapons.releaseSkill(2); step(r.weapons, 60);
      r.weapons.releaseSkill(3); step(r.weapons, 181);
      expect(props.seen.length).toBeGreaterThan(0);        // houve MUITO acerto em cenário…
      expect(r.weapons.sceneryHits).toBe(props.seen.length);
      expect(mp.current).toBe(0);                          // …e a barra não subiu um ponto
      expect(enemyHits).toHaveLength(0);
      expect(r.damage).toHaveLength(0);                    // nenhum `DamageDealt` de prop
      expect(r.weapons.hits).toBe(0);                      // `hits` continua contando inimigo
    } finally {r.dispose();}
  });

  it('o mesmo tiro que ignora o prop ainda premia o inimigo com o dano original', () => {
    collision.disableTriangles(TERRAIN.start, TERRAIN.count);
    const props = new PropField(collision, 10_000);
    const r = rig({collision, destruction: props});
    try {
      const target = enemy(r.scene, 12, 8);
      r.targets.push(target);
      step(r.weapons, 40, true);
      expect(r.damage.length).toBeGreaterThan(0);
      for (const context of r.damage) {
        expect(context.victimId).toBe(12);
        expect(context.sourceId).toBe('dual_pistols');
        expect(context.baseDamage).toBe(PISTOL_TUNING.damage);
        expect(context.finalDamage).toBe(PISTOL_TUNING.damage);
        expect(context.procCoefficient).toBe(1);
        expect(context.damageTags).toEqual(['bullet']);
      }
      expect(r.weapons.hits).toBe(r.damage.length);
      expect(props.seen).toHaveLength(0);
    } finally {r.dispose();}
  });

  it('o ricochete mantém o `procCoefficient` 0,3 e a cadência dos dez tiros com destruição ligada', () => {
    collision.disableTriangles(TERRAIN.start, TERRAIN.count);
    const props = new PropField(collision, 10_000);
    const r = rig({collision, destruction: props});
    try {
      const target = enemy(r.scene, 13, 8);
      target.mesh.scaling.setAll(4); target.mesh.computeWorldMatrix(true);
      r.targets.push(target);
      r.weapons.releaseSkill(1);
      step(r.weapons, 60);
      expect(r.weapons.skillShots).toBe(10);               // os dez tiros do leque, intactos
      const fan = r.damage.filter(c => c.sourceId === 'ricochet_fan');
      expect(fan.length).toBeGreaterThan(0);
      for (const context of fan) {
        expect(context.procCoefficient).toBe(.3);
        expect(context.baseDamage).toBe(18);
        expect(context.damageTags).toEqual(['bullet', 'skill']);
      }
    } finally {r.dispose();}
  });
});

describe('o padrão sem fachada preserva o jogo plano', () => {
  it('sem destruição instalada o acerto de cenário sai como marca de bala, e nada é contado', () => {
    collision.disableTriangles(TERRAIN.start, TERRAIN.count);
    const r = rig({collision});                            // `destruction` fica em NO_DESTRUCTION
    try {
      const before = r.weapons.effects.pool.stats.misses;
      step(r.weapons, 40, true);
      r.weapons.releaseSkill(2); step(r.weapons, 60);
      expect(r.weapons.sceneryHits).toBe(0);
      expect(r.weapons.effects.pool.stats.misses).toBe(before);  // o retorno visual saiu de verdade
    } finally {r.dispose();}
  });

  it('`resetAttempt` zera a conta de cenário sem tocar na fachada da cena', () => {
    collision.disableTriangles(TERRAIN.start, TERRAIN.count);
    const props = new PropField(collision, 10_000);
    const r = rig({collision, destruction: props});
    try {
      step(r.weapons, 40, true);
      expect(r.weapons.sceneryHits).toBeGreaterThan(0);
      r.weapons.resetAttempt();
      expect(r.weapons.sceneryHits).toBe(0);
      expect(props.ledger.hits).toBeGreaterThan(0);        // o ledger é da CENA, não da arma
    } finally {r.dispose();}
  });
});
