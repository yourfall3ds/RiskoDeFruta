/**
 * A SALA VIVE FORA DA CENA.
 *
 * ## O que foi medido
 *
 * Abrir MULTIPLAYER, criar sala e sair da sala reconstruíam a cena inteira, cada uma delas: o
 * console do jogo registrava `[planeta] mapa (manifesto + casca + colisão + destrutíveis): 35783 ms`
 * ao entrar e outros `30881 ms` ao voltar. O jogador via a tela de carregamento três vezes antes de
 * chegar a jogar — e duas delas eram para montar um mapa que ele nem ia pisar.
 *
 * ## Por que acontecia
 *
 * A conexão de sala nascia DENTRO da `PlayerScene` (`NetworkSession.fromLocation`). Como a cena lê
 * a URL para decidir o mundo — fora do co-op é o PLANETA, dentro é a FAZENDA —, a única forma de
 * ter sala era já estar na fazenda. Entrar no lobby virava, portanto, "troque de mundo agora".
 *
 * ## A separação
 *
 * O lobby é MENU, não partida. Escolher personagem, ver o roster, dar PRONTO e sair são todas
 * ações de menu, e nenhuma delas precisa de mundo nenhum montado. Então a conexão passa a morar
 * aqui, num registro de módulo que atravessa a troca de cena, e a cena — quando finalmente nasce na
 * fazenda, porque a PARTIDA começou — **adota** a conexão já aberta em vez de abrir uma segunda.
 *
 * Duas consequências que são o ponto do trabalho:
 *
 * - entrar e sair de sala não constroem mapa nenhum: a cena que está de pé continua de pé;
 * - o jogador não perde a vaga ao entrar em campo, porque a sala não cai junto com a cena velha.
 *
 * ## Sem SDK no caminho do menu
 *
 * `MenuShell` e `PlayerHUD` rodam em testes de DOM sem servidor, e este módulo está no meio deles.
 * Por isso o cliente de rede entra por `import()` tardio — a mesma razão que já governa
 * `Multiplayer.browse` — e `NetworkClient` entra só como TIPO, que some na compilação. Nada aqui
 * importa Colyseus.
 */

import type { LobbyLink } from './LobbyLink';
import type { OnlineIntent } from './OnlineIntent';
import { logger } from '../core/Log';
import { LOCAL_SERVER_URL, serverUrlFor } from './ServerAddress';

const log = logger('sala');

/**
 * O endereço padrão: o HOST DE ONDE A PÁGINA VEIO, e só depois a máquina local.
 *
 * Era `ws://127.0.0.1:2567` cravado, e isso serve a exatamente uma pessoa — quem hospeda. Quem abre
 * `http://192.168.15.42:5173` na LAN do anfitrião e entra por `?online=1` (o caminho do
 * `jogar-coop.ps1` e o da URL colada à mão) era mandado a falar com o `127.0.0.1` da PRÓPRIA
 * máquina, onde não há servidor nenhum: a sala não responde e a tela diz só "não consegui entrar",
 * sem nada ligando isso ao endereço.
 *
 * O caminho do MENU já resolvia certo por `ServerAddress.serverUrlFor`; era este atalho que ficou
 * para trás. `LOCAL_SERVER_URL` continua sendo a queda final para quando não há página legível
 * (`file://`, href inválido, testes) — aí a máquina local é de fato o único palpite honesto.
 */
export const DEFAULT_COOP_SERVER = typeof location === 'undefined' ? LOCAL_SERVER_URL : serverUrlFor(location.href);

/**
 * O que a sala viva precisa saber fazer: é `LobbyLink` (tudo o que a interface enxerga) mais o
 * ciclo de vida que só quem a abriu manuseia. `NetworkClient` já satisfaz isto palavra por palavra,
 * e é por isso que a cena pode adotá-la sem nenhuma tradução no meio.
 */
export interface RoomConnection extends LobbyLink {
  readonly url: string;
  connect(): Promise<void>;
  dispose(): void;
}

/** Abre — mas não conecta — a sala de uma intenção. A conexão é o passo seguinte, e é dele o erro. */
export type RoomConnector = (intent: OnlineIntent) => RoomConnection | Promise<RoomConnection>;

/** Quem escuta a sala nascer e morrer. `undefined` é "não há sala"; o texto é o motivo. */
export type RoomListener = (room: RoomConnection | undefined, notice: string) => void;

let connector: RoomConnector | undefined;
let current: RoomConnection | undefined;
const listeners = new Set<RoomListener>();

/**
 * Troca quem sabe abrir uma sala. Existe para os testes exercitarem o fluxo inteiro do menu sem
 * subir servidor; em produção o padrão é o `NetworkClient` carregado por `import()`.
 */
export function setRoomConnector(fn: RoomConnector | undefined): void { connector = fn; }

/**
 * A sala aberta, se há alguma — e é esta que a cena ADOTA em vez de abrir outra.
 *
 * Adotar deliberadamente NÃO tira a sala do registro: quem a abriu (o menu) continua sendo quem a
 * fecha, e é isso que garante que exista uma conexão só. A cena empresta, usa, e nunca descarta.
 */
export function currentRoom(): RoomConnection | undefined { return current; }

/**
 * A mesma sala, vista como o CLIENTE completo de que a cena precisa (input, predição, horda,
 * economia) — o menu só enxerga `RoomConnection`, que é a fatia de lobby.
 *
 * A conversão é segura porque quem abre salas em produção é `lazyConnector`, e o que ele constrói
 * é um `NetworkClient`. Só os testes injetam outra coisa, e ali quem adota é o teste, não a cena.
 * O `import type` some na compilação, então nada de Colyseus entra no caminho do menu por aqui.
 */
export function currentRoomClient(): import('./NetworkClient').NetworkClient | undefined {
  return current as import('./NetworkClient').NetworkClient | undefined;
}

export function onRoomChange(listener: RoomListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(notice: string): void {
  for (const listener of [...listeners]) listener(current, notice);
}

/**
 * Abre a sala SEM sair do menu.
 *
 * Devolve `false` só quando não há quem conecte — e aí quem chamou cai no caminho antigo (relançar
 * a cena, ou recarregar a página), que é a rede de segurança que mantém `?online=1&seed=` e o
 * `jogar-coop.ps1` funcionando exatamente como funcionavam.
 */
export function openRoom(intent: OnlineIntent): boolean {
  const open = connector ?? lazyConnector();
  if (!open) return false;
  // Uma sala de cada vez. Entrar noutra sem fechar a anterior deixaria duas conexões vivas — que é
  // exatamente o que este módulo existe para impedir.
  closeRoom();
  const token = ++generation;
  void (async () => {
    let room: RoomConnection;
    try { room = await open(intent); } catch { if (token === generation) fail(token, intent); return; }
    if (token !== generation) { room.dispose(); return; }
    current = room;
    log.info('sala aberta pelo menu, sem refazer a cena', { codigo: intent.code, servidor: room.url });
    notify('');
    try { await room.connect(); } catch {
      // A sala não subiu: a conexão morre aqui e o menu diz o motivo. Deixar o jogador numa tela de
      // sala que nunca vai responder seria pior do que a recusa escrita.
      if (token === generation) { log.aviso('não consegui entrar na sala', { codigo: intent.code, motivo: room.failure }); fail(token, intent); }
      return;
    }
    if (token !== generation) return;
    log.info('conectado à sala', { codigo: intent.code, jogadores: room.players.length });
    notify('');
  })();
  return true;
}

/**
 * A geração da sala. Abrir uma sala e desistir dela antes de a conexão voltar é comum (o jogador
 * clica em CRIAR e em VOLTAR em sequência); sem este contador, a conexão atrasada ressuscitaria uma
 * sala que já foi fechada.
 */
let generation = 0;

function fail(token: number, intent: OnlineIntent): void {
  if (token !== generation) return;
  log.aviso('a sala não respondeu', { codigo: intent.code, servidor: intent.server });
  closeRoom('NÃO CONSEGUI ENTRAR NA SALA');
}

/** Fecha a sala e avisa quem escuta. Chamável sem sala aberta — é o caso do single-player. */
export function closeRoom(notice = ''): void {
  const room = current;
  current = undefined;
  generation++;
  if (room) { try { room.dispose(); } catch { /* a sala já tinha caído; o menu segue de pé */ } }
  if (room || notice) notify(notice);
}

/**
 * O conector de produção.
 *
 * O `import()` é assíncrono, então a sala não existe no instante do clique. A tela da sala aparece
 * assim mesmo, na hora: quem a mostra é o menu (`MenuShell.showRoom`), com roster vazio e código em
 * reticências — exatamente o que ela já mostrava enquanto a boas-vindas não chegava.
 */
function lazyConnector(): RoomConnector | undefined {
  if (typeof window === 'undefined') return undefined;
  return async (intent: OnlineIntent): Promise<RoomConnection> => {
    const { NetworkClient } = await import('./NetworkClient');
    return new NetworkClient(intent.server || DEFAULT_COOP_SERVER, intent.seed, intent.name, intent.roomName);
  };
}
