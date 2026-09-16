import type {RandomStream} from '../core/RunRNG';

/** Bound terrain probes without relaxing the route required by StagePlan. */
export const RADIAL_ISLAND_POOL = 10;

export function pickIslands<T>(islands: readonly T[], rng: RandomStream, count: number): T[] {
  const pool = [...islands];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const swap = pool[i]!; pool[i] = pool[j]!; pool[j] = swap;
  }
  return pool.slice(0, Math.max(2, Math.min(count, pool.length)));
}
