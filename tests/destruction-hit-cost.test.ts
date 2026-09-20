import {describe, expect, it} from 'vitest';
import {DestructionField, DestructionSystem, type DestructibleRecord} from '../src/destruction';

/**
 * Custo do CAMINHO DE TIRO da destruição.
 *
 * O cabeçalho de `DestructionSystem` promete: "o custo de um disparo que não acerta prop nenhum é
 * uma busca binária que morre na primeira comparação". O código não cumpria — quando `byTriangle`
 * devolvia `undefined` (ou seja, em TODO tiro que acertou terreno) ele caía em `field.atPoint`, uma
 * varredura de ~64 células da grade com `Set`, `map`, `filter`, `sort` e uma string de chave por
 * célula. Com 6,6 tiros por segundo, mais os leques dos especiais, isso era trabalho por bala para
 * sempre responder "não é prop".
 *
 * Estes testes travam as duas pontas: o custo (nenhuma consulta espacial quando há triângulo) e a
 * correção (a busca por ponto continua existindo para quem não tem triângulo — soco e legado).
 */

const record = (over: Partial<DestructibleRecord> = {}): DestructibleRecord => ({
  id: 'crate-1', nodeName: 'Crate_01', kind: 'crate',
  centre: {x: 0, y: 180, z: 0}, extents: {x: 0.5, y: 0.5, z: 0.5}, up: {x: 0, y: 1, z: 0},
  triangleStart: 100, triangleCount: 12, components: [],
  ...over,
});

/** `DestructionField` com contadores nas duas entradas do índice. */
class CountingField extends DestructionField {
  byTriangleCalls = 0;
  nearCalls = 0;
  override byTriangle(triangle: number): ReturnType<DestructionField['byTriangle']> {
    this.byTriangleCalls++;
    return super.byTriangle(triangle);
  }
  override near(point: Parameters<DestructionField['near']>[0], radius: number): ReturnType<DestructionField['near']> {
    this.nearCalls++;
    return super.near(point, radius);
  }
}

function system(records: readonly DestructibleRecord[]) {
  const field = new CountingField();
  const facade = new DestructionSystem();
  // A fachada expõe `field` como `readonly`; trocar o índice por um instrumentado é o único jeito
  // de contar as consultas sem espionar por dentro do arquivo medido.
  Object.defineProperty(facade, 'field', {value: field, writable: false});
  facade.register(records);
  return {facade, field};
}

describe('custo do caminho de tiro da destruição', () => {
  it('tiro no terreno com triângulo conhecido NÃO faz varredura espacial', () => {
    const {facade, field} = system([record()]);
    // Triângulo fora de qualquer intervalo registrado: é o caso comum, o chão.
    for (let shot = 0; shot < 200; shot++) {
      expect(facade.hit({point: {x: 40, y: 180, z: 0}, direction: {x: 0, y: 0, z: 1}, damage: 12, triangle: 900_000 + shot}))
        .toBeUndefined();
    }
    expect(field.byTriangleCalls).toBe(200);
    expect(field.nearCalls).toBe(0);
  });

  it('acerto real por triângulo continua resolvendo o prop', () => {
    const {facade, field} = system([record()]);
    const outcome = facade.hit({point: {x: 0, y: 180, z: 0}, direction: {x: 0, y: 0, z: 1}, damage: 12, triangle: 104});
    expect(outcome?.id).toBe('crate-1');
    expect(field.nearCalls).toBe(0);
  });

  it('sem triângulo (soco, legado) a busca por PONTO continua sendo usada', () => {
    const {facade, field} = system([record()]);
    const outcome = facade.hit({point: {x: 0.2, y: 180, z: 0.1}, direction: {x: 0, y: 0, z: 1}, damage: 12});
    expect(outcome?.id).toBe('crate-1');
    expect(field.nearCalls).toBe(1);
    expect(field.byTriangleCalls).toBe(0);
  });

  it('a chave numérica da grade não confunde células vizinhas nem coordenadas negativas', () => {
    const field = new DestructionField([
      record({id: 'a', centre: {x: 0, y: 0, z: 0}, extents: {x: 0.4, y: 0.4, z: 0.4}, triangleStart: 0, triangleCount: 3}),
      record({id: 'b', centre: {x: -40, y: -16, z: 24}, extents: {x: 0.4, y: 0.4, z: 0.4}, triangleStart: 10, triangleCount: 3}),
      record({id: 'c', centre: {x: 24, y: -16, z: -40}, extents: {x: 0.4, y: 0.4, z: 0.4}, triangleStart: 20, triangleCount: 3}),
    ]);
    expect(field.atPoint({x: 0, y: 0, z: 0})?.id).toBe('a');
    expect(field.atPoint({x: -40, y: -16, z: 24})?.id).toBe('b');
    expect(field.atPoint({x: 24, y: -16, z: -40})?.id).toBe('c');
    // Permutação dos eixos tem de ser um endereço DIFERENTE — uma chave mal empacotada colide aqui.
    expect(field.atPoint({x: -16, y: 24, z: -40})).toBeUndefined();
    expect(field.near({x: 0, y: 0, z: 0}, 5).map(s => s.id)).toEqual(['a']);
  });

  it('`near` continua devolvendo do mais perto para o mais longe, e o buffer não vaza entre consultas', () => {
    const field = new DestructionField([
      record({id: 'near', centre: {x: 1, y: 0, z: 0}, triangleStart: 0, triangleCount: 3}),
      record({id: 'mid', centre: {x: 6, y: 0, z: 0}, triangleStart: 10, triangleCount: 3}),
      record({id: 'far', centre: {x: 11, y: 0, z: 0}, triangleStart: 20, triangleCount: 3}),
    ]);
    const first = field.near({x: 0, y: 0, z: 0}, 12);
    expect(first.map(s => s.id)).toEqual(['near', 'mid', 'far']);
    const second = field.near({x: 12, y: 0, z: 0}, 2);
    expect(second.map(s => s.id)).toEqual(['far']);
    // A consulta nova não pode ter mexido no resultado que o chamador anterior ainda segura.
    expect(first.map(s => s.id)).toEqual(['near', 'mid', 'far']);
  });
});
