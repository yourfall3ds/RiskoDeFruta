/**
 * CRONÔMETRO POR TRECHO do quadro de apresentação.
 *
 * O F1 dizia "Apresentação CPU 246 ms/quadro" e "Cena Babylon 26 ms": 220 ms por quadro gastos em
 * ALGUM lugar da lógica de apresentação, sem dizer onde. Isto mede o intervalo entre marcas
 * consecutivas (`begin` → `mark(nome)` → … ) e publica, a cada 2 s, os trechos mais caros em média.
 * Custo: um `performance.now()` por marca — desprezível perto do que está sendo caçado.
 */
export class FrameSections {
  private last = 0;
  private readonly totals = new Map<string, number>();
  private frames = 0;
  private since = 0;
  /** "horda 180.2 ms · câmera 12.0 ms · …" — os mais caros, em média por quadro. */
  summary = '';

  begin(): void {
    const now = performance.now();
    this.last = now;
    if (!this.since) this.since = now;
    this.frames++;
    if (now - this.since >= 2000) this.publish(now);
  }

  mark(name: string): void {
    const now = performance.now();
    this.totals.set(name, (this.totals.get(name) ?? 0) + (now - this.last));
    this.last = now;
  }

  private publish(now: number): void {
    const frames = Math.max(1, this.frames - 1);
    this.summary = [...this.totals].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([name, total]) => `${name} ${(total / frames).toFixed(1)} ms`).join(' · ');
    this.totals.clear(); this.frames = 1; this.since = now;
  }
}
