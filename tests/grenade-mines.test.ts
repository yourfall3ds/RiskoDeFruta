import {describe, it, expect} from 'vitest';
import {MINE, PrismGrenades, stepGrenade, type GrenadeContact, type GrenadeWorld} from '../src/combat/PrismGrenades';
import {PRISM_GRENADE} from '../src/combat/PrismTuning';
import {PRISM_SKILLS} from '../src/combat/PrismSkills';
import type {Vec3} from '../src/core/contracts';

/**
 * CAMPO MINADO e OGIVA — as duas habilidades do lança-granadas.
 *
 * O que se prova da mina é que ela PARA e ESPERA: uma cápsula que detona no contato e uma que
 * pousa desenham o mesmo primeiro quadro, e só o segundo em diante separa as duas.
 */

/** Chão plano em `y = 0`: o segmento acusa contato quando o trecho cruza para baixo. */
function chao(): GrenadeWorld {
  return {
    up: () => ({x: 0, y: 1, z: 0}),
    segment(from: Vec3, to: Vec3): GrenadeContact | undefined {
      if (!(from.y > 0 && to.y <= 0)) return undefined;
      const t = from.y / (from.y - to.y);
      return {point: {x: from.x + (to.x - from.x) * t, y: 0, z: from.z + (to.z - from.z) * t}, normal: {x: 0, y: 1, z: 0}};
    },
  };
}

const MINA = {radiusScale: 1, damageScale: 1, incendiary: false, attackId: 'qa_mina', mine: true};

describe('campo minado', () => {
  it('a cápsula POUSA em vez de detonar, e fica onde encostou', () => {
    let detonou = 0;
    const granadas = new PrismGrenades(chao(), () => {detonou++;});
    granadas.launch({x: 0, y: 2, z: 0}, {x: 0, y: -1, z: .2}, 10, MINA);
    for (let i = 0; i < 60; i++) granadas.update(1 / 60);
    expect(detonou, 'não explodiu no contato').toBe(0);
    expect(granadas.count, 'continua viva na lista').toBe(1);
    const mina = granadas.live[0]!;
    expect(mina.armed).toBe(true);
    // Pousada um dedo acima da superfície, não enterrada nem afundando quadro a quadro.
    expect(mina.position.y).toBeCloseTo(MINE.lift, 5);
    const onde = {...mina.position};
    for (let i = 0; i < 120; i++) granadas.update(1 / 60);
    expect(mina.position, 'não escorrega nem afunda').toEqual(onde);
  });

  it('o estopim de VOO não mata a mina: ela espera muito mais', () => {
    const granadas = new PrismGrenades(chao(), () => {});
    granadas.launch({x: 0, y: 2, z: 0}, {x: 0, y: -1, z: 0}, 10, MINA);
    for (let i = 0; i < 30; i++) granadas.update(1 / 60);
    // Bem além dos 3,2 s de estopim de voo, e ainda de pé.
    for (let i = 0; i < 60 * 8; i++) granadas.update(1 / 60);
    expect(granadas.count).toBe(1);
    expect(PRISM_GRENADE.fuseSeconds).toBeLessThan(MINE.armedSeconds);
  });

  it('a espera termina em EXPLOSÃO, não em sumiço', () => {
    let detonou = 0;
    const granadas = new PrismGrenades(chao(), () => {detonou++;});
    granadas.launch({x: 0, y: 2, z: 0}, {x: 0, y: -1, z: 0}, 10, MINA);
    for (let i = 0; i < 60 * (MINE.armedSeconds + 2); i++) granadas.update(1 / 60);
    expect(detonou, 'munição gasta sempre vira explosão').toBe(1);
    expect(granadas.count).toBe(0);
  });

  it('bater num CORPO detona na hora — mina não ricocheteia em hostil', () => {
    let detonou = 0;
    const mundo: GrenadeWorld = {
      up: () => ({x: 0, y: 1, z: 0}),
      segment: (_from, to) => (to.z >= 3 ? {point: {x: 0, y: 1, z: 3}, normal: {x: 0, y: 0, z: -1}, targetId: 7} : undefined),
    };
    const granadas = new PrismGrenades(mundo, () => {detonou++;});
    granadas.launch({x: 0, y: 1, z: 0}, {x: 0, y: 0, z: 1}, 30, MINA);
    // A 30 m/s ela anda meio metro por quadro: o corpo em z=3 está a alguns passos de distância.
    for (let i = 0; i < 20 && granadas.count > 0; i++) granadas.update(1 / 60);
    expect(detonou).toBe(1);
    expect(granadas.count).toBe(0);
  });

  it('detonar de fora tira a mina da lista UMA vez', () => {
    let detonou = 0;
    const granadas = new PrismGrenades(chao(), () => {detonou++;});
    const mina = granadas.launch({x: 0, y: 2, z: 0}, {x: 0, y: -1, z: 0}, 10, MINA);
    for (let i = 0; i < 60; i++) granadas.update(1 / 60);
    expect(granadas.detonateNow(mina.id), 'primeira chamada acerta').toBe(true);
    expect(granadas.detonateNow(mina.id), 'segunda não encontra mais').toBe(false);
    expect(detonou, 'uma explosão, não duas').toBe(1);
  });

  it('a cápsula COMUM continua detonando no contato', () => {
    let detonou = 0;
    const granadas = new PrismGrenades(chao(), () => {detonou++;});
    granadas.launch({x: 0, y: 2, z: 0}, {x: 0, y: -1, z: 0}, 10);
    for (let i = 0; i < 60; i++) granadas.update(1 / 60);
    expect(detonou, 'nada mudou para quem não é mina').toBe(1);
    expect(granadas.count).toBe(0);
  });

  it('o passo puro não integra corpo armado', () => {
    // É o que impede a mina de afundar: a gravidade continuaria puxando contra um contato já feito.
    const corpo = {position: {x: 0, y: 1, z: 0}, velocity: {x: 0, y: 0, z: 0}, fuse: 5, travelled: 0, armed: true};
    const passo = stepGrenade(chao(), corpo, 1 / 60);
    expect(passo.state).toBe('armed');
    expect(corpo.position.y, 'não caiu').toBe(1);
    expect(corpo.velocity.y, 'não acelerou').toBe(0);
  });
});

describe('as duas habilidades do lança-granadas', () => {
  const minado = PRISM_SKILLS[2][2], ogiva = PRISM_SKILLS[2][3];

  it('a II monta um campo de minas', () => {
    expect(minado.name).toBe('CAMPO MINADO');
    expect(minado.mine).toBe(true);
    expect(minado.shots).toBe(4);
    // Abaixo do teto de cápsulas vivas: o campo montado não expulsa o disparo comum.
    expect(minado.shots).toBeLessThan(PRISM_GRENADE.maxLive);
    expect(minado.fanDegrees, 'abre em leque para cobrir passagem').toBeGreaterThan(0);
  });

  it('a III é UMA ogiva pesada, não uma salva', () => {
    expect(ogiva.name).toBe('OGIVA');
    expect(ogiva.shots, 'peso, não cobertura').toBe(1);
    expect(ogiva.fanDegrees).toBe(0);
    expect(ogiva.forceScale, 'cem vezes a força do estilhaço comum').toBe(100);
    expect(ogiva.missile, 'corpo de míssil, reconhecível em voo').toBe(true);
    // Gasta o carregador inteiro: é o preço do tiro único.
    expect(ogiva.ammoCost).toBe(5);
  });

  it('nenhuma das duas é mina E ogiva ao mesmo tempo', () => {
    expect(minado.missile).toBeUndefined();
    expect(ogiva.mine).toBeUndefined();
  });
});
