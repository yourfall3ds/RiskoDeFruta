import { FixedLoop } from '../core/FixedLoop';
import { FrameGuard } from '../core/FrameGuard';
import { createSeed } from '../core/RunRNG';
import { seedPolicy, type SeedPolicy } from '../run/AttemptSeed';
import { coopHref } from '../net/OnlineIntent';
import { setRelaunchHandler, type RelaunchReason } from '../net/Relaunch';
import { log, logger } from '../core/Log';
import { createEngine } from '../engine/createEngine';
import { SceneLifecycle } from '../engine/SceneLifecycle';
import { DebugOverlay } from '../debug/DebugOverlay';
import { FoundationScene } from './FoundationScene';
import { PlayerScene } from './PlayerScene';
import { PlanetScene } from './PlanetScene';

/** Composition and lifecycle only. Gameplay belongs to dedicated systems. */
export class Application {
  private readonly session;
  private readonly lifecycle = new SceneLifecycle();
  private readonly loop: FixedLoop;
  private readonly debug: DebugOverlay;
  private foundation!: FoundationScene | PlayerScene | PlanetScene;
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
  /**
   * O laço do Babylon não sobrevive a uma exceção: ela pula o pedido do próximo quadro, e o jogo
   * congela no último desenho sem aviso. Ver `FrameGuard`.
   */
  private readonly frames = new FrameGuard({
    first: (failure, error) => logger('app').erro('quadro abandonado: o laço de desenho segue', {erro: failure.signature, pilha: failure.stack, causa: error}),
    repeated: (failure, since) => logger('app').erro('o mesmo erro de quadro se repetiu', {erro: failure.signature, vezes: since, total: failure.count}),
  });

  constructor(canvas: HTMLCanvasElement) {
    this.session = createEngine(canvas);
    // Arranque comum sorteia semente nova mesmo com a semente da partida anterior ainda na URL;
    // `?replay=1` e `?online=1` continuam presos ao que a URL pede. Ver `AttemptSeed`.
    this.policy = seedPolicy(coopHref(location.href));
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
    /**
     * ENTRAR NUMA SALA DEIXA DE RECARREGAR A PÁGINA.
     *
     * O menu gravava a intenção e chamava `location.assign()`: contexto WebGL destruído, shaders
     * recompilados, módulos reavaliados, motor reconstruído — a maior fatia dos ~40 s de espera,
     * toda ela gasta para recriar objetos idênticos. A CENA precisa ser refeita (fora do co-op o
     * mapa é o planeta, dentro é a fazenda: dois adaptadores de mundo distintos), mas a PÁGINA não.
     *
     * `restart` é o mesmo caminho que `F1 → reiniciar` percorre desde sempre; aqui ele só passa a
     * ser usado também quando a resposta a "que mundo é este?" muda. Ver `net/Relaunch`.
     */
    setRelaunchHandler(reason => this.relaunch(reason));
    if (new URL(location.href).searchParams.has('debug')) (window as unknown as {__rdfFrames?: unknown}).__rdfFrames = () => this.frames.snapshot();
    this.session.engine.runRenderLoop(() => {
      if (document.hidden) return;
      // Um quadro que lança é abandonado e registrado com a pilha; o laço segue. O relógio fixo
      // recomeça do zero para o quadro abandonado não voltar como uma rajada de passos atrasados.
      if (!this.frames.run(() => this.frame())) this.loop.suspend();
    });
  }
  private frame(): void {
    this.simulationMs=0;this.presentationMs=0;
    if (this.foundation.isPaused) { this.loop.suspend(); this.renderMeasured(1); }
    else this.loop.frame(performance.now() / 1000);
    this.timingFrames++;this.timingSimulation+=this.simulationMs;this.timingPresentation+=this.presentationMs;
    const measuredAt=performance.now();
    // Telemetria agregada: o que acontece por quadro virou contador, e o contador é publicado a
    // cada N segundos. Uma linha por quadro seria a enchente que o pedido proíbe.
    log.flush(measuredAt,undefined,'telemetria-cliente');
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
  }
  private renderMeasured(alpha:number):void {
    const start=performance.now();try{this.lifecycle.render(alpha);}finally{this.presentationMs+=performance.now()-start;}
  }
  /** Passa a tratar `seed` como a semente ativa e reescreve a URL, sem recriar nada. */
  private adoptSeed(seed: string | undefined): void {
    if (!seed || seed === this.seed) return;
    this.seed = seed;
    this.mirrorSeed(seed);
  }
  /**
   * A semente na URL — **só numa URL que já é de desenvolvimento**.
   *
   * Espelhar sempre era o certo enquanto a única forma de jogar em dupla era mandar a URL: o QA
   * precisa ver a semente em vigor e `jogar-coop.ps1` depende dela. Mas numa abertura comum isso
   * escrevia `?seed=…` na barra de endereço de um jogador que nunca pediu semente nenhuma — e o
   * pedido é que ele não veja seed em lugar nenhum. Com `?seed`, `?replay` ou `?online` já na URL,
   * nada muda: quem abriu assim está exatamente atrás desse número.
   */
  private mirrorSeed(seed: string): void {
    const url = new URL(location.href);
    if (!url.searchParams.get('seed') && !url.searchParams.get('replay') && !url.searchParams.get('online')) return;
    url.searchParams.set('seed', seed); history.replaceState(null, '', url);
  }
  /**
   * Refaz a cena no lugar, depois de a intenção de co-op ter sido gravada ou apagada.
   *
   * Adiado por um turno do laço de eventos de propósito: quem chama é o manipulador de clique de um
   * botão que vive DENTRO da cena que está prestes a ser descartada, e destruir o alvo do evento no
   * meio do despacho é a receita de um erro difícil de ler.
   *
   * A cena velha é descartada ANTES de a nova nascer — o contrário do que `SceneLifecycle.replace`
   * faz sozinho, e aqui é o certo: as duas cenas montam interface no `document.body`, e um instante
   * com dois menus vivos deixa classes de corpo e o vídeo do portão disputando o mesmo DOM. Entre o
   * descarte e a reconstrução não corre quadro nenhum, porque o bloco é síncrono.
   */
  private relaunch(reason: RelaunchReason): void {
    if (this.disposed) return;
    setTimeout(() => {
      if (this.disposed) return;
      const started = performance.now();
      this.lifecycle.dispose();
      const seed = seedPolicy(coopHref(location.href)).seed;
      this.restart(seed);
      logger('app').info('cena refeita sem recarregar a página', { motivo: reason, seed, ms: Math.round(performance.now() - started) });
    }, 0);
  }

  private restart(seed: string): void {
    this.lifecycle.replace(() => {
      // The simplified sandbox is available only through the explicit preview route.
      const mode = new URL(location.href).searchParams.get('mode');
      const scene = mode==='planet-preview' ? new PlanetScene(this.session.engine,seed)
        : mode==='foundation' ? new FoundationScene(this.session.engine,seed)
        : new PlayerScene(this.session.engine,seed);
      this.foundation = scene;
      return scene;
    });
    this.seed = seed;
    this.mirrorSeed(seed);
    this.loop.reset();
    this.foundation.setPaused(false);
    for(const [name,value] of this.settings)this.foundation.configure(name,value);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    setRelaunchHandler(undefined);
    document.removeEventListener('visibilitychange', this.visibility);
    this.session.engine.stopRenderLoop();
    this.debug.dispose(); this.lifecycle.dispose(); this.session.dispose();
  }
}
