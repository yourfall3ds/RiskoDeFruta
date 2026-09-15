import { describe, it, expect, vi } from 'vitest';
import { Reconciliation, type Pose } from '../src/net/Reconciliation';

const pose = (x: number, z: number, y = 0): Pose => ({ x, y, z, vx: 0, vy: 0, vz: 0 });

describe('reconciliação da predição local', () => {
  it('não corrige quando o servidor concorda com a predição, e libera as poses confirmadas', () => {
    const r = new Reconciliation(.12);
    for (let s = 1; s <= 5; s++) r.record(s, pose(0, s));
    const apply = vi.fn();
    const ack = r.ack(3, pose(0, 3.02), apply);
    expect(ack.corrected).toBe(false); expect(ack.error).toBeCloseTo(.02, 5); expect(ack.pending).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
    expect(r.pendingCount).toBe(2); expect(r.lastAcked).toBe(3); expect(r.corrections).toBe(0);
  });

  it('corrige quando o erro passa do limiar e devolve as entradas ainda não confirmadas para reaplicar', () => {
    const r = new Reconciliation(.12);
    for (let s = 1; s <= 6; s++) r.record(s, pose(0, s));
    const apply = vi.fn();
    const server = pose(.5, 3);                                // 0,5 m de diferença no seq 3
    const ack = r.ack(3, server, apply);
    expect(ack.corrected).toBe(true); expect(ack.error).toBeCloseTo(.5, 5);
    expect(ack.pending).toEqual([4, 5, 6]);                    // do mais antigo ao mais novo
    expect(apply).toHaveBeenCalledWith(server);
    expect(r.corrections).toBe(1); expect(r.lastError).toBeCloseTo(.5, 5);
  });

  it('ignora confirmações antigas ou repetidas', () => {
    const r = new Reconciliation();
    for (let s = 1; s <= 4; s++) r.record(s, pose(0, s));
    r.ack(3, pose(0, 3));
    const stale = r.ack(2, pose(9, 9));
    expect(stale).toEqual({ error: 0, corrected: false, pending: [] });
    expect(r.corrections).toBe(0); expect(r.lastAcked).toBe(3);
  });

  it('não corrige quando a pose prevista daquele seq já foi descartada (sem base de comparação)', () => {
    const r = new Reconciliation(.12, 4);
    for (let s = 1; s <= 10; s++) r.record(s, pose(0, s));  // capacidade 4: só 7..10 sobrevivem
    const ack = r.ack(5, pose(3, 3));
    expect(ack.corrected).toBe(false); expect(ack.error).toBe(0);
    expect(r.pendingCount).toBe(4);
  });

  it('valida parâmetros e seq', () => {
    expect(() => new Reconciliation(0)).toThrow();
    expect(() => new Reconciliation(.1, 1)).toThrow();
    expect(() => new Reconciliation().record(0, pose(0, 0))).toThrow();
  });
});
