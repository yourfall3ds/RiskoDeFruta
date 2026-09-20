/**
 * AS SALAS DISPONÍVEIS — de verdade, vindas do servidor.
 *
 * O `LobbyRoom` do Colyseus já está de pé (`server/index.ts`) e a `FarmRoom` já publica os seus
 * metadados (`enableRealtimeListing()` + `setMetadata`). O que faltava era o lado do jogador: uma
 * lista que ele possa olhar e clicar.
 *
 * Este arquivo tem duas metades bem separadas de propósito:
 *
 * - As funções PURAS (`toRoomRow`, `applyRoomEvent`) — a tradução de metadado em linha de tela e a
 *   fusão dos eventos incrementais do lobby. É onde moram as regras que interessam (sala cheia não
 *   é entrável, sala em partida não é listada) e é o que os testes exercitam sem servidor nenhum.
 * - O `ColyseusRoomBrowser`, que só transporta: entra no `lobby`, escuta e repassa.
 */

import type { FarmRoomMetadata } from '../../server/rooms/FarmRoom';
import { codeFromSeed } from './RoomCode';

/** Uma linha do navegador de salas. `seed` existe para ENTRAR, nunca para ser exibida. */
export interface RoomRow {
  readonly roomId: string;
  readonly code: string;
  /** O nome que o anfitrião deu à sala. Sempre preenchido: o servidor batiza pelo anfitrião. */
  readonly roomName: string;
  readonly hostName: string;
  readonly players: number;
  readonly max: number;
  readonly seed: string;
  readonly full: boolean;
}

/** O que o lobby do Colyseus entrega por sala. Só os campos que esta tela usa. */
export interface RoomAvailableLike {
  roomId: string;
  clients?: number;
  maxClients?: number;
  metadata?: Partial<FarmRoomMetadata> | undefined;
}

/** Ordinal de `PHASE.playing` no schema. Repetido aqui para o módulo não puxar o servidor em runtime. */
const PHASE_PLAYING = 1;
const DEFAULT_MAX = 4;

/**
 * Metadado → linha, ou `undefined` quando a sala não deve aparecer.
 *
 * Sala em PARTIDA não é listada: entrar nela hoje cairia numa corrida já em curso, com a horda e a
 * economia adiantadas — e a `FarmRoom` continua aceitando o join, então a recusa tem de ser aqui.
 * Sala CHEIA continua listada, porque ver "4/4" é informação; o que ela não fica é entrável.
 */
export function toRoomRow(entry: RoomAvailableLike): RoomRow | undefined {
  const meta = entry.metadata ?? {};
  if (meta.phase === PHASE_PLAYING) return undefined;
  const seed = String(meta.seed ?? '');
  if (!seed) return undefined;
  const max = Number(meta.maxClients ?? entry.maxClients ?? DEFAULT_MAX);
  // `playerCount` é do metadado (quem está no ESTADO da sala); `clients` é a contagem de conexões.
  // O primeiro é o que o jogador entende por "quantos estão lá dentro".
  const players = Number(meta.playerCount ?? entry.clients ?? 0);
  const hostName = String(meta.hostName ?? '').trim();
  return {
    roomId: entry.roomId,
    code: codeFromSeed(seed),
    roomName: String(meta.roomName ?? '').trim() || (hostName ? `SALA DE ${hostName}` : 'SALA ABERTA'),
    hostName: hostName || '—',
    players, max, seed,
    full: players >= max,
  };
}

export type RoomEvent =
  | { type: 'rooms'; rooms: readonly RoomAvailableLike[] }
  | { type: 'add'; room: RoomAvailableLike }
  | { type: 'remove'; roomId: string };

/**
 * A lista depois do evento. Sem estado escondido: a lista entra, a lista sai.
 *
 * O `LobbyRoom` manda a lista inteira uma vez e depois só diferenças (`+` e `-`), e o `+` serve
 * tanto para sala nova quanto para sala que mudou (alguém entrou, o anfitrião trocou). Por isso o
 * acréscimo SUBSTITUI a linha de mesmo `roomId` em vez de duplicá-la.
 */
export function applyRoomEvent(rows: readonly RoomRow[], event: RoomEvent): RoomRow[] {
  if (event.type === 'rooms') return event.rooms.map(toRoomRow).filter((row): row is RoomRow => !!row);
  if (event.type === 'remove') return rows.filter(row => row.roomId !== event.roomId);
  const row = toRoomRow(event.room);
  const rest = rows.filter(existing => existing.roomId !== event.room.roomId);
  if (!row) return rest;
  const index = rows.findIndex(existing => existing.roomId === event.room.roomId);
  // Uma sala que só mudou de contagem não pode PULAR para o fim da lista embaixo do cursor.
  if (index < 0) return [...rest, row];
  rest.splice(index, 0, row);
  return rest;
}

export interface RoomBrowserLink {
  readonly rooms: readonly RoomRow[];
  /** Por que não há lista. Vazio enquanto o servidor de salas responde. */
  readonly error: string;
  onChange(listener: () => void): () => void;
  dispose(): void;
}

/** O navegador de salas ligado no `LobbyRoom`. O SDK só é tocado aqui. */
export class ColyseusRoomBrowser implements RoomBrowserLink {
  rooms: RoomRow[] = [];
  error = '';
  private room: { leave(consented?: boolean): unknown } | undefined;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  constructor(readonly url: string) {}

  async connect(): Promise<void> {
    try {
      const { Client } = await import('@colyseus/sdk');
      const room = await new Client(this.url).joinOrCreate('lobby');
      if (this.disposed) { void room.leave(true); return; }
      this.room = room as unknown as { leave(consented?: boolean): unknown };
      room.onMessage('rooms', (rooms: RoomAvailableLike[]) => this.apply({ type: 'rooms', rooms }));
      room.onMessage('+', ([, entry]: [string, RoomAvailableLike]) => this.apply({ type: 'add', room: entry }));
      room.onMessage('-', (roomId: string) => this.apply({ type: 'remove', roomId }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'sem servidor';
      this.notify();
    }
  }

  private apply(event: RoomEvent): void {
    this.rooms = applyRoomEvent(this.rooms, event);
    this.notify();
  }
  private notify(): void { for (const listener of this.listeners) listener(); }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    void this.room?.leave(true);
    this.room = undefined;
  }
}
