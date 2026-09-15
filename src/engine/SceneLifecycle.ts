export interface SceneModule {
  fixedUpdate(dt: number): void;
  render(alpha: number): void;
  dispose(): void;
}

export class SceneLifecycle {
  private current: SceneModule | undefined;
  replace(create: () => SceneModule): void {
    // Build first: a failed factory leaves the running scene intact.
    const next = create();
    this.current?.dispose();
    this.current = next;
  }
  fixedUpdate(dt: number): void { this.current?.fixedUpdate(dt); }
  render(alpha: number): void { this.current?.render(alpha); }
  dispose(): void { this.current?.dispose(); this.current = undefined; }
}
