import { describe, it, expect } from 'vitest';
import { LOCAL_SERVER_URL, normalizeServerUrl, resolveServerUrl, serverUrlFor } from '../src/net/ServerAddress';

/**
 * ONDE O CLIENTE PROCURA O SERVIDOR — as três camadas, afirmadas.
 *
 * ## Por que este arquivo passou a existir
 *
 * A resolução de endereço decide se o co-op funciona entre MÁQUINAS, e não tinha um único caso. A
 * camada que importa é a terceira: quem abre `http://192.168.15.42:5173` na LAN do anfitrião precisa
 * falar com `192.168.15.42:2567`. Mandá-lo ao `127.0.0.1` da própria máquina é o defeito clássico
 * daqui — o convidado fala consigo mesmo, não acha sala nenhuma, e a tela diz apenas que não
 * conseguiu entrar.
 *
 * Tudo aqui é texto para texto: sem servidor, sem build e sem navegador.
 */

describe('as três camadas, em ordem', () => {
  const lan = 'http://192.168.15.42:5173/?debug=1';

  it('1ª: o `?server=` explícito vence build e página', () => {
    expect(serverUrlFor('http://192.168.15.42:5173/?server=ws://10.0.0.9:2567', 'wss://compartilhado.exemplo'))
      .toBe('ws://10.0.0.9:2567');
  });

  /**
   * O endereço do build mantém a porta do PRÓPRIO esquema quando vem escrito com `wss://` — é a
   * mesma regra do túnel, algumas linhas abaixo. Sem esquema, aí sim ele ganha a porta do co-op.
   */
  it('2ª: sem `?server=`, o servidor do build vence a página', () => {
    expect(serverUrlFor(lan, 'wss://compartilhado.exemplo')).toBe('wss://compartilhado.exemplo');
    expect(serverUrlFor(lan, 'compartilhado.exemplo')).toBe('ws://compartilhado.exemplo:2567');
  });

  /**
   * O CASO DA LAN. É este que faz o jogo funcionar entre duas máquinas: o host vem da PÁGINA, e é
   * por isso que abrir o endereço do anfitrião no outro computador basta — sem digitar servidor.
   */
  it('3ª: sem as duas, o servidor é o host DE ONDE A PÁGINA VEIO', () => {
    expect(serverUrlFor(lan, '')).toBe('ws://192.168.15.42:2567');
  });

  it('a página local continua apontando para a máquina local', () => {
    expect(serverUrlFor('http://localhost:5173/', '')).toBe('ws://localhost:2567');
  });

  /**
   * `file://` e href ilegível não têm host: aí a máquina local é o único palpite honesto, e é a
   * queda final — não um endereço inventado.
   */
  it('sem host legível, cai no endereço local', () => {
    expect(serverUrlFor('file:///C:/jogo/index.html', '')).toBe(LOCAL_SERVER_URL);
    expect(serverUrlFor('nem-url', '')).toBe(LOCAL_SERVER_URL);
  });
});

describe('o esquema acompanha o da página', () => {
  /**
   * Uma página em `https:` NÃO pode abrir `ws:` — o navegador bloqueia conteúdo misto. Descobrir
   * isso depois de publicar é caro, então a regra é afirmada aqui.
   */
  it('página https pede wss, não ws', () => {
    expect(serverUrlFor('https://jogo.exemplo/', '')).toBe('wss://jogo.exemplo:2567');
    expect(normalizeServerUrl('servidor.exemplo', 'https:')).toBe('wss://servidor.exemplo:2567');
  });

  it('página http pede ws', () => {
    expect(normalizeServerUrl('servidor.exemplo', 'http:')).toBe('ws://servidor.exemplo:2567');
  });

  it('um esquema já escrito é respeitado como está', () => {
    expect(normalizeServerUrl('wss://tunel.trycloudflare.com', 'http:')).toBe('wss://tunel.trycloudflare.com');
    expect(normalizeServerUrl('https://tunel.exemplo', 'http:')).toBe('wss://tunel.exemplo');
    expect(normalizeServerUrl('http://caseiro.local:9000', 'https:')).toBe('ws://caseiro.local:9000');
  });

  /**
   * O túnel fala na 443 do próprio esquema: acrescentar `:2567` a ele mandaria o jogador para uma
   * porta que o túnel não serve.
   */
  it('endereço sem porta com esquema escrito NÃO ganha porta', () => {
    expect(normalizeServerUrl('wss://algo.trycloudflare.com')).toBe('wss://algo.trycloudflare.com');
  });

  it('porta escrita à mão é respeitada', () => {
    expect(normalizeServerUrl('192.168.15.42:9999', 'http:')).toBe('ws://192.168.15.42:9999');
  });

  it('texto vazio não é endereço', () => {
    expect(normalizeServerUrl('')).toBe('');
    expect(normalizeServerUrl('   ')).toBe('');
  });

  it('barra sobrando no fim não muda o destino', () => {
    expect(normalizeServerUrl('ws://192.168.15.42:2567/')).toBe('ws://192.168.15.42:2567');
  });
});

describe('a resolução crua, sem ambiente', () => {
  it('respeita a porta pedida em todas as camadas', () => {
    expect(resolveServerUrl({pageHref: 'http://192.168.15.42:5173/', port: 7777})).toBe('ws://192.168.15.42:7777');
    expect(resolveServerUrl({configured: 'servidor.exemplo', pageHref: 'http://x/', port: 7777})).toBe('ws://servidor.exemplo:7777');
  });

  it('sem fonte nenhuma, o endereço local', () => {
    expect(resolveServerUrl({})).toBe(LOCAL_SERVER_URL);
  });
});
