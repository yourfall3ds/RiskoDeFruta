import { describe, it, expect } from 'vitest';
import {
  NO_TARGET, STICKY_LOCK_SECONDS, STICKY_SWITCH_RATIO,
  acquireTarget, newTargetingState, type TargetablePlayer, type TargetingState,
} from '../src/enemies/EnemyTargeting';

/**
 * A REGRA DO ALVO GRUDENTO, afirmada onde ela mora — com distâncias que o teste controla.
 *
 * ## Por que este arquivo passou a existir
 *
 * A regra do `STICKY_NEAREST` — trava de quatro segundos, e depois só troca por um candidato a 60%
 * da distância — só era coberta por um teste de SIMULAÇÃO: um corpo perseguindo, e o outro jogador
 * teleportado para "99% da distância". Esse teste passava numa semente e falhava em catorze de
 * vinte e três. Investigado, a regra estava certa e o teste era degenerado: ele punha o companheiro
 * SOBRE A LINHA até o alvo, a um deslocamento fixo, e quando o corpo chegava os três ocupavam o
 * mesmo ponto — dois centímetros de distância para cada um. Com três corpos no mesmo lugar,
 * qualquer razão de distância vira ruído.
 *
 * Aqui não há corpo andando, colisão nem semente: a posição de cada um é escolhida, e a regra
 * responde exatamente ao que ela promete.
 */

const origem = { x: 0, y: 0, z: 0 };
/** Distância plana; a regra não sabe nem precisa saber de relevo. */
const plana = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Um jogador a `d` metros da origem, num eixo próprio para não haver empate. */
const jogador = (entityId: number, d: number, eixo: 'x' | 'z' = 'x', over: Partial<TargetablePlayer> = {}): TargetablePlayer =>
  ({ entityId, position: eixo === 'x' ? { x: d, y: 0, z: 0 } : { x: 0, y: 0, z: d }, alive: true, eligible: true, ...over });

/** Um corpo que já tem `alvo` há `trava` segundos. */
function mirando(alvo: number, trava: number): TargetingState {
  const s = newTargetingState();
  s.targetPlayerId = alvo; s.targetLockTime = trava;
  return s;
}

const opcoes = (players: TargetablePlayer[]) => ({
  policy: 'STICKY_NEAREST' as const, players, position: origem, distance: plana, now: 100, random: () => 0,
});

describe('a trava', () => {
  /** Abaixo dos quatro segundos, NENHUMA distância troca — nem um candidato a 10% da distância. */
  it('dentro da trava, nem um candidato dez vezes mais perto rouba o alvo', () => {
    const s = mirando(1, STICKY_LOCK_SECONDS - .5);
    const alvo = acquireTarget(s, opcoes([jogador(1, 10), jogador(2, 1, 'z')]));
    expect(alvo).toBe(1);
  });

  it('a trava cresce com o tempo, e manter o alvo NÃO a zera', () => {
    const s = mirando(1, 0);
    for (let i = 0; i < 60; i++) acquireTarget(s, opcoes([jogador(1, 10), jogador(2, 9.9, 'z')]), 1 / 60);
    expect(s.targetLockTime).toBeCloseTo(1, 5);
    expect(s.targetPlayerId).toBe(1);
  });
});

describe('passada a trava: só troca por diferença que um humano enxergaria', () => {
  const vencida = STICKY_LOCK_SECONDS + 1;

  /** Dois jogadores lado a lado. É o jitter que a política existe para matar. */
  it('candidato a 99% da distância NÃO troca', () => {
    const s = mirando(1, vencida);
    expect(acquireTarget(s, opcoes([jogador(1, 10), jogador(2, 9.9, 'z')]))).toBe(1);
  });

  it('candidato logo ACIMA do limiar (61%) NÃO troca', () => {
    const s = mirando(1, vencida);
    expect(acquireTarget(s, opcoes([jogador(1, 10), jogador(2, 10 * (STICKY_SWITCH_RATIO + .01), 'z')]))).toBe(1);
  });

  /** O outro lado do limiar — sem ele, uma regra que NUNCA troca passaria nos três casos acima. */
  it('candidato logo ABAIXO do limiar (59%) troca, e a troca zera a trava', () => {
    const s = mirando(1, vencida);
    expect(acquireTarget(s, opcoes([jogador(1, 10), jogador(2, 10 * (STICKY_SWITCH_RATIO - .01), 'z')]))).toBe(2);
    expect(s.targetLockTime).toBe(0);
    expect(s.lastTargetSwitchTime).toBe(100);
  });
});

describe('o que vence a trava', () => {
  it('alvo MORTO: troca para o vivo mais perto, mesmo dentro da trava', () => {
    const s = mirando(1, .1);
    const alvo = acquireTarget(s, opcoes([jogador(1, 1, 'x', { alive: false }), jogador(2, 20, 'z'), jogador(3, 30, 'z')]));
    expect(alvo).toBe(2);
  });

  it('alvo que deixou de ser elegível (caiu da rede) também é trocado', () => {
    const s = mirando(1, .1);
    expect(acquireTarget(s, opcoes([jogador(1, 1, 'x', { eligible: false }), jogador(2, 20, 'z')]))).toBe(2);
  });

  it('aggro explícito vence a trava — é para isso que ele existe', () => {
    const s = mirando(1, .1);
    s.aggroSource = 2;
    expect(acquireTarget(s, opcoes([jogador(1, 1), jogador(2, 50, 'z')]))).toBe(2);
    expect(s.aggroSource).toBe(NO_TARGET);
  });

  /**
   * ROTA PERDIDA INVALIDA A POSSE, mesmo dentro da trava: o corpo readquire do zero, pelo mais
   * perto. Com um candidato a 80% da distância — que a regra do sticky NUNCA aceitaria (exige 60%) —,
   * a troca acontece, e só pode ter vindo da invalidação.
   */
  it('inalcançável por tempo demais: readquire pelo mais perto, mesmo o que o sticky recusaria', () => {
    const s = mirando(1, 3);
    const alvo = acquireTarget(s, { ...opcoes([jogador(1, 10), jogador(2, 8, 'z')]), unreachableFor: 12, unreachableLimit: 12 });
    expect(alvo).toBe(2);
    expect(s.targetLockTime).toBe(0);
  });

  /**
   * REGISTRO DE UMA FRAQUEZA, não de um acerto.
   *
   * Quando o alvo inalcançável é TAMBÉM o vivo mais perto, a readquisição devolve o mesmo id, e
   * `switchTo` só registra troca quando o id muda — então nada acontece: nem a trava zera, nem o
   * contador de rota da simulação (que só zera em troca). Um corpo preso atrás de um muro do
   * jogador mais próximo fica mirando nele para sempre, em vez de ir atrás de quem ele alcança.
   *
   * Consertar isso é decisão de design (excluir o inalcançável da readquisição? por quanto tempo?)
   * e está fora deste trabalho. Este caso fixa o comportamento REAL para que a correção, quando
   * vier, apareça como mudança deliberada e não como acidente.
   */
  it('FRAQUEZA registrada: se o inalcançável é o mais perto, a posse fica como está', () => {
    const s = mirando(1, 3);
    const alvo = acquireTarget(s, { ...opcoes([jogador(1, 10), jogador(2, 20, 'z')]), unreachableFor: 12, unreachableLimit: 12 });
    expect(alvo).toBe(1);
    expect(s.targetLockTime).toBe(3);
  });

  it('abaixo do limite de rota, a posse continua — e a trava segue contando', () => {
    const s = mirando(1, 3);
    acquireTarget(s, { ...opcoes([jogador(1, 10), jogador(2, 20, 'z')]), unreachableFor: 11.9, unreachableLimit: 12 }, .1);
    expect(s.targetPlayerId).toBe(1);
    expect(s.targetLockTime).toBeCloseTo(3.1, 5);
  });

  it('sem ninguém vivo, o corpo fica SEM alvo em vez de mirar num cadáver', () => {
    const s = mirando(1, 10);
    expect(acquireTarget(s, opcoes([jogador(1, 1, 'x', { alive: false }), jogador(2, 2, 'z', { alive: false })]))).toBe(NO_TARGET);
  });
});
