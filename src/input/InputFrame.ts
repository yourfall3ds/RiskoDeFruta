/** Quadro de entrada por tick. Puro: é compartilhado entre o cliente (captura) e o servidor (simulação). */
/**
 * `dash` é a INTENÇÃO de arrancada já resolvida (duplo toque detectado na captura).
 * Viaja no pacote para o servidor não precisar redetectar a borda — ele ainda valida
 * cooldown, carga aérea e colisão, então continua autoritativo.
 */
export interface InputFrame { x: number; z: number; jump: boolean; dodge: boolean; fire: boolean; charging: boolean; reload?: boolean; stance?: boolean; dash?: boolean; interact?: number | undefined }
export const EMPTY_INPUT: InputFrame = { x: 0, z: 0, jump: false, dodge: false, fire: false, charging: false };
