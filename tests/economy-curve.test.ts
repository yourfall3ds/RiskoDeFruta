import {describe, it, expect} from 'vitest';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
import {RunProgression} from '../src/run/RunProgression';
import {ENEMIES, killBounty, type EnemyKind} from '../src/run/MonsterDirector';
import {CHEST_PRICE_GROWTH, CHEST_PRICE_CAP, chestPrice} from '../src/run/RunInteractables';

/**
 * Curvas da economia.
 *
 * Problema medido: com pagamento fixo por abate (`8 + estágio×2`) e preço de baú fixo dentro do
 * estágio, a estratégia ótima era correr o arquipélago abrindo TODOS os baús — nenhum deles era uma
 * escolha, e uma partida chegava a 1 535 créditos sem farmar. As duas alavancas mexidas aqui:
 *
 * 1. pagamento por ESPÉCIE (`killBounty`), ancorado no `cost` que o diretor já usa;
 * 2. preço PROGRESSIVO do baú (`chestPrice`), que sobe a cada compra da fase.
 *
 * O que estes testes travam são as propriedades, e os números de referência ficam no relatório.
 */

/** Tabela ANTERIOR, para medir a diferença em vez de afirmá-la. */
const previousCredits = (stage: number): number => 8 + stage * 2;
const previousChest = (base: number, stage: number): number => Math.round(base * (1 + (stage - 1) * .3));

describe('pagamento por abate', () => {
  it('segue o custo de catálogo: praga barata paga menos, praga cara paga mais', () => {
    const kinds: EnemyKind[] = ['eggplant', 'carrot', 'corn', 'tomato', 'watermelon'];
    const paid = kinds.map(kind => killBounty(kind, 1).credits);
    // Ordenado pelo `cost` do catálogo, o pagamento nunca desce.
    const byCost = [...kinds].sort((a, b) => ENEMIES[a].cost - ENEMIES[b].cost);
    let previous = 0;
    for (const kind of byCost) {
      const value = killBounty(kind, 1).credits;
      expect(value, kind).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    // A berinjela é a praga que a abertura inteira usa: ela passa a pagar MENOS que os 10 antigos.
    expect(killBounty('eggplant', 1).credits).toBeLessThan(previousCredits(1));
    // A melancia custa quatro vezes mais ao diretor e tem 240 de vida: passa a pagar MAIS.
    expect(killBounty('watermelon', 1).credits).toBeGreaterThan(previousCredits(1));
    expect(paid.every(v => v > 0)).toBe(true);
  });

  it('cresce com o estágio e nunca produz NaN', () => {
    for (const kind of Object.keys(ENEMIES) as EnemyKind[]) {
      for (let stage = 1; stage <= 8; stage++) {
        const here = killBounty(kind, stage), next = killBounty(kind, stage + 1);
        expect(Number.isFinite(here.credits) && Number.isFinite(here.xp), kind).toBe(true);
        expect(next.credits).toBeGreaterThanOrEqual(here.credits);
        expect(next.xp).toBeGreaterThanOrEqual(here.xp);
      }
    }
    expect(killBounty('eggplant', Number.NaN).credits).toBe(killBounty('eggplant', 1).credits);
    expect(killBounty('eggplant', 0).credits).toBe(killBounty('eggplant', 1).credits);
  });

  it('o XP não é punido junto com os créditos: nível continua andando', () => {
    for (const kind of Object.keys(ENEMIES) as EnemyKind[]) {
      expect(killBounty(kind, 1).xp, kind).toBeGreaterThanOrEqual(killBounty(kind, 1).credits);
    }
  });

  it('`reward` sem recompensa explícita continua pagando exatamente a tabela antiga', () => {
    const run = new RunProgression(new EventBus<GameEvents>());
    run.reward();
    expect(run.credits).toBe(previousCredits(1));
    const elite = new RunProgression(new EventBus<GameEvents>());
    elite.reward(true);
    expect(elite.credits).toBe(50);
  });

  it('o ouro do afixo continua multiplicando a recompensa da espécie', () => {
    const run = new RunProgression(new EventBus<GameEvents>());
    run.reward(false, 4, killBounty('corn', 1));
    expect(run.credits).toBe(killBounty('corn', 1).credits * 4);
  });
});

describe('preço progressivo dos baús', () => {
  it('o primeiro baú continua ao alcance de poucos encontros', () => {
    const first = chestPrice('supply', 1, 0);
    expect(first).toBe(previousChest(30, 1));
    // A abertura só solta berinjela: quantos abates para a primeira caixa?
    // Cinco berinjelas — o primeiro minuto, com o teto de abertura em 3 hostis vivos.
    const kills = Math.ceil(first / killBounty('eggplant', 1).credits);
    expect(kills).toBe(5);
  });

  it('cada compra encarece a seguinte, de forma monótona e limitada', () => {
    let previous = 0;
    for (let opened = 0; opened <= CHEST_PRICE_CAP + 4; opened++) {
      const price = chestPrice('supply', 1, opened);
      expect(price).toBeGreaterThanOrEqual(previous);
      previous = price;
    }
    // Acima do teto o preço estabiliza em vez de virar um número inalcançável.
    expect(chestPrice('supply', 1, CHEST_PRICE_CAP)).toBe(chestPrice('supply', 1, CHEST_PRICE_CAP + 40));
    expect(chestPrice('supply', 1, 1) / chestPrice('supply', 1, 0)).toBeCloseTo(CHEST_PRICE_GROWTH, 1);
  });

  it('abrir dez baús deixou de ser quase de graça', () => {
    let now = 0, before = 0;
    for (let i = 0; i < 10; i++) {now += chestPrice('supply', 1, i); before += previousChest(30, 1);}
    expect(before).toBe(300);
    // O mesmo trajeto de dez caixas passa a cobrar bem mais que o dobro.
    expect(now).toBeGreaterThan(before * 2.5);
    // …e em abates de berinjela isso é farm de verdade, não um passeio.
    expect(Math.ceil(now / killBounty('eggplant', 1).credits)).toBeGreaterThan(100);
  });

  it('o estágio continua encarecendo por cima da progressão da fase', () => {
    for (let opened = 0; opened <= 6; opened++) {
      expect(chestPrice('supply', 2, opened)).toBeGreaterThan(chestPrice('supply', 1, opened));
    }
  });

  it('só o altar acumula a escalada de REUSO; baú comum abre uma vez e pronto', () => {
    expect(chestPrice('altar', 1, 0, 1)).toBeGreaterThan(chestPrice('altar', 1, 0, 0));
    expect(chestPrice('supply', 1, 0, 1)).toBe(chestPrice('supply', 1, 0, 0));
    expect(chestPrice('shop', 1, 0, 3)).toBe(chestPrice('shop', 1, 0, 0));
  });

  it('entradas absurdas caem no piso em vez de produzir NaN', () => {
    expect(chestPrice('supply', Number.NaN, Number.NaN)).toBe(chestPrice('supply', 1, 0));
    expect(chestPrice('supply', -5, -5)).toBe(chestPrice('supply', 1, 0));
  });
});

describe('progressão de uma corrida', () => {
  /** Créditos acumulados matando `kills` pragas da abertura, e quantos baús isso paga. */
  function chestsAffordable(kills: number, stage = 1): number {
    const run = new RunProgression(new EventBus<GameEvents>());
    run.stage = stage;
    for (let i = 0; i < kills; i++) run.reward(false, 1, killBounty('eggplant', stage));
    let opened = 0;
    for (;;) {
      const price = chestPrice('supply', stage, opened);
      if (run.credits < price) break;
      run.credits -= price; opened++;
    }
    return opened;
  }

  it('o começo é acessível e o meio da corrida vira escolha', () => {
    expect(chestsAffordable(4)).toBe(0);        // quatro abates ainda não pagam
    expect(chestsAffordable(5)).toBe(1);        // poucos encontros, primeiro baú
    // Vinte abates já não são mais "abra tudo": pagam um punhado, não uma dúzia.
    const twenty = chestsAffordable(20);
    expect(twenty).toBeGreaterThanOrEqual(3);
    expect(twenty).toBeLessThanOrEqual(5);
    // E a curva desacelera: quintuplicar o farm não quintuplica os baús.
    expect(chestsAffordable(100)).toBeLessThan(twenty * 4);
  });

  it('a mesma quantidade de abates comprava muito mais baús antes', () => {
    const run = new RunProgression(new EventBus<GameEvents>());
    for (let i = 0; i < 20; i++) run.reward();                 // tabela antiga: 10 por abate
    let before = 0, credits = run.credits;
    while (credits >= previousChest(30, 1)) {credits -= previousChest(30, 1); before++;}
    expect(before).toBeGreaterThan(chestsAffordable(20));
  });
});
