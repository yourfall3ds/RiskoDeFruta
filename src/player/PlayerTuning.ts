// Baseline corrigido em 15/09 pela revisão visual: 5,5/8 não desacelerava nada (antes 5,4/8,1).
// Valores adotados: caminhada 4,4 m/s, corrida 6,8 m/s, tiro ~3,3 disparos/s.
// `sprintMultiplier` é derivado para que a corrida bata exatamente SPRINT_SPEED.
export const WALK_SPEED = 4.4;
export const SPRINT_SPEED = 6.8;
export const PLAYER_TUNING = {
  speed: WALK_SPEED, sprintMultiplier: SPRINT_SPEED / WALK_SPEED, accelerationSeconds: 0.08, airControl: 0.75, airSpeedCap: 1.3,
  gravity: 20, jumpApex: 2.2, terminalVelocity: 70, coyoteSeconds: 0.13,
  jumpBufferSeconds: 0.15, radius: 0.32, height: 1.8, stepHeight: 0.5,
  maxSlopeDegrees: 50, dodgeDistance: 6, dodgeSeconds: 0.72, dodgeIFrames: 0.22,
  dodgeCharges: 2, dodgeRechargeSeconds: 2.5, safeGroundInterval: 0.5,
  voidHeight: -25, voidDamageFraction: 0.25, respawnProtection: 1,
  maxHP: 130, regeneration: 1,
  // Além da inclinação máxima o jogador escorrega em vez de ficar pendurado na cápsula.
  slideAcceleration: 16, slideMaxSpeed: 11, slideFriction: 1.6,
  // Dash direcional por duplo toque de WASD (item 10), disponível também no ar.
  dashDoubleTapSeconds: 0.28, dashDistance: 5.2, dashSeconds: 0.26, dashCooldownSeconds: 1.45, dashAirCharges: 1,
} as const;
export const CAMERA_TUNING = {
  distance: 2.25, shoulderOffset: .72, pivotHeight: 1.50, fov: 60 * Math.PI / 180, smoothing: 0.06,
  radius: 0.25, near: 0.08, sensitivity: 0.0022, pitchMin: -1.1, pitchMax: 1.1,
  defaultPitch: 0.02, shake: 0.35,
  // Acompanhamento amortecido com antecipação moderada e abertura de FOV na corrida.
  lookAheadMeters: 0.55, lookAheadSmoothing: 0.22, sprintFovDegrees: 6, fovSmoothing: 0.35,
} as const;
export const PISTOL_TUNING = { rate: 3.3, damage: 12, spreadDegrees: 1.5, range: 180, tracerSeconds: 0.045, recoilSeconds: 0.10 } as const;
// Combate desarmado alternável (tecla V). Cadência inicial lenta, conforme pedido.
export const MELEE_TUNING = {
  steps: [
    {id:'right-cross', windup:0.28, active:0.13, recover:0.33, damage:26, range:2.35, coneDegrees:95, force:4},
    {id:'left-hook',   windup:0.26, active:0.13, recover:0.31, damage:28, range:2.35, coneDegrees:95, force:4},
    {id:'right-kick',  windup:0.30, active:0.15, recover:0.37, damage:32, range:2.60, coneDegrees:80, force:9},
    {id:'uppercut',    windup:0.30, active:0.15, recover:0.37, damage:34, range:2.20, coneDegrees:80, force:8},
    {id:'left-kick',   windup:0.32, active:0.15, recover:0.38, damage:32, range:2.60, coneDegrees:95, force:9},
    {id:'spin-kick',   windup:0.34, active:0.25, recover:0.50, damage:44, range:2.90, coneDegrees:220, force:12},
  ],
  comboWindowSeconds: 0.55,
} as const;
