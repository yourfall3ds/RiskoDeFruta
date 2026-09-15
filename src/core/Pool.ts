export interface PoolStats { capacity: number; active: number; peak: number; misses: number }

export class Pool<T extends object> {
  private readonly free: T[];
  private readonly leased = new Set<T>();
  private peak = 0;
  private misses = 0;
  readonly capacity: number;
  constructor(capacity: number, factory: () => T, private readonly reset: (value: T) => void) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid pool capacity');
    this.capacity = capacity;
    this.free = Array.from({ length: capacity }, () => { const value = factory(); reset(value); return value; });
    if (new Set(this.free).size !== capacity) throw new Error('Pool factory must return unique instances');
  }
  acquire(): T | undefined {
    const value = this.free.pop();
    if (!value) { this.misses++; return undefined; }
    this.leased.add(value);
    this.peak = Math.max(this.peak, this.leased.size);
    return value;
  }
  release(value: T): void {
    if (!this.leased.has(value)) throw new Error('Double release or foreign pool value');
    this.reset(value);
    this.leased.delete(value);
    this.free.push(value);
  }
  releaseAll(): void { for (const value of this.leased) this.release(value); }
  get stats(): PoolStats { return { capacity: this.capacity, active: this.leased.size, peak: this.peak, misses: this.misses }; }
}
