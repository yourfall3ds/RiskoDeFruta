import { createSocket, type Socket } from 'node:dgram';

/**
 * DESCOBERTA NA LAN por difusão UDP.
 *
 * O problema: a lista de salas do jogo (`ColyseusRoomBrowser`) só enxerga as salas do servidor ao
 * qual o cliente JÁ está ligado. No aplicativo instalado cada jogador é anfitrião do próprio
 * servidor embutido, então cada um vê só as próprias salas — e "abrir e achar o amigo" seria
 * mentira: alguém ainda teria de ditar um endereço.
 *
 * A solução é uma camada ANTES do Colyseus: cada anfitrião grita na rede local "estou aqui, nesta
 * porta", e todo mundo escuta. Não precisa de internet, de servidor central, nem de configuração
 * de roteador. O que se descobre aqui vira o endereço que o cliente passa ao Colyseus — a
 * descoberta NÃO substitui o matchmaking, ela só o alimenta.
 */
export const PORTA_DESCOBERTA = 25670;
export const ASSINATURA = 'risco-de-fruta';
/** Versão do PROTOCOLO de anúncio, não a do jogo: só sobe quando o formato do pacote muda. */
export const VERSAO_PROTOCOLO = 1;

export interface Anuncio {
  readonly jogo: typeof ASSINATURA;
  readonly versao: number;
  readonly porta: number;
  readonly nome: string;
  /** Identidade da INSTÂNCIA, não da máquina: é ela que deixa dois jogos no mesmo PC se distinguirem. */
  readonly id: string;
}

export interface Anfitriao extends Anuncio {
  /** Preenchido por quem RECEBE, a partir do pacote — o anunciante não sabe como é visto. */
  readonly endereco: string;
  readonly vistoEm: number;
}

/**
 * Um anúncio só é aceito se for RECONHECÍVEL. A porta 25670 pode receber qualquer lixo de rede
 * (outro programa, um pacote truncado, uma sonda), e `JSON.parse` de lixo lança — dentro de um
 * ouvinte de evento do Node isso derruba o processo, que é o mesmo acidente que `server/index.ts`
 * documenta no `request`. Por isso tudo aqui é tolerante e nada lança.
 */
export function lerAnuncio(dados: Uint8Array | string): Anuncio | undefined {
  try {
    const bruto: unknown = JSON.parse(typeof dados === 'string' ? dados : Buffer.from(dados).toString('utf8'));
    if (!bruto || typeof bruto !== 'object') return undefined;
    const obj = bruto as Record<string, unknown>;
    if (obj['jogo'] !== ASSINATURA) return undefined;
    const porta = Number(obj['porta']);
    if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) return undefined;
    const id = String(obj['id'] ?? '');
    if (!id) return undefined;
    const versao = Number(obj['versao']);
    return {
      jogo: ASSINATURA,
      versao: Number.isFinite(versao) ? versao : 0,
      porta,
      nome: String(obj['nome'] ?? 'Sala'),
      id,
    };
  } catch {
    return undefined;
  }
}

export function escreverAnuncio(anuncio: Anuncio): Buffer {
  return Buffer.from(JSON.stringify(anuncio), 'utf8');
}

/**
 * A lista de anfitriões vistos, com VALIDADE.
 *
 * A parte difícil da descoberta não é achar, é ESQUECER. Um jogo que fecha não avisa ninguém — o
 * anfitrião some sem despedida. Sem validade, a sala dele ficaria na lista para sempre e o amigo
 * clicaria numa sala morta; o sintoma seria "entrei e travou", que parece bug de rede e é entrada
 * velha em lista.
 *
 * Então cada anúncio renova um prazo, e quem para de anunciar cai fora sozinho. O prazo é bem
 * maior que o intervalo de anúncio para que um único pacote UDP perdido — e UDP perde, por
 * projeto — não faça a sala piscar na tela.
 */
export class DiretorioDeAnfitrioes {
  private readonly vistos = new Map<string, Anfitriao>();

  constructor(
    private readonly validadeMs = 8000,
    private readonly agora: () => number = () => Date.now(),
  ) {}

  /** Registra (ou renova) um anfitrião. Devolve `true` quando a lista MUDOU de verdade. */
  registrar(anuncio: Anuncio, endereco: string): boolean {
    const anterior = this.vistos.get(anuncio.id);
    this.vistos.set(anuncio.id, { ...anuncio, endereco, vistoEm: this.agora() });
    // Renovar um anfitrião já conhecido, no mesmo endereço e com o mesmo nome, NÃO é mudança: se
    // fosse, a interface redesenharia a lista a cada intervalo de anúncio e o clique do jogador
    // cairia no lugar errado no instante do redesenho.
    return !anterior || anterior.endereco !== endereco || anterior.nome !== anuncio.nome || anterior.porta !== anuncio.porta;
  }

  /** Remove os vencidos. Devolve `true` quando algo saiu. */
  expirar(): boolean {
    const limite = this.agora() - this.validadeMs;
    let mudou = false;
    for (const [id, anfitriao] of this.vistos) if (anfitriao.vistoEm < limite) { this.vistos.delete(id); mudou = true; }
    return mudou;
  }

  /** Ignora a si mesmo: quem anuncia por difusão também RECEBE o próprio pacote de volta. */
  listar(exceto?: string): Anfitriao[] {
    this.expirar();
    return [...this.vistos.values()].filter((a) => a.id !== exceto).sort((a, b) => a.nome.localeCompare(b.nome));
  }

  esquecer(id: string): void { this.vistos.delete(id); }
  get tamanho(): number { return this.vistos.size; }
}

export interface OpcoesDescoberta {
  readonly porta?: number;
  /** Para onde gritar. Em produção é a difusão; nos testes, `127.0.0.1`, que não sai da máquina. */
  readonly destino?: string;
  readonly intervaloMs?: number;
  readonly validadeMs?: number;
}

/**
 * O socket compartilhado: a MESMA porta é usada para anunciar e para escutar.
 *
 * `reuseAddr` é o que permite duas cópias do jogo no mesmo computador — sem ele, a segunda morre
 * com `EADDRINUSE` ao tentar escutar, e de novo o sintoma seria "o jogo não abre".
 */
function abrirSocket(porta: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    socket.once('error', reject);
    socket.bind(porta, () => {
      socket.removeListener('error', reject);
      // Precisa estar ligado para a difusão ser permitida; em alguns sistemas isto falha sem
      // privilégio, e falhar aqui não pode derrubar o jogo — sem difusão ele ainda joga sozinho e
      // ainda aceita um código digitado.
      try { socket.setBroadcast(true); } catch { /* segue sem difusão */ }
      resolve(socket);
    });
  });
}

/**
 * Sobe a descoberta: anuncia o próprio servidor e mantém a lista dos outros.
 *
 * `aoMudar` só é chamado quando a lista MUDA, porque é ele que redesenha a interface.
 */
export async function iniciarDescoberta(
  anuncio: Anuncio,
  aoMudar: (anfitrioes: Anfitriao[]) => void,
  opcoes: OpcoesDescoberta = {},
): Promise<{ parar: () => void; diretorio: DiretorioDeAnfitrioes; porta: number }> {
  const porta = opcoes.porta ?? PORTA_DESCOBERTA;
  const destino = opcoes.destino ?? '255.255.255.255';
  const intervaloMs = opcoes.intervaloMs ?? 2000;
  const diretorio = new DiretorioDeAnfitrioes(opcoes.validadeMs ?? intervaloMs * 4);
  const socket = await abrirSocket(porta);

  socket.on('message', (dados, remetente) => {
    const recebido = lerAnuncio(dados);
    if (!recebido || recebido.id === anuncio.id) return;
    // O endereço vem do PACOTE, não do anúncio: é o único dado que o anunciante não tem como
    // errar, porque ele não sabe por qual interface foi visto.
    if (diretorio.registrar(recebido, `${remetente.address}:${recebido.porta}`)) aoMudar(diretorio.listar(anuncio.id));
  });
  socket.on('error', () => { /* rede sumiu; o jogo continua */ });

  const pacote = escreverAnuncio(anuncio);
  const gritar = (): void => { try { socket.send(pacote, porta, destino); } catch { /* sem rede agora */ } };
  const timerAnuncio = setInterval(gritar, intervaloMs);
  // A varredura de vencidos é separada do anúncio: uma sala que sumiu tem de cair da lista mesmo
  // quando NINGUÉM está anunciando mais nada (que é justamente quando o último amigo fechou o jogo).
  const timerLimpeza = setInterval(() => { if (diretorio.expirar()) aoMudar(diretorio.listar(anuncio.id)); }, intervaloMs);
  timerAnuncio.unref?.();
  timerLimpeza.unref?.();
  gritar();

  return {
    porta,
    diretorio,
    parar: () => { clearInterval(timerAnuncio); clearInterval(timerLimpeza); try { socket.close(); } catch { /* já fechado */ } },
  };
}
