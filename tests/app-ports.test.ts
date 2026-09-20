import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { escolherPorta, portaEfemera, portaLivre, PORTA_PREFERIDA } from '../electron/ports';
import { enderecoAnunciado, urlDoCliente } from '../electron/address';

function ocupar(porta: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen({ port: porta, host: '0.0.0.0', exclusive: true }, () => resolve(s));
  });
}
const fechar = (s: Server): Promise<void> => new Promise(r => s.close(() => r()));

describe('escolha de porta do servidor embutido', () => {
  it('uma porta efêmera é de verdade livre', async () => {
    const porta = await portaEfemera('127.0.0.1');
    expect(porta).toBeGreaterThan(0);
    expect(await portaLivre(porta, '127.0.0.1')).toBe(true);
  });

  it('uma porta ocupada é reconhecida como ocupada', async () => {
    const porta = await portaEfemera('0.0.0.0');
    const dono = await ocupar(porta);
    try {
      expect(await portaLivre(porta, '0.0.0.0')).toBe(false);
    } finally {
      await fechar(dono);
    }
  });

  it('prefere a primeira porta livre da lista', async () => {
    const livre = await portaEfemera('0.0.0.0');
    const ocupada = await portaEfemera('0.0.0.0');
    const dono = await ocupar(ocupada);
    try {
      expect(await escolherPorta([ocupada, livre], '0.0.0.0')).toBe(livre);
    } finally {
      await fechar(dono);
    }
  });

  /**
   * ESTE é o teste que protege a promessa "abriu, jogou": duas cópias do jogo na mesma casa — ou
   * na mesma máquina — não podem brigar pela 2567. Se `escolherPorta` devolvesse a porta ocupada,
   * o segundo jogador veria o jogo fechar sozinho na abertura.
   */
  it('com todas as preferidas ocupadas, ainda devolve uma porta utilizável', async () => {
    const a = await portaEfemera('0.0.0.0');
    const b = await portaEfemera('0.0.0.0');
    const donos = [await ocupar(a), await ocupar(b)];
    try {
      const escolhida = await escolherPorta([a, b], '0.0.0.0');
      expect(escolhida).not.toBe(a);
      expect(escolhida).not.toBe(b);
      expect(await portaLivre(escolhida, '0.0.0.0')).toBe(true);
    } finally {
      await Promise.all(donos.map(fechar));
    }
  });

  it('a lista padrão começa na porta do desenvolvimento', () => {
    expect(PORTA_PREFERIDA).toBe(2567);
  });
});

describe('endereço do servidor embutido', () => {
  it('a janela carrega o cliente local apontando para o servidor embutido', () => {
    const url = urlDoCliente({ portaHttp: 41234, portaJogo: 2567 });
    expect(url.startsWith('http://127.0.0.1:41234/index.html')).toBe(true);
    expect(new URL(url).searchParams.get('server')).toBe('127.0.0.1:2567');
  });

  it('em desenvolvimento usa a origem do Vite, sem servidor estático', () => {
    const url = urlDoCliente({ portaHttp: 0, portaJogo: 2570, origemDev: 'http://localhost:5173/' });
    expect(url.startsWith('http://localhost:5173/index.html')).toBe(true);
    expect(new URL(url).searchParams.get('server')).toBe('127.0.0.1:2570');
  });

  /**
   * O endereço vai SEM esquema de propósito: `normalizeServerUrl` escolhe `ws:`/`wss:` conforme o
   * protocolo da página. Um `ws://` cravado aqui funcionaria hoje e quebraria numa página servida
   * por `https`.
   */
  it('o endereço embutido não carrega esquema cravado', () => {
    const servidor = new URL(urlDoCliente({ portaHttp: 1, portaJogo: 2 })).searchParams.get('server') ?? '';
    expect(servidor).not.toMatch(/^wss?:/);
  });

  it('o endereço anunciado na LAN usa o IP da rede, nunca o localhost', () => {
    expect(enderecoAnunciado('192.168.0.7', 2567)).toBe('192.168.0.7:2567');
  });
});
