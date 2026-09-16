import type {Vec3} from '../core/contracts';
import {parseDestructibles, type DestructibleParseOptions, type DestructibleRecord} from './DestructibleTypes';
import {DestructionField} from './DestructionField';
import type {DestructibleState} from './DestructionModel';
import type {
  DestructionAudioPort, DestructionCollisionPort, DestructionHit, DestructionOutcome, DestructionPresentationPort,
} from './DestructionPorts';

/**
 * Fachada da destruição de cenário. **Sem uma linha de `@babylonjs/*`** — é o que permite testar
 * quebra, colisão e orçamento de cacos sem cena e sem canvas.
 *
 * O caminho de um tiro é curto de propósito:
 *
 * ```
 * PlanetCollision.raycast → RayHit.triangle → field.byTriangle → state.damage → portas
 * ```
 *
 * Nenhuma varredura sobre a lista de props, nenhuma reconstrução de BVH, nenhuma alocação por tiro
 * fora do relatório. O custo de um disparo que não acerta prop nenhum é uma busca binária que morre
 * na primeira comparação.
 */

export interface DestructionSystemOptions {
  /** Colisão que perde os triângulos do prop quebrado. Ausente ⇒ quebra só visual. */
  readonly collision?: DestructionCollisionPort;
  readonly presentation?: DestructionPresentationPort;
  readonly audio?: DestructionAudioPort;
  /** Profundidade máxima da corrente de explosões (barril acendendo barril). */
  readonly chainDepth?: number;
  /**
   * Chamado quando um corpo quebra, depois de a colisão por intervalo já ter sido removida.
   *
   * Existe para backends de colisão que NÃO são por triângulo — o `CollisionWorld` do jogo plano
   * guarda caixas, não intervalos, e é por aqui que o legado tira a caixa do prop quebrado.
   */
  readonly onBroken?: (state: DestructibleState) => void;
}

export class DestructionSystem {
  readonly field = new DestructionField();
  /** Registros recusados e malhas ausentes. O painel de depuração mostra esta lista. */
  readonly warnings: string[] = [];

  private readonly collision: DestructionCollisionPort | undefined;
  private readonly presentation: DestructionPresentationPort | undefined;
  private readonly audio: DestructionAudioPort | undefined;
  private readonly chainDepth: number;
  private readonly onBroken: ((state: DestructibleState) => void) | undefined;
  private removed = 0;
  private brokenCount = 0;

  constructor(options: DestructionSystemOptions = {}) {
    this.collision = options.collision;
    this.presentation = options.presentation;
    this.audio = options.audio;
    this.chainDepth = Math.max(0, options.chainDepth ?? 2);
    this.onBroken = options.onBroken;
  }

  get registered(): number {return this.field.size;}
  get broken(): number {return this.brokenCount;}
  /** Triângulos hoje fora da colisão por destruição. */
  get removedTriangles(): number {return this.removed;}
  get enabled(): boolean {return this.field.size > 0;}

  register(records: readonly DestructibleRecord[]): void {this.field.add(records);}

  /**
   * Lê `destructibles` do manifesto já decodificado. A chave ausente não é erro: o mapa carrega e
   * nada quebra, que é exatamente o estado do build até o Codex emitir o campo.
   */
  loadManifest(raw: unknown, options: DestructibleParseOptions = {}): number {
    const source = raw && typeof raw === 'object' && 'destructibles' in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).destructibles
      : raw;
    const {records, warnings} = parseDestructibles(source, options);
    this.warnings.push(...warnings);
    this.register(records);
    return records.length;
  }

  /**
   * Um acerto. Devolve o que aconteceu, ou `undefined` quando o ponto não era prop destrutível —
   * e nesse caso o chamador segue com o efeito de impacto normal dele, sem saber deste subsistema.
   */
  hit(hit: DestructionHit): DestructionOutcome | undefined {
    const found = hit.triangle !== undefined ? this.field.byTriangle(hit.triangle) : undefined;
    const state = found?.state ?? this.field.atPoint(hit.point);
    if (!state || state.broken) return undefined;
    return this.apply(state, hit.point, hit.direction, hit.normal, hit.damage, 0);
  }

  /**
   * Dano em área: granada, especial, barril em cadeia. O dano cai com a distância ao centro do prop.
   */
  splash(point: Vec3, radius: number, damage: number): DestructionOutcome[] {
    return this.splashFrom(point, radius, damage, undefined, 0);
  }

  private splashFrom(
    point: Vec3, radius: number, damage: number, exclude: DestructibleState | undefined, depth: number,
  ): DestructionOutcome[] {
    const out: DestructionOutcome[] = [];
    for (const state of this.field.near(point, radius)) {
      if (state === exclude || state.broken) continue;
      const centre = state.record.centre;
      const distance = Math.hypot(centre.x - point.x, centre.y - point.y, centre.z - point.z);
      const falloff = Math.max(0, 1 - distance / radius);
      if (falloff <= 0) continue;
      const direction: Vec3 = distance > 1e-4
        ? {x: (centre.x - point.x) / distance, y: (centre.y - point.y) / distance, z: (centre.z - point.z) / distance}
        : state.record.up;
      const outcome = this.apply(state, centre, direction, undefined, damage * falloff, depth);
      if (outcome) out.push(outcome);
    }
    return out;
  }

  /**
   * Corpos que a camada visual não consegue representar. Ficam de fora do subsistema INTEIRO — não
   * tomam dano, não perdem colisão, seguem sendo cenário comum. É a diferença entre "esse barril não
   * quebra" e "esse barril virou um fantasma sólido na tela e vazado ao tiro".
   */
  private readonly unsupported = new Set<string>();

  private supported(state: DestructibleState): boolean {
    if (this.unsupported.has(state.id)) return false;
    if (!this.presentation?.ready || this.presentation.ready(state)) return true;
    this.unsupported.add(state.id);
    this.warnings.push(
      `"${state.id}" (${state.record.nodeName || 'sem nodeName'}) não tem malha na cena: `
      + 'segue indestrutível para não virar obstáculo invisível',
    );
    return false;
  }

  private apply(
    state: DestructibleState, point: Vec3, direction: Vec3, normal: Vec3 | undefined, damage: number, depth: number,
  ): DestructionOutcome | undefined {
    if (!this.supported(state)) return undefined;
    const report = state.damage(damage);
    if (report.alreadyBroken || report.absorbed <= 0) return undefined;
    const material = state.profile.material;
    let removedNow = 0;

    // Retorno imediato do golpe: som, tranco e rachadura — antes de qualquer queda.
    this.audio?.impact(material, point, 1 - report.fraction);
    this.presentation?.jolt(state, direction, 1 + report.stage * 0.6);
    // A marca nasce na face atingida; sem normal, encara quem atirou.
    this.presentation?.mark(state, point, normal ?? negate(direction), report.stage);

    // Componentes caem antes do conjunto: é o que faz um celeiro responder durante os cinco segundos
    // de tiro em vez de só no último.
    for (const index of report.felled) {
      const part = state.record.components[index];
      if (!part) continue;
      removedNow += this.collision?.disableTriangles(part.triangleStart, part.triangleCount) ?? 0;
      this.presentation?.fell(state, index, point, direction);
    }

    if (report.broke) {
      this.brokenCount++;
      // O intervalo do pai cobre os componentes; desativar de novo é barato e idempotente.
      removedNow += this.collision?.disableTriangles(state.record.triangleStart, state.record.triangleCount) ?? 0;
      this.presentation?.destroy(state, point, direction);
      this.audio?.shatter(material, point);
      this.onBroken?.(state);
    }

    this.removed += removedNow;
    const outcome: DestructionOutcome = {
      id: state.id, kind: state.kind, broke: report.broke, stage: report.stage,
      fraction: report.fraction, felled: report.felled, removedTriangles: removedNow,
    };

    // Corrente do barril. Profundidade limitada: sem isso, um depósito de barris encadeados
    // recorreria até estourar a pilha no mesmo quadro.
    const {chainDamage, chainRadius} = state.profile;
    if (report.broke && chainDamage > 0 && chainRadius > 0 && depth < this.chainDepth) {
      this.splashFrom(state.record.centre, chainRadius, chainDamage, state, depth + 1);
    }
    return outcome;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    for (const state of this.field.all) if (state.broken) state.since += dt;
    this.presentation?.update(dt);
  }

  /** Reinício de tentativa: tudo volta inteiro, colisão inclusive. */
  resetAttempt(): void {
    for (const state of this.field.all) {
      if (this.collision) {
        this.collision.enableTriangles(state.record.triangleStart, state.record.triangleCount);
        for (const part of state.record.components) this.collision.enableTriangles(part.triangleStart, part.triangleCount);
      }
      state.reset();
    }
    this.removed = 0;
    this.brokenCount = 0;
    this.presentation?.restore();
  }
}

const negate = (v: Vec3): Vec3 => ({x: -v.x, y: -v.y, z: -v.z});
