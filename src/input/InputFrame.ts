/** Quadro de entrada por tick. Puro: é compartilhado entre o cliente (captura) e o servidor (simulação). */
/**
 * `dash` é a INTENÇÃO de arrancada já resolvida (duplo toque detectado na captura).
 * Viaja no pacote para o servidor não precisar redetectar a borda — ele ainda valida
 * cooldown, carga aérea e colisão, então continua autoritativo.
 */
/**
 * `swapWeapon` (tecla B) e `cycleMode` (tecla T) são de borda, como `reload` e `stance`.
 *
 * Ficam FORA do pacote de rede de propósito (ver `NetInput`): a simulação autoritativa do co-op é a
 * da fazenda com pistolas, e mandar uma troca de arma que o servidor não conhece só produziria
 * divergência. A PRISM é local; o movimento enviado ao servidor continua sendo o mesmo de sempre.
 */
export interface InputFrame { x: number; z: number; jump: boolean; dodge: boolean; fire: boolean; charging: boolean; reload?: boolean; stance?: boolean; dash?: boolean; interact?: number | undefined; swapWeapon?: boolean; cycleMode?: boolean }
export const EMPTY_INPUT: InputFrame = { x: 0, z: 0, jump: false, dodge: false, fire: false, charging: false };
