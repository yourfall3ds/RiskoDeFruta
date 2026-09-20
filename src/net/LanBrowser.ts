import type { RoomBrowserLink, RoomRow } from './RoomBrowser';

/**
 * A LISTA DE SALAS DA REDE LOCAL.
 *
 * O `ColyseusRoomBrowser` enxerga as salas de UM servidor: aquele ao qual esta página está ligada.
 * Isso bastava enquanto havia um servidor só (`npm run server`, todo mundo apontando para ele).
 *
 * No aplicativo instalado não há servidor combinado: cada jogador que abre o jogo é anfitrião do
 * próprio servidor embutido. Se a lista continuasse sendo a de um servidor só, cada um veria
 * apenas as próprias salas — e a promessa de "abriu e achou o amigo" exigiria alguém ditar um
 * endereço, que é exatamente o que o instalador existe para eliminar.
 *
 * Então a lista passa a ser uma SOMA: as salas do servidor local mais as salas de cada anfitrião
 * que a descoberta por UDP encontrou (`electron/discovery.ts`). Este arquivo é a soma, e nada
 * mais — ele não fala UDP nem Colyseus; recebe os endereços de um lado, cria um navegador por
 * endereço do outro, e junta.
 */

/** O que o `preload` do Electron expõe. Ausente no navegador, e isso é um caminho normal. */
export interface PonteLan {
  readonly empacotado: boolean;
  anfitrioes(): Promise<{ endereco: string; nome: string; id: string }[]>;
  aoMudarAnfitrioes(ouvinte: (lista: { endereco: string; nome: string; id: string }[]) => void): () => void;
}

export function ponteLan(escopo: unknown = globalThis): PonteLan | undefined {
  const ponte = (escopo as { riscoDeFruta?: PonteLan } | undefined)?.riscoDeFruta;
  return ponte && typeof ponte.anfitrioes === 'function' ? ponte : undefined;
}

/**
 * Junta as listas de vários servidores numa só, sem duplicar.
 *
 * A deduplicação é por `roomId` + servidor, e não por `roomId` sozinho: dois anfitriões diferentes
 * geram `roomId`s independentes e podem colidir por acaso — o Colyseus só garante unicidade DENTRO
 * de um servidor. Deduplicar só pelo `roomId` faria a sala de um amigo sumir porque outro amigo,
 * noutra máquina, tinha uma sala com o mesmo identificador.
 */
export function juntarSalas(listas: readonly (readonly RoomRow[])[]): RoomRow[] {
  const vistas = new Map<string, RoomRow>();
  for (const lista of listas) for (const sala of lista) {
    const chave = `${sala.server ?? ''}|${sala.roomId}`;
    if (!vistas.has(chave)) vistas.set(chave, sala);
  }
  return [...vistas.values()];
}

/** Endereço anunciado (`192.168.0.7:2567`) → URL de WebSocket que o SDK entende. */
export function urlDoAnfitriao(endereco: string): string {
  const limpo = String(endereco ?? '').trim();
  if (!limpo) return '';
  if (/^wss?:\/\//i.test(limpo)) return limpo;
  return `ws://${limpo}`;
}

export interface FabricaDeNavegador {
  (url: string): RoomBrowserLink & { connect(): Promise<void> };
}

/**
 * O navegador agregado: um por servidor, somados.
 *
 * Ele é um `RoomBrowserLink` como qualquer outro, de propósito — `MenuShell` não precisa saber que
 * a lista virou uma soma, e o caminho de navegador (sem ponte) continua sendo exatamente um
 * navegador só, com o mesmo comportamento de antes.
 */
export class NavegadorDaLan implements RoomBrowserLink {
  private readonly filhos = new Map<string, RoomBrowserLink>();
  private readonly ouvintes = new Set<() => void>();
  private readonly desinscrever = new Map<string, () => void>();
  private descartado = false;
  private soltarPonte: (() => void) | undefined;

  constructor(
    private readonly urlLocal: string,
    private readonly criar: FabricaDeNavegador,
    private readonly ponte = ponteLan(),
  ) {}

  get rooms(): readonly RoomRow[] { return juntarSalas([...this.filhos.values()].map(f => f.rooms)); }

  /**
   * O erro é o do servidor LOCAL, não o de qualquer um.
   *
   * Um amigo que fechou o jogo entre o anúncio e a conexão deixa um navegador com erro — e mostrar
   * "não consegui falar com o servidor" por causa disso seria alarme falso: o jogo local está de
   * pé e as outras salas estão na tela. Só o servidor embutido não responder é notícia.
   */
  get error(): string { return this.filhos.get(this.urlLocal)?.error ?? ''; }

  async connect(): Promise<void> {
    await this.ligar(this.urlLocal);
    if (!this.ponte) return;
    try {
      this.aplicarAnfitrioes(await this.ponte.anfitrioes());
      this.soltarPonte = this.ponte.aoMudarAnfitrioes(lista => this.aplicarAnfitrioes(lista));
    } catch { /* sem descoberta; a lista local continua valendo */ }
  }

  private aplicarAnfitrioes(lista: readonly { endereco: string }[]): void {
    if (this.descartado) return;
    const desejados = new Set([this.urlLocal, ...lista.map(a => urlDoAnfitriao(a.endereco)).filter(Boolean)]);
    // Quem sumiu da descoberta é DESLIGADO, não só escondido: manter o WebSocket de um jogo que
    // fechou custa uma reconexão eterna em segundo plano para cada amigo que já foi embora.
    for (const url of [...this.filhos.keys()]) if (!desejados.has(url)) this.desligar(url);
    for (const url of desejados) if (!this.filhos.has(url)) void this.ligar(url);
    this.avisar();
  }

  private async ligar(url: string): Promise<void> {
    if (this.descartado || this.filhos.has(url)) return;
    const filho = this.criar(url);
    this.filhos.set(url, filho);
    this.desinscrever.set(url, filho.onChange(() => this.avisar()));
    await filho.connect();
    if (this.descartado) { this.desligar(url); return; }
    this.avisar();
  }

  private desligar(url: string): void {
    this.desinscrever.get(url)?.();
    this.desinscrever.delete(url);
    this.filhos.get(url)?.dispose();
    this.filhos.delete(url);
  }

  private avisar(): void { if (!this.descartado) for (const ouvinte of this.ouvintes) ouvinte(); }

  onChange(ouvinte: () => void): () => void {
    this.ouvintes.add(ouvinte);
    return () => { this.ouvintes.delete(ouvinte); };
  }

  dispose(): void {
    this.descartado = true;
    this.soltarPonte?.();
    this.ouvintes.clear();
    for (const url of [...this.filhos.keys()]) this.desligar(url);
  }
}
