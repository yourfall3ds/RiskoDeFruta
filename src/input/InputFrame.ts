/** Quadro de entrada por tick. Puro: é compartilhado entre o cliente (captura) e o servidor (simulação). */
/**
 * `dash` é a INTENÇÃO de arrancada já resolvida (duplo toque detectado na captura).
 * Viaja no pacote para o servidor não precisar redetectar a borda — ele ainda valida
 * cooldown, carga aérea e colisão, então continua autoritativo.
 */
/**
 * `swapWeapon` (tecla B) e `cycleMode` (tecla T) NÃO EXISTEM MAIS.
 *
 * A arma passou a ser a da CLASSE escolhida no menu (ver `src/run/PlayerClass.ts`) e não muda
 * dentro de uma expedição; a forma da PRISM avança pelo `Q` no nível I. Nenhum dos dois chegou a
 * viajar no pacote de rede, então a remoção não toca em nada do co-op.
 */
/**
 * `charging` continua sendo a CARGA DO ESPECIAL, bit a bit o mesmo do pacote de rede
 * (`NetInput.BUTTON.CHARGE`). O que mudou foi só a tecla que o produz no cliente: era o botão
 * direito, virou `Q` segurado. O servidor não vê diferença nenhuma.
 *
 * `aim` (botão direito preso) e `zoomDelta` (roda do mouse) são LOCAIS e opcionais: ficam fora do
 * pacote de propósito — a simulação autoritativa do co-op é a da fazenda com pistolas e não conhece
 * mira apurada, então mandá-los só produziria divergência. Sendo opcionais, `toFrame` do servidor
 * continua construindo quadros válidos sem tocá-los.
 */
export interface InputFrame { x: number; z: number; jump: boolean; dodge: boolean; fire: boolean; charging: boolean; reload?: boolean; stance?: boolean; dash?: boolean; interact?: number | undefined; aim?: boolean; zoomDelta?: number }
export const EMPTY_INPUT: InputFrame = { x: 0, z: 0, jump: false, dodge: false, fire: false, charging: false };
