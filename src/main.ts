import { Application } from './game/Application';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const status = document.querySelector<HTMLElement>('#status');
if (!canvas || !status) throw new Error('Missing application root');
let application: Application | undefined;
try {
  application = new Application(canvas);
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
