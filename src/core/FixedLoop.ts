export interface LoopTuning { hz: number; maxFrameSeconds: number; maxSteps: number }
export const LOOP_TUNING: Readonly<LoopTuning> = { hz: 60, maxFrameSeconds: 0.25, maxSteps: 5 };

export class FixedLoop {
  readonly step: number;
  private accumulator = 0;
  private lastTime: number | undefined;
  tick = 0;
  droppedSeconds = 0;
  stepsLastFrame = 0;

  constructor(
    private readonly simulate: (dt: number) => void,
    private readonly render: (alpha: number) => void,
    private readonly tuning: Readonly<LoopTuning> = LOOP_TUNING,
  ) {
    if (tuning.hz <= 0 || tuning.maxFrameSeconds <= 0 || !Number.isInteger(tuning.maxSteps) || tuning.maxSteps < 1) {
      throw new Error('Invalid loop tuning');
    }
    this.step = 1 / tuning.hz;
  }

  frame(nowSeconds: number): void {
    if (!Number.isFinite(nowSeconds)) throw new Error('Invalid frame timestamp');
    const elapsed = this.lastTime === undefined ? 0 : Math.max(0, nowSeconds - this.lastTime);
    this.lastTime = nowSeconds;
    const bounded = Math.min(elapsed, this.tuning.maxFrameSeconds);
    this.droppedSeconds += elapsed - bounded;
    this.accumulator += bounded;
    this.stepsLastFrame = 0;
    while (this.accumulator + 1e-10 >= this.step && this.stepsLastFrame < this.tuning.maxSteps) {
      this.simulate(this.step);
      this.accumulator = Math.max(0, this.accumulator - this.step);
      this.stepsLastFrame++;
      this.tick++;
    }
    if (this.accumulator >= this.step) {
      const discarded = Math.floor((this.accumulator + 1e-10) / this.step) * this.step;
      this.droppedSeconds += discarded;
      this.accumulator = Math.max(0, this.accumulator - discarded);
    }
    this.render(this.accumulator / this.step);
  }

  suspend(): void { this.lastTime = undefined; this.accumulator = 0; }
  reset(): void { this.suspend(); this.tick = 0; this.droppedSeconds = 0; this.stepsLastFrame = 0; }
}
