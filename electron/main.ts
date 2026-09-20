import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { escolherPorta, portaEfemera } from './ports';
import { urlDoCliente } from './address';
import { servirPasta } from './static-server';
import { iniciarDescoberta, type Anfitriao, ASSINATURA, VERSAO_PROTOCOLO } from './discovery';

/**
 * PROCESSO PRINCIPAL — a única coisa que o jogador executa.
 *
 * A promessa é "abriu, jogou": nada de terminal, nada de endereço digitado, nada de escolher
 * porta. Isso exige que este arquivo faça, em ordem, o que hoje é feito à mão por dois comandos:
 * subir o servidor Colyseus, servir o cliente e ligar um no outro.
 */

const DEV = !app.isPackaged;
const ORIGEM_DEV = process.env['RDF_DEV_SERVER'] ?? 'http://localhost:5173';

/** Mesmo critério de `server/index.ts`: o IP da LAN, nunca `127.0.0.1`, para o convidado alcançar. */
function lanIPv4(): string {
  for (const entradas of Object.values(networkInterfaces()))
    for (const entrada of entradas ?? []) if (entrada.family === 'IPv4' && !entrada.internal) return entrada.address;
  return '127.0.0.1';
}

let janela: BrowserWindow | undefined;
let servidorJogo: ChildProcess | undefined;
let pararDescoberta: (() => void) | undefined;
let anfitrioesLan: Anfitriao[] = [];
const idInstancia = randomUUID();

/**
 * O servidor Colyseus roda num processo FILHO, não neste.
 *
 * Rodar junto seria menos código, e erraria: a simulação da fazenda é um laço de física que
 * compete com o processo principal do Electron — e o processo principal é quem desenha a janela e
 * responde ao teclado. O sintoma seria a janela engasgando junto com a simulação, e ninguém ligaria
 * uma coisa à outra. Separado, o sistema operacional dá a cada um seu núcleo.
 *
 * O segundo motivo é sobreviver: se o servidor morre por um erro na simulação, o filho cai e o
 * jogo pode avisar — no mesmo processo, ele levaria a janela junto.
 */
function subirServidor(porta: number): ChildProcess {
  const entrada = DEV ? join(__dirname, '..', 'server', 'index.ts') : join(__dirname, 'server.cjs');
  const filho = fork(entrada, [], {
    // `PORT` e `PUBLIC_HOST` são exatamente as variáveis que `server/index.ts` já lê. Reusar o
    // contrato que existe evita uma segunda regra de endereço — ver `electron/address.ts`.
    env: { ...process.env, PORT: String(porta), PUBLIC_HOST: `${lanIPv4()}:${porta}` },
    // Em desenvolvimento o servidor ainda é TypeScript: o `tsx` é o mesmo carregador do
    // `npm run server`, então o caminho de desenvolvimento continua idêntico ao de hoje.
    ...(DEV ? { execArgv: ['--import', 'tsx'] } : {}),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  filho.stdout?.on('data', (d: Buffer) => console.log('[servidor]', String(d).trim()));
  filho.stderr?.on('data', (d: Buffer) => console.error('[servidor]', String(d).trim()));
  filho.on('exit', (codigo) => console.error('[servidor] saiu com', codigo));
  return filho;
}

async function criarJanela(): Promise<void> {
  const portaJogo = await escolherPorta();
  servidorJogo = subirServidor(portaJogo);

  // O servidor estático só existe no aplicativo empacotado; em desenvolvimento quem serve é o
  // Vite, com recarga a quente — perder isso tornaria o `app:dev` inútil.
  let portaHttp = 0;
  if (!DEV) {
    portaHttp = await portaEfemera('127.0.0.1');
    await servirPasta(join(__dirname, '..', 'dist'), portaHttp, '127.0.0.1');
  }

  janela = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Risco de Fruta',
    backgroundColor: '#0b0b0f',
    // A janela só aparece quando tem o que mostrar: sem isto o jogador vê um retângulo branco
    // enquanto o Babylon carrega os modelos, e um retângulo branco parece travamento.
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      // O jogo é código nosso, mas a janela não precisa de Node para nada — a descoberta vive no
      // processo principal e chega pelo `preload`. Desligar reduz o estrago de qualquer
      // dependência do cliente que um dia seja comprometida.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  janela.once('ready-to-show', () => janela?.show());
  janela.setMenuBarVisibility(false);
  // Link externo abre no navegador do sistema, nunca dentro do jogo.
  janela.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });

  await iniciarDescobertaLan(portaJogo);
  await janela.loadURL(urlDoCliente({ portaHttp, portaJogo, origemDev: DEV ? ORIGEM_DEV : undefined }));
}

async function iniciarDescobertaLan(portaJogo: number): Promise<void> {
  try {
    const descoberta = await iniciarDescoberta(
      { jogo: ASSINATURA, versao: VERSAO_PROTOCOLO, porta: portaJogo, nome: `Fazenda de ${hostname()}`, id: idInstancia },
      (anfitrioes) => {
        anfitrioesLan = anfitrioes;
        // Empurrar em vez de esperar o cliente perguntar: a sala do amigo aparece sozinha na lista,
        // que é a diferença entre "achei" e "fica apertando atualizar".
        janela?.webContents.send('rdf:anfitrioes', anfitrioes);
      },
    );
    pararDescoberta = descoberta.parar;
  } catch (erro) {
    // Uma rede que recusa difusão (Wi-Fi público, firewall corporativo) não pode impedir de jogar:
    // sem descoberta o jogo ainda roda sozinho e ainda aceita um código digitado.
    console.error('[descoberta] indisponível:', erro);
  }
}

ipcMain.handle('rdf:anfitrioes', () => anfitrioesLan);

void app.whenReady().then(criarJanela);

// Uma segunda cópia do jogo na mesma máquina é LEGÍTIMA (duas pessoas, duas telas), então não há
// bloqueio de instância única aqui — `escolherPorta` e `reuseAddr` existem justamente para isso.

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => {
  pararDescoberta?.();
  // Matar o filho explicitamente: um processo de servidor órfão continuaria segurando a porta, e
  // o próximo `npm run server` do desenvolvedor falharia por um jogo que ele já fechou.
  servidorJogo?.kill();
});
