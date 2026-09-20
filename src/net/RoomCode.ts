/**
 * O CÓDIGO DA SALA — o que o jogador dita no telefone, e que basta por si só.
 *
 * ## O que o código PRECISA carregar
 *
 * A primeira versão deste módulo codificava só a identidade da sala. Isso não liga ninguém a
 * ninguém, e a medição é curta:
 *
 * ```
 * src/net/NetworkSession.ts   DEFAULT_SERVER = 'ws://127.0.0.1:2567'   ← o convidado fala consigo mesmo
 * server/index.ts             publicAddress  = `${lanIPv4()}:${port}`  ← o anfitrião mora noutro IP
 * ```
 *
 * Um código que diz apenas "sala X7K2" manda o convidado procurar a sala X7K2 **na máquina dele**.
 * Por isso o código carrega DUAS coisas: a sala e o ENDEREÇO de quem a hospeda. Continua sendo uma
 * cadeia curta, ditável e digitável — só deixou de ser um identificador solto.
 *
 * ## O formato
 *
 * ```
 * X7K2 S              sala local (mesmo endereço de onde a página veio)      5 caracteres
 * X7K2 V 4TQF9CM      sala num IPv4 (os quatro octetos em base32)           12 caracteres
 * X7K2 D 0A8C ...     sala num nome de servidor (porta + nome em base32)    variável
 * ^^^^ ^ ^^^^^^^
 * sala │ endereço
 *      espécie
 * ```
 *
 * A **sala** são os quatro primeiros caracteres e é o que vira SEMENTE — igual nos dois lados,
 * independentemente de como o endereço foi escrito. É isso que faz anfitrião e convidado caírem no
 * mesmo `filterBy(['seed'])` mesmo quando um digitou o código de dentro da LAN e o outro de fora.
 *
 * O dia em que existir um host público não muda uma linha de interface: o servidor já honra
 * `PUBLIC_HOST`, o endereço que ele publica passa a ser esse, e a espécie do código vira `D`
 * sozinha.
 *
 * ## O alfabeto
 *
 * Crockford Base32. O conjunto não tem `I`, `L`, `O` nem `U`, e a leitura ACEITA `I`, `l` e `L`
 * como `1` e `O`/`o` como `0` — que são exatamente os erros que um código ditado em voz alta
 * produz. Corrigir na entrada é melhor do que recusar: o jogador digitou o código certo.
 */

export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Tamanho da parte que identifica a SALA. É ela que vira semente. */
export const ROOM_PART_LENGTH = 4;
/** Porta padrão do servidor de salas; omitida do código quando é a que está em uso. */
export const DEFAULT_COOP_PORT = 2567;
const SEED_PREFIX = 'sala-';

/** As três espécies de endereço que um código pode carregar. */
export type RoomCodeKind = 'S' | 'V' | 'D';

export interface RoomCodeParts {
  /** Os quatro caracteres da sala. */
  readonly room: string;
  /** `host:porta` do servidor, ou `''` para "o mesmo de onde a página veio". */
  readonly address: string;
}

export interface DecodedRoomCode extends RoomCodeParts {
  readonly seed: string;
  /** `ws://host:porta`, ou `''` quando o código diz "mesma origem". */
  readonly server: string;
  readonly kind: RoomCodeKind;
}

// ---- base32 ---------------------------------------------------------------------------------

function encodeBits(values: readonly number[], bitsPerValue: number): string {
  let bits = 0, acc = 0, out = '';
  for (const value of values) {
    acc = (acc << bitsPerValue) | value; bits += bitsPerValue;
    while (bits >= 5) { bits -= 5; out += ROOM_CODE_ALPHABET[(acc >>> bits) & 31]; }
  }
  if (bits > 0) out += ROOM_CODE_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

/**
 * O inverso de `encodeBits`.
 *
 * O acumulador é MASCARADO a cada passo (`& ((1 << bits) - 1)`). Sem isso ele cresce sem limite e,
 * num endereço com mais de dez caracteres, passa dos 53 bits exatos do `number` — o sintoma é um
 * nome de servidor que volta com lixo no meio, exatamente o tipo de erro que só apareceria no dia
 * em que existisse um túnel.
 */
function decodeBits(text: string, count: number, bitsPerValue: number): number[] | undefined {
  let bits = 0, acc = 0;
  const out: number[] = [];
  for (const character of text) {
    const index = ROOM_CODE_ALPHABET.indexOf(character);
    if (index < 0) return undefined;
    acc = ((acc << 5) | index) >>> 0; bits += 5;
    while (bits >= bitsPerValue && out.length < count) {
      bits -= bitsPerValue;
      out.push((acc >>> bits) & ((1 << bitsPerValue) - 1));
      acc &= bits ? (1 << bits) - 1 : 0;
    }
  }
  return out.length === count ? out : undefined;
}

// ---- normalização ---------------------------------------------------------------------------

/** O que foi digitado, virado código canônico — ou `''` se não dá para ler. */
export function normalizeRoomCode(input: string): string {
  const clean = (input ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  if (clean.length < ROOM_PART_LENGTH) return '';
  for (const character of clean) if (!ROOM_CODE_ALPHABET.includes(character)) return '';
  return clean;
}

/** Só a parte da SALA. É a única coisa que precisa bater entre os dois jogadores. */
export function roomPart(code: string): string {
  return normalizeRoomCode(code).slice(0, ROOM_PART_LENGTH);
}

/** Uma sala nova. `random` entra por parâmetro para o teste fixar o sorteio. */
export function generateRoomPart(random: () => number = Math.random): string {
  let room = '';
  for (let i = 0; i < ROOM_PART_LENGTH; i++)
    room += ROOM_CODE_ALPHABET[Math.min(31, Math.floor(random() * 32))];
  return room;
}

/** A semente da sala. É esta a chave que vai para `joinOrCreate`. */
export function seedForCode(code: string): string {
  const room = roomPart(code);
  return room ? SEED_PREFIX + room.toLowerCase() : '';
}

/**
 * A sala de uma semente, quando ela veio de um código.
 *
 * `''` para as sementes de desenvolvimento (`f03a9243`, `lobby-3`): elas continuam salas válidas —
 * o atalho de URL não deixou de funcionar —, só não têm código. Inventar um prometeria um caminho
 * de entrada que não existe.
 */
export function codeFromSeed(seed: string): string {
  if (!seed?.toLowerCase().startsWith(SEED_PREFIX)) return '';
  const rest = seed.slice(SEED_PREFIX.length);
  return rest.length === ROOM_PART_LENGTH ? roomPart(rest) : '';
}

// ---- endereço -------------------------------------------------------------------------------

/** `host:porta` partido, com a porta padrão preenchida. */
export function splitAddress(address: string): { host: string; port: number } | undefined {
  const text = (address ?? '').trim().replace(/^wss?:\/\//, '').replace(/\/+$/, '');
  if (!text) return undefined;
  const match = /^([^:/]+)(?::(\d{1,5}))?$/.exec(text);
  if (!match) return undefined;
  const port = match[2] ? Number(match[2]) : DEFAULT_COOP_PORT;
  return port > 0 && port < 65536 ? { host: match[1]!, port } : undefined;
}

function ipv4Octets(host: string): number[] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  return octets.every(value => value >= 0 && value <= 255) ? octets : undefined;
}

/**
 * O código completo.
 *
 * `pageHost` é o servidor de onde a página veio: quando o servidor de salas mora no MESMO lugar, o
 * endereço não precisa viajar dentro do código e ele fica com cinco caracteres. É o caso do dia em
 * que existir um host público, e é por isso que nada na interface precisará mudar nesse dia.
 */
export function encodeRoomCode(parts: RoomCodeParts & { pageHost?: string }): string {
  const room = roomPart(parts.room);
  if (!room) return '';
  const address = splitAddress(parts.address);
  if (!address) return room + 'S';
  // "Mesma origem" compara o HOST, não a porta: a página vem do servidor web (5173, 80, 443) e a
  // sala vem do Colyseus (2567) — na mesma máquina, sempre portas diferentes. O que o código
  // precisa dizer é "o servidor de salas é o de onde você baixou o jogo", e isso é o host.
  const page = splitAddress(parts.pageHost ?? '');
  if (page && page.host === address.host && address.port === DEFAULT_COOP_PORT) return room + 'S';
  const octets = ipv4Octets(address.host);
  const port = address.port === DEFAULT_COOP_PORT ? '' : encodeBits([address.port], 16);
  if (octets) return room + 'V' + encodeBits(octets, 8) + port;
  const bytes = [...address.host.toUpperCase()].map(character => character.charCodeAt(0) & 127);
  return room + 'D' + encodeBits([address.port], 16) + encodeBits(bytes, 7);
}

/**
 * O código de volta em sala e endereço. `undefined` quando não dá para ler — e aí quem chamou
 * DIZ isso ao jogador, em vez de tentar entrar em alguma sala e travar esperando.
 */
export function decodeRoomCode(input: string): DecodedRoomCode | undefined {
  const code = normalizeRoomCode(input);
  if (!code) return undefined;
  const room = code.slice(0, ROOM_PART_LENGTH);
  const seed = seedForCode(room);
  const kind = (code[ROOM_PART_LENGTH] ?? 'S') as RoomCodeKind;
  const payload = code.slice(ROOM_PART_LENGTH + 1);
  if (code.length === ROOM_PART_LENGTH || (kind === 'S' && !payload)) return { room, seed, address: '', server: '', kind: 'S' };
  if (kind === 'V') {
    const octets = decodeBits(payload.slice(0, 7), 4, 8);
    if (!octets) return undefined;
    const port = payload.length > 7 ? decodeBits(payload.slice(7), 1, 16)?.[0] : DEFAULT_COOP_PORT;
    if (!port) return undefined;
    const address = `${octets.join('.')}:${port}`;
    return { room, seed, address, server: `ws://${address}`, kind };
  }
  if (kind === 'D') {
    const port = decodeBits(payload.slice(0, 4), 1, 16)?.[0];
    const rest = payload.slice(4);
    const bytes = decodeBits(rest, Math.floor((rest.length * 5) / 7), 7);
    if (!port || !bytes?.length) return undefined;
    const host = bytes.map(code7 => String.fromCharCode(code7)).join('').toLowerCase();
    const address = `${host}:${port}`;
    return { room, seed, address, server: `ws://${address}`, kind };
  }
  return undefined;
}

/** O código como ele é MOSTRADO: em grupos de quatro, que é como se lê um código em voz alta. */
export function formatRoomCode(code: string): string {
  const clean = normalizeRoomCode(code);
  return clean.replace(/(.{4})(?=.)/g, '$1-');
}
