import type { Entity, EntityId, Vec3 } from './contracts';

/** Gameplay entities contain no renderer references. Removal commits at tick boundaries. */
export class EntityStore {
  private nextId = 1;
  private readonly entities = new Map<EntityId, Entity>();
  private readonly pendingRemoval = new Set<EntityId>();
  create(definitionId: string, position: Vec3): Entity {
    const entity: Entity = {
      id: this.nextId++, definitionId,
      transform: { current: { ...position }, previous: { ...position } },
    };
    this.entities.set(entity.id, entity);
    return entity;
  }
  get(id: EntityId): Entity | undefined { return this.entities.get(id); }
  values(): IterableIterator<Entity> { return this.entities.values(); }
  get size(): number { return this.entities.size; }
  remove(id: EntityId): void { if (this.entities.has(id)) this.pendingRemoval.add(id); }
  beginTick(): void {
    for (const entity of this.entities.values()) Object.assign(entity.transform.previous, entity.transform.current);
  }
  flushRemovals(onRemove: (entity: Entity) => void = () => {}): void {
    for (const id of this.pendingRemoval) {
      const entity = this.entities.get(id);
      if (entity) { onRemove(entity); this.entities.delete(id); }
    }
    this.pendingRemoval.clear();
  }
  clear(): void { this.entities.clear(); this.pendingRemoval.clear(); }
}
