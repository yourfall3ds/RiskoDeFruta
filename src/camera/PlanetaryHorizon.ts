import type { Vec3 } from '../core/contracts';

/** Visual horizon only; movement and aiming retain their world-space direction. */
export class PlanetaryHorizon {
  private roll = 0;
  update(position: Vec3, yaw: number, pitch: number, dt: number): number {
    if (![position.x, position.z, yaw, pitch, dt].every(Number.isFinite) || dt <= 0) return this.roll;
    const lateral = position.x * Math.cos(yaw) - position.z * Math.sin(yaw);
    const limit = 4 * Math.PI / 180;
    const target = -Math.max(-limit, Math.min(limit, Math.atan2(lateral, 2400))) * Math.cos(pitch) ** 2;
    const step = Math.min(dt, .1);
    const change = (target - this.roll) * (1 - Math.exp(-step / 1.4));
    const maxChange = 2 * Math.PI / 180 * step;
    this.roll += Math.max(-maxChange, Math.min(maxChange, change));
    return this.roll;
  }
}
