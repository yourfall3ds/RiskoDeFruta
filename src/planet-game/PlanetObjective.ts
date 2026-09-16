import type {Vec3} from '../core/contracts';
import type {PlanetCollision} from '../planet/PlanetCollision';
import {PlanetFrame, length, sub} from '../planet/PlanetFrame';
import {PLAYER_TUNING} from '../player/PlayerTuning';
import {FINAL_CHALICE_JUICE, FRUIT_JUICE} from '../run/ExpeditionObjectives';
import type {EnemyKind} from '../run/MonsterDirector';
import {PlanetGraph} from './PlanetGraph';
import type {IslandRecord} from './PlanetManifest';
import {findIslandSpawn, SPAWN_DEFAULTS, type SpawnProbe} from './PlanetSpawn';

/**
 * A expedição do cálice no planeta.
 *
 * Mesmas REGRAS da expedição do jogo plano — chegar, procurar, encontrar, ativar a horda final com
 * o chefe, encher o cálice com o suco dos abates e recolher — medidas no referencial certo.
 *
 * **Por que não `src/run/ExpeditionObjectives`.** Aquele módulo é planar na raiz: `hypot(dx, dz)`
 * para distância e `groundAt(x, z)` para validar o sítio. No globo, `hypot(dx, dz)` entre duas
 * ilhas atravessa o vazio e `groundAt(x, z)` não existe. As CONSTANTES dele
 * (`FINAL_CHALICE_JUICE`, `FRUIT_JUICE`) são reaproveitadas aqui sem cópia, então a economia do
 * suco é literalmente a mesma.
 */
export type ObjectivePhase = 'procurar' | 'encontrado' | 'ativo' | 'horda' | 'pronto' | 'completo';

export interface ChaliceSite {
  readonly island: IslandRecord;
  readonly probe: SpawnProbe;
  /** Pé do cálice em espaço de mundo. */
  readonly position: Vec3;
}

export const OBJECTIVE_TUNING = {
  /** A que distância de caminhada o cálice deixa de ser rumor e passa a ter marcador. */
  discoveryMetres: 45,
  /** Alcance do `E`. */
  activationMetres: 4,
  /** Mínimo de pontes entre a chegada e o cálice. */
  minHops: 2,
  /** Suco necessário para o cálice encher. */
  juiceTarget: FINAL_CHALICE_JUICE,
} as const;

export class PlanetObjective {
  private state: ObjectivePhase = 'procurar';
  private site: ChaliceSite | undefined;
  private homeId = '';
  private juiceValue = 0;
  private bossDown = false;

  constructor(private readonly frame: PlanetFrame, private readonly graph: PlanetGraph) {}

  get phase(): ObjectivePhase {return this.state;}
  get chalice(): ChaliceSite | undefined {return this.site;}
  get discovered(): boolean {return this.state !== 'procurar';}
  get complete(): boolean {return this.state === 'completo';}
  /** `true` enquanto a horda final e o chefe devem estar em campo. */
  get hordeActive(): boolean {return this.state === 'horda';}
  get juice(): number {return this.juiceValue;}
  get juiceTarget(): number {return OBJECTIVE_TUNING.juiceTarget;}
  get bossDefeated(): boolean {return this.bossDown;}
  /** 0..1 para a barra do HUD. */
  get juiceProgress(): number {return Math.min(1, this.juiceValue / OBJECTIVE_TUNING.juiceTarget);}

  /**
   * Escolhe o cálice a partir da ilha de chegada e valida o sítio na malha real.
   *
   * Percorre as candidatas do MAIS LONGE para o mais perto e fica na primeira com apoio validado;
   * assim uma ilha sem chão caminhável não vira um objetivo impossível nem força a vizinha.
   */
  plan(collision: PlanetCollision, homeIsland: IslandRecord): ChaliceSite | undefined {
    this.homeId = homeIsland.id;
    this.state = 'procurar';
    this.juiceValue = 0;
    this.bossDown = false;
    // O cálice ocupa o volume de um corpo, não o da chegada em queda: usar a altura do jogador
    // em vez do `height` folgado do `SPAWN_DEFAULTS` evita recusar um sítio bom sob uma copa.
    const options = {...SPAWN_DEFAULTS, height: PLAYER_TUNING.height};
    for (const candidate of this.graph.rankedTargets(homeIsland.id, OBJECTIVE_TUNING.minHops)) {
      const probe = findIslandSpawn(collision, this.frame, candidate, options);
      if (!probe) continue;
      this.site = {island: candidate, probe, position: probe.position};
      return this.site;
    }
    this.site = undefined;
    return undefined;
  }

  /**
   * Distância de caminhada do corpo até o cálice: arco até a ilha atual, rota de pontes entre as
   * ilhas, e arco do centro da ilha do cálice até o cálice. É o número que o HUD mostra — nunca a
   * corda, que passaria por dentro do planeta.
   */
  walkingDistance(position: Vec3): number {
    const site = this.site;
    if (!site) return Infinity;
    const here = this.graph.islandAt(position);
    if (!here) return Infinity;
    if (here.id === site.island.id) return this.frame.arcDistance(position, site.position);
    const route = this.graph.route(here.id, site.island.id);
    if (!route) return Infinity;
    return this.frame.arcDistance(position, here.centre) + route.length
      + this.frame.arcDistance(site.island.centre, site.position);
  }

  /**
   * Avança o estado com a posição do corpo. Devolve `true` quando o estado mudou neste quadro.
   *
   * O laço existe porque as transições encadeiam: quem chega perto do cálice no MESMO quadro em que
   * o descobre precisa terminar em `ativo`, e não ficar um quadro em `encontrado` com o `E` inerte.
   * O número de estados é finito e cada passo só avança, então o laço sempre termina.
   */
  update(position: Vec3): boolean {
    let changed = false;
    for (let guard = 0; guard < 4 && this.step(position); guard++) changed = true;
    return changed;
  }

  private step(position: Vec3): boolean {
    const site = this.site;
    if (!site || this.state === 'completo' || this.state === 'pronto') return false;
    if (this.state === 'horda') {
      if (this.juiceValue >= OBJECTIVE_TUNING.juiceTarget && this.bossDown) {this.state = 'pronto'; return true;}
      return false;
    }
    if (this.state === 'procurar') {
      if (this.walkingDistance(position) > OBJECTIVE_TUNING.discoveryMetres) return false;
      this.state = 'encontrado';
      return true;
    }
    if (this.state === 'encontrado' && this.reachable(position)) {this.state = 'ativo'; return true;}
    if (this.state === 'ativo' && !this.reachable(position)) {this.state = 'encontrado'; return true;}
    return false;
  }

  /**
   * `E` no cálice. Só vale com o corpo ao lado dele.
   *
   * Dois usos, em ordem: o primeiro ACORDA a horda final com o chefe; o segundo, quando o cálice
   * está cheio e o chefe caiu, RECOLHE. Não existe atalho entre eles.
   */
  activate(position: Vec3): 'horda' | 'recolhido' | undefined {
    if (!this.reachable(position)) return undefined;
    if (this.state === 'ativo') {this.state = 'horda'; return 'horda';}
    if (this.state === 'pronto') {this.state = 'completo'; return 'recolhido';}
    return undefined;
  }

  /** Suco de um abate durante a horda final. Fora dela, abate não enche cálice nenhum. */
  registerKill(kind: EnemyKind | string): number {
    if (this.state !== 'horda') return 0;
    const gain = FRUIT_JUICE[kind] ?? 1;
    this.juiceValue = Math.min(OBJECTIVE_TUNING.juiceTarget, this.juiceValue + gain);
    return gain;
  }

  /** O chefe caiu. Só conta durante a horda. */
  registerBossDefeat(): void {
    if (this.state !== 'horda') return;
    this.bossDown = true;
  }

  private reachable(position: Vec3): boolean {
    const site = this.site;
    return site !== undefined && length(sub(position, site.position)) <= OBJECTIVE_TUNING.activationMetres;
  }

  /** Linha de objetivo do HUD, sem jargão. */
  label(position: Vec3): string {
    const site = this.site;
    if (!site) return 'Nenhum cálice foi posicionado neste planeta.';
    if (this.state === 'completo') return `Suco recolhido em ${site.island.name}. Embarque para a próxima ilha.`;
    if (this.state === 'pronto') return `[E] Recolher o suco do cálice`;
    if (this.state === 'horda') {
      const juice = `${Math.round(this.juiceValue)}/${OBJECTIVE_TUNING.juiceTarget}`;
      return this.bossDown
        ? `Cálice ${juice} · a Praga Alfa caiu`
        : `Cálice ${juice} · derrote a Praga Alfa`;
    }
    const distance = this.walkingDistance(position);
    const metres = Number.isFinite(distance) ? `${Math.round(distance)} m` : 'sem rota a pé';
    if (this.state === 'ativo') return `[E] Despertar o cálice · ${site.island.name}`;
    if (this.state === 'encontrado') return `Cálice à vista em ${site.island.name} · ${metres}`;
    const route = this.graph.route(this.homeId, site.island.id);
    return `Explore o planeta e encontre o cálice · ${route ? `${route.hops} ponte(s)` : 'rota desconhecida'} · ${metres}`;
  }
}
