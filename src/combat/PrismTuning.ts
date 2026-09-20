/**
 * Números da PRISM — a arma transformável autorada em `docs/prism-triform.md`.
 *
 * Ficam num arquivo só, longe da mecânica, pelo mesmo motivo que `PISTOL_TUNING` existe: balancear
 * não pode exigir ler o backend. Cada modo é uma ARMA, com cadência, dano, alcance e carregador
 * próprios — e é por isso que a munição é contada por modo (ver `PrismArsenal`).
 */

/** Assault (0) → Sniper (1) → Lança-granadas (2) → Assault. A mesma ordem dos clipes do GLB. */
export type PrismMode = 0 | 1 | 2;

export interface PrismModeTuning {
  /** Id estável; entra em `sourceId` do dano e nos testes. */
  readonly id: string;
  /** Nome legível, para o HUD. */
  readonly name: string;
  /** Disparos por segundo, antes de `attackSpeed`. */
  readonly rate: number;
  /** Dano BASE por acerto. O receptor aplica `stats.damage`, crítico e ponto fraco. */
  readonly damage: number;
  /** Abertura do tiro, em graus. Zero no sniper: precisão é o contrato dele. */
  readonly spreadDegrees: number;
  /** Alcance útil do raio, em metros. */
  readonly range: number;
  /** `true` atravessa e dana TODOS os corpos até a primeira parede (sniper). */
  readonly pierce: boolean;
  /** Balas por carregador. */
  readonly capacity: number;
  /** Segundos de recarga — casados com a duração dos clipes `*_Reload` do GLB. */
  readonly reloadSeconds: number;
  /** `true` mantém o gatilho pressionado disparando (assault). */
  readonly automatic: boolean;
  /** Tranco da câmera por disparo. */
  readonly impulse: number;
  /** Empurrão aplicado ao corpo atingido. */
  readonly force: number;
}

/**
 * As três formas.
 *
 * O assault é o substituto direto da pistola (cadência alta, dano baixo); o sniper troca cadência
 * por dano e perfuração; a granada é a única que não é hitscan — ela tem projétil, arco e área.
 * Os tempos de recarga saem da tabela de clipes de `docs/prism-triform.md` (2,6 / 3,0 / 3,2 s),
 * então a animação da arma termina junto com o carregador cheio em vez de cortar no meio.
 */
export const PRISM_MODES: readonly [PrismModeTuning, PrismModeTuning, PrismModeTuning] = [
  {id:'prism_assault',name:'PRISM · ASSALTO',rate:9,damage:7,spreadDegrees:1.7,range:180,pierce:false,capacity:36,reloadSeconds:2.6,automatic:true,impulse:.007,force:2},
  {id:'prism_sniper',name:'PRISM · LANÇA DE ÍONS',rate:.65,damage:140,spreadDegrees:0,range:320,pierce:true,capacity:6,reloadSeconds:3,automatic:false,impulse:.05,force:9},
  {id:'prism_grenade',name:'PRISM · LANÇA-GRANADAS',rate:.6,damage:20,spreadDegrees:0,range:140,pierce:false,capacity:5,reloadSeconds:3.2,automatic:false,impulse:.035,force:6},
] as const;

/**
 * Balística e explosão da granada.
 *
 * `maxLive` é teto de desempenho, não de design: cinco no carregador e 0,75 disparo por segundo
 * nunca chegam perto dele, mas um `live` sem teto é um vazamento esperando acontecer numa horda.
 * `blastRadius` é deliberadamente curto — o pedido é área LIMITADA, não limpeza de tela.
 */
export const PRISM_GRENADE = {
  /** Velocidade inicial da cápsula, em m/s. */
  speed: 34,
  /** Queda pela vertical LOCAL, em m/s². Um pouco acima da do jogador: arco mais curto e legível. */
  gravity: 26,
  /** Estopim: explode no ar se não encostar em nada. */
  fuseSeconds: 3.2,
  /** Raio da cápsula para o teste de contato, em metros. */
  probeRadius: .16,
  /** Raio da explosão, em metros. */
  blastRadius: 4.6,
  /** Dano no CENTRO da explosão. O impacto direto soma o dano do modo por cima. */
  blastDamage: 55,
  /** Fração do dano na borda do raio; entre borda e centro a queda é linear. */
  edgeFactor: .3,
  /** Dano entregue ao cenário no ponto da explosão. */
  sceneryDamage: 90,
  /** Empurrão da onda de choque. */
  blastForce: 7,
  /** Teto de cápsulas vivas ao mesmo tempo. A mais antiga detona quando o teto estoura. */
  maxLive: 8,
} as const;
