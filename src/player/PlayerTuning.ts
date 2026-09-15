export const PLAYER_TUNING = {
  speed: 5.4, sprintMultiplier: 1.5, accelerationSeconds: 0.08, airControl: 0.75, airSpeedCap: 1.3,
  gravity: 20, jumpApex: 2.2, terminalVelocity: 70, coyoteSeconds: 0.13,
  jumpBufferSeconds: 0.15, radius: 0.32, height: 1.8, stepHeight: 0.5,
  maxSlopeDegrees: 50, dodgeDistance: 6, dodgeSeconds: 0.72, dodgeIFrames: 0.22,
  dodgeCharges: 2, dodgeRechargeSeconds: 2.5, safeGroundInterval: 0.5,
  voidHeight: -25, voidDamageFraction: 0.25, respawnProtection: 1,
  maxHP: 130, regeneration: 1,
} as const;
export const CAMERA_TUNING = {
  distance: 2.25, shoulderOffset: .72, pivotHeight: 1.50, fov: 60 * Math.PI / 180, smoothing: 0.06,
  radius: 0.25, near: 0.08, sensitivity: 0.0022, pitchMin: -1.1, pitchMax: 1.1,
  defaultPitch: 0.02, shake: 0.35,
} as const;
export const PISTOL_TUNING = { rate: 6.7, damage: 12, spreadDegrees: 1.5, range: 180, tracerSeconds: 0.045, recoilSeconds: 0.10 } as const;
