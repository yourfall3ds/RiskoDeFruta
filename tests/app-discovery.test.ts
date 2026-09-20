import { describe, expect, it } from 'vitest';
import {
  ASSINATURA, DiretorioDeAnfitrioes, escreverAnuncio, iniciarDescoberta, lerAnuncio,
  VERSAO_PROTOCOLO, type Anfitriao, type Anuncio,
} from '../electron/discovery';
import { juntarSalas, ponteLan, urlDoAnfitriao } from '../src/net/LanBrowser';
import type { RoomRow } from '../src/net/RoomBrowser';

const anuncio = (id: string, porta = 2567, nome = 'Fazenda'): Anuncio =>
  ({ jogo: ASSINATURA, versao: VERSAO_PROTOCOLO, porta, nome, id });

describe('pacote de anúncio', () => {
  it('vai e volta inteiro', () => {
    expect(lerAnuncio(escreverAnuncio(anuncio('abc', 2570, 'Sítio')))).toEqual(anuncio('abc', 2570, 'Sítio'));
  });

  /**
   * A porta de descoberta recebe qualquer coisa que passe na rede. Um `JSON.parse` que lança dentro
   * do ouvinte de um socket derruba o processo — o mesmo acidente que `server/index.ts` documenta.
   */
  it.each([
    ['lixo binário', 'não é json {{{'],
    ['json que não é objeto', '42'],
    ['outro programa na mesma porta', JSON.stringify({ jogo: 'outra-coisa', porta: 1, id: 'x' })],
    ['sem porta', JSON.stringify({ jogo: ASSINATURA, id: 'x' })],
    ['porta fora da faixa', JSON.stringify({ jogo: ASSINATURA, porta: 99999, id: 'x' })],
    ['sem identidade', JSON.stringify({ jogo: ASSINATURA, porta: 2567 })],
  ])('recusa %s sem lançar', (_caso, carga) => {
    expect(lerAnuncio(carga)).toBeUndefined();
  });
});

describe('diretório de anfitriões', () => {
  it('um anfitrião novo é uma mudança; renovar o mesmo não é', () => {
    const dir = new DiretorioDeAnfitrioes();
    expect(dir.registrar(anuncio('a'), '192.168.0.2:2567')).toBe(true);
    expect(dir.registrar(anuncio('a'), '192.168.0.2:2567')).toBe(false);
  });

  it('o anfitrião que troca de endereço ou de nome é uma mudança', () => {
    const dir = new DiretorioDeAnfitrioes();
    dir.registrar(anuncio('a'), '192.168.0.2:2567');
    expect(dir.registrar(anuncio('a'), '192.168.0.9:2567')).toBe(true);
    expect(dir.registrar(anuncio('a', 2567, 'Outro'), '192.168.0.9:2567')).toBe(true);
  });

  /**
   * ESQUECER é a metade difícil: um jogo que fecha não se despede. Sem validade, a sala morta fica
   * na lista e o amigo clica nela.
   */
  it('quem para de anunciar cai da lista sozinho', () => {
    let agora = 1000;
    const dir = new DiretorioDeAnfitrioes(5000, () => agora);
    dir.registrar(anuncio('a'), '192.168.0.2:2567');
    dir.registrar(anuncio('b'), '192.168.0.3:2567');
    agora += 3000;
    dir.registrar(anuncio('b'), '192.168.0.3:2567'); // 'b' continua vivo
    agora += 3000;
    expect(dir.listar().map(h => h.id)).toEqual(['b']);
  });

  it('não lista a si mesmo — quem grita por difusão ouve o próprio grito', () => {
    const dir = new DiretorioDeAnfitrioes();
    dir.registrar(anuncio('eu'), '127.0.0.1:2567');
    dir.registrar(anuncio('outro'), '192.168.0.3:2567');
    expect(dir.listar('eu').map(h => h.id)).toEqual(['outro']);
  });
});

/**
 * A descoberta de verdade, com sockets UDP reais — mas em `127.0.0.1`, que não sai da máquina:
 * uma difusão de verdade numa suíte de testes seria ruído na rede de quem roda.
 */
describe('descoberta na LAN, ponta a ponta', () => {
  it('dois jogos abertos se acham sem ninguém digitar endereço', async () => {
    const porta = 25999;
    const opcoes = { porta, destino: '127.0.0.1', intervaloMs: 50, validadeMs: 5000 } as const;
    const vistosPorA: Anfitriao[][] = [];
    const a = await iniciarDescoberta(anuncio('jogo-a', 2567, 'Fazenda A'), lista => vistosPorA.push(lista), opcoes);
    const b = await iniciarDescoberta(anuncio('jogo-b', 2568, 'Fazenda B'), () => {}, opcoes);
    try {
      const prazo = Date.now() + 5000;
      while (a.diretorio.listar('jogo-a').length === 0 && Date.now() < prazo) await new Promise(r => setTimeout(r, 25));
      const achados = a.diretorio.listar('jogo-a');
      expect(achados.map(h => h.id)).toEqual(['jogo-b']);
      expect(achados[0]?.nome).toBe('Fazenda B');
      // O endereço vem do PACOTE (quem enviou) com a porta do ANÚNCIO: é o par que o convidado usa.
      expect(achados[0]?.endereco).toBe('127.0.0.1:2568');
      expect(vistosPorA.length).toBeGreaterThan(0);
    } finally {
      a.parar();
      b.parar();
    }
  });

  it('duas instâncias na mesma máquina conseguem escutar a mesma porta', async () => {
    const opcoes = { porta: 25998, destino: '127.0.0.1', intervaloMs: 1000 } as const;
    const a = await iniciarDescoberta(anuncio('x'), () => {}, opcoes);
    const b = await iniciarDescoberta(anuncio('y'), () => {}, opcoes);
    expect(a.porta).toBe(b.porta);
    a.parar();
    b.parar();
  });
});

describe('lista de salas somada', () => {
  const sala = (roomId: string, server: string): RoomRow =>
    ({ roomId, code: 'AAA', roomName: 'S', hostName: 'H', players: 1, max: 4, seed: 's', full: false, server });

  it('junta as salas de servidores diferentes', () => {
    const juntas = juntarSalas([[sala('1', 'ws://a:2567')], [sala('9', 'ws://b:2567')]]);
    expect(juntas).toHaveLength(2);
  });

  /**
   * O `roomId` só é único DENTRO de um servidor. Deduplicar por ele sozinho faria a sala de um
   * amigo desaparecer por coincidência de identificador com a de outro.
   */
  it('o mesmo roomId em máquinas diferentes são DUAS salas', () => {
    const juntas = juntarSalas([[sala('mesmo', 'ws://a:2567')], [sala('mesmo', 'ws://b:2567')]]);
    expect(juntas.map(s => s.server)).toEqual(['ws://a:2567', 'ws://b:2567']);
  });

  it('a mesma sala vista duas vezes aparece uma só', () => {
    expect(juntarSalas([[sala('1', 'ws://a:2567')], [sala('1', 'ws://a:2567')]])).toHaveLength(1);
  });

  it('o endereço anunciado vira URL de WebSocket', () => {
    expect(urlDoAnfitriao('192.168.0.7:2567')).toBe('ws://192.168.0.7:2567');
    expect(urlDoAnfitriao('ws://ja-tem:1')).toBe('ws://ja-tem:1');
    expect(urlDoAnfitriao('  ')).toBe('');
  });

  it('sem a ponte do Electron não há descoberta, e isso é um caminho normal', () => {
    expect(ponteLan({})).toBeUndefined();
    expect(ponteLan({ riscoDeFruta: { naoServe: true } })).toBeUndefined();
  });
});
