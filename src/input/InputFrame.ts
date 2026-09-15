/** Quadro de entrada por tick. Puro: é compartilhado entre o cliente (captura) e o servidor (simulação). */
export interface InputFrame { x: number; z: number; jump: boolean; dodge: boolean; fire: boolean; charging: boolean; reload?: boolean; interact?: number | undefined }
export const EMPTY_INPUT: InputFrame = { x: 0, z: 0, jump: false, dodge: false, fire: false, charging: false };
