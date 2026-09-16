import {describe, it, expect, vi} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';

/**
 * O 4º argumento do `ShellCasings`, do contrato `.temp/real-game-enemy-api.md` §3.
 *
 * O `ShellCasings` é do dono da horda e HOJE ainda tem três parâmetros — ele ignora o quarto. Este
 * teste fixa o lado que é meu: que o `DualPistols` já o repassa, e que no planeta o mundo NÃO é
 * rebaixado para `undefined`. Quando a horda acrescentar o parâmetro, o casco passa a cair na
 * vertical local sem que uma linha aqui mude.
 *
 * O dublê existe só para ler os argumentos do construtor — é a única forma de observar uma
 * passagem que o destinatário ainda descarta.
 */
const built: {args: unknown[]}[] = [];
vi.mock('../src/vfx/ShellCasings', () => ({
  ShellCasings: class {
    constructor(...args: unknown[]) {built.push({args});}
    eject(): void {}
    update(): void {}
    clear(): void {}
    dispose(): void {}
  },
}));

const {DualPistols} = await import('../src/combat/DualPistols');
const {CollisionWorld} = await import('../src/physics/CollisionWorld');
const {PlanetCollision} = await import('../src/planet/PlanetCollision');
const {PlanetFrame} = await import('../src/planet/PlanetFrame');
const {EventBus} = await import('../src/core/EventBus');
const {RunRNG} = await import('../src/core/RunRNG');
type Visual = ConstructorParameters<typeof DualPistols>[2];
type Audio = ConstructorParameters<typeof DualPistols>[6];
type Camera = ConstructorParameters<typeof DualPistols>[1];

function build(collision: ConstructorParameters<typeof DualPistols>[3]['collision']) {
  const engine = new NullEngine(), scene = new Scene(engine);
  const eye = new FreeCamera('casings-camera', Vector3.Zero(), scene);
  const camera = {forward: new Vector3(0, 0, 1), camera: eye, impulse: vi.fn()} as Camera;
  const visual = {ready: true, position: Vector3.Zero(), hands: [], grips: [], fire: vi.fn(), release: vi.fn()} as unknown as Visual;
  const audio = {shot: vi.fn(), reload: vi.fn()} as unknown as Audio;
  built.length = 0;
  const weapons = new DualPistols(scene, camera, visual, {targets: [], ...(collision ? {collision} : {})},
    new RunRNG('casings').stream('run'), new EventBus(), audio);
  const args = built[0]!.args;
  return {weapons, args, dispose: () => {weapons.dispose(); scene.dispose(); engine.dispose();}};
}

describe('ShellCasings recebe o referencial de superfície', () => {
  it('no mundo PLANO nada muda: o CollisionWorld de sempre e o `FlatSurface` dele', () => {
    const world = new CollisionWorld();
    const r = build(world);
    try {
      expect(r.args).toHaveLength(4);
      expect(r.args[1]).toBe(world);                 // o mundo continua chegando inteiro
      expect(r.args[3]).toBe(world.surface);
      expect((r.args[3] as {kind: string}).kind).toBe('flat');
      expect(world.spherical).toBe(false);
    } finally {r.dispose();}
  });

  it('no PLANETA o mundo não é rebaixado para undefined e a superfície é a esférica', () => {
    const world = new CollisionWorld();
    const collision = new PlanetCollision();
    collision.setGeometry([-1, 0, 5, 1, 0, 5, 0, 2, 5], [0, 1, 2]);
    world.configurePlanet(new PlanetFrame(), collision);
    const r = build(world);
    try {
      // Este é o ponto exato do pedido: `configurePlanet` não preenche `geometry`, mas o mundo
      // continua sendo um `CollisionWorld` completo — então `groundAt` existe e o casco mantém
      // o mundo. Rebaixar para `undefined` aqui seria perder o chão do casquilho no planeta.
      expect(r.args[1]).toBe(world);
      expect(world.spherical).toBe(true);
      const surface = r.args[3] as {kind: string; up(p: {x: number; y: number; z: number}): {x: number; y: number; z: number}};
      expect(surface).toBe(world.surface);
      expect(surface.kind).toBe('sphere');
      // Gravidade LOCAL: no equador +X a vertical é (1,0,0), não (0,1,0).
      const up = surface.up({x: 200, y: 0, z: 0});
      expect(up.x).toBeCloseTo(1, 9);
      expect(up.y).toBeCloseTo(0, 9);
    } finally {r.dispose();}
  });

  it('sem colisão nenhuma o construtor continua válido (mundo e superfície ausentes)', () => {
    const r = build(undefined);
    try {
      expect(r.args[1]).toBeUndefined();
      expect(r.args[3]).toBeUndefined();
    } finally {r.dispose();}
  });
});
