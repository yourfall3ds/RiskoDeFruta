import {describe, it, expect} from 'vitest';
import {RadialProps, withProps, type PropBox} from '../src/physics/RadialProps';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetFrame, PLANET} from '../src/planet/PlanetFrame';
import type {Vec3} from '../src/core/contracts';

/**
 * Revisão do `RadialProps`: os três defeitos apontados pelo root.
 *
 * 1. sonda infinita (`support(p, up, ∞, ∞)`) virava `NaN` — `up·∞` com eixo zerado é `0·∞`;
 * 2. `rayBox` devolvia normal apontando para DENTRO quando a direção era negativa;
 * 3. `slide` só sondava uma esfera no pé, então saliência na altura do peito era atravessada.
 */

const AXES: {name: string; up: Vec3}[] = [
  {name: '+Y', up: {x: 0, y: 1, z: 0}},
  {name: '-Y', up: {x: 0, y: -1, z: 0}},
  {name: '+X', up: {x: 1, y: 0, z: 0}},
  {name: '-X', up: {x: -1, y: 0, z: 0}},
  {name: '+Z', up: {x: 0, y: 0, z: 1}},
  {name: '-Z', up: {x: 0, y: 0, z: -1}},
];

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (p: Vec3, d: Vec3, s: number): Vec3 => ({x: p.x + d.x * s, y: p.y + d.y * s, z: p.z + d.z * s});
const finite = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** Caixa alinhada aos eixos do mundo, centrada em `centre`. */
function box(id: string, centre: Vec3, half: Vec3): PropBox {
  return {id, centre, right: {x: 1, y: 0, z: 0}, up: {x: 0, y: 1, z: 0}, forward: {x: 0, y: 0, z: 1}, half};
}

/** Caixa cuja vertical é `up`, com uma base ortonormal estável em volta dela. */
function orientedBox(id: string, centre: Vec3, up: Vec3, half: Vec3): PropBox {
  const seed = Math.abs(up.y) < .9 ? {x: 0, y: 1, z: 0} : {x: 0, y: 0, z: 1};
  const r = {x: seed.y * up.z - seed.z * up.y, y: seed.z * up.x - seed.x * up.z, z: seed.x * up.y - seed.y * up.x};
  const l = Math.hypot(r.x, r.y, r.z) || 1;
  const right = {x: r.x / l, y: r.y / l, z: r.z / l};
  const forward = {x: up.y * right.z - up.z * right.y, y: up.z * right.x - up.x * right.z, z: up.x * right.y - up.y * right.x};
  return {id, centre, right, up, forward, half};
}

// --------------------------------------------------------------------------------------------
// 1. Sonda infinita
// --------------------------------------------------------------------------------------------

describe('sonda infinita devolve contato FINITO', () => {
  it.each(AXES)('support(p, $name, ∞, ∞) não produz NaN e acha o corpo', ({up}) => {
    const props = new RadialProps();
    // Baú a 1 m abaixo do pé, na vertical local.
    const centre = add({x: 0, y: 0, z: 0}, up, -1);
    props.add(orientedBox('caixote', centre, up, {x: .53, y: .34, z: .43}));
    const hit = props.support({x: 0, y: 0, z: 0}, up, Infinity, Infinity);
    expect(hit).toBeDefined();
    expect(finite(hit!.point)).toBe(true);
    expect(finite(hit!.normal)).toBe(true);
    expect(Number.isFinite(hit!.offset)).toBe(true);
    expect(Number.isFinite(hit!.slopeDegrees)).toBe(true);
    // O topo do corpo está 1 − 0,34 = 0,66 m abaixo do pé.
    expect(hit!.offset).toBeCloseTo(.66, 6);
    expect(dot(hit!.normal, up)).toBeCloseTo(1, 9);
  });

  it('o mesmo vale pela superfície embrulhada, que é o caminho real do motor', () => {
    const world = new CollisionWorld();
    world.configurePlanet(new PlanetFrame(), new PlanetCollision());
    const props = new RadialProps();
    const up = {x: 0, y: 1, z: 0}, foot = {x: 0, y: PLANET.surfaceRadius, z: 0};
    props.add(box('caixote', add(foot, up, -1), {x: .53, y: .34, z: .43}));
    world.attachRadialProps('teste', props);
    const hit = world.surface.support(foot, Infinity, Infinity);
    expect(hit).toBeDefined();
    expect(finite(hit!.point)).toBe(true);
    expect(Number.isFinite(hit!.offset)).toBe(true);
  });

  it('não perde corpo ALTO: a sonda é limitada pela extensão real, não por uma janela chutada', () => {
    const props = new RadialProps();
    const up = {x: 0, y: 1, z: 0};
    // Torre de 40 m cujo topo está 30 m ACIMA do pé e a base 50 m abaixo.
    props.add(box('torre', {x: 0, y: -10, z: 0}, {x: 1, y: 40, z: 1}));
    const hit = props.support({x: 0, y: 0, z: 0}, up, Infinity, Infinity);
    expect(hit).toBeDefined();
    // Descendo do topo, o primeiro contato é o topo da torre, 30 m acima do pé ⇒ offset negativo.
    expect(hit!.offset).toBeCloseTo(-30, 6);
    expect(finite(hit!.point)).toBe(true);
  });

  it('só `below` infinito também funciona, e um alcance finito continua recortando', () => {
    const props = new RadialProps();
    const up = {x: 0, y: 1, z: 0};
    props.add(box('fundo', {x: 0, y: -120, z: 0}, {x: 4, y: 1, z: 4}));
    expect(props.support({x: 0, y: 0, z: 0}, up, 0, Infinity)?.offset).toBeCloseTo(119, 6);
    // Uma janela finita e curta continua recusando o que está fora dela — caminho preservado.
    expect(props.support({x: 0, y: 0, z: 0}, up, 0, 5)).toBeUndefined();
  });

  it('sem corpo nenhum a sonda infinita devolve undefined em vez de girar', () => {
    expect(new RadialProps().support({x: 0, y: 0, z: 0}, {x: 0, y: 1, z: 0}, Infinity, Infinity)).toBeUndefined();
  });

  it('raycast com alcance infinito é limitado analiticamente', () => {
    const props = new RadialProps();
    props.add(box('alvo', {x: 0, y: 0, z: 10}, {x: 1, y: 1, z: 1}));
    const hit = props.raycast({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 1}, Infinity);
    expect(hit?.distance).toBeCloseTo(9, 6);
    expect(props.raycast({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: -1}, Infinity)).toBeUndefined();
  });
});

// --------------------------------------------------------------------------------------------
// 2. Normais externas das seis faces
// --------------------------------------------------------------------------------------------

describe('rayBox devolve a normal EXTERNA da face de entrada', () => {
  const FACES: {name: string; from: Vec3; direction: Vec3; normal: Vec3}[] = [
    {name: '+X', from: {x: 5, y: 0, z: 0}, direction: {x: -1, y: 0, z: 0}, normal: {x: 1, y: 0, z: 0}},
    {name: '-X', from: {x: -5, y: 0, z: 0}, direction: {x: 1, y: 0, z: 0}, normal: {x: -1, y: 0, z: 0}},
    {name: '+Y', from: {x: 0, y: 5, z: 0}, direction: {x: 0, y: -1, z: 0}, normal: {x: 0, y: 1, z: 0}},
    {name: '-Y', from: {x: 0, y: -5, z: 0}, direction: {x: 0, y: 1, z: 0}, normal: {x: 0, y: -1, z: 0}},
    {name: '+Z', from: {x: 0, y: 0, z: 5}, direction: {x: 0, y: 0, z: -1}, normal: {x: 0, y: 0, z: 1}},
    {name: '-Z', from: {x: 0, y: 0, z: -5}, direction: {x: 0, y: 0, z: 1}, normal: {x: 0, y: 0, z: -1}},
  ];

  it.each(FACES)('face $name aponta para FORA', ({from, direction, normal}) => {
    const props = new RadialProps();
    props.add(box('cubo', {x: 0, y: 0, z: 0}, {x: 1, y: 1, z: 1}));
    const hit = props.raycast(from, direction, 10);
    expect(hit).toBeDefined();
    expect(hit!.distance).toBeCloseTo(4, 9);
    expect(hit!.normal.x).toBeCloseTo(normal.x, 9);
    expect(hit!.normal.y).toBeCloseTo(normal.y, 9);
    expect(hit!.normal.z).toBeCloseTo(normal.z, 9);
    // Contra a direção do raio: é isso que "externa" quer dizer.
    expect(dot(hit!.normal, direction)).toBeLessThan(0);
  });

  it('numa caixa girada a normal sai em MUNDO, não no espaço da caixa', () => {
    const up = {x: 0, y: 0, z: 1};                      // caixa deitada: vertical local é +Z
    const props = new RadialProps();
    props.add(orientedBox('deitada', {x: 0, y: 0, z: 0}, up, {x: 1, y: 2, z: 1}));
    const hit = props.raycast({x: 0, y: 0, z: 5}, {x: 0, y: 0, z: -1}, 10);
    expect(hit).toBeDefined();
    expect(hit!.normal.z).toBeCloseTo(1, 9);            // topo da caixa deitada = +Z do mundo
    expect(hit!.distance).toBeCloseTo(3, 9);            // half.y = 2 ao longo de `up` = +Z
  });

  it('raio nascido DENTRO do corpo não inventa contato a distância zero', () => {
    const props = new RadialProps();
    props.add(box('cubo', {x: 0, y: 0, z: 0}, {x: 1, y: 1, z: 1}));
    // Sem a guarda, o teste de fatias devolvia distância 0 com a normal do eixo default (+X) — e a
    // sonda de degrau lia isso como "dá para subir", deixando o baú atravessável.
    expect(props.raycast({x: 0, y: 0, z: 0}, {x: 0, y: -1, z: 0}, 10)).toBeUndefined();
    expect(props.support({x: 0, y: 0, z: 0}, {x: 0, y: 1, z: 0}, .45, 0)).toBeUndefined();
    // Encostado na face por fora continua valendo.
    expect(props.raycast({x: 0, y: 1.001, z: 0}, {x: 0, y: -1, z: 0}, 10)?.distance).toBeCloseTo(.001, 6);
  });

  it('a normal do apoio bate com a do raio: a sonda para BAIXO era o caso quebrado', () => {
    const props = new RadialProps();
    props.add(box('cubo', {x: 0, y: -1, z: 0}, {x: 1, y: .5, z: 1}));
    const down = props.raycast({x: 0, y: 3, z: 0}, {x: 0, y: -1, z: 0}, 10);
    expect(down!.normal.y).toBeCloseTo(1, 9);           // topo aponta para CIMA
    const support = props.support({x: 0, y: 0, z: 0}, {x: 0, y: 1, z: 0}, 2, 4);
    expect(support!.normal.y).toBeCloseTo(1, 9);
    expect(support!.slopeDegrees).toBeCloseTo(0, 6);    // topo plano é piso, não rampa
  });
});

// --------------------------------------------------------------------------------------------
// 3. Cápsula inteira, não só o pé
// --------------------------------------------------------------------------------------------

describe('colisão do corpo SUPERIOR contra saliência', () => {
  const up = {x: 0, y: 1, z: 0};
  /** Saliência do peito à cabeça (y de 1,0 a 1,6), com o chão livre por baixo. */
  const overhang = () => {
    const props = new RadialProps();
    props.add(box('saliencia', {x: 0, y: 1.3, z: 4}, {x: 3, y: .3, z: .5}));
    return props;
  };

  it('a esfera do PÉ não vê a saliência — era exatamente o furo', () => {
    const props = overhang();
    const foot = {x: 0, y: 0, z: 0}, delta = {x: 0, y: 0, z: 8};
    expect(props.sweep(add(foot, up, .35), delta, .35)).toBeUndefined();
  });

  it('a cápsula vê, e para antes de entrar nela', () => {
    const props = overhang();
    const foot = {x: 0, y: 0, z: 0}, delta = {x: 0, y: 0, z: 8};
    const hit = props.sweepCapsule(foot, up, delta, .35, 1.8);
    expect(hit).toBeDefined();
    // Face frontal da saliência em z = 3,5; menos o raio da cápsula ⇒ 3,15 de 8.
    expect(hit!.time * 8).toBeCloseTo(3.15, 1);
    expect(hit!.normal.z).toBeCloseTo(-1, 6);
  });

  it('`slide` embrulhado barra o corpo em vez de atravessar a saliência', () => {
    const world = new CollisionWorld();
    world.configurePlanet(new PlanetFrame(), new PlanetCollision());
    const props = overhang();
    const solid = withProps(world.surface, props);
    const p = {x: 0, y: 0, z: 0};
    const result = solid.slide(p, {x: 0, y: 0, z: 8}, .35, 1.8, .45, {ignoreFloors: true});
    expect(result.blocked).toBe(true);
    expect(p.z).toBeLessThan(3.5);                      // não entrou na saliência
    expect(p.z).toBeGreaterThan(2.5);                   // nem foi teleportado para trás
    expect(finite(p)).toBe(true);
    expect(solid.insideSolid(p, 1.8)).toBe(false);
  });

  it('o passo nunca anda mais que o pedido — sem teleporte', () => {
    const world = new CollisionWorld();
    world.configurePlanet(new PlanetFrame(), new PlanetCollision());
    const solid = withProps(world.surface, overhang());
    const start = {x: 0, y: 0, z: 0}, p = {...start};
    solid.slide(p, {x: 0, y: 0, z: 8}, .35, 1.8, .45, {ignoreFloors: true});
    expect(Math.hypot(p.x - start.x, p.y - start.y, p.z - start.z)).toBeLessThanOrEqual(8 + 1e-6);
  });

  it('contato de PISO continua sendo do `support`: o topo do baú não vira parede', () => {
    const world = new CollisionWorld();
    world.configurePlanet(new PlanetFrame(), new PlanetCollision());
    const props = new RadialProps();
    // Baú BAIXO logo à frente: o contato é o topo dele, e subir nele é trabalho do apoio.
    props.add(box('baú', {x: 0, y: -.2, z: 2}, {x: 2, y: .3, z: .5}));
    const solid = withProps(world.surface, props);
    const p = {x: 0, y: 0, z: 0};
    const result = solid.slide(p, {x: 0, y: 0, z: 3}, .35, 1.8, .45, {ignoreFloors: true});
    // Sem `blocked` fabricado: o passo segue e o vertical é resolvido por `support`.
    expect(result.blocked).toBe(false);
    expect(p.z).toBeGreaterThan(2);
  });
});

// --------------------------------------------------------------------------------------------
// 4. Ficar em pé no baú, pela superfície REAL do CollisionWorld
// --------------------------------------------------------------------------------------------

describe('ficar em pé no baú pela CollisionWorld.surface embrulhada', () => {
  /** Um deck plano de verdade na casca, para o terreno ter o que responder. */
  function deck(): {world: CollisionWorld; foot: Vec3} {
    const R = PLANET.surfaceRadius, collision = new PlanetCollision();
    const positions: number[] = [], indices: number[] = [];
    const rings = 4, segments = 12, arc = 30;
    positions.push(0, R, 0);
    for (let ring = 1; ring <= rings; ring++) {
      const theta = (arc * ring / rings) / R;
      for (let s = 0; s < segments; s++) {
        const phi = s * 2 * Math.PI / segments;
        positions.push(Math.sin(theta) * Math.cos(phi) * R, Math.cos(theta) * R, Math.sin(theta) * Math.sin(phi) * R);
      }
    }
    const at = (ring: number, s: number) => 1 + (ring - 1) * segments + ((s % segments) + segments) % segments;
    for (let s = 0; s < segments; s++) indices.push(0, at(1, s), at(1, s + 1));
    for (let ring = 1; ring < rings; ring++) for (let s = 0; s < segments; s++) {
      indices.push(at(ring, s), at(ring + 1, s), at(ring + 1, s + 1));
      indices.push(at(ring, s), at(ring + 1, s + 1), at(ring, s + 1));
    }
    collision.setGeometry(positions, indices);
    const world = new CollisionWorld();
    world.configurePlanet(new PlanetFrame(), collision);
    return {world, foot: {x: 0, y: R, z: 0}};
  }

  it('o apoio passa a ser o TOPO do baú, e some quando o corpo é removido', () => {
    const {world, foot} = deck();
    const props = new RadialProps();
    world.attachRadialProps('loot', props);
    const up = world.surface.up(foot);
    const bare = world.surface.support(add(foot, up, 2), 0, 6);
    expect(bare).toBeDefined();
    props.add(box('baú', add(foot, up, .34), {x: .53, y: .34, z: .43}));
    // Registro VIVO: nada de re-attach, o corpo vale no mesmo quadro.
    const standing = world.surface.support(add(foot, up, 2), 0, 6);
    expect(standing).toBeDefined();
    const lift = standing!.offset;
    expect(bare!.offset - lift).toBeCloseTo(.68, 2);    // exatamente a altura do baú
    expect(dot(standing!.normal, up)).toBeCloseTo(1, 6);
    expect(standing!.slopeDegrees).toBeLessThan(1);
    props.remove('baú');
    expect(world.surface.support(add(foot, up, 2), 0, 6)!.offset).toBeCloseTo(bare!.offset, 6);
  });

  it('em pé no topo o corpo NÃO conta como dentro do sólido', () => {
    const {world, foot} = deck();
    const props = new RadialProps();
    world.attachRadialProps('loot', props);
    const up = world.surface.up(foot);
    props.add(box('baú', add(foot, up, .34), {x: .53, y: .34, z: .43}));
    const top = add(foot, up, .68);
    expect(world.surface.insideSolid(top, 1.8)).toBe(false);
    // Já ENTERRADO no corpo, sim.
    expect(props.insideSolid(add(foot, up, .1), up, .2)).toBe(true);
  });

  it('a sonda infinita do StageSpawn atravessa a superfície embrulhada sem NaN', () => {
    const {world, foot} = deck();
    const props = new RadialProps();
    props.add(box('baú', add(foot, world.surface.up(foot), .34), {x: .53, y: .34, z: .43}));
    world.attachRadialProps('loot', props);
    const probe = add(foot, world.surface.up(foot), 4);
    const hit = world.surface.support(probe, Infinity, Infinity);
    expect(hit).toBeDefined();
    expect(finite(hit!.point)).toBe(true);
    expect(Number.isFinite(hit!.offset)).toBe(true);
    expect(Number.isFinite(hit!.slopeDegrees)).toBe(true);
  });
});
