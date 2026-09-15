/**
 * Reconciliação da predição local, pura e testável.
 *
 * O cliente simula o próprio jogador com o mesmo `PlayerMotor` do servidor (predição) e grava a pose
 * prevista por `seq`. Quando o servidor confirma um `seq` (`lastProcessed` do InputHandle), compara-se
 * a pose autoritativa com a prevista naquele mesmo `seq`. Erro pequeno: nada a fazer — a predição está certa.
 * Erro grande: corrige (snap para a pose do servidor) e devolve os `seq` ainda não confirmados para
 * reaplicar as entradas, como a reconciliação clássica. O motor não é reconstruído; só posição/velocidade.
 *
 * Não usa o `Reconciler` do SDK: ele faz rollback de campos numéricos expostos, e o `PlayerMotor`
 * guarda estado privado (coyote, buffer de pulo, esquiva) que não cabe nesse contrato sem refatorá-lo.
 */
export interface Pose { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface AckResult {
  /** Distância entre a pose prevista e a autoritativa no `seq` confirmado (m). */
  error: number;
  /** `true` quando o erro passou do limiar e a pose local foi trocada pela do servidor. */
  corrected: boolean;
  /** `seq`s ainda não confirmados, do mais antigo ao mais novo — reaplicar as entradas deles após uma correção. */
  pending: number[];
}

export class Reconciliation {
  private readonly poses = new Map<number, Pose>();
  private readonly order: number[] = [];
  lastAcked = 0;
  corrections = 0;
  lastError = 0;
  constructor(readonly threshold = .12, readonly capacity = 240) {
    if (!(threshold > 0) || !Number.isInteger(capacity) || capacity < 2) throw new Error('Reconciliation: parâmetros inválidos');
  }
  /** Pose prevista logo após simular a entrada `seq`. */
  record(seq: number, pose: Pose): void {
    if (!Number.isInteger(seq) || seq <= 0) throw new Error('seq inválido');
    if (!this.poses.has(seq)) this.order.push(seq);
    this.poses.set(seq, { ...pose });
    while (this.order.length > this.capacity) this.poses.delete(this.order.shift()!);
  }
  get pendingCount(): number { return this.order.filter(seq => seq > this.lastAcked).length; }
  /**
   * Confirmação do servidor para `seq`, com a pose autoritativa naquele passo.
   * `apply` recebe a pose do servidor quando há correção (o chamador escreve no motor e reaplica `pending`).
   */
  ack(seq: number, server: Pose, apply?: (pose: Pose) => void): AckResult {
    if (seq <= this.lastAcked) return { error: 0, corrected: false, pending: [] };
    this.lastAcked = seq;
    const predicted = this.poses.get(seq);
    const error = predicted ? Math.hypot(server.x - predicted.x, server.y - predicted.y, server.z - predicted.z) : Number.POSITIVE_INFINITY;
    this.lastError = Number.isFinite(error) ? error : 0;
    const pending = this.order.filter(s => s > seq);
    // Poses até `seq` já não servem para nada: liberadas.
    for (const s of this.order.filter(s => s <= seq)) this.poses.delete(s);
    this.order.splice(0, this.order.length, ...pending);
    const corrected = !Number.isFinite(error) ? false : error > this.threshold;
    if (corrected) { this.corrections++; apply?.(server); }
    return { error: Number.isFinite(error) ? error : 0, corrected, pending: corrected ? pending : [] };
  }
  reset(): void { this.poses.clear(); this.order.length = 0; this.lastAcked = 0; }
}
