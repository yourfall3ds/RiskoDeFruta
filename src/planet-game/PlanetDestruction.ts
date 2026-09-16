import type {Vec3} from '../core/contracts';
import type {DestructionHit, DestructionOutcome} from '../destruction/DestructionPorts';

/**
 * A porta da destruição vista pelo jogo, e as travas de segurança do lado de cá.
 *
 * O subsistema `src/destruction` é de outro dono; aqui não se reimplementa nada dele. O que este
 * arquivo faz é (a) declarar a porta estreita que a fachada satisfaz por estrutura, (b) contar o
 * que saiu da colisão e (c) **detectar o defeito perigoso**: cenário que sumiu da tela mas
 * continuou barrando o corpo.
 *
 * Os tipos `DestructionHit`/`DestructionOutcome` vêm do próprio subsistema por `import type` —
 * apagado na compilação, então nada aqui depende de a fachada já existir.
 */
export type {DestructionHit, DestructionOutcome};

/** Fachada da destruição. `DestructionSystem` satisfaz por estrutura, sem import cruzado. */
export interface DestructionPort {
  /** Um acerto. `undefined` = não era prop nenhum, siga com o efeito genérico de bala. */
  hit(hit: DestructionHit): DestructionOutcome | undefined;
  update(dt: number): void;
  /** Volta tudo ao estado intacto — nova tentativa, próxima ilha. */
  reset(): void;
  dispose?(): void;
}

/** Colisão que sabe remover intervalo contíguo de triângulos. `PlanetCollision` satisfaz. */
export interface TriangleCollisionPort {
  disableTriangles(start: number, count: number): number;
  enableTriangles(start: number, count: number): number;
}

/** Intervalo desativado, em TRIÂNGULOS. É o que a navegação precisaria saber. */
export interface DisabledRange {
  readonly start: number;
  readonly count: number;
}

/**
 * Contabilidade da destruição do lado do jogo.
 *
 * Existe por três motivos concretos:
 *
 * 1. **Cópia da navegação.** O worker de rotas montou a BVH dele a partir de uma CÓPIA da
 *    geometria. Quando um prop some daqui, some só daqui. O ledger guarda os intervalos para que
 *    essa cópia possa ser informada (ver `ranges`) e para o painel de verificação mostrar.
 * 2. **Colisão invisível.** Um corpo que quebrou na tela e não saiu da colisão vira parede
 *    fantasma. `defects` conta exatamente esse caso e o nome do culpado sai no diagnóstico.
 * 3. **Reinício.** Nova tentativa e troca de ilha precisam devolver a colisão original; o ledger
 *    sabe o que reativar mesmo que a fachada já tenha esquecido.
 */
export class PlanetDestructionLedger {
  private readonly disabled = new Map<string, DisabledRange>();
  /** Props que quebraram na tela sem tirar um único triângulo da colisão. */
  readonly defects: string[] = [];
  breaks = 0;
  hits = 0;
  removedTriangles = 0;

  constructor(private readonly collision: TriangleCollisionPort | undefined) {}

  /** Intervalos desativados agora, ordenados por início. Prontos para a navegação. */
  get ranges(): readonly DisabledRange[] {
    return [...this.disabled.values()].sort((a, b) => a.start - b.start);
  }

  get disabledProps(): number {return this.disabled.size;}

  /**
   * `true` quando algum intervalo entrou ou saiu desde a última chamada.
   *
   * É o gatilho de publicação para a cópia da navegação: sem ele a cena mandaria a lista inteira
   * todo quadro, e a lista cresce com a partida.
   */
  drainDirty(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    return true;
  }
  private dirty = false;

  /**
   * Porta de colisão entregue à fachada.
   *
   * Cada desativação é registrada com uma chave derivada do intervalo — a fachada pode chamar duas
   * vezes (componente e depois o pai) sem inflar a conta, e o reinício reativa cada intervalo uma
   * única vez.
   */
  collisionPort(): TriangleCollisionPort {
    return {
      disableTriangles: (start, count) => {
        const changed = this.collision?.disableTriangles(start, count) ?? 0;
        if (count > 0) {this.disabled.set(`${start}:${count}`, {start, count}); this.dirty = true;}
        this.removedTriangles += changed;
        return changed;
      },
      enableTriangles: (start, count) => {
        const changed = this.collision?.enableTriangles(start, count) ?? 0;
        if (this.disabled.delete(`${start}:${count}`)) this.dirty = true;
        this.removedTriangles = Math.max(0, this.removedTriangles - changed);
        return changed;
      },
    };
  }

  /**
   * Registra o que a fachada devolveu e acusa o defeito perigoso.
   *
   * `broke` com zero triângulo removido só é aceitável quando o prop nunca teve intervalo — e o
   * contrato do manifesto exige intervalo. Então aqui isso é sempre defeito, e é melhor gritar no
   * diagnóstico do que deixar o jogador bater numa caixa que já virou caco.
   */
  record(outcome: DestructionOutcome | undefined): DestructionOutcome | undefined {
    if (!outcome) return undefined;
    this.hits++;
    if (!outcome.broke) return outcome;
    this.breaks++;
    if (outcome.removedTriangles <= 0 && !this.defects.includes(outcome.id)) {
      this.defects.push(outcome.id);
    }
    return outcome;
  }

  /** Devolve toda a colisão removida. Chamado antes de `reset()` da fachada. */
  restore(): void {
    for (const {start, count} of this.disabled.values()) this.collision?.enableTriangles(start, count);
    this.disabled.clear();
    this.dirty = true;
    this.removedTriangles = 0;
    this.breaks = 0;
    this.hits = 0;
    this.defects.length = 0;
  }

  /** Linha do painel de verificação. */
  readout(): string {
    const defects = this.defects.length > 0 ? ` · DEFEITO sem colisão removida: ${this.defects.join(', ')}` : '';
    return `cenário ${this.breaks} quebrados de ${this.hits} acertos · ${this.disabledProps} intervalos`
      + ` · ${this.removedTriangles} triângulos fora${defects}`;
  }
}

/**
 * Nada instalado: o jogo roda igual e nenhum acerto vira destruição.
 *
 * É o caminho normal enquanto o manifesto não trouxer `destructibles` — e continua sendo o caminho
 * se a fachada falhar. O tiro nunca depende dela para funcionar.
 */
export const NO_DESTRUCTION: DestructionPort = {
  hit: () => undefined,
  update: () => {},
  reset: () => {},
};

/**
 * Monta o acerto que a fachada espera a partir do que o tiro já sabe.
 * `triangle` é o caminho barato: com ele o campo resolve o prop por intervalo, sem busca espacial.
 */
export function destructionHit(
  point: Vec3, direction: Vec3, damage: number, triangle: number | undefined, normal: Vec3 | undefined,
): DestructionHit {
  return {
    point, direction, damage,
    ...(triangle === undefined ? {} : {triangle}),
    ...(normal === undefined ? {} : {normal}),
  };
}
