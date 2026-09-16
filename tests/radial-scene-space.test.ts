import {describe, expect, it} from 'vitest';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlanetCollision} from '../src/planet/PlanetCollision';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import {MELEE_TUNING} from '../src/player/PlayerTuning';
import {meleeReaches} from '../src/combat/UnarmedCombat';
import {siteBiomes} from '../src/stages/StageRoute';

/** Planeta mínimo: uma casca de raio 180 e nada mais. Basta para o referencial responder. */
function spherical(): CollisionWorld {
  const world = new CollisionWorld();
  world.configurePlanet(new PlanetFrame({
    centre: {x: 0, y: 0, z: 0}, surfaceRadius: 180, voidRadius: 151, ceilingRadius: 288, islandRadius: 72,
  }), new PlanetCollision());
  return world;
}

describe('o referencial que a cena consulta', () => {
  /**
   * O defeito que este teste tranca: o mapa do planeta carrega de forma ASSÍNCRONA, e quem guardou
   * `collision.surface` no construtor ficou com o referencial PLANO para sempre — corpo deitado,
   * praga sem chão e distância medida por `hypot(dx,dz)` numa esfera.
   */
  it('quem guarda o referencial congela no plano; quem consulta por provedor acompanha', () => {
    const world = new CollisionWorld();
    const captured = world.surface;                    // como o avatar fazia antes
    const provider = () => world.surface;              // como ele faz agora
    expect(captured.kind).toBe('flat');
    expect(provider().kind).toBe('flat');

    world.configurePlanet(new PlanetFrame(), new PlanetCollision());

    expect(captured.kind).toBe('flat');                // a referência velha NÃO vira esfera
    expect(provider().kind).toBe('sphere');            // o provedor vê o planeta
  });

  it('a vertical local deixa de ser +Y assim que o planeta é configurado', () => {
    const world = spherical();
    const onEquator = {x: 180, y: 0, z: 0};
    const up = world.surface.up(onEquator);
    expect(up.x).toBeCloseTo(1, 6);
    expect(up.y).toBeCloseTo(0, 6);
  });
});

describe('alcance do combo no mapa curvo', () => {
  const step = MELEE_TUNING.steps[0]!;

  it('mede distância por arco e cone no plano tangente, não em x/z de mundo', () => {
    const surface = spherical().surface;
    // Corpo no equador em +X; a frente aponta para o norte local (+Y de mundo).
    const origin = {x: 180, y: 0, z: 0};
    const facing = {x: 0, y: 1, z: 0};
    const ahead = surface.walk(origin, {x: 0, y: step.range * 0.6, z: 0});
    const behind = surface.walk(origin, {x: 0, y: -step.range * 0.6, z: 0});

    expect(meleeReaches(step, origin, 0, ahead, 0, surface, facing)).toBe(true);
    expect(meleeReaches(step, origin, 0, behind, 0, surface, facing)).toBe(false);
  });

  /**
   * No equador o deslocamento tangente acontece em `y` de MUNDO, então o cálculo plano mede
   * `hypot(dx,dz) ≈ 0` e julga o alvo pela diferença de altura — ou seja, decide pelo eixo errado.
   * O teste trava a DISCORDÂNCIA: é ela que prova que o referencial mudou a resposta.
   */
  it('o cálculo plano discorda do referencial no mesmo par, no equador', () => {
    const surface = spherical().surface;
    const origin = {x: 180, y: 0, z: 0};
    const facing = {x: 0, y: 1, z: 0};
    const ahead = surface.walk(origin, {x: 0, y: step.range * 0.6, z: 0});
    expect(meleeReaches(step, origin, 0, ahead, 0, surface, facing)).toBe(true);
    expect(meleeReaches(step, origin, 0, ahead)).toBe(false);
  });

  it('no mundo plano o porte devolve exatamente o resultado de sempre', () => {
    const surface = new CollisionWorld().surface;
    const origin = {x: 0, y: 0, z: 0};
    const facing = {x: 0, y: 0, z: 1};
    for (const target of [{x: 0, y: 0, z: 1}, {x: 0, y: 0, z: -1}, {x: 1, y: 0, z: 1}, {x: 0, y: 3, z: 1}]) {
      expect(meleeReaches(step, origin, 0, target, 0, surface, facing))
        .toBe(meleeReaches(step, origin, 0, target));
    }
  });
});

describe('regiões nomeadas de um mapa que traz as próprias ilhas', () => {
  const sites = Array.from({length: 12}, (_, i) => {
    const angle = i / 12 * Math.PI * 2;
    return {
      id: `i${i}`, name: `Ilha ${i}`, radius: 10 + (i % 3) * 5,
      centre: {x: Math.cos(angle) * 180, y: 0, z: Math.sin(angle) * 180},
    };
  });
  const arc = (a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}) =>
    new PlanetFrame({centre: {x: 0, y: 0, z: 0}, surfaceRadius: 180, voidRadius: 151, ceilingRadius: 288, islandRadius: 72})
      .arcDistance(a, b);

  it('produz seis regiões, cada uma com a lista INTEIRA de ilhas', () => {
    const biomes = siteBiomes(sites, arc);
    expect(biomes).toHaveLength(6);
    // Restringir o sorteio ao agrupamento travaria a expedição quando a região fosse desconexa.
    for (const biome of biomes) expect(biome.islands).toHaveLength(sites.length);
  });

  it('é determinístico e escolhe sementes distintas', () => {
    const first = siteBiomes(sites, arc).map(b => b.id);
    expect(siteBiomes(sites, arc).map(b => b.id)).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it('não quebra com menos ilhas que regiões', () => {
    expect(siteBiomes(sites.slice(0, 2), arc)).toHaveLength(2);
    expect(siteBiomes([], arc)).toHaveLength(0);
  });
});
