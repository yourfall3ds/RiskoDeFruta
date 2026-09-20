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
  /**
   * Direção REAL do projétil que produziu o acerto, quando o emissor a conhece — OPCIONAL e
   * aditivo: nada existente lê este campo e nenhum emissor é obrigado a preenchê-lo.
   *
   * Por que não reaproveitar `forceDirection`: ele é a direção do TRANCO, e nos disparos ele carrega
   * o rumo da CÂMERA, enquanto `hitPosition` sai do raio que parte do CANO. A poucos metros os dois
   * divergem em graus, o suficiente para um teste de ponto fraco errar de lado. Quem preenche
   * `hitDirection` entrega o par coerente `(hitPosition, hitDirection)` — origem e direção do mesmo
   * segmento —, que é o que `resolveWeakPoint` precisa para dizer "a bala passou DENTRO da asa"
   * em vez de "a bala acertou perto do bicho".
   *
   * Ausente ⇒ quem consome cai em `forceDirection`, que é o comportamento anterior.
   */
  hitDirection?: Vec3;
  /**
   * IDENTIDADE DESTE EVENTO DE COMBATE, quando o servidor o emitiu — OPCIONAL e aditivo.
   *
   * Existe para que retransmissão, reconciliação ou mensagem duplicada não produzam dano duas
   * vezes, proc duas vezes nem morte duas vezes: quem aplica guarda o id e recusa o repetido. Um
   * contexto sem `combatEventId` é um golpe que não tem como se repetir (dano contínuo, QA, teste)
   * e segue pelo caminho de sempre.
   */
  combatEventId?: string;
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
