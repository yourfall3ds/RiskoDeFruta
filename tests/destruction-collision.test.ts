import {describe, expect, it} from 'vitest';
import {PLANET, PlanetFrame, add, scale} from '../src/planet/PlanetFrame';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {TriangleSoup, islandDeck, tangentSlab} from './planet-fixture';

/**
 * Colisão que some por intervalo de triângulos.
 *
 * É o contrato que sustenta a destruição no planeta: quebrar um prop precisa tirar os triângulos
 * dele do raio, da varredura e da sonda de apoio, **sem** refazer a BVH — que no mapa real tem mais
 * de um milhão de triângulos e levaria centenas de milissegundos por tiro.
 */

const frame = new PlanetFrame(PLANET);
const deckCentre = frame.fromDirection({x: 0, y: 0, z: 1}, 0);
const up = frame.up(deckCentre);

interface World {collision: PlanetCollision; crateStart: number; crateCount: number; deckCount: number}

function world(): World {
  const soup = new TriangleSoup();
  islandDeck(soup, frame, {x: 0, y: 0, z: 1});
  const deckCount = soup.triangleCount;
  // O "caixote": um bloco tangente de 1 m de altura no centro do convés. É a mesma forma fechada que
  // um prop autoral tem, e ocupa um intervalo CONTÍGUO — exatamente o que o manifesto promete.
  tangentSlab(soup, frame, deckCentre, {along: 1.2, across: 1.2, height: 1});
  const collision = new PlanetCollision();
  collision.setGeometry(soup.positions, soup.indices);
  return {collision, crateStart: deckCount, crateCount: soup.triangleCount - deckCount, deckCount};
}

const above = (metres: number) => add(deckCentre, scale(up, metres));
const down = {x: -up.x, y: -up.y, z: -up.z};

describe('PlanetCollision — desativação por intervalo', () => {
  it('o raio para no caixote e, depois da quebra, atravessa até o chão', () => {
    const {collision, crateStart, crateCount} = world();
    const before = collision.raycast(above(6), down, 12);
    expect(before).toBeDefined();
    expect(before!.triangle).toBeGreaterThanOrEqual(crateStart);
    expect(before!.distance).toBeCloseTo(5, 1);

    expect(collision.disableTriangles(crateStart, crateCount)).toBe(crateCount);

    const after = collision.raycast(above(6), down, 12);
    expect(after).toBeDefined();
    expect(after!.triangle).toBeLessThan(crateStart);   // agora é o convés
    expect(after!.distance).toBeCloseTo(6, 1);
  });

  it('a sonda de apoio perde o tampo do caixote e acha o chão embaixo', () => {
    const {collision, crateStart, crateCount} = world();
    const onTop = collision.supportBelow(deckCentre, up, 4, 4);
    expect(onTop).toBeDefined();
    // O tampo está 1 m ACIMA do ponto sondado: deslocamento negativo.
    expect(onTop!.offset).toBeCloseTo(-1, 1);

    collision.disableTriangles(crateStart, crateCount);
    const onGround = collision.supportBelow(deckCentre, up, 4, 4);
    expect(onGround).toBeDefined();
    expect(onGround!.offset).toBeCloseTo(0, 2);
  });

  it('chão removido é chão que não existe: a sonda devolve nada e o corpo cai', () => {
    const {collision} = world();
    expect(collision.supportBelow(deckCentre, up, 4, 4)).toBeDefined();
    collision.disableTriangles(0, collision.triangleCount);
    expect(collision.supportBelow(deckCentre, up, 4, 4)).toBeUndefined();
    expect(collision.raycast(above(6), down, 40)).toBeUndefined();
    expect(collision.disabledCount).toBe(collision.triangleCount);
  });

  it('a cápsula para na parede do caixote antes e passa depois', () => {
    const {collision, crateStart, crateCount} = world();
    const start = add(deckCentre, scale(PlanetFrame.compass(up).east, -2.2));
    const step = scale(PlanetFrame.compass(up).east, 2.4);
    const blocked = collision.sweepCapsule(start, up, step, 0.32, 1.8, 0.5);
    expect(blocked).toBeDefined();
    expect(blocked!.triangle).toBeGreaterThanOrEqual(crateStart);

    collision.disableTriangles(crateStart, crateCount);
    expect(collision.sweepCapsule(start, up, step, 0.32, 1.8, 0.5)).toBeUndefined();
  });

  it('o contato de desencrave ignora o que foi destruído', () => {
    const {collision, crateStart, crateCount} = world();
    // Cápsula enfiada dentro do bloco.
    const inside = add(deckCentre, scale(up, 0.2));
    expect(collision.deepestContact(inside, up, 0.4, 1.2)).toBeDefined();
    collision.disableTriangles(crateStart, crateCount);
    const after = collision.deepestContact(inside, up, 0.4, 1.2);
    // Sobra só o convés sob os pés, que não encrava ninguém.
    expect(after?.depth ?? 0).toBeLessThan(0.45);
  });

  it('não reconstrói nada: a árvore e a contagem de triângulos ficam intactas', () => {
    const {collision, crateStart, crateCount} = world();
    const total = collision.triangleCount;
    collision.disableTriangles(crateStart, crateCount);
    expect(collision.triangleCount).toBe(total);
    expect(collision.disabledCount).toBe(crateCount);
    expect(collision.ready).toBe(true);
  });

  it('desativar duas vezes não conta duas vezes, e a restauração devolve o mundo', () => {
    const {collision, crateStart, crateCount} = world();
    expect(collision.disableTriangles(crateStart, crateCount)).toBe(crateCount);
    expect(collision.disableTriangles(crateStart, crateCount)).toBe(0);
    expect(collision.disabledCount).toBe(crateCount);

    expect(collision.enableTriangles(crateStart, crateCount)).toBe(crateCount);
    expect(collision.disabledCount).toBe(0);
    const restored = collision.raycast(above(6), down, 12);
    expect(restored!.triangle).toBeGreaterThanOrEqual(crateStart);
  });

  it('intervalo fora do buffer é recortado em vez de estourar', () => {
    const {collision} = world();
    const total = collision.triangleCount;
    expect(collision.disableTriangles(total - 3, 999)).toBe(3);
    // Início negativo encolhe a janela; não escorrega para o começo da malha e apaga chão alheio.
    expect(collision.disableTriangles(-50, 10)).toBe(0);
    collision.clearDisabledTriangles();
    expect(collision.disabledCount).toBe(0);
    expect(collision.disableTriangles(0, 0)).toBe(0);
  });

  it('`setGeometry` zera a máscara: mapa novo, mundo inteiro', () => {
    const {collision, crateStart, crateCount} = world();
    collision.disableTriangles(crateStart, crateCount);
    const soup = new TriangleSoup();
    islandDeck(soup, frame, {x: 1, y: 0, z: 0});
    collision.setGeometry(soup.positions, soup.indices);
    expect(collision.disabledCount).toBe(0);
  });
});
