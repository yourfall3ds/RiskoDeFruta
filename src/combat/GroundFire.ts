import type {Vec3} from '../core/contracts';

/**
 * Chão em chamas — área negada que sobrevive à explosão que a criou.
 *
 * Existe porque `ElementalEffects` é RAJADA, não poça: 1,7 s de três billboards subindo, que somem
 * antes de o jogador decidir por onde andar. O pedido ("deve queimar o solo", e "melhorar o fogo do
 * tomate") é outra coisa — uma marca que fica, cobra pedágio de quem pisar e depois apaga.
 *
 * Um único sistema serve os dois lados por decisão de desenho: a ogiva do míssil, o estilhaço
 * incendiário e a bomba do tomate voador acendem a MESMA coisa, com raio e duração diferentes.
 * Duas implementações divergiriam em regra de dano na primeira semana.
 *
 * **Só hostil queima.** Decisão do usuário, registrada aqui porque é regra de jogo e não detalhe:
 * a poça é área negada para a horda e terreno seguro para o jogador, inclusive a que o tomate
 * acende. Sem isto, usar a própria habilidade num corredor viraria suicídio.
 *
 * Puro: sem Babylon, sem cena. Quem desenha a chama é a apresentação; aqui mora só onde ela está,
 * quanto tempo dura e quem paga.
 */

export const GROUND_FIRE = {
  /** Vida da poça, em segundos. */
  seconds: 6,
  /** Dano por segundo a quem está dentro. Cobrado em pulsos — ver `tickSeconds`. */
  damagePerSecond: 14,
  /**
   * Intervalo entre pulsos de dano.
   *
   * Dano contínuo por quadro produziria uma enxurrada de rótulos de 0,2 e afogaria o teto de 32 de
   * `EnemySwarm.labels`. Em pulsos o número que sobe é legível e o custo é o mesmo.
   */
  tickSeconds: .5,
  /**
   * Poças vivas ao mesmo tempo.
   *
   * A chuva de mísseis acende três de uma vez e a salva incendiária cinco; com a horda final por
   * cima, sem teto isso vira dezenas de consultas de distância por pulso. Estourado o teto, a mais
   * VELHA morre — quem acabou de atirar vê o próprio fogo, que é o que importa.
   */
  limit: 12,
} as const;

export interface GroundFirePatch {
  /** Centro no chão, em MUNDO. */
  readonly centre: Vec3;
  /** Vertical LOCAL no ponto. No planeta não é `+Y`; é a normal da casca. */
  readonly up: Vec3;
  readonly radius: number;
  /** Segundos restantes. */
  remaining: number;
  /** Duração total com que nasceu, para a apresentação saber a fração de vida. */
  readonly duration: number;
  /** Relógio do próximo pulso de dano. */
  tick: number;
  /** Quem acendeu. Entra no dano para o abate ser creditado a quem atirou. */
  readonly owner: number;
}

/** Um corpo consultável pelo fogo. A posição é lida no instante do pulso. */
export interface BurnableBody { readonly id: number; readonly position: Vec3 }

/**
 * Distância no plano TANGENTE ao chão da poça.
 *
 * Medir em linha reta no espaço puniria quem voa: o tomate pairando a 2 m de altura sobre a poça
 * está a 2 m do centro em linha reta e a ZERO metro no chão. A componente ao longo de `up` é
 * descontada, então a poça é um cilindro vertical local — que é o que o jogador vê desenhado.
 */
function tangentDistance(patch: GroundFirePatch, point: Vec3): number {
  const dx = point.x - patch.centre.x, dy = point.y - patch.centre.y, dz = point.z - patch.centre.z;
  const along = dx * patch.up.x + dy * patch.up.y + dz * patch.up.z;
  const tx = dx - patch.up.x * along, ty = dy - patch.up.y * along, tz = dz - patch.up.z * along;
  return Math.hypot(tx, ty, tz);
}

export class GroundFireField {
  private readonly live: GroundFirePatch[] = [];

  /** As poças vivas agora. A apresentação lê daqui; ninguém de fora escreve. */
  get patches(): readonly GroundFirePatch[] { return this.live; }
  get count(): number { return this.live.length; }

  /**
   * Acende o chão. `up` deve ser a vertical local do ponto — no planeta, a normal da casca.
   *
   * Raio ou duração não-positivos são recusados em silêncio: quem chama vem de uma tabela de
   * balanceamento, e uma linha zerada ali não deve criar uma poça invisível e eterna.
   */
  ignite(centre: Vec3, up: Vec3, radius: number, owner = 1, seconds: number = GROUND_FIRE.seconds): GroundFirePatch | undefined {
    if (!(radius > 0) || !(seconds > 0)) return undefined;
    if (!Number.isFinite(centre.x + centre.y + centre.z)) return undefined;
    const length = Math.hypot(up.x, up.y, up.z) || 1;
    const patch: GroundFirePatch = {
      centre: {x: centre.x, y: centre.y, z: centre.z},
      up: {x: up.x / length, y: up.y / length, z: up.z / length},
      radius, remaining: seconds, duration: seconds, tick: GROUND_FIRE.tickSeconds, owner,
    };
    this.live.push(patch);
    // A mais velha sai primeiro: `live` está em ordem de nascimento por construção.
    while (this.live.length > GROUND_FIRE.limit) this.live.shift();
    return patch;
  }

  /**
   * Um passo: envelhece as poças e cobra os pulsos vencidos.
   *
   * `hurt` é chamado uma vez por (corpo, poça) com o dano do pulso. Um corpo parado sobre duas
   * poças sobrepostas paga as duas — é o comportamento esperado de quem ficou no meio de uma
   * chuva de mísseis, e deixar o pedágio dobrar é o que dá sentido a concentrar fogo.
   */
  update(dt: number, bodies: readonly BurnableBody[], hurt: (body: BurnableBody, amount: number, patch: GroundFirePatch) => void): void {
    const step = Math.max(0, dt);
    if (step === 0) return;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const patch = this.live[i]!;
      patch.remaining -= step;
      patch.tick -= step;
      if (patch.tick <= 0) {
        // O pulso paga o intervalo cheio mesmo que o quadro tenha passado do ponto: o dano por
        // segundo é o contrato, e um quadro longo não pode roubar dano da poça.
        const amount = GROUND_FIRE.damagePerSecond * GROUND_FIRE.tickSeconds;
        patch.tick += GROUND_FIRE.tickSeconds;
        if (patch.tick <= 0) patch.tick = GROUND_FIRE.tickSeconds;
        for (const body of bodies) if (tangentDistance(patch, body.position) <= patch.radius) hurt(body, amount, patch);
      }
      if (patch.remaining <= 0) this.live.splice(i, 1);
    }
  }

  /** Apaga tudo — troca de estágio, nova tentativa, descarte da cena. */
  clear(): void { this.live.length = 0; }
}
