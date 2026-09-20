import {describe, it, expect} from 'vitest';
import {ballisticLob, interceptPoint} from '../src/enemies/BallisticLob';
import type {Vec3} from '../src/core/contracts';

/**
 * O arremesso em parábola do milho artilheiro.
 *
 * O teste que importa não é o ângulo: é se o projétil CAI EM CIMA DO ALVO. Por isso quase tudo
 * aqui integra o voo passo a passo, com a mesma gravidade que a cena usa, e mede onde ele aterrissa.
 * Um solucionador que devolve um ângulo bonito e erra o alvo por três metros passaria num teste de
 * ângulo e reprovaria em jogo.
 */

const UP: Vec3 = {x: 0, y: 1, z: 0};

/** Integra o voo até cruzar a altura do alvo, e devolve onde passou. */
function fly(origin: Vec3, direction: Vec3, speed: number, gravity: number, up: Vec3, alvoY: number): Vec3 {
  const p = {...origin};
  const v = {x: direction.x * speed, y: direction.y * speed, z: direction.z * speed};
  const step = 1 / 240;
  for (let i = 0; i < 240 * 30; i++) {
    v.x -= up.x * gravity * step; v.y -= up.y * gravity * step; v.z -= up.z * gravity * step;
    const antes = p.y;
    p.x += v.x * step; p.y += v.y * step; p.z += v.z * step;
    // Cruzou a altura do alvo na descida: é aqui que o acerto é medido.
    if (v.y < 0 && antes >= alvoY && p.y <= alvoY) return p;
  }
  return p;
}

describe('arremesso em parábola', () => {
  it('cai EM CIMA do alvo, não curto', () => {
    const origem = {x: 0, y: 1.3, z: 0}, alvo = {x: 0, y: 1, z: 14};
    const solucao = ballisticLob(origem, alvo, 16, 12, UP);
    expect(solucao.reaches).toBe(true);
    const queda = fly(origem, solucao.direction, 16, 12, UP, alvo.y);
    expect(Math.hypot(queda.x - alvo.x, queda.z - alvo.z), 'erro no chão').toBeLessThan(0.4);
  });

  it('é o arco ALTO: sobe bem acima da linha reta até o alvo', () => {
    const origem = {x: 0, y: 1.3, z: 0}, alvo = {x: 0, y: 1, z: 14};
    const solucao = ballisticLob(origem, alvo, 16, 12, UP);
    // Um tiro quase reto sairia perto de 0°; o arco alto tem de subir de verdade.
    expect(solucao.elevation).toBeGreaterThan(Math.PI / 4);
    expect(solucao.direction.y, 'a componente vertical domina').toBeGreaterThan(0.6);
  });

  it('acerta alvo ACIMA e alvo ABAIXO da origem', () => {
    for (const alvoY of [4.5, -3]) {
      const origem = {x: 0, y: 1.3, z: 0}, alvo = {x: 0, y: alvoY, z: 10};
      const solucao = ballisticLob(origem, alvo, 18, 12, UP);
      expect(solucao.reaches, `alvo em y=${alvoY}`).toBe(true);
      const queda = fly(origem, solucao.direction, 18, 12, UP, alvo.y);
      expect(Math.hypot(queda.x - alvo.x, queda.z - alvo.z), `alvo em y=${alvoY}`).toBeLessThan(0.5);
    }
  });

  it('funciona fora do polo norte: a vertical é a da casca', () => {
    // No equador do planeta o `up` aponta em +X. O arco tem de subir em +X, não em +Y.
    const up: Vec3 = {x: 1, y: 0, z: 0};
    const origem = {x: 200, y: 0, z: 0}, alvo = {x: 200, y: 0, z: 12};
    const solucao = ballisticLob(origem, alvo, 16, 12, up);
    expect(solucao.reaches).toBe(true);
    expect(solucao.direction.x, 'sobe ao longo do up local').toBeGreaterThan(0.5);
    expect(Math.abs(solucao.direction.y), 'nada de +Y do mundo').toBeLessThan(0.01);
  });

  it('fora de alcance devolve 45° e avisa, em vez de travar sem atirar', () => {
    const origem = {x: 0, y: 1, z: 0}, alvo = {x: 0, y: 1, z: 400};
    const solucao = ballisticLob(origem, alvo, 16, 12, UP);
    expect(solucao.reaches, 'não alcança').toBe(false);
    expect(solucao.elevation).toBeCloseTo(Math.PI / 4, 6);
    // Ainda é uma direção utilizável: unitária e apontando para o alvo.
    expect(Math.hypot(solucao.direction.x, solucao.direction.y, solucao.direction.z)).toBeCloseTo(1, 6);
    expect(solucao.direction.z).toBeGreaterThan(0);
  });

  it('alvo na vertical vira lançamento reto para cima', () => {
    const solucao = ballisticLob({x: 0, y: 0, z: 0}, {x: 0, y: 9, z: 0}, 16, 12, UP);
    expect(solucao.direction.y).toBeCloseTo(1, 6);
  });

  it('sem gravidade continua sendo o tiro reto de sempre', () => {
    const solucao = ballisticLob({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 10}, 16, 0, UP);
    expect(solucao.elevation).toBe(0);
    expect(solucao.direction.z).toBeCloseTo(1, 6);
  });
});

describe('antecipação do alvo', () => {
  it('mira À FRENTE de quem anda de lado', () => {
    const origem = {x: 0, y: 1, z: 0}, alvo = {x: 0, y: 1, z: 15};
    const andando = {x: 6, y: 0, z: 0};
    const mira = interceptPoint(origem, alvo, andando, 16);
    expect(mira.x, 'deslocou para onde ele vai').toBeGreaterThan(3);
    expect(mira.z).toBeCloseTo(alvo.z, 6);
  });

  it('alvo parado é mirado onde está', () => {
    const alvo = {x: 2, y: 1, z: 15};
    const mira = interceptPoint({x: 0, y: 1, z: 0}, alvo, {x: 0, y: 0, z: 0}, 16);
    expect(mira).toEqual(alvo);
  });

  it('antecipação zero desliga o chumbo sem tirar o código do caminho', () => {
    const alvo = {x: 2, y: 1, z: 15};
    expect(interceptPoint({x: 0, y: 1, z: 0}, alvo, {x: 9, y: 0, z: 0}, 16, 0)).toEqual(alvo);
  });

  it('o arco antecipado ainda cai em cima de quem andou', () => {
    // Fecha o ciclo: antecipa, resolve o arco, voa, e confere contra onde o jogador REALMENTE estará.
    const origem = {x: 0, y: 1.3, z: 0}, alvo = {x: 0, y: 1, z: 14};
    const velocidade = {x: 4, y: 0, z: 0}, tiro = 17, gravidade = 12;
    const mira = interceptPoint(origem, alvo, velocidade, tiro);
    const solucao = ballisticLob(origem, mira, tiro, gravidade, UP);
    const queda = fly(origem, solucao.direction, tiro, gravidade, UP, alvo.y);
    const voo = Math.hypot(queda.x - origem.x, queda.y - origem.y, queda.z - origem.z) / tiro;
    const ondeEstara = {x: alvo.x + velocidade.x * voo, z: alvo.z + velocidade.z * voo};
    expect(Math.hypot(queda.x - ondeEstara.x, queda.z - ondeEstara.z), 'erro contra o alvo móvel').toBeLessThan(1.5);
  });
});
