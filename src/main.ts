import { Application } from './game/Application';
import {traceBoot} from './core/BootTrace';
import './style.css';

if(new URLSearchParams(location.search).has('qaBoot')){
  traceBoot('entry');
  window.addEventListener('error',e=>traceBoot('error:'+e.message));
  window.addEventListener('unhandledrejection',e=>traceBoot('rejection:'+String(e.reason)));
  document.addEventListener('pointerlockchange',()=>traceBoot(document.pointerLockElement?'pointer:locked':'pointer:free'));
  const heartbeat=window.setInterval(()=>traceBoot('event-loop-alive'),2000);
  window.setTimeout(()=>window.clearInterval(heartbeat),120000);
}

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const status = document.querySelector<HTMLElement>('#status');
if (!canvas || !status) throw new Error('Missing application root');
if(new URLSearchParams(location.search).has('qaBoot')){
  canvas.addEventListener('webglcontextlost',()=>traceBoot('webgl-context-lost'));
  window.addEventListener('pagehide',()=>traceBoot('page-hidden'));
}
let application: Application | undefined;
try {
  application = new Application(canvas);
  traceBoot('application-created');
  status.textContent = new URL(location.href).searchParams.get('mode')==='foundation'?'MUTANT FARM · M0 / Fundação técnica · F1 diagnóstico':'';
  document.documentElement.dataset.appState = 'ready';
} catch (error) {
  console.error(error);
  status.textContent = `Falha ao iniciar: ${error instanceof Error ? error.message : 'erro desconhecido'}`;
  document.documentElement.dataset.appState = 'error';
}
const cleanup = (): void => application?.dispose();
window.addEventListener('pagehide', cleanup, { once: true });
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener('pagehide', cleanup); cleanup();
});
