import type {Vec3} from '../core/contracts';

/**
 * Formato autoral dos props destrutíveis e sua validação.
 *
 * Contrato completo (o que o Codex precisa emitir) em `.temp/destruction-api.md`. Este arquivo é a
 * implementação exata daquele documento — se os dois divergirem, este manda.
 *
 * Princípio de projeto: **um registro ruim nunca derruba o mapa**. Diferente de
 * `PlanetManifest.parsePlanetManifest`, que recusa o planeta inteiro quando a colisão está corrompida
 * (um vértice NaN quebra tudo silenciosamente e é melhor não abrir), aqui o pior caso é uma caixa que
 * não quebra. Recusar o arquivo todo por causa de um barril mal exportado seria trocar um defeito
 * cosmético por um mapa que não carrega.
 */

export type DestructibleKind = 'crate' | 'barrel' | 'tree' | 'structure' | 'rock';

export const DESTRUCTIBLE_KINDS: readonly DestructibleKind[] = ['crate', 'barrel', 'tree', 'structure', 'rock'];

const isKind = (value: unknown): value is DestructibleKind =>
  typeof value === 'string' && (DESTRUCTIBLE_KINDS as readonly string[]).includes(value);

/** Parte de uma estrutura, derrubada num estágio próprio antes de o conjunto cair. */
export interface DestructibleComponent {
  /** Malha própria no GLB. Vazio = componente só de colisão, sem visual próprio. */
  readonly nodeName: string;
  readonly triangleStart: number;
  readonly triangleCount: number;
}

export interface DestructibleRecord {
  readonly id: string;
  readonly nodeName: string;
  readonly kind: DestructibleKind;
  /** Centro da caixa envolvente, em espaço de MUNDO. */
  readonly centre: Vec3;
  /** MEIA-extensão da caixa envolvente alinhada ao mundo, em metros. */
  readonly extents: Vec3;
  /** Vertical local do prop, unitária. Preenchida pelo parser quando ausente no arquivo. */
  readonly up: Vec3;
  /** Primeiro triângulo do prop em `indices`, EM TRIÂNGULOS. */
  readonly triangleStart: number;
  readonly triangleCount: number;
  readonly components: readonly DestructibleComponent[];
}

export interface DestructibleParseResult {
  readonly records: readonly DestructibleRecord[];
  /** Registros recusados, com o motivo em português. O HUD de depuração mostra esta lista. */
  readonly warnings: readonly string[];
}

export interface DestructibleParseOptions {
  /** Centro do planeta, para deduzir `up` quando o arquivo não manda. */
  readonly centre?: Vec3;
  /** `indices.length / 3` do manifesto. Sem ele, intervalos não são conferidos contra o buffer. */
  readonly triangleTotal?: number;
}

const finite = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const vec3 = (value: unknown): Vec3 | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const x = finite(raw.x), y = finite(raw.y), z = finite(raw.z);
  return x === undefined || y === undefined || z === undefined ? undefined : {x, y, z};
};

const integer = (value: unknown): number | undefined => {
  const n = finite(value);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
};

const unit = (v: Vec3, fallback: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z);
  return n > 1e-9 ? {x: v.x / n, y: v.y / n, z: v.z / n} : fallback;
};

function component(value: unknown, where: string, warnings: string[]): DestructibleComponent | undefined {
  if (!value || typeof value !== 'object') {warnings.push(`${where} não é um objeto`); return undefined;}
  const raw = value as Record<string, unknown>;
  const start = integer(raw.triangleStart), count = integer(raw.triangleCount);
  if (start === undefined || start < 0) {warnings.push(`${where}.triangleStart inválido`); return undefined;}
  if (count === undefined || count < 1) {warnings.push(`${where}.triangleCount inválido`); return undefined;}
  return {
    nodeName: typeof raw.nodeName === 'string' ? raw.nodeName : '',
    triangleStart: start,
    triangleCount: count,
  };
}

/**
 * Lê `manifest.destructibles`. Aceita a chave ausente (nada quebra, jogo normal) e devolve os
 * registros bons junto com a lista de recusados.
 *
 * O que é conferido, e por quê:
 *  - intervalo dentro do buffer: desativar triângulo fora do buffer é silencioso e inútil;
 *  - intervalos sem sobreposição: dois props no mesmo triângulo fariam um "ressuscitar" a colisão
 *    do outro na reinicialização;
 *  - componentes contidos no pai: um componente que apaga triângulo alheio abre buraco no chão;
 *  - `id` único: o sistema indexa por `id` e o segundo silenciosamente substituiria o primeiro.
 */
export function parseDestructibles(value: unknown, options: DestructibleParseOptions = {}): DestructibleParseResult {
  const warnings: string[] = [];
  if (value === undefined || value === null) return {records: [], warnings};
  if (!Array.isArray(value)) return {records: [], warnings: ['destructibles não é uma lista']};

  const centre = options.centre ?? {x: 0, y: 0, z: 0};
  const total = options.triangleTotal;
  const accepted: DestructibleRecord[] = [];
  const ids = new Set<string>();

  for (const [index, entry] of (value as unknown[]).entries()) {
    const where = `destructibles[${index}]`;
    if (!entry || typeof entry !== 'object') {warnings.push(`${where} não é um objeto`); continue;}
    const raw = entry as Record<string, unknown>;

    const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined;
    if (!id) {warnings.push(`${where}.id vazio`); continue;}
    if (ids.has(id)) {warnings.push(`${where}.id "${id}" repetido`); continue;}
    if (!isKind(raw.kind)) {warnings.push(`${where}.kind "${String(raw.kind)}" não é um tipo conhecido`); continue;}

    const centrePoint = vec3(raw.centre);
    if (!centrePoint) {warnings.push(`${where}.centre inválido`); continue;}
    const extents = vec3(raw.extents);
    if (!extents || !(extents.x > 0) || !(extents.y > 0) || !(extents.z > 0)) {
      warnings.push(`${where}.extents precisa de meia-extensão positiva nos três eixos`); continue;
    }

    const start = integer(raw.triangleStart), count = integer(raw.triangleCount);
    if (start === undefined || start < 0) {warnings.push(`${where}.triangleStart inválido`); continue;}
    if (count === undefined || count < 1) {warnings.push(`${where}.triangleCount inválido`); continue;}
    if (total !== undefined && start + count > total) {
      warnings.push(`${where} cobre até o triângulo ${start + count} mas a malha só tem ${total}`); continue;
    }

    const parts: DestructibleComponent[] = [];
    if (raw.components !== undefined) {
      if (!Array.isArray(raw.components)) warnings.push(`${where}.components não é uma lista`);
      else for (const [k, item] of (raw.components as unknown[]).entries()) {
        const part = component(item, `${where}.components[${k}]`, warnings);
        if (!part) continue;
        if (part.triangleStart < start || part.triangleStart + part.triangleCount > start + count) {
          warnings.push(`${where}.components[${k}] sai do intervalo do pai`); continue;
        }
        if (parts.some(other => overlaps(other.triangleStart, other.triangleCount, part.triangleStart, part.triangleCount))) {
          warnings.push(`${where}.components[${k}] sobrepõe outro componente`); continue;
        }
        parts.push(part);
      }
    }

    const clash = accepted.find(other => overlaps(other.triangleStart, other.triangleCount, start, count));
    if (clash) {warnings.push(`${where} sobrepõe os triângulos de "${clash.id}"`); continue;}

    const raised = vec3(raw.up);
    ids.add(id);
    accepted.push({
      id,
      nodeName: typeof raw.nodeName === 'string' ? raw.nodeName : '',
      kind: raw.kind,
      centre: centrePoint,
      extents,
      up: unit(
        raised ?? {x: centrePoint.x - centre.x, y: centrePoint.y - centre.y, z: centrePoint.z - centre.z},
        {x: 0, y: 1, z: 0},
      ),
      triangleStart: start,
      triangleCount: count,
      // A ordem da lista é a ordem de queda; o arquivo manda, o runtime não reordena.
      components: parts,
    });
    if (!accepted[accepted.length - 1]!.nodeName) {
      warnings.push(`${where} não tem nodeName: quebra só a colisão, sem rachadura nem caco`);
    }
  }

  return {records: accepted, warnings};
}

const overlaps = (aStart: number, aCount: number, bStart: number, bCount: number): boolean =>
  aStart < bStart + bCount && bStart < aStart + aCount;

/** Soma dos triângulos de um conjunto de registros — usado em teste de orçamento e diagnóstico. */
export const totalTriangles = (records: readonly DestructibleRecord[]): number =>
  records.reduce((sum, record) => sum + record.triangleCount, 0);
