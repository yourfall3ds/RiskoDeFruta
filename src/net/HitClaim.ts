/**
 * O PEDIDO DE ACERTO — o elo entre a arma que o jogador VÊ e o dano que o servidor APLICA.
 *
 * Antes, online, a arma local de cada classe acertava a malha do inimigo e `EnemySwarm.hit`
 * descartava o acerto (autoridade do servidor); o servidor, por sua vez, refazia um tiro de PISTOLA
 * do peito do boneco, para qualquer classe. O que o jogador via acertar não acertava, a PRISM e a
 * SMG batiam como pistola e nenhuma habilidade causava dano.
 *
 * Agora quem atira DIZ o que acertou — inimigo, dano base, etiquetas, ponto — e o servidor DECIDE:
 * valida (vivo, perto do ponto, alcance, teto de dano por segundo), calcula o dano final com os
 * itens e o crítico DELE e aplica pelo caminho de sempre. Morte, XP, crédito e drop seguem sendo do
 * servidor, e a morte segue idempotente (`applyDamage` recusa corpo morto e evento repetido).
 *
 * Este arquivo é puro: formato, saneamento e as regras de plausibilidade, testáveis sem rede.
 */
import type { Vec3 } from '../core/contracts';

export interface HitClaim {
  /** Id do inimigo NO SERVIDOR (`EnemyState.id`). */
  enemy: number;
  /** Dano BASE da arma/habilidade, antes de itens e crítico — o servidor multiplica. */
  base: number;
  tags: string[];
  source: string;
  /** Único por emissão e vítima: é a chave de idempotência do servidor. */
  attack: string;
  /** O cliente acertou a zona fraca (cabeça/asa) pela geometria que ele desenhou. */
  weak: boolean;
  /** Profundidade de proc (0 = golpe direto). Proc em cadeia não rola crítico. */
  proc: number;
  point: Vec3;
  force: Vec3;
  forceMagnitude: number;
}

/** Nome da mensagem cliente → servidor. */
export const HIT_MESSAGE = 'hit';

/**
 * Distância máxima entre o ponto que o cliente diz ter acertado e o corpo no servidor. O cliente
 * desenha a horda meio patch no passado (interpolação); a 12 m/s de investida isso é ~1 m, mais o
 * raio do corpo e a folga de rede.
 */
export const HIT_POSITION_SLACK = 4.5;
/** Alcance máximo de qualquer arma (a lança de íons é a mais longa). */
export const HIT_MAX_RANGE = 160;
/** Dano BASE por segundo que um jogador pode reivindicar (antes de itens). Folga larga: é LAN. */
export const HIT_BASE_BUDGET_PER_SECOND = 2600;
/** Maior dano base de um único golpe aceito (habilidade III inclusa). */
export const HIT_MAX_SINGLE = 900;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown): Vec3 | undefined => {
  const o = v as Partial<Vec3> | undefined;
  return o && finite(o.x) && finite(o.y) && finite(o.z) ? { x: o.x, y: o.y, z: o.z } : undefined;
};

/** Saneia o que veio da rede. `undefined` = pedido malformado, descartado sem resposta. */
export function sanitizeHitClaim(raw: unknown): HitClaim | undefined {
  const r = raw as Record<string, unknown> | undefined;
  if (!r) return undefined;
  const point = vec(r['point']), force = vec(r['force']) ?? { x: 0, y: 0, z: 1 };
  if (!finite(r['enemy']) || !finite(r['base']) || !point) return undefined;
  const base = r['base'];
  if (base <= 0 || base > HIT_MAX_SINGLE) return undefined;
  const tags = Array.isArray(r['tags']) ? (r['tags'] as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 8) : [];
  return {
    enemy: r['enemy'], base, tags,
    source: typeof r['source'] === 'string' ? r['source'].slice(0, 48) : 'weapon',
    attack: typeof r['attack'] === 'string' ? r['attack'].slice(0, 64) : '',
    weak: r['weak'] === true,
    proc: finite(r['proc']) ? Math.max(0, Math.min(3, Math.floor(r['proc']))) : 0,
    point, force,
    forceMagnitude: finite(r['forceMagnitude']) ? Math.max(0, Math.min(40, r['forceMagnitude'])) : 0,
  };
}

/** Por que um pedido foi recusado — ou `undefined` quando ele é plausível. */
export function implausibleHit(claim: HitClaim, shooter: Vec3, enemyAt: Vec3 | undefined, enemyAlive: boolean): string | undefined {
  if (!enemyAt || !enemyAlive) return 'alvo';
  const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  if (d(claim.point, enemyAt) > HIT_POSITION_SLACK) return 'ponto';
  if (d(shooter, claim.point) > HIT_MAX_RANGE) return 'alcance';
  return undefined;
}

/**
 * Orçamento de dano base por jogador, em janela deslizante de 1 s. Protege o servidor de um
 * cliente em laço (ou de um bug que dispare mil pedidos) sem nunca atrapalhar jogo normal.
 */
export class HitBudget {
  private spent = 0;
  private clock = 0;
  constructor(private readonly perSecond = HIT_BASE_BUDGET_PER_SECOND) {}
  update(dt: number): void {
    this.clock += dt;
    if (this.clock >= 1) { this.clock = 0; this.spent = 0; }
  }
  take(base: number, multiplier = 1): boolean {
    if (this.spent + base > this.perSecond * Math.max(1, multiplier)) return false;
    this.spent += base;
    return true;
  }
}

/** Aviso de disparo, repassado aos OUTROS para desenharem rastro e tocarem o som da arma certa. */
export interface ShotFx {
  weapon: 'pistols' | 'prism' | 'smg';
  from: Vec3;
  to: Vec3;
  /** Forma da PRISM (0 assalto, 1 sniper, 2 granada) ou lado da pistola. */
  mode: number;
}
export const SHOT_MESSAGE = 'shot';
/** O que o servidor repassa: o aviso + quem atirou. */
export interface RelayedShot extends ShotFx { entityId: number }

export function sanitizeShot(raw: unknown): ShotFx | undefined {
  const r = raw as Record<string, unknown> | undefined;
  const from = vec(r?.['from']), to = vec(r?.['to']);
  const weapon = r?.['weapon'];
  if (!from || !to || (weapon !== 'pistols' && weapon !== 'prism' && weapon !== 'smg')) return undefined;
  const mode = finite(r?.['mode']) ? Math.max(0, Math.min(2, Math.floor(r!['mode'] as number))) : 0;
  return { weapon, from, to, mode };
}
