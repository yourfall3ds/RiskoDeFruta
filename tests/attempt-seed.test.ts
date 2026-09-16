import {describe,it,expect} from 'vitest';
import {seedPolicy,seedPinned,retrySeed,LEGACY_DEFAULT_SEED} from '../src/run/AttemptSeed';

/**
 * A queixa que estes testes travam: "toda partida nasce na mesma ilha com o cálice no mesmo lugar".
 * A causa era a semente da URL — `?seed=mutant-farm-m0` sobrevivia a cada abertura e a cada derrota,
 * então o sorteio de ilhas, que é determinístico pela semente, devolvia sempre o mesmo plano.
 */

/** Sorteio falso e previsível, para o teste medir "sorteou" sem depender de `crypto`. */
function counter(){let n=0;return ()=>`nova-${++n}`;}

describe('semente do arranque',()=>{
  it('sorteia semente nova no arranque comum mesmo com a semente antiga na URL',()=>{
    const policy=seedPolicy('https://jogo/?seed=mutant-farm-m0',counter());
    expect(policy.seed).toBe('nova-1');
    expect(policy.pinned).toBe(false);
    expect(policy.reason).toBe('fresh');
  });

  it('sorteia semente nova quando a URL não pede nada',()=>{
    expect(seedPolicy('https://jogo/',counter()).seed).toBe('nova-1');
  });

  it('duas aberturas seguidas não repetem a expedição',()=>{
    const fresh=counter();
    const first=seedPolicy('https://jogo/?seed=mutant-farm-m0',fresh);
    const second=seedPolicy(`https://jogo/?seed=${first.seed}`,fresh);
    expect(second.seed).not.toBe(first.seed);
  });

  it('respeita a semente exata na repetição de QA (`replay=1`)',()=>{
    const policy=seedPolicy('https://jogo/?replay=1&seed=mutant-farm-m0',counter());
    expect(policy.seed).toBe('mutant-farm-m0');
    expect(policy.pinned).toBe(true);
    expect(policy.reason).toBe('replay');
  });

  it('prende uma semente nova quando `replay=1` vem sem semente, para a sessão repetir igual',()=>{
    const policy=seedPolicy('https://jogo/?replay=1',counter());
    expect(policy.seed).toBe('nova-1');
    expect(policy.pinned).toBe(true);
  });

  it('mantém o contrato de semente do cooperativo: a sala não é sorteada por cliente',()=>{
    // Dois clientes abrindo o MESMO link têm de cair na mesma sala e no mesmo plano de ilhas.
    const link='https://jogo/?online=1&seed=sala-dos-amigos';
    expect(seedPolicy(link,counter()).seed).toBe('sala-dos-amigos');
    expect(seedPolicy(link,counter()).seed).toBe('sala-dos-amigos');
    expect(seedPolicy(link,counter()).pinned).toBe(true);
    // Sem `seed=`, o cooperativo cai na sala padrão de sempre em vez de sortear uma por cliente.
    expect(seedPolicy('https://jogo/?online=1',counter()).seed).toBe(LEGACY_DEFAULT_SEED);
  });

  it('uma URL inválida não derruba o arranque',()=>{
    expect(seedPolicy('não é url',counter()).seed).toBe('nova-1');
  });
});

describe('semente da repetição depois da derrota',()=>{
  it('sorteia expedição nova quando a semente não é contrato',()=>{
    // Um único gerador para arranque e repetição, senão dois contadores distintos colidiriam
    // em `nova-1` e o teste passaria/falharia por artefato do dublê.
    const fresh=counter(),policy=seedPolicy('https://jogo/?seed=mutant-farm-m0',fresh);
    expect(policy.seed).toBe('nova-1');
    expect(retrySeed(policy,fresh)).toBe('nova-2');
    expect(retrySeed(policy,fresh)).not.toBe(policy.seed);
  });

  it('repete a MESMA semente quando `replay=1` ou `online=1` a prenderam',()=>{
    for(const href of ['https://jogo/?replay=1&seed=fixa','https://jogo/?online=1&seed=fixa']){
      const policy=seedPolicy(href,counter());
      expect(retrySeed(policy,counter())).toBe('fixa');
    }
  });

  it('repetir várias vezes seguidas dá uma expedição diferente a cada vez',()=>{
    const policy=seedPolicy('https://jogo/',counter()),fresh=counter();
    const seeds=[retrySeed(policy,fresh),retrySeed(policy,fresh),retrySeed(policy,fresh)];
    expect(new Set(seeds).size).toBe(3);
  });
});

describe('quem está preso à semente da URL',()=>{
  it('só a repetição de QA e o cooperativo',()=>{
    expect(seedPinned('https://jogo/?replay=1&seed=x')).toBe(true);
    expect(seedPinned('https://jogo/?online=1')).toBe(true);
    expect(seedPinned('https://jogo/?seed=mutant-farm-m0')).toBe(false);
    expect(seedPinned('https://jogo/')).toBe(false);
    expect(seedPinned('não é url')).toBe(false);
  });
});
