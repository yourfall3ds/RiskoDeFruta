import { schema, t } from '@colyseus/schema';
import type { InputFrame } from '../input/InputFrame';

/** Bits de `NetInput.buttons`. Intenções, nunca resultados. */
export const BUTTON = { FIRE: 1, JUMP: 2, DODGE: 4, CHARGE: 8, RELOAD: 16, INTERACT: 32 } as const;

/**
 * Entrada flat por tick (cliente → servidor), compartilhada entre `server/` e o cliente Babylon.
 * `seq` é o campo de sequência do `defineInput`; o servidor ignora seq repetido ou atrasado.
 */
export const NetInput = schema({
  x: t.float32(), z: t.float32(), yaw: t.float32(), pitch: t.float32(),
  buttons: t.uint8(), interactOption: t.uint8(), seq: t.uint32(),
}, 'NetInput');
export type NetInput = InstanceType<typeof NetInput>;

export function toFrame(input: NetInput): InputFrame {
  const b = input.buttons;
  const frame: InputFrame = { x: input.x, z: input.z, jump: !!(b & BUTTON.JUMP), dodge: !!(b & BUTTON.DODGE), fire: !!(b & BUTTON.FIRE), charging: !!(b & BUTTON.CHARGE) };
  if (b & BUTTON.RELOAD) frame.reload = true;
  if (b & BUTTON.INTERACT) frame.interact = input.interactOption;
  return frame;
}

/** Escreve um `InputFrame` local no objeto de input do SDK (mutação in-place; o SDK serializa no `send()`). */
export function writeInput(target: NetInput, frame: InputFrame, yaw: number, pitch: number, seq: number): void {
  target.x = frame.x; target.z = frame.z; target.yaw = yaw; target.pitch = pitch; target.seq = seq;
  target.buttons = (frame.fire ? BUTTON.FIRE : 0) | (frame.jump ? BUTTON.JUMP : 0) | (frame.dodge ? BUTTON.DODGE : 0)
    | (frame.charging ? BUTTON.CHARGE : 0) | (frame.reload ? BUTTON.RELOAD : 0) | (frame.interact !== undefined ? BUTTON.INTERACT : 0);
  target.interactOption = frame.interact ?? 0;
}
