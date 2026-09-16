import { FixedLoop } from '../core/FixedLoop';
import { createSeed } from '../core/RunRNG';
import { seedPolicy, type SeedPolicy } from '../run/AttemptSeed';
import { createEngine } from '../engine/createEngine';
import { SceneLifecycle } from '../engine/SceneLifecycle';
import { DebugOverlay } from '../debug/DebugOverlay';
import { FoundationScene } from './FoundationScene';
import { PlayerScene } from './PlayerScene';

/** Composition and lifecycle only. Gameplay belongs to dedicated systems. */
export class Application {
  private readonly session;
  private readonly lifecycle = new SceneLifecycle();
  private readonly loop: FixedLoop;
  private readonly debug: DebugOverlay;
  private foundation!: FoundationScene | PlayerScene;
  /** De onde veio a semente do arranque; decide se uma repetição pode sortear outra. */
  private readonly policy: SeedPolicy;
  private seed: string;
  private simulationMs=0;
  private presentationMs=0;
  private timingFrames=0;
  private timingSimulation=0;
  private timingPresentation=0;
  private timingSince=performance.now();
  private timingAverage={simulation:0,presentation:0};
  private readonly settings=new Map<string,number>();
  private disposed = false;
  private readonly visibility = (): void => this.loop.suspend();

  constructor(canvas: HTMLCanvasElement) {
    this.session = createEngine(canvas);
    // Arranque comum sorteia semente nova mesmo com a semente da partida anterior ainda na URL;
    // `?replay=1` e `?online=1` continuam presos ao que a URL pede. Ver `AttemptSeed`.
    this.policy = seedPolicy(location.href);
    this.seed = this.policy.seed;
    this.loop = new FixedLoop(dt => {
      const start=performance.now();try{this.lifecycle.fixedUpdate(dt);}finally{this.simulationMs+=performance.now()-start;}
    }, alpha => this.renderMeasured(alpha));
    try { this.restart(this.seed); } catch (error) { this.session.dispose(); throw error; }
    this.debug = new DebugOverlay({
      restartSame: () => this.restart(this.seed),
      restartNew: () => this.restart(createSeed()),
      pause: () => { this.foundation.setPaused(!this.foundation.isPaused);this.loop.suspend(); return this.foundation.isPaused; },
      configure: (name,value) => {if(['distance','fov','shake'].includes(name))this.settings.set(name,value);this.foundation.configure(name,value);},
    });
    document.addEventListener('visibilitychange', this.visibility);
    this.session.engine.runRenderLoop(() => {
      if (document.hidden) return;
      this.simulationMs=0;this.presentationMs=0;
      if (this.foundation.isPaused) { this.loop.suspend(); this.renderMeasured(1); }
      else this.loop.frame(performance.now() / 1000);
      this.timingFrames++;this.timingSimulation+=this.simulationMs;this.timingPresentation+=this.presentationMs;
      const measuredAt=performance.now();
      if(measuredAt-this.timingSince>=500){
        this.timingAverage={simulation:this.timingSimulation/this.timingFrames,presentation:this.timingPresentation/this.timingFrames};
        this.timingFrames=0;this.timingSimulation=0;this.timingPresentation=0;this.timingSince=measuredAt;
      }
      // A cena pode sortear uma semente nova sozinha ao repetir depois da derrota, sem passar por
      // `restart` (os assets ficam de pé). A URL e o overlay têm de mostrar a semente REAL em vigor,
      // senão o QA reportaria a semente errada.
      this.adoptSeed((this.foundation as {runSeed?: string}).runSeed);
      this.debug.update(this.session.engine.getDeltaTime() / 1000, () => {
        const f = this.foundation;
        return {
          paused: f.isPaused, backend: this.session.backend,renderer:this.session.renderer,gpuMs:this.session.gpuMs(), seed: this.seed, tick: this.loop.tick,
          droppedSeconds: this.loop.droppedSeconds, steps: this.loop.stepsLastFrame,
          simulationMs:this.timingAverage.simulation,presentationMs:this.timingAverage.presentation,
          fps: this.session.engine.getFps(), frameMs: f.instrumentation.frameTimeCounter.lastSecAverage,
          drawCalls: f.instrumentation.drawCallsCounter.current, activeMeshes: f.scene.getActiveMeshes().length,
          triangles: f.scene.getActiveMeshes().data.slice(0, f.scene.getActiveMeshes().length)
            .reduce((count, mesh) => count + (mesh.getClassName() === 'LinesMesh' ? 0 : Math.floor(((f.scene.activeCamera?mesh.getLOD(f.scene.activeCamera):mesh)?.getTotalIndices()??0) / 3)), 0),
          ...f.getDebug(),
        };
      });
    });
  }
  private renderMeasured(alpha:number):void {
    const start=performance.now();try{this.lifecycle.render(alpha);}finally{this.presentationMs+=performance.now()-start;}
  }
  /** Passa a tratar `seed` como a semente ativa e reescreve a URL, sem recriar nada. */
  private adoptSeed(seed: string | undefined): void {
    if (!seed || seed === this.seed) return;
    this.seed = seed;
    const url = new URL(location.href); url.searchParams.set('seed', seed); history.replaceState(null, '', url);
  }
  private restart(seed: string): void {
    this.lifecycle.replace(() => {
      const scene = new URL(location.href).searchParams.get('mode')==='foundation'
        ? new FoundationScene(this.session.engine,seed) : new PlayerScene(this.session.engine,seed);
      this.foundation = scene;
      return scene;
    });
    this.seed = seed;
    const url = new URL(location.href); url.searchParams.set('seed', seed); history.replaceState(null, '', url);
    this.loop.reset();
    this.foundation.setPaused(false);
    for(const [name,value] of this.settings)this.foundation.configure(name,value);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.visibility);
    this.session.engine.stopRenderLoop();
    this.debug.dispose(); this.lifecycle.dispose(); this.session.dispose();
  }
}
