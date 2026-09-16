import {describe,it,expect,vi} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import {EventBus} from '../src/core/EventBus';
import {RunRNG} from '../src/core/RunRNG';
import type {GameEvents} from '../src/core/contracts';
import {RicochetFan,rotateAboutAxis,stablePerpendicular} from '../src/combat/RicochetFan';
import {DualPistols,WORLD_SPACE,type CombatBasis,type CombatCamera,type CombatSpace} from '../src/combat/DualPistols';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import type {CharacterVisual} from '../src/animation/CharacterVisual';
import type {TrainingTarget} from '../src/world/TrainingYard';
import type {WeaponAudio} from '../src/audio/WeaponAudio';

/**
 * O combate AUTORAL num mapa esférico.
 *
 * Estes testes não checam uma arma nova — checam que a arma de sempre parou de presumir que "para
 * cima" é `+Y` do mundo, e que quem não pede nada continua com números idênticos aos do jogo plano.
 */

const planet = new PlanetFrame();
/** Os seis polos do contrato R=200: ±X, ±Y, ±Z. */
const POLES: {name: string; direction: Vector3}[] = [
  {name: '+Y (polo norte — o único caso que o código plano acertava)', direction: new Vector3(0, 1, 0)},
  {name: '-Y (de cabeça para baixo)', direction: new Vector3(0, -1, 0)},
  {name: '+X (equador leste)', direction: new Vector3(1, 0, 0)},
  {name: '-X (equador oeste)', direction: new Vector3(-1, 0, 0)},
  {name: '+Z (equador frente)', direction: new Vector3(0, 0, 1)},
  {name: '-Z (equador atrás)', direction: new Vector3(0, 0, -1)},
];

const vec = (v: {x: number; y: number; z: number}): Vector3 => new Vector3(v.x, v.y, v.z);
/** Ponto da superfície nominal no polo dado. */
const surface = (direction: Vector3): Vector3 => vec(planet.fromDirection({x: direction.x, y: direction.y, z: direction.z}));
/** Uma frente tangente estável naquele ponto. */
const tangentForward = (point: Vector3): Vector3 =>
  vec(planet.basisAt({x: point.x, y: point.y, z: point.z}, {x: 0.3, y: 0.71, z: 0.64}).forward);

/**
 * O adaptador que a cena do planeta vai escrever, aqui na sua forma mínima: `visual.position` é
 * LOCAL sob o pai radial, então `toWorld` soma a origem desse pai.
 */
class RadialSpace implements CombatSpace {
  constructor(private readonly origin: Vector3) {}
  upAt(point: Vector3, result = new Vector3()): Vector3 {
    const u = planet.up({x: point.x, y: point.y, z: point.z});
    return result.copyFromFloats(u.x, u.y, u.z);
  }
  frameAt(point: Vector3, forwardHint: Vector3, result: CombatBasis = {up: new Vector3(), right: new Vector3(), forward: new Vector3()}): CombatBasis {
    const b = planet.basisAt({x: point.x, y: point.y, z: point.z}, {x: forwardHint.x, y: forwardHint.y, z: forwardHint.z});
    result.up.copyFromFloats(b.up.x, b.up.y, b.up.z);
    result.right.copyFromFloats(b.right.x, b.right.y, b.right.z);
    result.forward.copyFromFloats(b.forward.x, b.forward.y, b.forward.z);
    return result;
  }
  toWorld(local: Vector3, result = new Vector3()): Vector3 {return result.copyFrom(local).addInPlace(this.origin);}
}

describe('WORLD_SPACE é a identidade do jogo plano', () => {
  it('responde +Y em qualquer ponto, a base do mundo e a posição sem conversão', () => {
    for (const point of [Vector3.Zero(), new Vector3(913, -47, 208), new Vector3(0, 200, 0)]) {
      expect(WORLD_SPACE.upAt(point).asArray()).toEqual([0, 1, 0]);
      const frame = WORLD_SPACE.frameAt(point, new Vector3(0.4, 0.2, -0.9));
      expect(frame.up.asArray()).toEqual([0, 1, 0]);
      expect(frame.right.asArray()).toEqual([1, 0, 0]);
      expect(frame.forward.asArray()).toEqual([0, 0, 1]);
      // A base padrão IGNORA a mira de propósito: os offsets autorais do coldre e do carregador
      // sempre foram escritos em eixos de MUNDO, não em eixos do corpo.
      expect(WORLD_SPACE.toWorld(point).asArray()).toEqual(point.asArray());
    }
  });
  it('a base padrão é ortonormal e de mão-esquerda, igual à do PlanetFrame (right = up × forward)', () => {
    const {up, right, forward} = WORLD_SPACE.frameAt(Vector3.Zero(), Vector3.Forward());
    expect(Vector3.Cross(up, forward).asArray()).toEqual(right.asArray());
  });
});

describe('helpers espaciais preservam a aritmética antiga', () => {
  it('stablePerpendicular(+Y) devolve exatamente o literal (1,0,0) do fallback antigo', () => {
    expect(stablePerpendicular(new Vector3(0, 1, 0)).asArray()).toEqual([1, 0, 0]);
  });
  it('e devolve um eixo unitário perpendicular em cada um dos seis polos', () => {
    for (const {name, direction} of POLES) {
      const perpendicular = stablePerpendicular(direction);
      expect(perpendicular.length(), name).toBeCloseTo(1, 12);
      expect(Vector3.Dot(perpendicular, direction), name).toBeCloseTo(0, 12);
    }
  });
  it('rotateAboutAxis em torno de +Y reproduz termo a termo a guinada literal do MP II', () => {
    const source = new Vector3(0.3, -0.42, 0.85).normalize();
    for (let i = 0; i < 14; i++) {
      const angle = (i / 13 - 0.5) * 0.75;                    // a mesma abertura da fuzilaria
      const legacy = source.clone();                          // fórmula ORIGINAL, copiada daqui:
      legacy.x = source.x * Math.cos(angle) + source.z * Math.sin(angle);
      legacy.z = source.z * Math.cos(angle) - source.x * Math.sin(angle);
      const rotated = rotateAboutAxis(source, new Vector3(0, 1, 0), angle);
      expect(rotated.x).toBeCloseTo(legacy.x, 15);
      expect(rotated.y).toBeCloseTo(legacy.y, 15);             // a componente vertical fica intacta
      expect(rotated.z).toBeCloseTo(legacy.z, 15);
    }
  });
  it('e num polo qualquer preserva comprimento, tangência e o ângulo pedido', () => {
    for (const {name, direction} of POLES) {
      const point = surface(direction), up = vec(planet.up({x: point.x, y: point.y, z: point.z}));
      const forward = tangentForward(point);
      const rotated = rotateAboutAxis(forward, up, 0.375);
      expect(rotated.length(), name).toBeCloseTo(1, 12);
      expect(Vector3.Dot(rotated, up), name).toBeCloseTo(0, 12);
      expect(Math.acos(Vector3.Dot(rotated, forward)), name).toBeCloseTo(0.375, 12);
    }
  });
});

describe('leque do MP I abre no plano tangente', () => {
  const fan = () => new RicochetFan(() => undefined, () => {}, () => {});

  it('sem `up` o resultado é bit a bit o de antes (padrão preservado)', () => {
    const implicit = fan(), explicit = fan();
    for (let i = 0; i < 10; i++) {
      const a = implicit.launch(new Vector3(0, 1.3, 0), new Vector3(0.2, -0.1, 0.9), i, 10);
      const b = explicit.launch(new Vector3(0, 1.3, 0), new Vector3(0.2, -0.1, 0.9), i, 10, new Vector3(0, 1, 0));
      expect(a.asArray()).toEqual(b.asArray());
    }
  });

  it('num polo qualquer o leque sai tangente e mantém a abertura de 0,95 rad', () => {
    for (const {name, direction} of POLES) {
      const point = surface(direction), up = vec(planet.up({x: point.x, y: point.y, z: point.z}));
      const forward = tangentForward(point), f = fan();
      const directions = Array.from({length: 10}, (_, i) => f.launch(point, forward, i, 10, up));
      for (const d of directions) {
        expect(Vector3.Dot(d, up), name).toBeCloseTo(0, 12);   // nenhum tiro sobe nem afunda
        expect(d.length(), name).toBeCloseTo(1, 12);
      }
      const first = directions[0]!, last = directions[9]!;
      expect(Math.acos(Math.min(1, Vector3.Dot(first, last))), name).toBeCloseTo(0.95, 10);
    }
  });

  it('e a curva em voo também fica no plano tangente: o eixo do giro É a vertical local', () => {
    for (const {name, direction} of POLES) {
      const point = surface(direction), up = vec(planet.up({x: point.x, y: point.y, z: point.z}));
      const f = fan();
      f.launch(point, tangentForward(point), 0, 10, up);
      const bullet = f.bullets[0]!;
      expect(Math.abs(Vector3.Dot(bullet.axis, up)), name).toBeCloseTo(1, 10);
      for (let i = 0; i < 20; i++) f.update(1 / 60);
      expect(Vector3.Dot(bullet.direction, up), name).toBeCloseTo(0, 9);
      // E o corpo da bala não deixa a casca esférica pelo eixo vertical.
      expect(Vector3.Dot(bullet.position.subtract(point), up), name).toBeCloseTo(0, 6);
    }
  });

  it('mira exatamente vertical cai no fallback estável em vez de degenerar em NaN', () => {
    for (const {name, direction} of POLES) {
      const point = surface(direction), up = vec(planet.up({x: point.x, y: point.y, z: point.z}));
      const d = fan().launch(point, up, 3, 10, up);
      expect(Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z), name).toBe(true);
      expect(d.length(), name).toBeCloseTo(1, 12);
    }
  });
});

// --------------------------------------------------------------------------------------------
// As pistolas de verdade, inteiras, nos seis polos.
// --------------------------------------------------------------------------------------------

interface SkillRayProbe {skillRay(side: 0 | 1, dir: Vector3, id: string, damage: number, pierce: boolean): void}

function rig(options: {space?: CombatSpace; bodyLocal?: Vector3; forward?: Vector3; gripAnchor?: Vector3} = {}) {
  const {space, bodyLocal = Vector3.Zero(), forward = Vector3.Forward(), gripAnchor} = options;
  const engine = new NullEngine(), scene = new Scene(engine), events = new EventBus<GameEvents>();
  const eye = new FreeCamera('space-test-camera', bodyLocal.add(new Vector3(0, 1.7, -3)), scene);
  // Os `WeaponGrip` do rig são nós de MUNDO; sem eles o código cai no encaixe pela mão e o
  // arremesso da recarga nem chega a ser exercido.
  const grips = gripAnchor === undefined ? [] : [0, 1].map(side => {
    const node = new TransformNode(`space-grip-${side}`, scene);
    node.position.copyFrom(gripAnchor).addInPlace(Vector3.Cross(forward, gripAnchor.clone().normalize()).normalize().scale(side === 0 ? 0.3 : -0.3));
    node.computeWorldMatrix(true);
    return node;
  });
  const visual = {ready: true, position: bodyLocal.clone(), hands: [], grips, fire: vi.fn(), release: vi.fn(), stormAim: vi.fn()} as unknown as CharacterVisual;
  // Estrutural: nem a câmera de teste nem a do jogo precisam ser a MESMA classe.
  const camera: CombatCamera = {forward: forward.clone(), camera: eye, impulse: vi.fn()};
  const audio = {shot: vi.fn(), reload: vi.fn(), skillImpact: vi.fn()} as unknown as WeaponAudio;
  const targets: TrainingTarget[] = [];
  const weapons = new DualPistols(scene, camera, visual, {targets}, new RunRNG('space').stream('run'), events, audio, ...(space ? [space] as const : []));
  weapons.updatePose(0);
  return {weapons, scene, camera, visual, grips, dispose: () => {weapons.dispose(); scene.dispose(); engine.dispose();}};
}

/** Roda o passo fixo e o de pose juntos, como a cena faz. */
const run = (weapons: DualPistols, frames: number) => {
  for (let i = 0; i < frames; i++) {weapons.fixedUpdate(1 / 60, false); weapons.updatePose(1 / 60);}
};

describe('DualPistols original sob um referencial radial', () => {
  it('o espaço padrão continua sendo o jogo plano: mesmas direções do leque com e sem contrato', () => {
    const implicit = rig(), explicit = rig({space: WORLD_SPACE});
    try {
      implicit.weapons.releaseSkill(1); explicit.weapons.releaseSkill(1);
      run(implicit.weapons, 40); run(explicit.weapons, 40);
      expect(implicit.weapons.fan.bullets.length).toBeGreaterThan(0);
      expect(explicit.weapons.fan.bullets.map(b => b.direction.asArray()))
        .toEqual(implicit.weapons.fan.bullets.map(b => b.direction.asArray()));
      expect(explicit.weapons.skillShots).toBe(implicit.weapons.skillShots);
    } finally {implicit.dispose(); explicit.dispose();}
  });

  it.each(POLES)('o leque do MP I sai tangente ao corpo no polo $name', ({direction}) => {
    const origin = surface(direction), up = vec(planet.up({x: origin.x, y: origin.y, z: origin.z}));
    const r = rig({space: new RadialSpace(origin), forward: tangentForward(origin)});
    try {
      r.weapons.releaseSkill(1);
      run(r.weapons, 60);
      expect(r.weapons.fan.bullets.length).toBeGreaterThan(0);
      expect(r.weapons.skillShots).toBe(10);                   // cadência e total do MP I intactos
      for (const bullet of r.weapons.fan.bullets) {
        // Tolerância larga porque a origem é o CANO, deslocado da vertical do corpo por ~1 m
        // numa esfera de 200 m — o desvio geométrico legítimo é da ordem de 1e-2.
        expect(Math.abs(Vector3.Dot(bullet.direction, up))).toBeLessThan(0.02);
      }
    } finally {r.dispose();}
  });

  it.each(POLES)('a fuzilaria do MP II varre o plano tangente no polo $name', ({direction}) => {
    const origin = surface(direction), up = vec(planet.up({x: origin.x, y: origin.y, z: origin.z}));
    const forward = tangentForward(origin);
    const r = rig({space: new RadialSpace(origin), forward});
    const fired: Vector3[] = [];
    // A direção da varredura não é pública; observá-la no ponto de disparo é o único jeito de
    // provar o plano da varredura sem inventar um caminho de dano paralelo.
    vi.spyOn(r.weapons as unknown as SkillRayProbe, 'skillRay').mockImplementation((_side, dir) => {fired.push(dir.clone());});
    try {
      r.weapons.releaseSkill(2);
      run(r.weapons, 60);
      expect(fired).toHaveLength(14);                          // os 14 tiros de sempre
      for (const dir of fired) {
        expect(Math.abs(Vector3.Dot(dir, up))).toBeLessThan(1e-9);
        expect(dir.length()).toBeCloseTo(1, 12);
      }
      // Abertura total de 0,75 rad preservada, e centrada na mira.
      expect(Math.acos(Math.min(1, Vector3.Dot(fired[0]!, fired[13]!)))).toBeCloseTo(0.75, 9);
      expect(Vector3.Dot(fired[0]!, forward)).toBeCloseTo(Vector3.Dot(fired[13]!, forward), 9);
    } finally {r.dispose();}
  });

  it.each(POLES)('a tempestade do MP III dispara do peito na vertical local no polo $name', ({direction}) => {
    const origin = surface(direction), up = vec(planet.up({x: origin.x, y: origin.y, z: origin.z}));
    const r = rig({space: new RadialSpace(origin), forward: tangentForward(origin)});
    try {
      r.weapons.releaseSkill(3);
      run(r.weapons, 181);
      expect(r.weapons.skillShots).toBeGreaterThanOrEqual(59);  // 20 Hz por 3 s, como no jogo plano
      expect(r.weapons.skillShots).toBeLessThanOrEqual(61);
      expect(r.weapons.stormRemaining).toBe(0);
      // O peito fica 1,3 m acima do corpo NA VERTICAL LOCAL: o cano nasce mais longe do centro do
      // planeta que os pés, e não mais alto em `+Y` do mundo.
      const muzzle = r.weapons.muzzlePose(0).position;
      expect(Vector3.Dot(muzzle.subtract(origin), up)).toBeGreaterThan(0.5);
    } finally {r.dispose();}
  });
});

describe('arremesso da recarga sobe na vertical local', () => {
  it.each(POLES)('a arma deixa a mão na vertical local, sem deriva lateral, no polo $name', ({direction}) => {
    const origin = surface(direction), up = vec(planet.up({x: origin.x, y: origin.y, z: origin.z}));
    const anchor = origin.add(up.scale(1.15));
    const r = rig({space: new RadialSpace(origin), forward: tangentForward(origin), gripAnchor: anchor});
    try {
      const grip = r.grips[0]!.getAbsolutePosition().clone();
      r.weapons.magazine.ammo = 3;
      expect(r.weapons.requestReload()).toBe(true);
      let peak = -Infinity, drift = 0;
      for (let i = 0; i < 81; i++) {                            // 1,35 s de recarga a 60 Hz
        r.weapons.magazine.update(1 / 60);
        r.weapons.updatePose(1 / 60);
        const delta = r.weapons.muzzlePose(0).position.subtract(grip);
        const along = Vector3.Dot(delta, up);
        peak = Math.max(peak, along);
        drift = Math.max(drift, delta.subtract(up.scale(along)).length());
      }
      // O arco vale 1,12 m no ápice; o cano fica a 0,374 m do eixo da arma, então a janela é larga
      // o bastante para o rodopio e estreita o bastante para reprovar um arco em `+Y` do mundo —
      // que num polo do equador sairia inteiro DE LADO (`peak` ≈ 0, `drift` ≈ 1,12).
      expect(peak).toBeGreaterThan(0.9);
      expect(peak).toBeLessThan(1.55);
      expect(drift).toBeLessThan(0.45);
      expect(r.weapons.magazine.ammo).toBe(r.weapons.magazine.capacity);
    } finally {r.dispose();}
  });
});

describe('eixo do rodopio substitui camera.rotation.y sem mudar o jogo plano', () => {
  it('up × forward vale exatamente (cos yaw, 0, −sin yaw) para qualquer mira do jogo plano', () => {
    const up = new Vector3(0, 1, 0);
    for (const yaw of [0, 0.7, -1.9, Math.PI, 2.6]) {
      for (const pitch of [-1.1, -0.4, 0, 0.55, 1.1]) {        // o clamp real do jogador
        // `ThirdPersonCamera.update` monta exatamente esta frente.
        const forward = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        const axis = Vector3.Cross(up, forward).normalize();
        const legacy = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));   // a expressão ORIGINAL
        expect(axis.x).toBeCloseTo(legacy.x, 12);
        expect(axis.y).toBeCloseTo(legacy.y, 12);
        expect(axis.z).toBeCloseTo(legacy.z, 12);
      }
    }
  });
  it('e num polo qualquer continua perpendicular à vertical local e à mira', () => {
    for (const {name, direction} of POLES) {
      const point = surface(direction), up = vec(planet.up({x: point.x, y: point.y, z: point.z}));
      const forward = tangentForward(point);
      const axis = Vector3.Cross(up, forward).normalize();
      expect(Vector3.Dot(axis, up), name).toBeCloseTo(0, 12);
      expect(Vector3.Dot(axis, forward), name).toBeCloseTo(0, 12);
    }
  });
});
