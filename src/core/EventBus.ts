type Listener<T> = (event: T) => void;

export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    let bucket = this.listeners.get(type);
    if (!bucket) { bucket = new Set(); this.listeners.set(type, bucket); }
    bucket.add(listener as Listener<never>);
    return () => {
      bucket.delete(listener as Listener<never>);
      if (!bucket.size && this.listeners.get(type) === bucket) this.listeners.delete(type);
    };
  }

  emit<K extends keyof Events>(type: K, event: Events[K]): void {
    const bucket = this.listeners.get(type);
    if (!bucket) return;
    // Snapshot preserves predictable delivery when a handler changes subscriptions.
    for (const listener of [...bucket]) listener(event as never);
  }

  get listenerCount(): number {
    let count = 0;
    for (const bucket of this.listeners.values()) count += bucket.size;
    return count;
  }

  clear(): void { this.listeners.clear(); }
}
