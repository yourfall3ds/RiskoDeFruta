import {describe, it, expect} from 'vitest';
import {GroundFireField, GROUND_FIRE, type BurnableBody} from '../src/combat/GroundFire';
import {markStrikeTargets, PRISM_SKILLS, PrismSkillRunner, type PrismSkillPlan} from '../src/combat/PrismSkills';
import {enemyImpact} from '../src/enemies/EnemyImpact';
import type {DamageContext} from '../src/core/contracts';

const UP = {x: 0, y: 1, z: 0};
const body = (id: number, x: number, y = 0, z = 0): BurnableBody => ({id, position: {x, y, z}});

/** Avança o campo em passos de um quadro, somando o dano por id. */
function burn(field: GroundFireField, seconds: number, bodies: readonly BurnableBody[]): Map<number, number> {
  const total = new Map<number, number>();
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step)
    field.update(step, bodies, (b, amount) => total.set(b.id, (total.get(b.id) ?? 0) + amount));
  return total;
}

describe('chão em chamas', () => {
  it('cobra o dano por segundo contratado a quem fica dentro, e nada a quem está fora', () => {
    const field = new GroundFireField();
    field.ignite({x: 0, y: 0, z: 0}, UP, 3);
    // Um dentro do raio, um logo fora.
    const total = burn(field, GROUND_FIRE.seconds, [body(1, 1.5), body(2, 4)]);
    const expected = GROUND_FIRE.damagePerSecond * GROUND_FIRE.seconds;
    // Tolerância de um pulso: o último pode cair junto com a morte da poça.
    expect(total.get(1)!).toBeGreaterThan(expected * 0.8);
    expect(total.get(1)!).toBeLessThanOrEqual(expected + GROUND_FIRE.damagePerSecond * GROUND_FIRE.tickSeconds);
    expect(total.get(2)).toBeUndefined();
  });

  it('apaga sozinho e para de cobrar', () => {
    const field = new GroundFireField();
    field.ignite({x: 0, y: 0, z: 0}, UP, 3);
    burn(field, GROUND_FIRE.seconds + 1, [body(1, 0)]);
    expect(field.count).toBe(0);
    // Depois de apagada, mais tempo não tira mais vida de ninguém.
    expect(burn(field, 2, [body(1, 0)]).size).toBe(0);
  });

  it('mede a distância NO CHÃO: quem voa sobre a poça queima', () => {
    // É o caso do tomate voador. Em linha reta ele estaria a 2,5 m do centro e escaparia de um raio
    // de 2; no plano tangente ele está no meio da poça.
    const field = new GroundFireField();
    field.ignite({x: 0, y: 0, z: 0}, UP, 2);
    const total = burn(field, 1, [body(1, 0.2, 2.5, 0)]);
    expect(total.get(1)).toBeGreaterThan(0);
  });

  it('funciona fora do polo norte: a vertical local é a da casca, não +Y', () => {
    // No equador do planeta o `up` aponta em +X. Um corpo deslocado ao longo do `up` continua
    // dentro da poça; um deslocado no plano tangente sai dela.
    const field = new GroundFireField();
    field.ignite({x: 200, y: 0, z: 0}, {x: 1, y: 0, z: 0}, 2);
    const acima = burn(field, 1, [body(1, 203, 0, 0)]);
    expect(acima.get(1), 'acima da poça, ao longo do up local').toBeGreaterThan(0);
    const field2 = new GroundFireField();
    field2.ignite({x: 200, y: 0, z: 0}, {x: 1, y: 0, z: 0}, 2);
    const aoLado = burn(field2, 1, [body(2, 200, 5, 0)]);
    expect(aoLado.get(2), 'a 5 m no plano tangente').toBeUndefined();
  });

  it('respeita o teto de poças, descartando a mais velha', () => {
    const field = new GroundFireField();
    for (let i = 0; i < GROUND_FIRE.limit + 4; i++) field.ignite({x: i * 20, y: 0, z: 0}, UP, 2);
    expect(field.count).toBe(GROUND_FIRE.limit);
    // A primeira posição sobrevivente é a que o teto deixou entrar, não a de índice zero.
    expect(field.patches[0]!.centre.x).toBe(4 * 20);
  });

  it('recusa raio ou duração inválidos em vez de criar poça eterna', () => {
    const field = new GroundFireField();
    expect(field.ignite({x: 0, y: 0, z: 0}, UP, 0)).toBeUndefined();
    expect(field.ignite({x: 0, y: 0, z: 0}, UP, 3, 1, 0)).toBeUndefined();
    expect(field.ignite({x: NaN, y: 0, z: 0}, UP, 3)).toBeUndefined();
    expect(field.count).toBe(0);
  });

  it('poças sobrepostas cobram as duas', () => {
    const field = new GroundFireField();
    field.ignite({x: 0, y: 0, z: 0}, UP, 3);
    field.ignite({x: 1, y: 0, z: 0}, UP, 3);
    const total = burn(field, 1, [body(1, 0.5)]);
    const uma = new GroundFireField();
    uma.ignite({x: 0, y: 0, z: 0}, UP, 3);
    expect(total.get(1)).toBeCloseTo(burn(uma, 1, [body(1, 0.5)]).get(1)! * 2, 5);
  });
});

describe('habilidades novas do assalto', () => {
  const beam = PRISM_SKILLS[0][2], strike = PRISM_SKILLS[0][3];

  it('a II virou feixe carregado e a III virou chuva de mísseis', () => {
    expect(beam.kind).toBe('beam');
    expect(beam.pierce, 'o feixe atravessa a fila').toBe(true);
    expect(strike.kind).toBe('strike');
    expect(strike.shots, 'três marcados, três mísseis').toBe(3);
    expect(strike.groundFire, 'o míssil queima o solo').toBe(true);
  });

  it('nada sai do cano antes de a carga fechar', () => {
    const runner = new PrismSkillRunner();
    runner.start(beam);
    let emitted = 0;
    const step = 1 / 60;
    for (let t = 0; t < beam.chargeSeconds - step * 2; t += step) runner.update(step, () => emitted++);
    expect(emitted, 'ainda carregando').toBe(0);
    expect(runner.charging).toBe(true);
    expect(runner.chargeProgress).toBeLessThan(1);
    // Passada a carga, os tiques começam a sair.
    for (let t = 0; t < beam.interval * 3; t += step) runner.update(step, () => emitted++);
    expect(emitted).toBeGreaterThan(0);
    expect(runner.charging).toBe(false);
  });

  it('o feixe entrega exatamente os tiques contratados e termina', () => {
    const runner = new PrismSkillRunner();
    runner.start(beam);
    let emitted = 0;
    for (let t = 0; t < beam.chargeSeconds + beam.interval * beam.shots + 1; t += 1 / 60)
      runner.update(1 / 60, () => emitted++);
    expect(emitted).toBe(beam.shots);
    expect(runner.active).toBe(false);
  });

  it('marca os mais próximos dentro do raio, com desempate estável', () => {
    const candidates = [
      {id: 7, distance: 30}, {id: 2, distance: 5}, {id: 9, distance: 5}, {id: 4, distance: 12},
    ];
    expect(markStrikeTargets(candidates, 3, strike.markRadius)).toEqual([2, 9, 4]);
    // Fora do raio nunca entra, nem faltando alvo.
    expect(markStrikeTargets([{id: 7, distance: 30}], 3, strike.markRadius)).toEqual([]);
    // Menos hostis que mísseis é caso normal, não erro.
    expect(markStrikeTargets([{id: 1, distance: 2}], 3, strike.markRadius)).toEqual([1]);
  });

  it('as seis habilidades continuam completas e com campos coerentes', () => {
    for (const mode of [0, 1, 2] as const)
      for (const tier of [2, 3] as const) {
        const plan: PrismSkillPlan = PRISM_SKILLS[mode][tier];
        expect(plan.chargeSeconds, plan.id).toBeGreaterThanOrEqual(0);
        expect(plan.markRadius, plan.id).toBeGreaterThanOrEqual(0);
        // Só a chuva de mísseis procura alvo; o resto vai pela mira.
        expect(plan.markRadius > 0, plan.id).toBe(plan.kind === 'strike');
      }
  });
});

describe('knockback explosivo', () => {
  const context = (tags: string[], force: number): DamageContext => ({
    attackerId: 1, victimId: 2, sourceId: 'prism_grenade', attackId: 'blast',
    baseDamage: 40, finalDamage: 40, crit: false, procCoefficient: 1, procChainDepth: 0,
    damageTags: tags, hitPosition: {x: 0, y: 1, z: 0}, hitNormal: {x: 0, y: 1, z: 0},
    forceDirection: {x: 0, y: 0, z: 1}, hitDirection: {x: 0, y: 0, z: 1}, forceMagnitude: force,
  });

  it('explosão empurra muito mais que o mesmo golpe sem a etiqueta', () => {
    const explosivo = enemyImpact(context(['explosive', 'skill'], 10), 'normal', 'eggplant', 0);
    const comum = enemyImpact(context(['bullet', 'skill'], 10), 'normal', 'eggplant', 0);
    expect(explosivo.force).toBeGreaterThan(comum.force * 2.5);
    expect(explosivo.stagger).toBe(true);
  });

  it('o teto da onda de choque é maior que o do corpo a corpo', () => {
    const explosivo = enemyImpact(context(['explosive'], 999), 'normal', 'eggplant', 0);
    const melee = enemyImpact(context(['melee'], 999), 'normal', 'eggplant', 0);
    expect(explosivo.force).toBeGreaterThan(melee.force);
  });

  it('chefe e gigante continuam resistindo na mesma proporção', () => {
    const normal = enemyImpact(context(['explosive'], 10), 'normal', 'eggplant', 0).force;
    expect(enemyImpact(context(['explosive'], 10), 'giant', 'eggplant', 0).force).toBeCloseTo(normal / 3, 5);
    expect(enemyImpact(context(['explosive'], 10), 'normal', 'boss', 0).force).toBeCloseTo(normal / 5, 5);
  });

  it('o eco de um proc de item não vira onda de choque', () => {
    // `procChainDepth > 0` é dano derivado: mantém o impulso reduzido mesmo carregando a etiqueta.
    const eco = enemyImpact({...context(['explosive'], 10), procChainDepth: 1}, 'normal', 'eggplant', 0);
    const golpe = enemyImpact(context(['explosive'], 10), 'normal', 'eggplant', 0);
    expect(eco.force).toBeLessThan(golpe.force);
  });
});
