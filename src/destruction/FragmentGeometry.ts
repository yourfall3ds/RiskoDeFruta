/**
 * Recorte de cacos a partir da geometria ORIGINAL do prop. Puro: só arrays, nada de Babylon.
 *
 * A regra do projeto é que caco é caco — pedaço do corpo que quebrou, com a textura dele. Cubinho
 * genérico e clone reduzido do prop inteiro estão os dois proibidos, e por bons motivos: o primeiro
 * denuncia o truque, o segundo transforma a caixa quebrada numa caixinha voando.
 *
 * O método é uma partição de Voronoi sobre os triângulos do próprio prop: sementes espalhadas pela
 * caixa envolvente, cada triângulo vai para a semente mais próxima do seu centroide, e cada célula
 * vira uma malha nova com os MESMOS vértices, normais e UV da origem. Nenhum vértice é inventado,
 * então a pele do caco é literalmente a pele que estava ali.
 *
 * O caco é aberto — a face do corte não existe. Isso é deliberado: fechar o corte exigiria
 * triangular a seção, e o caco vive 4–6 segundos girando no ar antes de sumir. O custo não se paga.
 */

export interface GeometrySource {
  /** `[x,y,z, ...]` — já no espaço em que o caco vai viver (mundo, na prática). */
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  readonly normals?: ArrayLike<number> | undefined;
  readonly uvs?: ArrayLike<number> | undefined;
}

export interface FragmentSlice {
  /** Posições RELATIVAS a `centre` — o caco gira em torno do próprio centro, não da origem. */
  readonly positions: Float32Array;
  readonly normals: Float32Array | undefined;
  readonly uvs: Float32Array | undefined;
  readonly indices: Uint32Array;
  /** Centro do caco no espaço da origem. */
  readonly centre: readonly [number, number, number];
  /** Meia-extensão do caco, para assentar no chão sem afundar. */
  readonly half: readonly [number, number, number];
  readonly triangles: number;
}

/**
 * Teto de triângulos da malha de origem. Acima disso o estilhaço é recusado e o chamador cai no
 * plano B (sumir com poeira). O limite inclui as caixas reais do mapa (2 499 triângulos),
 * mas impede recortar uma construção inteira durante o quadro de um disparo.
 */
export const FRAGMENT_SOURCE_LIMIT = 8192;

/** Ruído determinístico: a mesma caixa quebra sempre nos mesmos pedaços. */
const noise = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Recorta `pieces` cacos da geometria. Devolve lista vazia quando a origem é grande demais,
 * degenerada, ou quando `pieces < 2` — nunca devolve um "caco" que é o corpo inteiro.
 */
export function shatterGeometry(source: GeometrySource, pieces: number, seed = 1): FragmentSlice[] {
  const {positions, indices} = source;
  const triangles = Math.floor(indices.length / 3);
  const wanted = Math.floor(pieces);
  if (triangles < 2 || wanted < 2 || triangles > FRAGMENT_SOURCE_LIMIT) return [];

  // Caixa envolvente da origem: as sementes moram dentro dela.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return [];

  const count = Math.min(wanted, triangles);
  const seeds = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Espiral dourada dentro da caixa: cobre o volume sem alinhar as sementes num eixo, que é o que
    // produziria fatias paralelas em vez de pedaços.
    const t = (i + 0.5) / count;
    const phi = Math.acos(1 - 2 * t), theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const jitter = 0.72 + 0.34 * noise(seed * 31 + i);
    seeds[i * 3] = lerp(minX, maxX, 0.5 + 0.5 * Math.sin(phi) * Math.cos(theta) * jitter);
    seeds[i * 3 + 1] = lerp(minY, maxY, 0.5 + 0.5 * Math.cos(phi) * jitter);
    seeds[i * 3 + 2] = lerp(minZ, maxZ, 0.5 + 0.5 * Math.sin(phi) * Math.sin(theta) * jitter);
  }

  const owner = new Int32Array(triangles);
  const used = new Uint8Array(count);
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3]! * 3, b = indices[t * 3 + 1]! * 3, c = indices[t * 3 + 2]! * 3;
    const cx = (positions[a]! + positions[b]! + positions[c]!) / 3;
    const cy = (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3;
    const cz = (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3;
    let best = 0, bestDistance = Infinity;
    for (let i = 0; i < count; i++) {
      const d = (cx - seeds[i * 3]!) ** 2 + (cy - seeds[i * 3 + 1]!) ** 2 + (cz - seeds[i * 3 + 2]!) ** 2;
      if (d < bestDistance) {bestDistance = d; best = i;}
    }
    owner[t] = best;
    used[best] = 1;
  }

  const slices: FragmentSlice[] = [];
  for (let piece = 0; piece < count; piece++) {
    if (!used[piece]) continue;   // célula vazia não vira caco invisível
    const slice = extract(source, owner, piece, triangles);
    if (slice) slices.push(slice);
  }
  return slices;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.max(0, Math.min(1, t));

function extract(source: GeometrySource, owner: Int32Array, piece: number, triangles: number): FragmentSlice | undefined {
  const {positions, indices, normals, uvs} = source;
  const remap = new Map<number, number>();
  const outIndices: number[] = [];
  const outPositions: number[] = [];
  const outNormals: number[] | undefined = normals ? [] : undefined;
  const outUvs: number[] | undefined = uvs ? [] : undefined;

  for (let t = 0; t < triangles; t++) {
    if (owner[t] !== piece) continue;
    for (let k = 0; k < 3; k++) {
      const vertex = indices[t * 3 + k]!;
      let mapped = remap.get(vertex);
      if (mapped === undefined) {
        mapped = outPositions.length / 3;
        remap.set(vertex, mapped);
        outPositions.push(positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!);
        if (outNormals && normals) outNormals.push(normals[vertex * 3]!, normals[vertex * 3 + 1]!, normals[vertex * 3 + 2]!);
        if (outUvs && uvs) outUvs.push(uvs[vertex * 2]!, uvs[vertex * 2 + 1]!);
      }
      outIndices.push(mapped);
    }
  }
  if (outIndices.length < 3) return undefined;

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < outPositions.length; i += 3) {
    const x = outPositions[i]!, y = outPositions[i + 1]!, z = outPositions[i + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const centre: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  for (let i = 0; i < outPositions.length; i += 3) {
    outPositions[i] = outPositions[i]! - centre[0];
    outPositions[i + 1] = outPositions[i + 1]! - centre[1];
    outPositions[i + 2] = outPositions[i + 2]! - centre[2];
  }

  return {
    positions: Float32Array.from(outPositions),
    normals: outNormals ? Float32Array.from(outNormals) : undefined,
    uvs: outUvs ? Float32Array.from(outUvs) : undefined,
    indices: Uint32Array.from(outIndices),
    centre,
    half: [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2],
    triangles: outIndices.length / 3,
  };
}
