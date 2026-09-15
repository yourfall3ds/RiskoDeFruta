import { Engine } from '@babylonjs/core/Engines/engine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import '@babylonjs/core/Engines/Extensions/engine.query';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery';

export interface EngineSession { engine: AbstractEngine; backend: string; renderer:string; gpuMs():number; renderScale():number; setRenderScale(scale:number):void; dispose(): void }

/** Pixels renderizados por pixel de CSS, em cada eixo. Acima de 1 é supersampling. */
export const RENDER_SCALE = 1.5;
/** Teto de pixels por frame para o supersampling não explodir em telas grandes. */
const MAX_PIXELS = 3_840_000;

/** Resolve a escala pedida contra o teto de pixels; nunca renderiza abaixo do nativo. */
export function resolveRenderScale(scale:number,width:number,height:number,maxPixels=MAX_PIXELS):number {
  const area=Math.max(1,width)*Math.max(1,height);
  return Math.max(1,Math.min(scale,Math.sqrt(maxPixels/area)));
}

/** Backend selection stays at this boundary; gameplay never imports WebGL Engine. */
export function createEngine(canvas: HTMLCanvasElement): EngineSession {
  if (!canvas.getContext('webgl2', { antialias: true, stencil: true, preserveDrawingBuffer: false })) {
    throw new Error('WebGL2 indisponível. Ative a aceleração gráfica do navegador.');
  }
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, false);
  let requested = RENDER_SCALE;
  const applyScale = (): void => { engine.setHardwareScalingLevel(1/resolveRenderScale(requested,canvas.clientWidth,canvas.clientHeight)); };
  applyScale();
  const instrument=new EngineInstrumentation(engine);instrument.captureGPUFrameTime=true;
  const resize = (): void => { applyScale(); engine.resize(); };
  window.addEventListener('resize', resize);
  return { engine, backend: 'WebGL2', renderer:engine.getGlInfo().renderer,gpuMs:()=>instrument.gpuFrameTimeCounter?.lastSecAverage/1e6||0,
    renderScale:()=>1/engine.getHardwareScalingLevel(),
    setRenderScale:(scale:number)=>{requested=Math.max(.5,scale);applyScale();engine.resize();},
    dispose: () => { window.removeEventListener('resize', resize);instrument.dispose(); engine.dispose(); } };
}
