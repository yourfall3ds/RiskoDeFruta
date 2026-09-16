import type {Vec3} from '../core/contracts';

/**
 * Portas de entrada da navegação, declaradas por ESTRUTURA.
 *
 * `src/planet-nav` não importa `src/planet` nem `src/planet-game`: declara o mínimo que consome e
 * deixa `PlanetFrame`, `PlanetCollision` e `PlanetManifest` satisfazerem por compatibilidade
 * estrutural. Ganho concreto: os três arquivos têm donos diferentes e evoluem em paralelo; se a
 * assinatura do núcleo mudar, quem acusa é o `typecheck` do teste (que faz a atribuição real),
 * não o jogo rodando.
 */

export interface NavFrame {
  readonly centre: Vec3;
  readonly surfaceRadius: number;
  /** Vertical local (unitária) em `p`. */
  up(p: Vec3): Vec3;
  /** Distância de `p` ao centro do planeta. */
  radius(p: Vec3): number;
}

export interface NavRayHit {
  readonly distance: number;
  readonly point: Vec3;
  readonly normal: Vec3;
}

export interface NavSupport {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly offset: number;
  readonly slopeDegrees: number;
}

export interface NavCollision {
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): NavRayHit | undefined;
  supportBelow(p: Vec3, up: Vec3, above: number, below: number): NavSupport | undefined;
  sweepCapsule(base: Vec3, axis: Vec3, delta: Vec3, radius: number, height: number):
    {readonly time: number; readonly normal: Vec3} | undefined;
  /** Opcional: quando existe, desqualifica um nó nascido DENTRO de parede/prop. */
  deepestContact?(base: Vec3, axis: Vec3, radius: number, height: number):
    {readonly depth: number; readonly normal: Vec3} | undefined;
}

export interface NavIsland {
  readonly id: string;
  /** Direção unitária do centro do planeta até o convés. */
  readonly up: Vec3;
  readonly centre: Vec3;
  readonly spawn: Vec3;
  /** Raio da pegada caminhável, em metros de arco. */
  readonly radius: number;
}

export interface NavBridge {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly width: number;
  /** Polilinha do convés em espaço de mundo, da ilha `a` até a `b`. */
  readonly waypoints: readonly Vec3[];
}

/** Ponto autoral de acesso — soleira de porta, pé de rampa, cabeceira de ponte. */
export interface NavAccess {
  readonly point: Vec3;
  /** Raio da mancha densa em volta do ponto; padrão `accessPatchRadius`. */
  readonly radius?: number;
}

export interface NavManifest {
  readonly islands: readonly NavIsland[];
  readonly bridges: readonly NavBridge[];
  /** Opcional. Sem isto, porta estreita depende do refino adaptativo (ver doc §6). */
  readonly access?: readonly NavAccess[];
}

export interface NavOptions {
  /** Cápsula do ator. Tudo — piso, teto, ligação — é validado com ela. */
  capsuleRadius: number;
  capsuleHeight: number;
  /** Espaçamento da grade tangente por ilha, em metros de arco. */
  islandSpacing: number;
  /** Densificação máxima da geodésica da ponte. */
  bridgeSpacing: number;
  /** `acos(dot(normal, up))` máximo para um piso contar como chão. */
  maxSlopeDegrees: number;
  /** Altitude mínima aceita (relativa ao convés nominal). Abaixo disso é flanco de penhasco. */
  minAltitude: number;
  /** Altitude máxima aceita. */
  maxAltitude: number;
  /** A sonda radial começa em `surfaceRadius + probeAbove`, SEMPRE de fora para dentro. */
  probeAbove: number;
  /** Camadas de piso colhidas por coluna (piso sob telhado, andares). */
  layers: number;
  /** Degrau máximo entre dois nós ligados, medido no raio. */
  maxStep: number;
  /** Levantamento da cápsula na varredura de ligação, para não bater no próprio piso. */
  stepHeight: number;
  /** Raio de ligação entre nós. */
  linkRadius: number;
  /**
   * Teto de vizinhos PROVADOS por nó, dos mais próximos para os mais distantes.
   *
   * Sem teto, um nó no meio de uma área refinada a 1,25 m tem centenas de candidatos dentro de
   * 4 m e uma única fatia de construção estoura cinco segundos. Dezesseis cobre com folga a
   * vizinhança de oito da grade; o que passa disso é redundante.
   */
  linkCandidates: number;
  /**
   * Passo das sondas de apoio ao longo de uma ligação.
   *
   * Precisa ser MENOR que o diâmetro da cápsula (0,70 m) para a garantia ser demonstrável: um
   * buraco por onde a cápsula cai deixa, na linha de centro do trajeto, um trecho sem piso de pelo
   * menos o próprio diâmetro — e nenhum trecho maior que o passo escapa entre duas sondas.
   * Medido: com 0,8 m passavam buracos reais de 1,2–1,3 m atravessados de través.
   */
  supportSpacing: number;
  /** Janela da sonda de apoio ao longo da ligação: acima / abaixo da reta interpolada. */
  supportAbove: number;
  supportBelow: number;
  /** Encaixe máximo de `nearestSafe`. */
  snapRadius: number;
  /** Quantos nós `nearestSafe` chega a validar antes de desistir. */
  snapCandidates: number;
  /** Rodadas de refino adaptativo em volta de nós de borda/gargalo. */
  refineRounds: number;
  /** Um nó com menos vizinhos que isto é candidato a refino. */
  refineDegree: number;
  /** Teto de nós criados pelo refino (proteção de memória/tempo). */
  refineBudget: number;
  /** Raio e espaçamento das manchas densas de `manifest.access`. */
  accessPatchRadius: number;
  accessSpacing: number;
  /** Tolerância radial para casar uma amostra de ponte com o convés autoral. */
  bridgeTolerance: number;
  /** Alcance do conector explícito entre cabeceira de ponte e convés da ilha. */
  connectorRadius: number;
  /** Degrau tolerado NO CONECTOR — a junta ponte/ilha é onde o autor deixa desnível. */
  connectorStep: number;
  /** Quantas amostras de cada ponta da ponte tentam conectar. */
  connectorSamples: number;
  /** Teto de candidatos avaliados por conector. */
  connectorCandidates: number;
  /** Penetração tolerada em `deepestContact` antes de descartar o nó. */
  embedTolerance: number;
  /** Teto absoluto de nós. Estourar vira defeito reportado, não travamento. */
  maxNodes: number;
  /** Alcance máximo do atalho do suavizador de caminho. */
  smoothingRange: number;
  /** Quantos atalhos o suavizador chega a PROVAR por ponto. Cada prova custa sondas + varredura. */
  smoothingTests: number;
}

export const NAV_DEFAULTS: NavOptions = {
  capsuleRadius: 0.35,
  capsuleHeight: 1.8,
  islandSpacing: 2.5,
  bridgeSpacing: 3,
  maxSlopeDegrees: 50,
  minAltitude: -3,
  maxAltitude: 60,
  probeAbove: 60,
  layers: 4,
  maxStep: 0.35,
  stepHeight: 0.35,
  linkRadius: 4,
  linkCandidates: 16,
  supportSpacing: 0.6,
  supportAbove: 0.5,
  supportBelow: 0.6,
  snapRadius: 6,
  snapCandidates: 8,
  refineRounds: 1,
  refineDegree: 8,
  refineBudget: 60000,
  accessPatchRadius: 2.5,
  accessSpacing: 0.7,
  bridgeTolerance: 2,
  connectorRadius: 8,
  connectorStep: 0.6,
  connectorSamples: 3,
  connectorCandidates: 12,
  embedTolerance: 0.01,
  maxNodes: 250000,
  smoothingRange: 12,
  smoothingTests: 3,
};

export function resolveNavOptions(overrides?: Partial<NavOptions>): NavOptions {
  const merged = {...NAV_DEFAULTS, ...(overrides ?? {})};
  // Uma ligação mais curta que a diagonal da grade desconecta o mundo inteiro em silêncio.
  merged.linkRadius = Math.max(merged.linkRadius, merged.islandSpacing * Math.SQRT2 + 0.05);
  return merged;
}

export type NavPhase = 'sample' | 'link' | 'refine' | 'finish' | 'done';

export interface NavProgress {
  readonly done: boolean;
  readonly phase: NavPhase;
  /** Fração estimada [0,1] — serve para barra de carregamento, não para contabilidade. */
  readonly ratio: number;
  readonly nodes: number;
  readonly edges: number;
}

export interface NavSnap {
  readonly node: number;
  readonly point: Vec3;
  readonly distance: number;
}

export interface NavRoute {
  readonly points: readonly Vec3[];
  readonly distance: number;
  readonly reachable: boolean;
  readonly start: NavSnap | undefined;
  readonly goal: NavSnap | undefined;
}

export interface NavCoverage {
  readonly id: string;
  readonly nodes: number;
  /** Amostras pedidas pela grade/densificação. */
  readonly attempted: number;
  /** Amostras que acharam piso válido. */
  readonly accepted: number;
}

/**
 * Grafo já construído, pronto para gravar em disco.
 *
 * Existe por medição, não por gosto: construir o arquipélago final leva centenas de segundos
 * (ver `.temp/planet-navigation-result.md`), e nenhuma tela de carregamento paga isso. Assar uma
 * vez e carregar em segundos é a diferença entre navegação utilizável e navegação teórica.
 *
 * `signature` é responsabilidade de quem assa: qualquer string que mude junto com a geometria
 * (tamanho do arquivo, hash, data do build). `load()` recusa o grafo quando ela não bate, e o
 * jogo cai de volta para `build()` em vez de andar sobre um mapa de um asset que não existe mais.
 */
export interface NavBaked {
  readonly version: number;
  readonly signature: string;
  /** `[x, y, z, x, y, z, ...]` — em milímetros arredondados, o que é resolução de sobra. */
  readonly nodes: readonly number[];
  /** Dicionário de donos (ilha/ponte/acesso) e o índice do dono de cada nó. */
  readonly owners: readonly string[];
  readonly ownerOf: readonly number[];
  /** Pares `(a, b)` achatados, `a < b`. */
  readonly edges: readonly number[];
  readonly islands: readonly NavCoverage[];
  readonly bridges: readonly NavCoverage[];
  readonly defects: readonly string[];
}

export const NAV_BAKED_VERSION = 1;

export interface NavStats {
  readonly nodes: number;
  readonly edges: number;
  readonly components: number;
  readonly islands: readonly NavCoverage[];
  readonly bridges: readonly NavCoverage[];
  /** Ilhas agrupadas por componente caminhável, do maior grupo para o menor. */
  readonly groups: readonly (readonly string[])[];
  /** Tamanho do MAIOR grupo de ilhas mutuamente alcançáveis a pé. */
  readonly connectedIslands: number;
  readonly totalIslands: number;
  readonly longestEdge: number;
  /** Problemas nomeados, em português, prontos para relatório. */
  readonly defects: readonly string[];
}
