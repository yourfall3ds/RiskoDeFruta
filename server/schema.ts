import { schema, t } from '@colyseus/schema';

/**
 * Estado publicado pela sala, via Schema Builder (sem decorators: independe do toolchain).
 * Só campos de simulação; ragdoll, poses, sombras e áudio ficam locais em cada cliente.
 */
/**
 * Classes por ORDINAL: o índice aqui é o que viaja em `PlayerState.classId`.
 * O cliente resolve nome e retrato pela tabela local (`src/run/PlayerClass.ts`), como já faz com
 * o ícone dos drops — string na rede custa tamanho + moldura a cada mudança.
 *
 * `classChosen` existe à parte porque "ainda não escolhi" NÃO pode ser um ordinal válido: a
 * unanimidade do lobby precisa distinguir "escolheu o pistoleiro (0)" de "não escolheu nada".
 */
export const CLASS_IDS = ['gunslinger', 'soldier'] as const;
export type ClassId = typeof CLASS_IDS[number];

/** Fases da sala. Só duas por enquanto; o plano reserva 2..4 para viagem/extração/derrota. */
export const PHASE = { lobby: 0, playing: 1 } as const;

export const PlayerState = schema({
  id: t.string(),
  // Numeração 1..4 atribuída UMA VEZ na entrada. Ver `FarmSimulation.addPlayer`: recalcular pela
  // ordem do mapa renumerava os jogadores restantes quando alguém caía no meio da corrida.
  entityId: t.uint8(),
  name: t.string(), classId: t.uint8(), classChosen: t.boolean(), ready: t.boolean(),
  x: t.number(), y: t.number(), z: t.number(), yaw: t.number(), pitch: t.number(),
  seq: t.uint32(),
  hp: t.number(), maxHP: t.number(),
  grounded: t.boolean(), sprinting: t.boolean(),
  dodgeRemaining: t.number(), charges: t.uint8(), invulnerable: t.number(),
  ammo: t.uint8(), reloading: t.boolean(),
  mpSeconds: t.number(), mpTier: t.uint8(),
  skillTier: t.uint8(), skillElapsed: t.number(), skillActive: t.boolean(),
  /** Pilhas DESTE jogador. Itens são instanciados por sobrevivente; créditos e XP é que são da sala. */
  inventory: t.map('uint16'),
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

/** Contadores da SALA. O inventário saiu daqui e virou `PlayerState.inventory` — itens são por jogador. */
export const ProgressionState = schema({
  credits: t.uint32(), xp: t.uint32(), level: t.uint16(), totalKills: t.uint32(),
}, 'ProgressionState');

export const FarmState = schema({
  seed: t.string(), tick: t.uint32(), time: t.number(),
  /** `PHASE.lobby` | `PHASE.playing`. A corrida só sai do lobby por unanimidade (ver `FarmRoom`). */
  phase: t.uint8(),
  /** Sessão do anfitrião: primeiro a entrar, e o próximo do mapa quando ele sai. Dono dos ajustes. */
  hostId: t.string(),
  playerCount: t.uint8(),
  /** Ajustes da corrida (seed, modo). Só o anfitrião escreve; `setSetting` de outro é recusado. */
  settings: t.map('string'),
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
