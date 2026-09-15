export interface Definition { readonly id: string }

export class ContentRegistry<T extends Definition> {
  private readonly entries = new Map<string, Readonly<T>>();
  register(definition: T): void {
    if (!definition.id.trim()) throw new Error('Empty content id');
    if (this.entries.has(definition.id)) throw new Error(`Duplicate content: ${definition.id}`);
    this.entries.set(definition.id, Object.freeze({ ...definition }));
  }
  get(id: string): Readonly<T> {
    const value = this.entries.get(id);
    if (!value) throw new Error(`Missing content: ${id}`);
    return value;
  }
  get size(): number { return this.entries.size; }
  values(): IterableIterator<Readonly<T>> { return this.entries.values(); }
}
