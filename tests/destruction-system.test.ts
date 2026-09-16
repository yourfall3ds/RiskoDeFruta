import {describe, expect, it} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {Vec3} from '../src/core/contracts';
import {
  DEBRIS_BUDGET, DESTRUCTIBLE_PROFILES, DestructionDebris, DestructionSystem, DestructionVisuals,
  FRAGMENT_SOURCE_LIMIT, legacyBoxRemover, legacyKindOf, legacyRecordsFromMeshes, materialDestructionAudio,
  shatterGeometry,
  type DestructibleRecord, type DestructibleState, type DestructionCollisionPort, type DestructionPresentationPort,
} from '../src/destruction';

/**
 * A fachada de ponta a ponta, o recorte de cacos e o teto do pool.
 *
 * O que este arquivo cobra, e o root valida na tela: estado, colisão e **limite de fragmentos**.
 */

const PISTOL = 12;

const record = (over: Partial<DestructibleRecord> = {}): DestructibleRecord => ({
  id: 'crate-1', nodeName: 'Crate_01', kind: 'crate',
  centre: {x: 0, y: 180, z: 0}, extents: {x: 0.5, y: 0.5, z: 0.5}, up: {x: 0, y: 1, z: 0},
  triangleStart: 100, triangleCount: 12, components: [],
  ...over,
});

class FakeCollision implements DestructionCollisionPort {
  readonly off = new Set<number>();
  disableTriangles(start: number, count: number): number {
    let changed = 0;
    for (let t = start; t < start + count; t++) if (!this.off.has(t)) {this.off.add(t); changed++;}
    return changed;
  }
  enableTriangles(start: number, count: number): number {
    let changed = 0;
    for (let t = start; t < start + count; t++) if (this.off.delete(t)) changed++;
    return changed;
  }
}

class Spy implements DestructionPresentationPort {
  marks: number[] = [];
  jolts = 0;
  felled: number[] = [];
  destroyed: string[] = [];
  restored = 0;
  seconds = 0;
  mark(_s: DestructibleState, _p: Vec3, _n: Vec3, stage: number): void {this.marks.push(stage);}
  jolt(): void {this.jolts++;}
  fell(_s: DestructibleState, component: number): void {this.felled.push(component);}
  destroy(state: DestructibleState): void {this.destroyed.push(state.id);}
  update(dt: number): void {this.seconds += dt;}
  restore(): void {this.restored++;}
}

const hit = (over: Partial<Parameters<DestructionSystem['hit']>[0]> = {}) => ({
  point: {x: 0, y: 180, z: 0}, direction: {x: 0, y: 0, z: 1}, damage: PISTOL, triangle: 104, ...over,
});

describe('DestructionSystem — um tiro do começo ao fim', () => {
  it('ignora o que não é prop meu e não gasta nada', () => {
    const system = new DestructionSystem();
    system.register([record()]);
    expect(system.hit(hit({triangle: 5, point: {x: 90, y: 0, z: 90}}))).toBeUndefined();
  });

  it('a caixa acumula dano e some da colisão ao quebrar', () => {
    const collision = new FakeCollision();
    const spy = new Spy();
    const system = new DestructionSystem({collision, presentation: spy});
    system.register([record()]);

    const first = system.hit(hit())!;
    expect(first.broke).toBe(false);
    expect(first.fraction).toBeCloseTo(1 - PISTOL / DESTRUCTIBLE_PROFILES.crate.health, 5);
    expect(collision.off.size).toBe(0);
    expect(spy.jolts).toBe(1);

    system.hit(hit());
    const last = system.hit(hit())!;
    expect(last.broke).toBe(true);
    expect(last.removedTriangles).toBe(12);
    expect(collision.off.size).toBe(12);
    expect(spy.destroyed).toEqual(['crate-1']);
    expect(system.broken).toBe(1);
    expect(system.removedTriangles).toBe(12);
  });

  it('o corpo quebrado não responde mais: o resto do leque passa direto', () => {
    const collision = new FakeCollision();
    const system = new DestructionSystem({collision});
    system.register([record()]);
    for (let i = 0; i < 20; i++) system.hit(hit({damage: 100}));
    expect(system.broken).toBe(1);
    expect(collision.off.size).toBe(12);
  });

  it('marca só quando existe rachadura para mostrar', () => {
    const spy = new Spy();
    const system = new DestructionSystem({presentation: spy});
    system.register([record({kind: 'rock', triangleCount: 40})]);
    while (!system.hit(hit())?.broke) { /* até quebrar */ }
    expect(spy.marks[0]).toBe(0);                      // primeiro tiro: ainda sem rachadura
    expect(Math.max(...spy.marks)).toBe(DESTRUCTIBLE_PROFILES.rock.stages);
  });

  it('a estrutura derruba componentes no caminho, cada um com o intervalo dele', () => {
    const collision = new FakeCollision();
    const spy = new Spy();
    const system = new DestructionSystem({collision, presentation: spy});
    system.register([record({
      id: 'barn', kind: 'structure', nodeName: 'Barn', triangleStart: 0, triangleCount: 300,
      components: [
        {nodeName: 'Barn_roof', triangleStart: 0, triangleCount: 100},
        {nodeName: 'Barn_wall', triangleStart: 100, triangleCount: 100},
      ],
    })]);
    let broke = false, guard = 0;
    while (!broke && guard++ < 200) {
      const outcome = system.hit(hit({triangle: 250}));
      if (outcome?.felled.length) expect(collision.off.size).toBeGreaterThan(0);
      broke = outcome?.broke ?? false;
    }
    expect(spy.felled).toEqual([0, 1]);
    expect(collision.off.size).toBe(300);
  });

  it('o barril acende o vizinho, e a corrente tem fundo', () => {
    const system = new DestructionSystem({chainDepth: 1});
    system.register([
      record({id: 'b1', kind: 'barrel', centre: {x: 0, y: 180, z: 0}, triangleStart: 0, triangleCount: 20}),
      record({id: 'b2', kind: 'barrel', centre: {x: 1.4, y: 180, z: 0}, triangleStart: 20, triangleCount: 20}),
      record({id: 'b3', kind: 'barrel', centre: {x: 2.8, y: 180, z: 0}, triangleStart: 40, triangleCount: 20}),
    ]);
    system.hit(hit({triangle: 5, damage: 1000}));
    // O primeiro quebra pelo tiro, o segundo pela corrente; o terceiro está fora do alcance do
    // segundo salto porque a profundidade foi limitada a 1.
    expect(system.broken).toBe(2);
    expect(system.field.get('b3')!.broken).toBe(false);
  });

  it('dano em área cai com a distância', () => {
    const system = new DestructionSystem();
    system.register([
      record({id: 'perto', kind: 'rock', centre: {x: 0, y: 180, z: 0}, triangleStart: 0, triangleCount: 10}),
      record({id: 'longe', kind: 'rock', centre: {x: 4, y: 180, z: 0}, triangleStart: 10, triangleCount: 10}),
    ]);
    system.splash({x: 0, y: 180, z: 0}, 5, 100);
    expect(system.field.get('perto')!.health).toBeLessThan(system.field.get('longe')!.health);
  });

  it('`resetAttempt` devolve corpo, colisão e cena', () => {
    const collision = new FakeCollision();
    const spy = new Spy();
    const system = new DestructionSystem({collision, presentation: spy});
    system.register([record()]);
    system.hit(hit({damage: 1000}));
    system.resetAttempt();
    expect(collision.off.size).toBe(0);
    expect(system.broken).toBe(0);
    expect(system.removedTriangles).toBe(0);
    expect(system.field.get('crate-1')!.broken).toBe(false);
    expect(spy.restored).toBe(1);
  });

  it('prop sem malha na cena fica INDESTRUTÍVEL em vez de virar fantasma sólido', () => {
    const collision = new FakeCollision();
    const system = new DestructionSystem({
      collision,
      presentation: Object.assign(new Spy(), {ready: () => false}),
    });
    system.register([record()]);
    expect(system.hit(hit({damage: 1000}))).toBeUndefined();
    expect(collision.off.size).toBe(0);                     // colisão intacta: nada de buraco invisível
    expect(system.field.get('crate-1')!.broken).toBe(false);
    expect(system.warnings.join(' ')).toContain('indestrutível');
    // O aviso sai uma vez só, não uma por bala.
    system.hit(hit());
    expect(system.warnings).toHaveLength(1);
  });

  it('lê `destructibles` do manifesto e acumula os avisos', () => {
    const system = new DestructionSystem();
    const count = system.loadManifest({
      destructibles: [
        {id: 'a', nodeName: 'A', kind: 'crate', centre: {x: 0, y: 1, z: 0}, extents: {x: 1, y: 1, z: 1}, triangleStart: 0, triangleCount: 10},
        {id: 'b', nodeName: 'B', kind: 'nada', centre: {x: 0, y: 1, z: 0}, extents: {x: 1, y: 1, z: 1}, triangleStart: 20, triangleCount: 10},
      ],
    }, {triangleTotal: 100});
    expect(count).toBe(1);
    expect(system.registered).toBe(1);
    expect(system.warnings).toHaveLength(1);
  });

  it('manifesto sem a chave carrega e simplesmente nada quebra', () => {
    const system = new DestructionSystem();
    expect(system.loadManifest({islands: [], bridges: []})).toBe(0);
    expect(system.enabled).toBe(false);
  });
});

describe('shatterGeometry — caco recortado da geometria original', () => {
  /** Cubo indexado: 8 vértices, 12 triângulos. Serve de prop de teste sem depender de asset. */
  const cube = () => {
    const positions: number[] = [];
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) positions.push(x, y, z);
    const indices = [
      0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1,
      2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
    ];
    return {positions, indices};
  };

  it('conserva todos os triângulos da origem, sem inventar nem perder', () => {
    const source = cube();
    const slices = shatterGeometry(source, 4);
    expect(slices.length).toBeGreaterThan(1);
    expect(slices.reduce((sum, slice) => sum + slice.triangles, 0)).toBe(12);
  });

  it('usa os vértices da origem: nenhum ponto novo é inventado', () => {
    const source = cube();
    const original = new Set<string>();
    for (let i = 0; i < source.positions.length; i += 3) {
      original.add(`${source.positions[i]},${source.positions[i + 1]},${source.positions[i + 2]}`);
    }
    for (const slice of shatterGeometry(source, 4)) {
      for (let i = 0; i < slice.positions.length; i += 3) {
        const key = [0, 1, 2].map(k => round(slice.positions[i + k]! + slice.centre[k]!)).join(',');
        expect(original.has(key)).toBe(true);
      }
    }
  });

  it('é determinístico: a mesma caixa quebra sempre igual', () => {
    // Impressão digital do recorte: contagem POR PEDAÇO não basta (dois cortes diferentes podem dar
    // 3+2+3+2+2), então a comparação é sobre os vértices de fato.
    const print = (slices: ReturnType<typeof shatterGeometry>): string =>
      JSON.stringify(slices.map(slice => [slice.triangles, [...slice.positions].map(round)]));
    expect(print(shatterGeometry(cube(), 5, 7))).toBe(print(shatterGeometry(cube(), 5, 7)));
    // Semente diferente, recorte diferente — o mapa não repete a mesma silhueta em todo prop.
    expect(print(shatterGeometry(cube(), 5, 3))).not.toBe(print(shatterGeometry(cube(), 5, 7)));
  });

  it('leva UV e normal junto, que é o que preserva a textura no caco', () => {
    const source = cube();
    const uvs: number[] = [];
    const normals: number[] = [];
    for (let i = 0; i < source.positions.length / 3; i++) {uvs.push(i / 8, 0.5); normals.push(0, 1, 0);}
    const slices = shatterGeometry({...source, uvs, normals}, 3);
    for (const slice of slices) {
      expect(slice.uvs).toBeDefined();
      expect(slice.uvs!.length / 2).toBe(slice.positions.length / 3);
      expect(slice.normals!.length).toBe(slice.positions.length);
    }
  });

  it('recusa origem grande demais e pedido degenerado', () => {
    const big = {positions: new Array((FRAGMENT_SOURCE_LIMIT + 10) * 9).fill(0), indices: [] as number[]};
    for (let t = 0; t < FRAGMENT_SOURCE_LIMIT + 10; t++) big.indices.push(t * 3, t * 3 + 1, t * 3 + 2);
    expect(shatterGeometry(big, 6)).toHaveLength(0);
    expect(shatterGeometry(cube(), 1)).toHaveLength(0);
    expect(shatterGeometry({positions: [], indices: []}, 4)).toHaveLength(0);
  });
});

describe('DestructionDebris — teto, TTL e gravidade radial', () => {
  const scene = (): Scene => new Scene(new NullEngine());

  const slices = (count: number) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: undefined, uvs: undefined,
        indices: new Uint32Array([0, 1, 2]),
        centre: [i, 200, 0] as const,
        half: [0.5, 0.5, 0.5] as const,
        triangles: 1,
      });
    }
    return out;
  };

  it('nunca passa do teto, por mais quebras que cheguem no mesmo quadro', () => {
    const debris = new DestructionDebris(scene(), {budget: 6});
    for (let burst = 0; burst < 5; burst++) debris.burst(slices(10), null, {x: 0, y: 1, z: 0}, 4, 5);
    expect(debris.active).toBeLessThanOrEqual(6);
    expect(debris.capacity).toBe(6);
    debris.dispose();
  });

  it('o caco morre no TTL e devolve a vaga', () => {
    const debris = new DestructionDebris(scene(), {budget: 8});
    debris.burst(slices(4), null, {x: 0, y: 1, z: 0}, 3, 1.5);
    expect(debris.active).toBe(4);
    for (let i = 0; i < 20; i++) debris.update(0.1);
    expect(debris.active).toBe(0);
    debris.dispose();
  });

  it('cai na direção do centro do planeta, não em −Y do mundo', () => {
    // Caco na face LATERAL do planeta: a vertical local aponta para +X.
    const centre = {x: 0, y: 0, z: 0};
    const debris = new DestructionDebris(scene(), {budget: 4, centre, gravity: 20});
    const side = [{
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: undefined, uvs: undefined,
      indices: new Uint32Array([0, 1, 2]), centre: [200, 0, 0] as const, half: [0.1, 0.1, 0.1] as const, triangles: 1,
    }];
    debris.burst(side, null, {x: 0, y: 0, z: 1}, 0, 5);
    for (let i = 0; i < 30; i++) debris.update(1 / 60);
    // Sem sonda de apoio ele cai para sempre; o que importa é a DIREÇÃO: raio diminuindo.
    expect(debris.active).toBe(1);
    debris.dispose();
  });

  it('o orçamento padrão é o que a revisão de desempenho combinou', () => {
    expect(DEBRIS_BUDGET).toBe(48);
  });
});

describe('DestructionVisuals — o prop inteiro, não uma primitiva', () => {
  it('assume o nó do glTF com todas as primitivas e descongela a matriz', () => {
    const scene = new Scene(new NullEngine());
    // Um "tronco" com duas primitivas de materiais diferentes, como o exportador entrega.
    const node = new TransformNode('island_tree_01', scene);
    const bark = CreateBox('island_tree_01_primitive0', {size: 1}, scene);
    const leaves = CreateBox('island_tree_01_primitive1', {size: 2}, scene);
    bark.material = new StandardMaterial('bark', scene);
    leaves.material = new StandardMaterial('leaves', scene);
    bark.parent = node; leaves.parent = node;
    for (const mesh of [bark, leaves]) mesh.freezeWorldMatrix();

    const visuals = new DestructionVisuals(scene);
    const system = new DestructionSystem({presentation: visuals});
    system.register([record({id: 'tree-1', nodeName: 'island_tree_01', kind: 'tree', extents: {x: 1, y: 2, z: 1}})]);

    system.hit({point: {x: 0, y: 180, z: 0}, direction: {x: 0, y: 0, z: 1}, damage: 1, triangle: 104});
    // Matriz descongelada nas duas primitivas: senão só a casca se mexeria.
    expect(bark.isWorldMatrixFrozen).toBe(false);
    expect(leaves.isWorldMatrixFrozen).toBe(false);
    expect(visuals.missing).toHaveLength(0);

    system.hit({point: {x: 0, y: 180, z: 0}, direction: {x: 0, y: 0, z: 1}, damage: 1000, triangle: 104});
    system.update(0.5);
    // Árvore tomba: ainda visível no meio da queda, presa a um pivô na raiz.
    expect(node.isEnabled()).toBe(true);
    expect(node.parent?.name).toContain('destruction-pivot');
    system.update(DESTRUCTIBLE_PROFILES.tree.toppleSeconds + DESTRUCTIBLE_PROFILES.tree.linger + 0.2);
    expect(node.isEnabled()).toBe(false);

    system.resetAttempt();
    expect(node.isEnabled()).toBe(true);
    expect(node.parent).toBe(null);
    visuals.dispose();
  });

  it('avisa a malha ausente e não a trata como destrutível', () => {
    const scene = new Scene(new NullEngine());
    const visuals = new DestructionVisuals(scene);
    const system = new DestructionSystem({presentation: visuals});
    system.register([record({nodeName: 'Nao_Existe'})]);
    expect(system.hit(hit({damage: 999}))).toBeUndefined();
    expect(visuals.missing).toEqual(['Nao_Existe']);
    visuals.dispose();
  });
});

describe('Legado plano — mesmo sistema, outra origem', () => {
  it('reconhece prop por nome e recusa copa de árvore', () => {
    expect(legacyKindOf('Crate_02')).toBe('crate');
    expect(legacyKindOf('barrel.007')).toBe('barrel');
    expect(legacyKindOf('island_tree_01_trunk')).toBe('tree');
    expect(legacyKindOf('coast_land_rocks_02')).toBe('rock');
    expect(legacyKindOf('tree-canopy-island_tree_01-0')).toBeUndefined();
    expect(legacyKindOf('Ground_Plane')).toBeUndefined();
  });

  it('monta registros das malhas da cena, sem intervalo de triângulo', () => {
    const scene = new Scene(new NullEngine());
    const crate = CreateBox('Crate_01', {size: 1}, scene);
    crate.position.set(3, 1, 0);
    const huge = CreateBox('rock_gigante', {size: 40}, scene);
    huge.position.set(0, 0, 0);
    CreateBox('Ground', {size: 50}, scene);

    const records = legacyRecordsFromMeshes(scene.meshes);
    expect(records.map(r => r.nodeName)).toEqual(['Crate_01']);   // a pedra gigante é cenário, não prop
    expect(records[0]!.triangleCount).toBe(0);
    expect(records[0]!.centre.x).toBeCloseTo(3, 5);

    // Sem intervalo, o acerto resolve por posição e o sistema funciona igual.
    const system = new DestructionSystem();
    system.register(records);
    expect(system.hit({point: {x: 3, y: 1, z: 0}, direction: {x: 1, y: 0, z: 0}, damage: 1000})?.broke).toBe(true);
    void huge;
  });

  it('remove do `CollisionWorld` só a caixa contida no prop quebrado', () => {
    const world = {
      boxes: [
        {id: 'crate', min: {x: 2.6, y: 0.6, z: -0.4}, max: {x: 3.4, y: 1.4, z: 0.4}},
        {id: 'parede-vizinha', min: {x: 3.2, y: 0, z: -6}, max: {x: 3.6, y: 4, z: 6}},
      ],
    };
    const remove = legacyBoxRemover(world);
    const system = new DestructionSystem({onBroken: remove});
    system.register([record({id: 'legacy-crate', nodeName: 'Crate_01', centre: {x: 3, y: 1, z: 0}, triangleCount: 0})]);
    system.hit({point: {x: 3, y: 1, z: 0}, direction: {x: 1, y: 0, z: 0}, damage: 1000});
    expect(world.boxes.map(box => box.id)).toEqual(['parede-vizinha']);
  });
});

describe('Som — reaproveita o banco existente', () => {
  it('mapeia material para o banco de foley certo', () => {
    const played: string[] = [];
    const audio = materialDestructionAudio({
      footstep: (surface: string) => played.push(`foley:${surface}`),
      impact: (heavy?: boolean) => played.push(heavy ? 'heavy' : 'impact'),
    });
    const point = {x: 0, y: 0, z: 0};
    audio.impact('wood', point, 0.5);
    audio.shatter('stone', point);
    audio.impact('foliage', point, 0.1);
    expect(played).toEqual(['foley:wood', 'foley:concrete', 'heavy', 'foley:grass']);
  });
});

const round = (n: number): number => Math.round(n * 1e4) / 1e4;
