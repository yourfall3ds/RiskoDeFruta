import { describe, it, expect } from 'vitest';
import { RNG_STREAMS, RandomStream, RunRNG, streamSeed, type RNGStream } from '../src/core/RunRNG';
import { FarmSimulation } from '../server/FarmSimulation';
import { TEST_MAP, testMapCollision } from '../src/world/TestMap';
import { FARM_MAP } from '../src/world/FarmMap';

/**
 * CADA DOMÍNIO DE RNG ANDA SOZINHO — e a lotação da sala não move a horda.
 *
 * ## O defeito que este arquivo fecha
 *
 * Existia um fluxo chamado `spawn`, e ele atendia três decisões: onde o jogador nasce, onde cada
 * corpo da horda nasce e qual ilha do planeta é a casa. Cada `addPlayer` puxava dois números dele.
 * Resultado:
 *
 *     mesma semente + 1 jogador   = horda A
 *     mesma semente + 2 jogadores = horda B
 *     mesma semente + 4 jogadores = horda C
 *
 * A propriedade que permite reproduzir um defeito a partir da semente simplesmente não valia no
 * co-op. Ela só apareceu porque o nascimento do jogador virou determinístico, parou de puxar
 * números, e a distribuição da horda mudou sem ninguém ter tocado nela.
 *
 * ## O que NÃO se fez
 *
 * Não se queimaram números falsos para manter a sequência antiga. Isso preservaria o comportamento
 * e deixaria a armadilha armada: o próximo sorteio acrescentado em qualquer lugar do nascimento
 * voltaria a mover a horda. O conserto foi de FRONTEIRA — cada decisão com o seu domínio, e o
 * nascimento do jogador sem domínio nenhum.
 *
 * ## Por que estes casos e não uma captura de números
 *
 * Nenhum caso aqui afirma "o décimo sorteio vale 0,4172". Todos afirmam uma IGUALDADE entre duas
 * corridas que deveriam ser a mesma sob o ponto de vista de um domínio. Uma captura de números
 * quebraria em toda mudança legítima; uma igualdade só quebra quando um domínio passa a depender de
 * outro — que é exatamente o defeito.
 */

const SEMENTE = 'rng-dominios';

/** Os próximos `n` valores de um domínio, sem mexer em nenhum outro. */
function proximos(rng: RunRNG, dominio: RNGStream, n = 20): number[] {
  const s = rng.stream(dominio);
  return Array.from({ length: n }, () => s.next());
}

/** Uma simulação no mapa de teste: colisão de seis números, sobe na hora. */
function simulacao(semente = SEMENTE, mapa = TEST_MAP): FarmSimulation {
  return new FarmSimulation(semente, testMapCollision(), mapa);
}

/**
 * Conta quantas vezes cada domínio foi sorteado a partir de agora.
 *
 * Envolve `next` na INSTÂNCIA: `range` e `pick` passam por ele, então nada sorteia por fora da
 * contagem.
 */
function contarSorteios(rng: RunRNG): Map<RNGStream, number> {
  const contagem = new Map<RNGStream, number>();
  for (const dominio of RNG_STREAMS) {
    const s = rng.stream(dominio);
    const original = s.next.bind(s);
    contagem.set(dominio, 0);
    s.next = () => { contagem.set(dominio, contagem.get(dominio)! + 1); return original(); };
  }
  return contagem;
}

describe('a lotação da sala não move domínio nenhum', () => {
  /**
   * O CASO QUE PROVA O DEFEITO ANTIGO. Com o fluxo partilhado, os quatro `addPlayer` de B puxavam
   * oito números a mais que o único de A, e as duas hordas saíam diferentes.
   */
  it('1 jogador ou 4 jogadores: os próximos 20 valores da horda são os mesmos', () => {
    const a = simulacao(); a.addPlayer('p1');
    const b = simulacao(); for (const id of ['p1', 'p2', 'p3', 'p4']) b.addPlayer(id);
    expect(proximos(b.rng, 'enemySpawn')).toEqual(proximos(a.rng, 'enemySpawn'));
  });

  /** A mesma pergunta, para todos os domínios de uma vez: nenhum depende de quantos entraram. */
  it.each(RNG_STREAMS.map(d => [d] as const))('o domínio %s ignora quantos jogadores entraram', dominio => {
    const a = simulacao(); a.addPlayer('p1');
    const b = simulacao(); for (const id of ['p1', 'p2', 'p3', 'p4']) b.addPlayer(id);
    expect(proximos(b.rng, dominio)).toEqual(proximos(a.rng, dominio));
  });

  /**
   * NASCER NÃO SORTEIA NADA. Não só "não sorteia da horda": não sorteia de domínio NENHUM. É a
   * forma mais forte de dizer que a posição de largada é dado do mapa, e que ninguém vai
   * reintroduzir um sorteio ali sem este caso reclamar.
   */
  it('entrar quatro jogadores consome ZERO sorteios, em todos os domínios', () => {
    const sim = simulacao();
    const contagem = contarSorteios(sim.rng);
    for (const id of ['p1', 'p2', 'p3', 'p4']) sim.addPlayer(id);
    expect(Object.fromEntries(contagem)).toEqual(Object.fromEntries(RNG_STREAMS.map(d => [d, 0])));
  });

  /**
   * MUDAR ONDE O JOGADOR NASCE não mexe em nada aleatório. A fazenda e o mapa de teste declaram
   * assentos completamente diferentes; a mesma semente tem de dar a mesma horda, o mesmo loot e o
   * mesmo combate nos dois.
   */
  it('trocar a fileira de largada (fazenda × teste) não muda horda, loot nem combate', () => {
    const naFazenda = simulacao(SEMENTE, FARM_MAP), noTeste = simulacao(SEMENTE, TEST_MAP);
    for (const id of ['p1', 'p2']) { naFazenda.addPlayer(id); noTeste.addPlayer(id); }
    for (const dominio of ['enemySpawn', 'director', 'loot', 'combatCrit', 'combatProc', 'combatSpread'] as const) {
      expect(proximos(noTeste.rng, dominio)).toEqual(proximos(naFazenda.rng, dominio));
    }
  });
});

describe('isolamento cruzado entre domínios', () => {
  it('100 sorteios de loot não movem a horda', () => {
    const limpo = new RunRNG(SEMENTE), sujo = new RunRNG(SEMENTE);
    for (let i = 0; i < 100; i++) sujo.stream('loot').next();
    expect(proximos(sujo, 'enemySpawn')).toEqual(proximos(limpo, 'enemySpawn'));
  });

  it('100 sorteios de crítico não movem a horda', () => {
    const limpo = new RunRNG(SEMENTE), sujo = new RunRNG(SEMENTE);
    for (let i = 0; i < 100; i++) sujo.stream('combatCrit').next();
    expect(proximos(sujo, 'enemySpawn')).toEqual(proximos(limpo, 'enemySpawn'));
  });

  it('e o inverso: 100 sorteios da horda não movem o loot', () => {
    const limpo = new RunRNG(SEMENTE), sujo = new RunRNG(SEMENTE);
    for (let i = 0; i < 100; i++) sujo.stream('enemySpawn').next();
    expect(proximos(sujo, 'loot')).toEqual(proximos(limpo, 'loot'));
  });

  /** Todos os pares de uma vez: gastar qualquer domínio não move nenhum outro. */
  it('gastar QUALQUER domínio não move NENHUM outro', () => {
    for (const gasto of RNG_STREAMS) {
      const limpo = new RunRNG(SEMENTE), sujo = new RunRNG(SEMENTE);
      for (let i = 0; i < 50; i++) sujo.stream(gasto).next();
      for (const observado of RNG_STREAMS) {
        if (observado === gasto) continue;
        expect(proximos(sujo, observado, 5), `${gasto} moveu ${observado}`).toEqual(proximos(limpo, observado, 5));
      }
    }
  });
});

describe('a semente de um domínio é do NOME, não da posição no registro', () => {
  /**
   * O caso que pega derivação por ORDEM. Se cada domínio recebesse o `next()` de um gerador-mestre
   * na sequência da lista, só o primeiro bateria com `streamSeed`: todos os outros dependeriam de
   * quantos vieram antes. Batendo para TODOS, a semente de cada um é função de `(corrida, nome)` e
   * de nada mais — e inserir um domínio novo no meio da lista não pode mexer em nenhum.
   */
  it('cada domínio registrado sai exatamente de streamSeed(corrida, nome)', () => {
    const rng = new RunRNG(SEMENTE);
    for (const dominio of RNG_STREAMS) {
      const avulso = new RandomStream(streamSeed(SEMENTE, dominio));
      expect(proximos(rng, dominio, 10), dominio).toEqual(Array.from({ length: 10 }, () => avulso.next()));
    }
  });

  /**
   * Um domínio que NÃO existe no registro — `cosmetic`, aqui — tem semente própria e distinta, e
   * nenhum domínio registrado a compartilha. É o que garante que acrescentá-lo amanhã não colide
   * com o loot de hoje.
   */
  it('um domínio novo teria semente própria, distinta de todas as existentes', () => {
    const nova = streamSeed(SEMENTE, 'cosmetic');
    for (const dominio of RNG_STREAMS) expect(streamSeed(SEMENTE, dominio)).not.toBe(nova);
  });

  it('corridas diferentes dão sementes diferentes ao mesmo domínio', () => {
    expect(streamSeed('corrida-a', 'loot')).not.toBe(streamSeed('corrida-b', 'loot'));
  });
});

describe('o registro recusa o que não conhece', () => {
  /**
   * `stream()` devolvia `this.streams.get(name)!`. Um nome fora do registro chegando por um
   * caminho que o tipo não cobre — o vitest não checa tipo; um script em JavaScript também não —
   * voltava `undefined` calado e só estourava três chamadas adiante. Derrubou dez testes de horda
   * de uma vez, sem nenhum apontar para cá.
   */
  it('nome desconhecido é erro na hora, com o nome na mensagem', () => {
    expect(() => new RunRNG(SEMENTE).stream('spawn' as RNGStream)).toThrow(/spawn/);
  });

  /** O nome ambíguo saiu de vez: cada decisão tem domínio que diz o que ele decide. */
  it('o antigo `spawn` não existe mais, e os domínios que o substituíram existem', () => {
    expect(RNG_STREAMS as readonly string[]).not.toContain('spawn');
    expect(RNG_STREAMS).toContain('enemySpawn');
    expect(RNG_STREAMS).toContain('world');
  });
});
