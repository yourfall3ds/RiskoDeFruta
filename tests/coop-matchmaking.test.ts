import { describe, it, expect } from 'vitest';
import {
  decodeRoomCode, encodeRoomCode, formatRoomCode, generateRoomPart,
  normalizeRoomCode, roomPart, seedForCode, codeFromSeed, splitAddress,
} from '../src/net/RoomCode';
import { loadPlayerName, savePlayerName, sanitizePlayerName, type NameStorage } from '../src/net/PlayerName';
import { coopHref, readCoopNotice, readOnlineIntent, writeCoopNotice, writeOnlineIntent, clearOnlineIntent, type IntentStorage } from '../src/net/OnlineIntent';
import { applyRoomEvent, toRoomRow, type RoomAvailableLike } from '../src/net/RoomBrowser';
import { lobbyBlockerText } from '../src/net/LobbyStatus';
import { coopServerUrl, pickRoomPart } from '../src/net/Multiplayer';
import type { LobbyPlayer } from '../src/net/LobbyLink';

/**
 * O MATCHMAKING VISTO PELO JOGADOR, medido sem servidor.
 *
 * Tudo que decide para onde o jogador vai — o código, a semente por baixo, o nome guardado, a
 * intenção que atravessa a recarga e a lista de salas — é função pura de propósito. É o que permite
 * cobrir aqui, em milissegundos, exatamente os casos que quebram na mão de quem joga: código
 * ditado em voz alta com `O` no lugar de `0`, sala cheia, sala que sumiu, servidor noutro IP.
 */

/** Armazenamento de mentira, com a mesma superfície de `localStorage`/`sessionStorage`. */
function fakeStorage(): NameStorage & IntentStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

describe('código da sala', () => {
  it('a sala vira semente e a semente volta a ser sala', () => {
    expect(seedForCode('X7K2')).toBe('sala-x7k2');
    expect(codeFromSeed('sala-x7k2')).toBe('X7K2');
    // Semente de desenvolvimento continua válida como sala — só não tem código para mostrar.
    expect(codeFromSeed('f03a9243')).toBe('');
    expect(codeFromSeed('lobby-3')).toBe('');
  });

  it('perdoa os erros de quem digitou um código ditado em voz alta', () => {
    // `O`→`0`, `I`/`L`→`1`, minúsculas, espaço e hífen: nada disso é erro do jogador.
    expect(normalizeRoomCode('x7k2')).toBe('X7K2');
    expect(normalizeRoomCode('X7-K2')).toBe('X7K2');
    expect(normalizeRoomCode(' x 7 k 2 ')).toBe('X7K2');
    expect(normalizeRoomCode('OIL5')).toBe('0115');
    expect(roomPart('0115V4TQF9C')).toBe('0115');
    // Curto demais ou com caractere fora do alfabeto: recusa, em vez de adivinhar outra sala.
    expect(normalizeRoomCode('X7K')).toBe('');
    expect(normalizeRoomCode('X7K@')).toBe('');
  });

  it('o código sorteado usa só o alfabeto legível', () => {
    for (let i = 0; i < 200; i++) {
      const room = generateRoomPart();
      expect(room).toHaveLength(4);
      expect(normalizeRoomCode(room)).toBe(room);
    }
  });

  it('um código novo não repete sala já aberta', () => {
    // Sorteio viciado nas duas primeiras tentativas: o terceiro valor é o que sobra.
    const valores = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const room = pickRoomPart(['0000'], () => valores[i++] ?? 0.5);
    expect(room).not.toBe('0000');
  });
});

describe('o código carrega o endereço do anfitrião', () => {
  it('IPv4 vai e volta, com e sem porta fora do padrão', () => {
    // O caso real: o servidor publica o IP da LAN, e a página do anfitrião veio de `localhost`.
    const code = encodeRoomCode({ room: 'X7K2', address: '192.168.15.42:2567', pageHost: 'localhost' });
    const decoded = decodeRoomCode(code);
    expect(decoded?.room).toBe('X7K2');
    expect(decoded?.address).toBe('192.168.15.42:2567');
    expect(decoded?.server).toBe('ws://192.168.15.42:2567');
    // A semente sai da SALA, não do endereço: os dois lados caem no mesmo `filterBy(['seed'])`.
    expect(decoded?.seed).toBe(seedForCode('X7K2'));

    const outraPorta = decodeRoomCode(encodeRoomCode({ room: 'X7K2', address: '10.0.0.7:2600', pageHost: 'localhost' }));
    expect(outraPorta?.server).toBe('ws://10.0.0.7:2600');
  });

  it('nome de servidor (o dia do túnel) vai e volta sem a interface mudar', () => {
    const code = encodeRoomCode({ room: 'AB34', address: 'coop.exemplo.com:443', pageHost: 'localhost' });
    const decoded = decodeRoomCode(code);
    expect(decoded?.address).toBe('coop.exemplo.com:443');
    expect(decoded?.server).toBe('ws://coop.exemplo.com:443');
  });

  it('servidor na mesma origem da página dispensa o endereço', () => {
    const code = encodeRoomCode({ room: 'X7K2', address: 'jogo.exemplo.com:2567', pageHost: 'jogo.exemplo.com' });
    expect(code).toBe('X7K2S');
    const decoded = decodeRoomCode(code);
    expect(decoded?.room).toBe('X7K2');
    // Endereço vazio significa "o servidor de onde você baixou o jogo" — quem entra usa o próprio.
    expect(decoded?.server).toBe('');
  });

  it('código ilegível é recusado, não vira sala errada', () => {
    expect(decodeRoomCode('')).toBeUndefined();
    expect(decodeRoomCode('X7K')).toBeUndefined();
    expect(decodeRoomCode('X7K2Z99')).toBeUndefined();     // espécie desconhecida
    expect(decodeRoomCode('X7K2V4T')).toBeUndefined();     // endereço truncado
  });

  it('o código é mostrado em grupos de quatro, que é como se lê em voz alta', () => {
    expect(formatRoomCode('X7K2V4TQF9C')).toBe('X7K2-V4TQ-F9C');
  });

  it('endereço com esquema e barra continua sendo o mesmo endereço', () => {
    expect(splitAddress('ws://192.168.0.5:2567/')).toEqual({ host: '192.168.0.5', port: 2567 });
    expect(splitAddress('exemplo.com')).toEqual({ host: 'exemplo.com', port: 2567 });
    expect(splitAddress('')).toBeUndefined();
  });

  it('o endereço do servidor de salas é deduzido de onde a página veio', () => {
    expect(coopServerUrl('http://192.168.15.42:5173/')).toBe('ws://192.168.15.42:2567');
    expect(coopServerUrl('https://jogo.exemplo.com/')).toBe('wss://jogo.exemplo.com:2567');
    // `?server=` explícito continua mandando: é o caminho de desenvolvimento.
    expect(coopServerUrl('http://localhost:5173/?server=ws://10.1.1.1:9999')).toBe('ws://10.1.1.1:9999');
  });
});

describe('o nome do jogador, perguntado uma vez', () => {
  it('salva e relê, sem perguntar de novo', () => {
    const storage = fakeStorage();
    expect(loadPlayerName(storage)).toBe('');           // primeira vez: a pergunta aparece
    expect(savePlayerName('  Lucas  ', storage)).toBe('Lucas');
    expect(loadPlayerName(storage)).toBe('Lucas');      // segunda vez: não pergunta mais
  });

  it('nome vazio não apaga o que já valia', () => {
    const storage = fakeStorage();
    savePlayerName('Lucas', storage);
    expect(savePlayerName('   ', storage)).toBe('');
    expect(loadPlayerName(storage)).toBe('Lucas');
  });

  it('corta no limite e normaliza espaços', () => {
    expect(sanitizePlayerName('  jo   ão  ')).toBe('jo ão');
    expect(sanitizePlayerName('x'.repeat(40))).toHaveLength(16);
  });

  it('armazenamento que lança (janela anônima) não derruba o menu', () => {
    const quebrado: NameStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
    expect(loadPlayerName(quebrado)).toBe('');
    expect(savePlayerName('Lucas', quebrado)).toBe('Lucas');
  });
});

describe('a intenção de co-op atravessa a recarga sem URL', () => {
  it('grava, relê e faz o jogo enxergar `online=1&seed=`', () => {
    const storage = fakeStorage();
    writeOnlineIntent({ code: 'X7K2', seed: 'sala-x7k2', name: 'Lucas', server: 'ws://192.168.15.42:2567', roomName: 'SALA DE LUCAS' }, storage);
    const intent = readOnlineIntent(storage);
    expect(intent?.seed).toBe('sala-x7k2');
    expect(intent?.server).toBe('ws://192.168.15.42:2567');

    // A URL do jogador continua limpa; quem passa a ver `online=1` é só o código interno.
    const href = coopHref('http://localhost:5173/', intent);
    expect(new URL(href).searchParams.get('online')).toBe('1');
    expect(new URL(href).searchParams.get('seed')).toBe('sala-x7k2');
  });

  it('a URL explícita manda sobre a intenção esquecida na aba', () => {
    const intent = { code: 'X7K2', seed: 'sala-x7k2', name: 'Lucas', server: '', roomName: '' };
    const href = coopHref('http://localhost:5173/?online=1&seed=f03a9243', intent);
    expect(new URL(href).searchParams.get('seed')).toBe('f03a9243');
  });

  it('sem intenção, a URL passa intacta — o single-player não muda em nada', () => {
    expect(coopHref('http://localhost:5173/', undefined)).toBe('http://localhost:5173/');
  });

  it('intenção corrompida é tratada como ausência', () => {
    const storage = fakeStorage();
    storage.setItem('rdf.coop.intencao', '{lixo');
    expect(readOnlineIntent(storage)).toBeUndefined();
  });

  it('sair da sala limpa a intenção e deixa o motivo para o menu', () => {
    const storage = fakeStorage();
    writeOnlineIntent({ code: 'X7K2', seed: 'sala-x7k2', name: 'Lucas', server: '', roomName: '' }, storage);
    clearOnlineIntent(storage);
    writeCoopNotice('O ANFITRIÃO ENCERROU A SALA', storage);
    expect(readOnlineIntent(storage)).toBeUndefined();
    expect(readCoopNotice(storage)).toBe('O ANFITRIÃO ENCERROU A SALA');
    // Lido UMA vez: o aviso não pode reaparecer na próxima visita ao menu.
    expect(readCoopNotice(storage)).toBe('');
  });
});

describe('a lista de salas', () => {
  const sala = (over: Partial<RoomAvailableLike['metadata']> & { roomId?: string } = {}): RoomAvailableLike => ({
    roomId: over.roomId ?? 'r1',
    clients: 1,
    maxClients: 4,
    metadata: { seed: 'sala-x7k2', playerCount: 1, maxClients: 4, hostName: 'LUCAS', phase: 0, roomName: '', address: '192.168.15.42:2567', ...over },
  });

  it('mostra nome, anfitrião e lotação, e o código continua saindo da semente', () => {
    const row = toRoomRow(sala())!;
    expect(row.roomName).toBe('SALA DE LUCAS');
    expect(row.hostName).toBe('LUCAS');
    expect(row.players).toBe(1);
    expect(row.max).toBe(4);
    expect(row.code).toBe('X7K2');
    expect(row.full).toBe(false);
  });

  it('o nome dado pelo anfitrião ganha do nome automático', () => {
    expect(toRoomRow(sala({ roomName: 'TESTE COOP' }))!.roomName).toBe('TESTE COOP');
  });

  it('sala 4/4 aparece cheia — e cheia não é entrável', () => {
    const row = toRoomRow(sala({ playerCount: 4 }))!;
    expect(row.players).toBe(4);
    expect(row.full).toBe(true);
  });

  it('sala já em partida não é listada', () => {
    expect(toRoomRow(sala({ phase: 1 }))).toBeUndefined();
  });

  it('a lista segue os eventos do lobby sem duplicar nem embaralhar', () => {
    let rows = applyRoomEvent([], { type: 'rooms', rooms: [sala({ roomId: 'a' }), sala({ roomId: 'b', hostName: 'JOÃO' })] });
    expect(rows.map(row => row.roomId)).toEqual(['a', 'b']);

    // `+` de uma sala que já existe é ATUALIZAÇÃO: ela não pode pular para o fim da lista.
    rows = applyRoomEvent(rows, { type: 'add', room: sala({ roomId: 'a', playerCount: 3 }) });
    expect(rows.map(row => row.roomId)).toEqual(['a', 'b']);
    expect(rows[0]!.players).toBe(3);

    rows = applyRoomEvent(rows, { type: 'add', room: sala({ roomId: 'c' }) });
    expect(rows.map(row => row.roomId)).toEqual(['a', 'b', 'c']);

    rows = applyRoomEvent(rows, { type: 'remove', roomId: 'b' });
    expect(rows.map(row => row.roomId)).toEqual(['a', 'c']);

    // Uma sala que entrou em partida SOME da lista pelo mesmo caminho do `+`.
    rows = applyRoomEvent(rows, { type: 'add', room: sala({ roomId: 'a', phase: 1 }) });
    expect(rows.map(row => row.roomId)).toEqual(['c']);
  });
});

describe('o que está travando a largada', () => {
  const jogador = (over: Partial<LobbyPlayer>): LobbyPlayer => ({
    id: 's1', entityId: 1, name: 'LUCAS', classId: 'gunslinger', connected: true, ready: true, host: true, self: true, ...over,
  });

  it('diz QUEM falta e o QUÊ, em vez de deixar o botão morto', () => {
    expect(lobbyBlockerText([jogador({}), jogador({ id: 's3', entityId: 3, name: 'JOÃO', classId: undefined, host: false, self: false })]))
      .toBe('P3 JOÃO ainda não escolheu personagem');
    expect(lobbyBlockerText([jogador({}), jogador({ id: 's2', entityId: 2, name: 'ANA', ready: false, host: false, self: false })]))
      .toBe('P2 ANA ainda não deu PRONTO');
  });

  it('com todos prontos e escolhidos, anuncia a largada', () => {
    expect(lobbyBlockerText([jogador({})])).toBe('TODOS PRONTOS · A PARTIDA VAI COMEÇAR');
    expect(lobbyBlockerText([jogador({})], 'playing')).toBe('A PARTIDA COMEÇOU');
  });

  it('sala ainda sem resposta não finge saber', () => {
    expect(lobbyBlockerText([])).toBe('AGUARDANDO A SALA RESPONDER');
  });
});
