export interface AIJob { id: number; distance: () => number; update: (elapsed: number) => void }
interface ScheduledJob { job: AIJob; due: number; last: number }
export const AI_TUNING = { nearDistance: 25, mediumDistance: 60, nearHz: 20, mediumHz: 10, farHz: 4, maxPerTick: 24 } as const;

/** Phase staggering and a rotating cursor keep a crowded tier from starving other jobs. */
export class AIScheduler {
  private readonly jobs: ScheduledJob[] = [];
  private cursor = 0;
  private time = 0;
  ticksLastUpdate = 0;
  totalTicks = 0;
  add(job: AIJob): void {
    if (this.jobs.some(entry => entry.job.id === job.id)) throw new Error(`Duplicate AI job ${job.id}`);
    this.jobs.push({ job, last: this.time, due: this.time + (job.id % 17) / 17 * this.interval(job.distance()) });
  }
  remove(id: number): void {
    const index = this.jobs.findIndex(entry => entry.job.id === id);
    if (index >= 0) this.jobs.splice(index, 1);
  }
  private interval(distance: number): number {
    return 1 / (distance < AI_TUNING.nearDistance ? AI_TUNING.nearHz : distance < AI_TUNING.mediumDistance ? AI_TUNING.mediumHz : AI_TUNING.farHz);
  }
  update(dt: number): void {
    this.time += dt;
    this.ticksLastUpdate = 0;
    for (let visited = 0; visited < this.jobs.length && this.ticksLastUpdate < AI_TUNING.maxPerTick; visited++) {
      this.cursor %= this.jobs.length;
      const entry = this.jobs[this.cursor++]!;
      // Reclassify on distance changes without waiting for an old far-tier deadline.
      const interval = this.interval(entry.job.distance());
      if (this.time + 1e-9 < Math.min(entry.due, entry.last + interval)) continue;
      entry.job.update(this.time - entry.last);
      entry.last = this.time;
      entry.due = this.time + interval;
      this.ticksLastUpdate++;
      this.totalTicks++;
    }
  }
  get size(): number { return this.jobs.length; }
  clear(): void { this.jobs.length = 0; this.cursor = 0; this.time = 0; this.totalTicks = 0; this.ticksLastUpdate = 0; }
}
