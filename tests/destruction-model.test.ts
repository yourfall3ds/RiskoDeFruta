import {describe, expect, it} from 'vitest';
import {
  DESTRUCTIBLE_PROFILES, DestructibleState, DestructionField, parseDestructibles, totalTriangles,
  type DestructibleRecord,
} from '../src/destruction';

/**
 * Vida, estágios e busca — a parte do subsistema que não tem cena nem Babylon.
 *
 * O teste cobra o CONTRATO do manifesto (`.temp/destruction-api.md`) e o balanceamento em tiros de
 * pistola, que é a unidade que o jogador sente. Mudar `DESTRUCTIBLE_PROFILES` sem mexer aqui é
 * mudar o jogo sem perceber.
 */

const PISTOL = 12;

const record = (over: Partial<DestructibleRecord> = {}): DestructibleRecord => ({
  id: 'crate-1',
  nodeName: 'Crate_01',
  kind: 'crate',
  centre: {x: 0, y: 180, z: 0},
  extents: {x: 0.5, y: 0.5, z: 0.5},
  up: {x: 0, y: 1, z: 0},
  triangleStart: 100,
  triangleCount: 12,
  components: [],
  ...over,
});

describe('parseDestructibles — contrato do manifesto', () => {
  it('aceita a chave ausente sem erro: o build de hoje continua válido', () => {
    expect(parseDestructibles(undefined).records).toHaveLength(0);
    expect(parseDestructibles(undefined).warnings).toHaveLength(0);
  });

  it('lê um registro completo e normaliza o `up`', () => {
    const {records, warnings} = parseDestructibles([{
      id: 'barrel-2', nodeName: 'Barrel_02', kind: 'barrel',
      centre: {x: 0, y: 200, z: 0}, extents: {x: 0.4, y: 0.6, z: 0.4},
      triangleStart: 10, triangleCount: 40,
    }], {centre: {x: 0, y: 0, z: 0}, triangleTotal: 1000});
    expect(warnings).toHaveLength(0);
    expect(records).toHaveLength(1);
    // Sem `up` no arquivo, o parser deduz a radial a partir do centro do planeta.
    expect(records[0]!.up).toEqual({x: 0, y: 1, z: 0});
  });

  it('recusa o registro ruim e mantém os bons — um barril mal exportado não derruba o mapa', () => {
    const {records, warnings} = parseDestructibles([
      {id: 'ok', nodeName: 'A', kind: 'crate', centre: {x: 0, y: 1, z: 0}, extents: {x: 1, y: 1, z: 1}, triangleStart: 0, triangleCount: 10},
      {id: 'sem-tipo', nodeName: 'B', kind: 'tanque', centre: {x: 0, y: 1, z: 0}, extents: {x: 1, y: 1, z: 1}, triangleStart: 20, triangleCount: 10},
      {id: 'fora', nodeName: 'C', kind: 'rock', centre: {x: 0, y: 1, z: 0}, extents: {x: 1, y: 1, z: 1}, triangleStart: 990, triangleCount: 40},
      {id: 'ok', nodeName: 'D', kind: 'rock', centre: {x: 0, y: 1, z: 0}, extents: {x: 1, y: 1, z: 1}, triangleStart: 40, triangleCount: 10},
    ], {triangleTotal: 1000});
    expect(records.map(r => r.nodeName)).toEqual(['A']);
    expect(warnings).toHaveLength(3);
    expect(warnings.join(' ')).toContain('tanque');
    expect(warnings.join(' ')).toContain('1030');   // intervalo além dos 1000 triângulos da malha
    expect(warnings.join(' ')).toContain('repetido');
  });

  it('recusa intervalos sobrepostos: dois donos do mesmo triângulo quebrariam a restauração', () => {
    const {records, warnings} = parseDestructibles([
      {id: 'a', nodeName: 'A', kind: 'crate', centre: {x: 0, y: 1, z: 0}, extents: {x: 1, y: 1, z: 1}, triangleStart: 0, triangleCount: 30},
      {id: 'b', nodeName: 'B', kind: 'crate', centre: {x: 0, y: 1, z: 0}, extents: {x: 1, y: 1, z: 1}, triangleStart: 20, triangleCount: 30},
    ]);
    expect(records).toHaveLength(1);
    expect(warnings[0]).toContain('sobrepõe');
  });

  it('exige componente contido no pai e sem sobreposição entre irmãos', () => {
    const {records, warnings} = parseDestructibles([{
      id: 'barn', nodeName: 'Barn', kind: 'structure',
      centre: {x: 0, y: 1, z: 0}, extents: {x: 8, y: 5, z: 8},
      triangleStart: 100, triangleCount: 300,
      components: [
        {nodeName: 'Barn_roof', triangleStart: 100, triangleCount: 100},
        {nodeName: 'Barn_wall', triangleStart: 150, triangleCount: 100},   // sobrepõe o telhado
        {nodeName: 'Barn_out', triangleStart: 500, triangleCount: 10},     // fora do pai
        {nodeName: 'Barn_frame', triangleStart: 200, triangleCount: 100},
      ],
    }]);
    expect(records[0]!.components.map(c => c.nodeName)).toEqual(['Barn_roof', 'Barn_frame']);
    expect(warnings).toHaveLength(2);
  });

  it('avisa quando o prop não tem malha: quebra só a colisão', () => {
    const {records, warnings} = parseDestructibles([
      {id: 'sem-malha', kind: 'rock', centre: {x: 0, y: 1, z: 0}, extents: {x: 1, y: 1, z: 1}, triangleStart: 0, triangleCount: 4},
    ]);
    expect(records).toHaveLength(1);
    expect(warnings[0]).toContain('nodeName');
  });
});

describe('DestructibleState — vida por tipo', () => {
  it('a caixa abre em três tiros de pistola e o barril em quatro', () => {
    expect(Math.ceil(DESTRUCTIBLE_PROFILES.crate.health / PISTOL)).toBe(3);
    expect(Math.ceil(DESTRUCTIBLE_PROFILES.barrel.health / PISTOL)).toBe(4);
    // Pedra e árvore custam o suficiente para o acúmulo de marcas ser lido como progresso.
    expect(Math.ceil(DESTRUCTIBLE_PROFILES.rock.health / PISTOL)).toBe(10);
    expect(Math.ceil(DESTRUCTIBLE_PROFILES.tree.health / PISTOL)).toBe(13);
  });

  it('acumula estágios antes de quebrar', () => {
    const state = new DestructibleState(record({kind: 'rock', triangleCount: 40}));
    const stages: number[] = [];
    while (!state.broken) stages.push(state.damage(PISTOL).stage);
    expect(stages[0]).toBe(0);                       // primeiro tiro ainda não marca
    expect(Math.max(...stages.slice(0, -1))).toBeGreaterThan(0);
    expect(stages.at(-1)).toBe(DESTRUCTIBLE_PROFILES.rock.stages);
    expect(state.health).toBe(0);
  });

  it('dano em corpo já quebrado não faz nada — 21 raios do especial não disparam 21 quebras', () => {
    const state = new DestructibleState(record());
    state.damage(1000);
    const again = state.damage(1000);
    expect(again.alreadyBroken).toBe(true);
    expect(again.broke).toBe(false);
    expect(again.absorbed).toBe(0);
  });

  it('a estrutura derruba componentes no caminho e todos no fim', () => {
    const state = new DestructibleState(record({
      kind: 'structure', triangleStart: 0, triangleCount: 300,
      components: [
        {nodeName: 'a', triangleStart: 0, triangleCount: 100},
        {nodeName: 'b', triangleStart: 100, triangleCount: 100},
        {nodeName: 'c', triangleStart: 200, triangleCount: 100},
      ],
    }));
    const felled: number[] = [];
    let steps = 0;
    while (!state.broken && steps++ < 200) felled.push(...state.damage(PISTOL).felled);
    expect(felled).toEqual([0, 1, 2]);
    expect(state.felled).toBe(3);
    // Nunca todos antes da quebra: o último marco é reservado para o desabamento.
    const half = new DestructibleState(record({
      kind: 'structure', triangleCount: 300,
      components: [{nodeName: 'a', triangleStart: 100, triangleCount: 100}, {nodeName: 'b', triangleStart: 200, triangleCount: 100}],
    }));
    half.damage(DESTRUCTIBLE_PROFILES.structure.health * 0.6);
    expect(half.broken).toBe(false);
    expect(half.standing).toBeGreaterThan(0);
  });

  it('`reset` devolve o corpo inteiro', () => {
    const state = new DestructibleState(record());
    state.damage(1000);
    state.reset();
    expect(state.broken).toBe(false);
    expect(state.health).toBe(DESTRUCTIBLE_PROFILES.crate.health);
    expect(state.stage).toBe(0);
  });
});

describe('DestructionField — achar o prop atingido', () => {
  const field = new DestructionField([
    record({id: 'crate', triangleStart: 100, triangleCount: 12}),
    record({
      id: 'barn', kind: 'structure', centre: {x: 40, y: 180, z: 0}, extents: {x: 6, y: 4, z: 6},
      triangleStart: 200, triangleCount: 300,
      components: [
        {nodeName: 'Barn_roof', triangleStart: 220, triangleCount: 40},
        {nodeName: 'Barn_frame', triangleStart: 300, triangleCount: 80},
      ],
    }),
    record({id: 'rock', kind: 'rock', centre: {x: 3, y: 180, z: 0}, triangleStart: 600, triangleCount: 50}),
  ]);

  it('acha o dono do triângulo', () => {
    expect(field.byTriangle(105)?.state.id).toBe('crate');
    expect(field.byTriangle(610)?.state.id).toBe('rock');
  });

  it('o componente ganha do pai: acerto no telhado é do telhado', () => {
    const roof = field.byTriangle(230);
    expect(roof?.state.id).toBe('barn');
    expect(roof?.component).toBe(0);
    const body = field.byTriangle(210);
    expect(body?.state.id).toBe('barn');
    expect(body?.component).toBe(-1);
  });

  it('triângulo de terreno não pertence a ninguém', () => {
    expect(field.byTriangle(0)).toBeUndefined();
    expect(field.byTriangle(150)).toBeUndefined();
    expect(field.byTriangle(999999)).toBeUndefined();
    expect(field.byTriangle(-1)).toBeUndefined();
  });

  it('acha por posição quando o acerto não traz triângulo', () => {
    expect(field.atPoint({x: 0.2, y: 180.1, z: 0})?.id).toBe('crate');
    expect(field.atPoint({x: 3.1, y: 180, z: 0})?.id).toBe('rock');
    expect(field.atPoint({x: 100, y: 0, z: 100})).toBeUndefined();
  });

  it('lista vizinhos por distância, para dano em área', () => {
    const near = field.near({x: 0, y: 180, z: 0}, 5).map(state => state.id);
    expect(near).toEqual(['crate', 'rock']);
  });

  it('conta os triângulos marcados', () => {
    expect(totalTriangles([...field.all].map(state => state.record))).toBe(12 + 300 + 50);
  });
});
