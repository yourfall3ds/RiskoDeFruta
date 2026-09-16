import {describe, expect, it} from 'vitest';
import {PLANET, PlanetFrame, add, distance, dot, normalize, scale, sub} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {capsuleTriangle, sweepCapsuleTriangle} from '../src/planet/OrientedCapsule';
import {TriangleSoup, bridgeDeck, islandDeck, tangentSlab} from './planet-fixture';

const frame = new PlanetFrame(PLANET);

const world = (): PlanetCollision => {
  const soup = new TriangleSoup();
  islandDeck(soup, frame, {x: 0, y: 0, z: 1});
  islandDeck(soup, frame, {x: 1, y: 0, z: 0});
  islandDeck(soup, frame, {x: 0, y: -1, z: 0});
  bridgeDeck(soup, frame, {x: 0, y: 0, z: 1}, {x: 1, y: 0, z: 0});
  const collision = new PlanetCollision();
  collision.setGeometry(soup.positions, soup.indices);
  return collision;
};

describe('OrientedCapsule — eixo arbitrário', () => {
  it('mede a mesma distância que a versão Y-up quando o eixo é +Y', () => {
    const contact = capsuleTriangle(
      {x: 0, y: 2, z: 0}, {x: 0, y: 1, z: 0}, 0.32, 1.8,
      {x: -5, y: 0, z: -5}, {x: 5, y: 0, z: -5}, {x: 0, y: 0, z: 5},
    );
    // Pé a 2 m do chão, esfera inferior a `radius` acima do pé.
    expect(contact.distance).toBeCloseTo(2 + 0.32, 6);
    expect(contact.normal.y).toBeCloseTo(1, 6);
  });

  it('funciona de cabeça para baixo: eixo −Y sobre uma face abaixo', () => {
    // Pé na origem, corpo apontando para −Y: o topo da cápsula fica em y = −1,48.
    const contact = capsuleTriangle(
      {x: 0, y: 0, z: 0}, {x: 0, y: -1, z: 0}, 0.32, 1.8,
      {x: -5, y: -3, z: -5}, {x: 5, y: -3, z: -5}, {x: 0, y: -3, z: 5},
    );
    expect(contact.distance).toBeCloseTo(3 - (1.8 - 0.32), 6);
    // A normal separa: vai da face para a cápsula.
    expect(contact.normal.y).toBeCloseTo(1, 6);
  });

  it('detecta penetração quando o eixo atravessa a face', () => {
    const contact = capsuleTriangle(
      {x: 0, y: -0.5, z: 0}, {x: 0, y: 1, z: 0}, 0.32, 1.8,
      {x: -5, y: 0, z: -5}, {x: 5, y: 0, z: -5}, {x: 0, y: 0, z: 5},
    );
    expect(contact.distance).toBe(0);
  });

  it('a varredura para antes da face e nunca a atravessa', () => {
    const hit = sweepCapsuleTriangle(
      {x: 0, y: 3, z: 0}, {x: 0, y: 1, z: 0}, {x: 0, y: -6, z: 0}, 0.32, 1.8,
      {x: -5, y: 0, z: -5}, {x: 5, y: 0, z: -5}, {x: 0, y: 0, z: 5},
    );
    expect(hit).toBeDefined();
    const landing = 3 + hit!.time * -6;
    expect(landing).toBeGreaterThan(-0.001);
    expect(landing).toBeLessThan(0.02);
  });

  it('ignora contato quando o movimento se afasta da face', () => {
    expect(sweepCapsuleTriangle(
      {x: 0, y: 0.01, z: 0}, {x: 0, y: 1, z: 0}, {x: 0, y: 4, z: 0}, 0.32, 1.8,
      {x: -5, y: 0, z: -5}, {x: 5, y: 0, z: -5}, {x: 0, y: 0, z: 5},
    )).toBeUndefined();
  });
});

describe('PlanetCollision — sonda radial substitui groundAt(x,z)', () => {
  it('encontra o convés da ilha em qualquer lado do planeta', () => {
    const collision = world();
    for (const d of [{x: 0, y: 0, z: 1}, {x: 1, y: 0, z: 0}, {x: 0, y: -1, z: 0}]) {
      const above = frame.fromDirection(d, 2);
      const sample = collision.supportBelow(above, frame.up(above), 0.1, 6);
      expect(sample).toBeDefined();
      expect(sample!.offset).toBeCloseTo(2, 2);
      expect(Math.abs(frame.altitude(sample!.point))).toBeLessThan(0.01);
      expect(sample!.slopeDegrees).toBeLessThan(2);
      // A normal aponta para FORA do planeta — inclusive no polo sul, onde "fora" é −Y.
      expect(dot(sample!.normal, frame.up(sample!.point))).toBeGreaterThan(0.99);
    }
  });

  it('não encontra apoio no vão entre ilhas sem ponte', () => {
    const collision = world();
    const gap = normalize({x: 0, y: 0.7, z: 0.7});
    const above = frame.fromDirection(gap, 2);
    expect(collision.supportBelow(above, frame.up(above), 0.1, 12)).toBeUndefined();
  });

  it('encontra o convés da ponte no meio do vão', () => {
    const collision = world();
    const middle = normalize({x: 1, y: 0, z: 1});
    const above = frame.fromDirection(middle, 3);
    const sample = collision.supportBelow(above, frame.up(above), 0.1, 8);
    expect(sample).toBeDefined();
    // O convés do fixture é facetado: a corda de 8 m de largura afunda R·(1−cos(4/R)) ≈ 4 cm.
    expect(Math.abs(sample!.offset - 3)).toBeLessThan(0.05);
    expect(sample!.slopeDegrees).toBeLessThan(2);
  });

  it('mede inclinação contra a vertical LOCAL, não contra +Y', () => {
    const soup = new TriangleSoup();
    const at = frame.fromDirection({x: 0, y: -1, z: 0});
    islandDeck(soup, frame, {x: 0, y: -1, z: 0});
    // Rampa de 30° no polo sul: normal longe de ±Y global, mas 30° da vertical local.
    tangentSlab(soup, frame, at, {along: 8, across: 8, height: 0.05, riseAlong: 8 * Math.tan(Math.PI / 6)});
    const collision = new PlanetCollision();
    collision.setGeometry(soup.positions, soup.indices);
    const probeAt = frame.fromDirection(frame.up(frame.geodesicStep(at, scale(frame.basisAt(at, {x: 0, y: 1, z: 0}).forward, 2)).position), 6);
    const sample = collision.supportBelow(probeAt, frame.up(probeAt), 0.1, 12);
    expect(sample).toBeDefined();
    expect(sample!.slopeDegrees).toBeGreaterThan(25);
    expect(sample!.slopeDegrees).toBeLessThan(35);
  });

  it('o raio casa pela frente e pelo verso da face autoral', () => {
    const collision = world();
    const outside = frame.fromDirection({x: 0, y: 0, z: 1}, 40);
    const inward = collision.raycast(outside, scale(frame.up(outside), -1), 80);
    expect(inward?.distance).toBeCloseTo(40, 2);
    const inside = frame.fromDirection({x: 0, y: 0, z: 1}, -40);
    const outward = collision.raycast(inside, frame.up(inside), 80);
    expect(outward?.distance).toBeCloseTo(40, 2);
  });

  it('a varredura da cápsula barra um murete alto e libera o baixo', () => {
    const at = frame.fromDirection({x: 0, y: 0, z: 1});
    const basis = frame.basisAt(at, {x: 0, y: 1, z: 0});
    const build = (height: number): PlanetCollision => {
      const soup = new TriangleSoup();
      islandDeck(soup, frame, {x: 0, y: 0, z: 1});
      tangentSlab(soup, frame, add(at, scale(basis.forward, 3)), {along: 2, across: 10, height});
      const collision = new PlanetCollision();
      collision.setGeometry(soup.positions, soup.indices);
      return collision;
    };
    const walk = scale(basis.forward, 4);
    const high = build(2).sweepCapsule(at, basis.up, walk, 0.32, 1.8);
    expect(high).toBeDefined();
    expect(Math.abs(dot(high!.normal, basis.up))).toBeLessThan(0.3);
    // Um degrau de 0,3 m também é parede para a varredura crua — quem sobe nele é o motor,
    // com a tentativa de degrau; a colisão sozinha só informa que há contato lateral.
    const low = build(0.3).sweepCapsule(at, basis.up, walk, 0.32, 1.8);
    expect(low).toBeDefined();
    expect(low!.time).toBeGreaterThan(high!.time - 1e-6);
  });

  it('desencrava um corpo posto dentro do convés', () => {
    const collision = world();
    const buried = frame.fromDirection({x: 0, y: 0, z: 1}, -0.2);
    const contact = collision.deepestContact(buried, frame.up(buried), 0.32, 1.8);
    expect(contact).toBeDefined();
    // Pé 0,2 m abaixo do convés ⇒ a esfera inferior (0,32 acima do pé) ainda está 0,12 acima dele.
    expect(contact!.depth).toBeCloseTo(0.2, 2);
    const pushed = add(buried, scale(contact!.normal, contact!.depth));
    expect(frame.altitude(pushed)).toBeGreaterThan(frame.altitude(buried));
  });

  it('geometria vazia não quebra nenhuma consulta', () => {
    const empty = new PlanetCollision();
    expect(empty.ready).toBe(false);
    expect(empty.triangleCount).toBe(0);
    expect(empty.supportBelow({x: 0, y: 210, z: 0}, {x: 0, y: 1, z: 0}, 1, 10)).toBeUndefined();
    expect(empty.sweepCapsule({x: 0, y: 210, z: 0}, {x: 0, y: 1, z: 0}, {x: 1, y: 0, z: 0}, 0.32, 1.8)).toBeUndefined();
    expect(empty.raycast({x: 0, y: 210, z: 0}, {x: 0, y: -1, z: 0}, 50)).toBeUndefined();
  });

  it('indexa a quantidade de triângulos que recebeu', () => {
    const soup = new TriangleSoup();
    islandDeck(soup, frame, {x: 0, y: 0, z: 1}, {rings: 4, sectors: 8});
    const collision = new PlanetCollision();
    collision.setGeometry(soup.positions, soup.indices);
    expect(collision.triangleCount).toBe(soup.triangleCount);
    expect(collision.ready).toBe(true);
    // 8 triângulos no centro + 3 anéis de 8 quads.
    expect(collision.triangleCount).toBe(8 + 3 * 8 * 2);
  });
});

describe('PlanetCollision — coerência com o referencial', () => {
  it('a distância do ponto de apoio ao centro é o raio da superfície', () => {
    const collision = world();
    const above = frame.fromDirection(normalize({x: 0.2, y: 0, z: 1}), 5);
    const sample = collision.supportBelow(above, frame.up(above), 0.1, 10)!;
    // Tolerância = faceta do fixture (calota de 24 setores × 10 anéis), não erro do referencial.
    expect(Math.abs(distance(sample.point, PLANET.centre) - PLANET.surfaceRadius)).toBeLessThan(0.05);
    expect(distance(sub(sample.point, PLANET.centre), scale(frame.up(above), PLANET.surfaceRadius))).toBeLessThan(0.06);
  });
});

it('extracts nearby corpse terrain including large faces and excludes destroyed props',()=>{
 const collision=new PlanetCollision();
 collision.setGeometry([-10,0,-10,10,0,-10,0,0,10,100,0,100,101,0,100,100,0,101],[0,1,2,3,4,5]);
 const patch=collision.trianglesAround({x:0,y:0,z:0},1);
 expect(patch.indices).toHaveLength(3);expect(patch.positions).toHaveLength(9);
 collision.disableTriangles(0,1);expect(collision.trianglesAround({x:0,y:0,z:0},1).indices).toHaveLength(0);
});
