import { schema, t } from '@colyseus/schema';

/**
 * Estado publicado pela sala, via Schema Builder (sem decorators: independe do toolchain).
 * Só campos de simulação; ragdoll, poses, sombras e áudio ficam locais em cada cliente.
 */
export const PlayerState = schema({
  id: t.string(),
  x: t.number(), y: t.number(), z: t.number(), yaw: t.number(), pitch: t.number(),
  seq: t.uint32(),
  hp: t.number(), maxHP: t.number(),
  grounded: t.boolean(), sprinting: t.boolean(),
  dodgeRemaining: t.number(), charges: t.uint8(), invulnerable: t.number(),
  ammo: t.uint8(), reloading: t.boolean(),
  mpSeconds: t.number(), mpTier: t.uint8(),
  skillTier: t.uint8(), skillElapsed: t.number(), skillActive: t.boolean(),
}, 'PlayerState');
export type PlayerState = InstanceType<typeof PlayerState>;

export const EnemyState = schema({
  id: t.uint16(), kind: t.string(), variant: t.string(), scale: t.number(),
  x: t.number(), y: t.number(), z: t.number(), yaw: t.number(),
  hp: t.number(), maxHP: t.number(),
  state: t.string(), time: t.number(), burn: t.number(), stagger: t.number(),
}, 'EnemyState');
export type EnemyState = InstanceType<typeof EnemyState>;

export const WarningState = schema({
  x: t.number(), y: t.number(), z: t.number(), radius: t.number(),
  remaining: t.number(), duration: t.number(), kind: t.string(), owner: t.uint16(),
}, 'WarningState');

export const ProjectileState = schema({
  x: t.number(), y: t.number(), z: t.number(), vx: t.number(), vy: t.number(), vz: t.number(), radius: t.number(), owner: t.uint16(),
}, 'ProjectileState');

export const InteractableState = schema({
  id: t.string(), kind: t.string(), x: t.number(), y: t.number(), z: t.number(),
  cost: t.uint16(), used: t.boolean(), opening: t.number(), lootIcon: t.int16(),
}, 'InteractableState');

export const DropState = schema({
  itemId: t.string(), icon: t.uint8(), x: t.number(), y: t.number(), z: t.number(), landed: t.boolean(),
}, 'DropState');

/** itemId → pilhas. Os 90 ids de `ITEMS` cabem aqui; o cliente resolve ícone/nome pela tabela local. */
export const ProgressionState = schema({
  credits: t.uint32(), xp: t.uint32(), level: t.uint16(), totalKills: t.uint32(),
  inventory: t.map('uint16'),
}, 'ProgressionState');

export const FarmState = schema({
  seed: t.string(), tick: t.uint32(), time: t.number(),
  stage: t.uint16(), wave: t.uint16(), hordeState: t.uint8(), intermission: t.number(), bossDeadTime: t.number(),
  ferryTime: t.number(),
  progression: ProgressionState,
  players: t.map(PlayerState),
  enemies: t.map(EnemyState),
  warnings: t.array(WarningState),
  projectiles: t.array(ProjectileState),
  interactables: t.array(InteractableState),
  drops: t.array(DropState),
}, 'FarmState');
export type FarmState = InstanceType<typeof FarmState>;
