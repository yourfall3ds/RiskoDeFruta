import { describe, expect, it } from 'vitest';
import { normalize } from 'node:path';
import { resolverCaminho, tipoDoArquivo } from '../electron/static-server';
import { NavegadorDaLan, type PonteLan } from '../src/net/LanBrowser';
import type { RoomBrowserLink, RoomRow } from '../src/net/RoomBrowser';

describe('servidor estático do aplicativo', () => {
  it('serve o índice na raiz', () => {
    expect(resolverCaminho('/app/dist', '/')).toBe(normalize('/app/dist/index.html'));
  });

  /**
   * A travessia CODIFICADA é a que morde de verdade, e por uma ordem que engana.
   *
   * `new URL()` já colapsa `../` sozinho, então `/../../segredo.txt` chega como `/segredo.txt` e
   * nunca sai da raiz. Mas o `%2f` sobrevive a essa normalização — ele só vira `/` no
   * `decodeURIComponent`, que roda DEPOIS. Quem confiasse apenas no `URL` estaria descoberto
   * exatamente contra o caminho que um atacante usaria. É por isso que a comparação com a raiz
   * existe, e é isto que estes casos guardam.
   */
  it.each(['/..%2f..%2fsegredo.txt', '/..%5c..%5csegredo.txt', '/sub%2f..%2f..%2f..%2ffora.txt'])(
    'barra a travessia codificada %s',
    (caminho) => { expect(resolverCaminho('/app/dist', caminho)).toBeUndefined(); },
  );

  /** A travessia literal é inofensiva porque o `URL` já a colapsou — e cai dentro da raiz. */
  it('a travessia literal é colapsada pelo próprio URL, não escapa', () => {
    expect(resolverCaminho('/app/dist', '/../../segredo.txt')).toBe(normalize('/app/dist/segredo.txt'));
  });

  it('não confunde uma pasta irmã de nome parecido com estar dentro', () => {
    expect(resolverCaminho('/app/dist', '/..%2f..%2fdist-secreto/x')).toBeUndefined();
  });

  it('os tipos que o jogo realmente carrega estão cobertos', () => {
    expect(tipoDoArquivo('a.js')).toBe('text/javascript; charset=utf-8');
    expect(tipoDoArquivo('modelo.glb')).toBe('model/gltf-binary');
    expect(tipoDoArquivo('havok.wasm')).toBe('application/wasm');
    expect(tipoDoArquivo('som.ogg')).toBe('audio/ogg');
    expect(tipoDoArquivo('qualquer.xyz')).toBe('application/octet-stream');
  });
});

/** Um navegador de salas de mentira: nenhuma rede, só a lista que o teste mandar. */
class NavegadorFalso implements RoomBrowserLink {
  rooms: RoomRow[] = [];
  error = '';
  descartado = false;
  private readonly ouvintes = new Set<() => void>();
  constructor(readonly url: string) {}
  async connect(): Promise<void> {
    this.rooms = [{ roomId: `sala-de-${this.url}`, code: 'AAA', roomName: 'S', hostName: 'H', players: 1, max: 4, seed: 's', full: false, server: this.url }];
    for (const o of this.ouvintes) o();
  }
  onChange(o: () => void): () => void { this.ouvintes.add(o); return () => { this.ouvintes.delete(o); }; }
  dispose(): void { this.descartado = true; this.ouvintes.clear(); }
}

function ponteFalsa(inicial: { endereco: string; nome: string; id: string }[]): PonteLan & { empurrar(l: { endereco: string; nome: string; id: string }[]): void } {
  let ouvinte: ((l: { endereco: string; nome: string; id: string }[]) => void) | undefined;
  return {
    empacotado: true,
    anfitrioes: async () => inicial,
    aoMudarAnfitrioes: (o) => { ouvinte = o; return () => { ouvinte = undefined; }; },
    empurrar: (l) => ouvinte?.(l),
  };
}

describe('navegador somado da rede local', () => {
  const criados: NavegadorFalso[] = [];
  const criar = (url: string): NavegadorFalso => { const n = new NavegadorFalso(url); criados.push(n); return n; };

  it('sem ponte, é exatamente o servidor local — o caminho do navegador não muda', async () => {
    const nav = new NavegadorDaLan('ws://local:2567', criar, undefined);
    await nav.connect();
    expect(nav.rooms.map(r => r.server)).toEqual(['ws://local:2567']);
    nav.dispose();
  });

  it('soma as salas dos anfitriões descobertos às do servidor local', async () => {
    const nav = new NavegadorDaLan('ws://local:2567', criar, ponteFalsa([{ endereco: '192.168.0.9:2567', nome: 'Amigo', id: 'b' }]));
    await nav.connect();
    await new Promise(r => setTimeout(r, 10));
    expect([...nav.rooms].map(r => r.server).sort()).toEqual(['ws://192.168.0.9:2567', 'ws://local:2567']);
    nav.dispose();
  });

  /** Um amigo que fecha o jogo tem de sair da lista E ter o WebSocket dele desligado. */
  it('o anfitrião que some é desligado, não só escondido', async () => {
    const ponte = ponteFalsa([{ endereco: '192.168.0.9:2567', nome: 'Amigo', id: 'b' }]);
    const nav = new NavegadorDaLan('ws://local:2567', criar, ponte);
    await nav.connect();
    await new Promise(r => setTimeout(r, 10));
    const doAmigo = criados.find(n => n.url === 'ws://192.168.0.9:2567');
    ponte.empurrar([]);
    expect(doAmigo?.descartado).toBe(true);
    expect(nav.rooms.map(r => r.server)).toEqual(['ws://local:2567']);
    nav.dispose();
  });

  /**
   * O erro mostrado é só o do servidor LOCAL: um amigo que fechou o jogo entre o anúncio e a
   * conexão não pode fazer a tela dizer que o servidor caiu enquanto as salas estão ali.
   */
  it('o erro de um anfitrião remoto não vira alarme na tela', async () => {
    const quebrado = (url: string): NavegadorFalso => {
      const n = criar(url);
      if (url !== 'ws://local:2567') n.error = 'sem servidor';
      return n;
    };
    const nav = new NavegadorDaLan('ws://local:2567', quebrado, ponteFalsa([{ endereco: '10.0.0.5:2567', nome: 'Foi', id: 'c' }]));
    await nav.connect();
    await new Promise(r => setTimeout(r, 10));
    expect(nav.error).toBe('');
    nav.dispose();
  });

  it('descartar desliga todos os filhos', async () => {
    const nav = new NavegadorDaLan('ws://local:2567', criar, ponteFalsa([{ endereco: '10.0.0.5:2567', nome: 'X', id: 'd' }]));
    await nav.connect();
    await new Promise(r => setTimeout(r, 10));
    const filhos = criados.filter(n => n.url === 'ws://local:2567' || n.url === 'ws://10.0.0.5:2567');
    nav.dispose();
    expect(filhos.every(f => f.descartado)).toBe(true);
  });
});
