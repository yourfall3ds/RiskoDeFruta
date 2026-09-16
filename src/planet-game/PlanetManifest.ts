import type {Vec3} from '../core/contracts';

/**
 * Manifesto autoral do arquipélago esférico (`public/models/planet-archipelago.json`).
 *
 * É a ÚNICA fonte de verdade do mundo: a geometria de colisão já vem transformada para
 * coordenadas GLOBAIS pelo Codex, junto com o GLB de mesma raiz. Nada aqui rotaciona,
 * escala ou reposiciona nada — reposicionar de novo é exatamente como se produz a emenda
 * entre o que se vê e o que sustenta o corpo.
 *
 * O `PLANET_LAYOUT` de seis slots do núcleo (`src/planet`) é demonstração matemática; a cena
 * de jogo usa este manifesto, que tem catorze ilhas e vinte e quatro pontes.
 */
export interface IslandRecord {
  readonly id: string;
  readonly name: string;
  /** Direção unitária do centro do planeta até o convés da ilha. */
  readonly up: Vec3;
  /** Centro do convés em espaço de mundo. */
  readonly centre: Vec3;
  /** Ponto de nascimento sugerido pelo autor; ainda validado por sonda radial. */
  readonly spawn: Vec3;
  /** Raio da pegada caminhável, em metros. */
  readonly radius: number;
  /** GLB de origem, só para diagnóstico. */
  readonly source: string;
}

export interface BridgeRecord {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly width: number;
  /** Polilinha do convés da ponte em espaço de mundo, da ilha `a` até a `b`. */
  readonly waypoints: readonly Vec3[];
}

export interface PlanetManifest {
  readonly version: number;
  readonly centre: Vec3;
  readonly radius: number;
  /** Vértices da malha de colisão, em espaço de mundo: `[x,y,z, x,y,z, ...]`. */
  readonly positions: Float64Array;
  /** Triângulos da malha de colisão. */
  readonly indices: Uint32Array;
  readonly islands: readonly IslandRecord[];
  readonly bridges: readonly BridgeRecord[];
  /**
   * Cenário quebrável, CRU, como veio do arquivo (`version: 2`).
   *
   * Passa direto, sem validação aqui, de propósito: quem valida é `parseDestructibles` em
   * `src/destruction/DestructibleTypes.ts`, que é o dono do formato e já devolve os registros
   * aceitos junto com a lista de recusados. Validar nos dois lugares só criaria duas verdades.
   *
   * Ausente é o caso normal (`version: 1`): o planeta carrega igual e nada quebra. Por isso o
   * campo é OPCIONAL — um manifesto antigo continua satisfazendo o tipo sem nenhuma mudança.
   */
  readonly destructibles?: unknown;
}

/** Falha de manifesto com mensagem já pronta para o HUD, em português. */
export class PlanetManifestError extends Error {
  constructor(message: string) {super(message); this.name = 'PlanetManifestError';}
}

const fail = (message: string): never => {throw new PlanetManifestError(message);};

const finite = (value: unknown, where: string): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fail(`${where} não é um número finito`);
};

const vec3 = (value: unknown, where: string): Vec3 => {
  if (!value || typeof value !== 'object') fail(`${where} não é um vetor`);
  const raw = value as Record<string, unknown>;
  return {x: finite(raw.x, `${where}.x`), y: finite(raw.y, `${where}.y`), z: finite(raw.z, `${where}.z`)};
};

const text = (value: unknown, where: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fail(`${where} não é um texto válido`);

/**
 * Converte a lista numérica do JSON num buffer tipado, rejeitando NaN/Infinity.
 *
 * Um único vértice NaN contamina a árvore de colisão inteira e o corpo cai para sempre sem
 * explicação — vale mais recusar o mapa com o índice do vértice ruim na mensagem.
 */
function numbers<T extends Float64Array | Uint32Array>(
  value: unknown, where: string, multiple: number, make: (size: number) => T,
): T {
  if (!Array.isArray(value)) fail(`${where} não é uma lista`);
  const list = value as unknown[];
  if (list.length === 0) fail(`${where} está vazia`);
  if (list.length % multiple !== 0) fail(`${where} tem ${list.length} itens, que não é múltiplo de ${multiple}`);
  // Escreve DIRETO no buffer tipado. O manifesto do planeta tem milhões de entradas; um
  // `number[]` intermediário dobraria o pico de memória do carregamento sem nenhum ganho.
  const out = make(list.length);
  for (let i = 0; i < list.length; i++) {
    const n = Number(list[i]);
    if (!Number.isFinite(n)) fail(`${where}[${i}] não é um número finito`);
    out[i] = n;
  }
  return out;
}

function island(value: unknown, index: number): IslandRecord {
  if (!value || typeof value !== 'object') fail(`islands[${index}] não é um objeto`);
  const raw = value as Record<string, unknown>;
  const where = `islands[${index}]`;
  const radius = finite(raw.radius, `${where}.radius`);
  if (radius <= 0) fail(`${where}.radius precisa ser positivo`);
  const up = vec3(raw.up, `${where}.up`);
  const norm = Math.hypot(up.x, up.y, up.z);
  if (norm < 1e-6) fail(`${where}.up é degenerado`);
  return {
    id: text(raw.id, `${where}.id`),
    name: typeof raw.name === 'string' && raw.name ? raw.name : text(raw.id, `${where}.name`),
    up: {x: up.x / norm, y: up.y / norm, z: up.z / norm},
    centre: vec3(raw.centre, `${where}.centre`),
    spawn: vec3(raw.spawn, `${where}.spawn`),
    radius,
    source: typeof raw.source === 'string' ? raw.source : '',
  };
}

function bridge(value: unknown, index: number, islandIds: ReadonlySet<string>): BridgeRecord {
  if (!value || typeof value !== 'object') fail(`bridges[${index}] não é um objeto`);
  const raw = value as Record<string, unknown>;
  const where = `bridges[${index}]`;
  const a = text(raw.a, `${where}.a`), b = text(raw.b, `${where}.b`);
  if (!islandIds.has(a)) fail(`${where}.a aponta para a ilha desconhecida "${a}"`);
  if (!islandIds.has(b)) fail(`${where}.b aponta para a ilha desconhecida "${b}"`);
  const list = Array.isArray(raw.waypoints) ? (raw.waypoints as unknown[]) : fail(`${where}.waypoints não é uma lista`);
  if (list.length < 2) fail(`${where}.waypoints precisa de pelo menos dois pontos`);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${a}~${b}`,
    a, b,
    width: raw.width === undefined ? 6 : finite(raw.width, `${where}.width`),
    waypoints: list.map((point, i) => vec3(point, `${where}.waypoints[${i}]`)),
  };
}

/**
 * Valida o JSON já decodificado e devolve o manifesto tipado.
 *
 * Erro de validação é sempre `PlanetManifestError` com o campo culpado na mensagem: a cena
 * mostra o texto direto no HUD em vez de um "falhou" genérico.
 */
export function parsePlanetManifest(data: unknown): PlanetManifest {
  if (!data || typeof data !== 'object') fail('O manifesto do planeta não é um objeto JSON');
  const raw = data as Record<string, unknown>;
  const version = raw.version === undefined ? 1 : finite(raw.version, 'version');
  const radius = finite(raw.radius, 'radius');
  if (radius <= 0) fail('radius precisa ser positivo');
  const positions = numbers(raw.positions, 'positions', 3, size => new Float64Array(size));
  const rawIndices = raw.indices;
  if (!Array.isArray(rawIndices)) fail('indices não é uma lista');
  const vertices = positions.length / 3;
  for (let i = 0; i < (rawIndices as unknown[]).length; i++) {
    const value = Number((rawIndices as unknown[])[i]);
    if (!Number.isInteger(value) || value < 0 || value >= vertices)
      fail(`indices[${i}] = ${value} está fora dos ${vertices} vértices`);
  }
  const indices = numbers(rawIndices, 'indices', 3, size => new Uint32Array(size));
  const islandList = Array.isArray(raw.islands) ? (raw.islands as unknown[]).map(island) : fail('islands não é uma lista');
  if (islandList.length === 0) fail('O manifesto não traz nenhuma ilha');
  const ids = new Set<string>();
  for (const entry of islandList) {
    if (ids.has(entry.id)) fail(`A ilha "${entry.id}" aparece duas vezes`);
    ids.add(entry.id);
  }
  const bridgeList = Array.isArray(raw.bridges)
    ? (raw.bridges as unknown[]).map((entry, i) => bridge(entry, i, ids))
    : fail('bridges não é uma lista');
  return {
    version,
    centre: raw.centre === undefined ? {x: 0, y: 0, z: 0} : vec3(raw.centre, 'centre'),
    radius,
    positions,
    indices,
    islands: islandList,
    bridges: bridgeList,
    // `version: 2` acrescenta esta chave; a ausência dela NÃO é erro — é o build atual.
    ...(raw.destructibles === undefined ? {} : {destructibles: raw.destructibles}),
  };
}

export const PLANET_MANIFEST_URL = '/models/planet-archipelago.json.gz';
export const PLANET_MESH_URL = '/models/planet-archipelago.glb';

/** Baixa e valida o manifesto. A ausência do arquivo vira uma instrução, não um 404 cru. */
export async function loadPlanetManifest(url = PLANET_MANIFEST_URL, fetcher: typeof fetch = fetch): Promise<PlanetManifest> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new PlanetManifestError(`Não foi possível buscar ${url}`);
  }
  if (!response.ok) {
    throw new PlanetManifestError(response.status === 404
      ? `O mapa do planeta ainda não foi gerado (${url} não existe)`
      : `${url} respondeu ${response.status}`);
  }
  let data: unknown;
  try {
    // Fetch already decompresses HTTP Content-Encoding; static hosts may instead serve raw .gz.
    if(url.endsWith('.gz')&&!response.headers.get('content-encoding')?.toLowerCase().includes('gzip')){
      if(!response.body)throw new Error('Resposta vazia');
      const decoded=response.body.pipeThrough(new DecompressionStream('gzip'));
      data=await new Response(decoded).json();
    }else data = await response.json();
  } catch {
    throw new PlanetManifestError(`${url} não é JSON válido`);
  }
  return parsePlanetManifest(data);
}
