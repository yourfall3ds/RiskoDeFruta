export type EntityId = number;
export interface Vec3 { x: number; y: number; z: number }
export interface Transform { previous: Vec3; current: Vec3 }
export interface Entity { readonly id: EntityId; readonly definitionId: string; transform: Transform }
export interface System { readonly id: string; fixedUpdate(dt: number): void; dispose(): void }

export interface DamageContext {
  attackerId: EntityId;
  victimId: EntityId;
  sourceId: string;
  attackId: string;
  baseDamage: number;
  finalDamage: number;
  crit: boolean;
  procCoefficient: number;
  procChainDepth: number;
  sourceProcId?: string;
  damageTags: readonly string[];
  hitPosition: Vec3;
  hitNormal: Vec3;
  forceDirection: Vec3;
  forceMagnitude: number;
}

export interface GameEvents {
  DamageDealt: DamageContext;
  DamageTaken: DamageContext;
  EnemyHit: DamageContext;
  EnemyKilled: DamageContext;
  FruitHarvested: {sequence:number;entityId:EntityId;kind:string;position:Vec3};
  PlayerHit: DamageContext;
  PlayerKilled: DamageContext;
  SkillUsed: { entityId: EntityId; skillId: string };
  MPCharged: { entityId: EntityId; tier: 1 | 2 | 3 };
  MPReleased: { entityId: EntityId; tier: 0 | 1 | 2 | 3 };
  BodyBumped: {entityId:EntityId;strength:number};
  Dodged: { entityId: EntityId; direction: Vec3 };
  ItemPicked: { entityId: EntityId; itemId: string };
  ItemStackChanged: { entityId: EntityId; itemId: string; stacks: number };
  StageStarted: { stageId: string; seed: string };
  StageCompleted: { stageId: string };
  BossSpawned: { entityId: EntityId; definitionId: string };
  BossKilled: DamageContext;
  InteractableUsed: { entityId: EntityId; interactableId: string };
  LevelUp: { entityId: EntityId; level: number };
}
