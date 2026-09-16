import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Quaternion, Vector3} from '@babylonjs/core/Maths/math.vector';
import {PointLight} from '@babylonjs/core/Lights/pointLight';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Scene} from '@babylonjs/core/scene';
import type {DamageContext, GameEvents, Vec3} from '../core/contracts';
import type {EventBus} from '../core/EventBus';
import type {RandomStream} from '../core/RunRNG';
import {PistolCadence} from '../combat/PistolCadence';
import {PistolMagazine} from '../combat/PistolMagazine';
import {MP_COSTS, type MPTier} from '../combat/MPCharge';
import {PISTOL_TUNING as t} from '../player/PlayerTuning';
import {ShotEffects} from '../vfx/ShotEffects';
import type {WeaponAudio} from '../audio/WeaponAudio';
import type {PlanetCollision} from '../planet/PlanetCollision';
import {add, dot, length, normalize, scale, sub} from '../planet/PlanetFrame';
import {hitscan, tangentSpread, type HitCapsule, type HitscanResult} from './PlanetHitscan';
import {destructionHit, NO_DESTRUCTION, type DestructionPort} from './PlanetDestruction';
import type {PlanetAvatar} from './PlanetAvatar';

/**
 * As duas pistolas autorais no planeta.
 *
 * **Por que não `src/combat/DualPistols`.** Aquela classe continua sendo a do jogo plano e não foi
 * tocada, mas não serve aqui por três motivos concretos, não por gosto:
 *
 * 1. exige `ThirdPersonCamera` e `CollisionWorld` concretos (têm estado privado ⇒ elenco duplo);
 * 2. usa `visual.position` como posição de MUNDO, e sob o pai radial do `PlanetAvatar` ela é LOCAL;
 * 3. os especiais montam a direção com o Y do MUNDO (`RicochetFan.launch` usa
 *    `Cross(Vector3.Up(), forward)`; o MP II gira o desvio em torno de `y`), o que num planeta
 *    aponta o leque para um plano errado em qualquer lugar fora do polo norte.
 *
 * O que é reaproveitado inteiro e sem cópia: `PistolMagazine`, `PistolCadence`, `PISTOL_TUNING`,
 * `ShotEffects`, `WeaponAudio` e o modelo `pistol.glb` — instanciado e **parentado nos
 * `RightWeaponGrip`/`LeftWeaponGrip` do rig**, que é o que faz as pistolas aparecerem de verdade
 * na mão e acompanharem a animação e o referencial radial sem nenhuma pose procedural.
 */
export interface WeaponAim {
  /** Origem da mira: a posição da câmera. */
  readonly eye: Vec3;
  /** Direção de visão da câmera, já com o pitch — vetor de MUNDO. */
  readonly forward: Vec3;
  /** Vertical local do corpo; define o plano do leque do especial. */
  readonly up: Vec3;
}

export interface WeaponTargets {
  /** Cápsulas vivas candidatas ao disparo. */
  capsules(): Iterable<HitCapsule>;
  /** Aplica o dano no ator. É quem chama `Health.apply` e portanto quem emite `EnemyHit`. */
  damage(id: number, context: DamageContext): void;
}

export interface WeaponStats {
  /** Multiplicador de dano vindo de `RunProgression.stats.damage`. */
  damage: number;
  /** Multiplicador de cadência. */
  attackSpeed: number;
  /** Chance de crítico já com retornos decrescentes aplicados. */
  crit: number;
  /** Multiplicador de poder de habilidade. */
  mp: number;
}

const BASE_STATS: WeaponStats = {damage: 1, attackSpeed: 1, crit: 0, mp: 1};

/** Tiros e dano por tier do especial. Mesma escala de custo de `MP_COSTS`. */
const SKILL_SHAPE: Record<Exclude<MPTier, 0>, {shots: number; spread: number; damage: number; id: string}> = {
  1: {shots: 7, spread: 0.85, damage: 20, id: 'planet_fan'},
  2: {shots: 13, spread: 1.25, damage: 24, id: 'planet_sweep'},
  3: {shots: 21, spread: 1.9, damage: 28, id: 'planet_storm'},
};

export class PlanetWeapons {
  readonly magazine = new PistolMagazine();
  readonly cadence = new PistolCadence();
  readonly effects: ShotEffects;
  stats: WeaponStats = {...BASE_STATS};
  ready = false;
  error = '';
  hits = 0;
  shots = 0;
  /** Último disparo que encontrou um ator; alimenta o retorno visual da mira. */
  hitTime = 0;

  private container: AssetContainer | undefined;
  private readonly roots: TransformNode[] = [];
  private readonly muzzles: TransformNode[] = [];
  private readonly flashes: PointLight[] = [];
  private readonly recoil = [0, 0];
  private disposed = false;
  /**
   * Destruição de cenário. Trocável a quente porque a fachada só existe depois de o manifesto e o
   * GLB carregarem — até lá o tiro funciona exatamente como antes, sem nenhum caminho novo.
   */
  destruction: DestructionPort = NO_DESTRUCTION;
  /** Acertos que viraram dano em cenário; diagnóstico do painel de verificação. */
  sceneryHits = 0;

  constructor(
    private readonly scene: Scene,
    private readonly avatar: PlanetAvatar,
    private readonly collision: PlanetCollision,
    private readonly targets: WeaponTargets,
    private readonly events: EventBus<GameEvents>,
    private readonly rng: RandomStream,
    private readonly audio: WeaponAudio,
  ) {
    this.effects = new ShotEffects(scene);
    for (let side = 0; side < 2; side++) {
      const root = new TransformNode(`planet-pistol-${side}`, scene);
      root.rotationQuaternion = Quaternion.Identity();
      this.roots.push(root);
      // Mesmo deslocamento de cano da montagem original do `pistol.glb`.
      const muzzle = new TransformNode(`planet-muzzle-${side}`, scene);
      muzzle.parent = root; muzzle.position.set(0, 0.154, 0.341);
      this.muzzles.push(muzzle);
      const light = new PointLight(`planet-muzzle-light-${side}`, Vector3.Zero(), scene);
      light.parent = muzzle; light.diffuse = new Color3(1, 0.65, 0.25); light.range = 2.4; light.intensity = 0;
      this.flashes.push(light);
    }
  }

  async load(url = '/models/pistol.glb'): Promise<void> {
    try {
      const container = await LoadAssetContainerAsync(url, this.scene);
      if (this.disposed) {container.dispose(); return;}
      this.container = container;
      for (let side = 0; side < 2; side++) {
        const instance = container.instantiateModelsToScene(name => `planet-pistol-${side}-${name}`, false, {doNotInstantiate: true});
        for (const node of instance.rootNodes) {
          node.parent = this.roots[side]!;
          for (const mesh of node.getChildMeshes()) {mesh.isPickable = false; mesh.receiveShadows = true;}
        }
      }
      this.ready = true;
    } catch (error) {
      if (!this.disposed) this.error = error instanceof Error ? error.message : 'Falha ao carregar a pistola';
    }
  }

  get ammo(): number {return this.magazine.ammo;}
  get capacity(): number {return this.magazine.capacity;}
  get reloading(): boolean {return this.magazine.reloading;}
  requestReload(): boolean {
    if (!this.magazine.request()) return false;
    this.audio.reload();
    return true;
  }

  /**
   * Prende as pistolas nos `WeaponGrip` do rig.
   *
   * Sem pai, o modelo fica na origem do mundo e o jogador segura o ar — que é exatamente o defeito
   * relatado. Como o grip é descendente do pai radial do avatar, a arma herda `up` e `forward`
   * corretos sem nenhuma matemática extra aqui.
   */
  updatePose(dt: number): void {
    const grips = this.avatar.visual.grips;
    for (let side = 0; side < 2; side++) {
      const root = this.roots[side]!, grip = grips[side];
      this.recoil[side] = Math.max(0, this.recoil[side]! - dt);
      const visible = this.ready && this.avatar.visual.ready && grip !== undefined;
      root.setEnabled(visible);
      if (!visible || !grip) {this.flashes[side]!.intensity = 0; continue;}
      if (root.parent !== grip) {
        root.parent = grip;
        root.position.setAll(0);
        root.rotationQuaternion = Quaternion.Identity();
      }
      root.computeWorldMatrix(true);
      const kick = this.recoil[side]! / t.recoilSeconds;
      this.flashes[side]!.intensity = kick > 0.6 ? (kick - 0.6) * 4 : 0;
    }
    this.hitTime = Math.max(0, this.hitTime - dt);
    this.effects.update(dt);
  }

  /** Passo fixo do tiro básico. `aim` precisa ser do quadro corrente. */
  fixedUpdate(dt: number, firing: boolean, aim: WeaponAim): void {
    this.magazine.update(dt);
    this.avatar.visual.reloadProgress = this.magazine.reloading ? this.magazine.progress : -1;
    if (this.magazine.ammo === 0 && !this.magazine.reloading) this.requestReload();
    this.cadence.rateMultiplier = this.stats.attackSpeed;
    this.cadence.update(dt, firing && this.ready && !this.magazine.reloading && this.magazine.ammo > 0,
      side => this.shoot(side, aim));
  }

  /**
   * Especial: leque de raios no PLANO TANGENTE do corpo.
   *
   * O leque abre em torno do `up` local, então ele continua horizontal no equador, no polo e de
   * cabeça para baixo. Cada raio passa pelo mesmo `hitscan` do tiro comum — o especial não tem
   * caminho próprio de dano e portanto não tem como acertar através de parede.
   */
  releaseSkill(tier: Exclude<MPTier, 0>, aim: WeaponAim): void {
    if (!this.ready) return;
    const shape = SKILL_SHAPE[tier];
    this.avatar.visual.release();
    this.events.emit('SkillUsed', {entityId: 1, skillId: shape.id});
    const directions = tangentSpread(aim.forward, aim.up, shape.shots, shape.spread);
    for (const [index, direction] of directions.entries()) {
      const side = (index % 2) as 0 | 1;
      this.fireRay(side, aim, direction, shape.damage * this.stats.mp, shape.id, ['bullet', 'skill']);
    }
    this.audio.charge(tier);
  }

  /** Custo em MP do tier, exposto para o HUD. */
  static costOf(tier: Exclude<MPTier, 0>): number {return MP_COSTS[tier - 1]!;}

  private shoot(side: 0 | 1, aim: WeaponAim): void {
    if (!this.magazine.consume()) return;
    const spread = t.spreadDegrees * Math.PI / 180;
    const direction = normalize({
      x: aim.forward.x + this.rng.range(-spread, spread),
      y: aim.forward.y + this.rng.range(-spread, spread),
      z: aim.forward.z + this.rng.range(-spread, spread),
    }, aim.forward);
    this.fireRay(side, aim, direction, t.damage * this.stats.damage, 'planet_pistols', ['bullet']);
  }

  /**
   * Um raio, do olho ao alvo e depois do cano ao alvo.
   *
   * O primeiro traçado decide ONDE o jogador mirou (a câmera é a verdade da mira). O segundo sai do
   * cano até esse ponto e é ele que causa dano — assim a bala não atravessa a parede que está entre
   * a mão e o alvo só porque a câmera enxerga por cima do ombro.
   */
  private fireRay(side: 0 | 1, aim: WeaponAim, direction: Vec3, damage: number, sourceId: string, tags: string[]): void {
    const capsules = [...this.targets.capsules()];
    const aimed = hitscan(this.collision, aim.eye, direction, t.range, capsules);
    const muzzle = this.muzzles[side]!;
    muzzle.computeWorldMatrix(true);
    const origin = muzzle.getAbsolutePosition();
    const from: Vec3 = {x: origin.x, y: origin.y, z: origin.z};
    const toAim = sub(aimed.point, from);
    const span = length(toAim);
    const shot: HitscanResult = span < 1e-4
      ? aimed
      : hitscan(this.collision, from, toAim, span + 0.05, capsules);

    this.recoil[side] = t.recoilSeconds;
    this.avatar.visual.fire(side);
    this.shots++;
    this.effects.muzzle(new Vector3(from.x, from.y, from.z));
    this.effects.tracer(new Vector3(from.x, from.y, from.z), new Vector3(shot.point.x, shot.point.y, shot.point.z));

    if (shot.target) {
      this.applyDamage(shot, direction, damage, sourceId, tags);
      this.hits++; this.hitTime = 0.12;
    } else if (!shot.missed) {
      // Cenário. O mesmo raio que já provou linha de visão é quem entrega o acerto: não existe
      // caminho separado que danifique um prop sem ter batido nele de verdade.
      //
      // Nada aqui toca `Health`, então nada aqui paga MP — a barra continua sendo paga só por
      // `EnemyHit`, que só a vida de uma praga emite.
      const outcome = this.destruction.hit(
        destructionHit(shot.point, direction, damage, shot.triangle, shot.normal));
      const point = new Vector3(shot.point.x, shot.point.y, shot.point.z);
      const normal = new Vector3(shot.normal.x, shot.normal.y, shot.normal.z);
      if (outcome) {
        // A rachadura progressiva e o som do material são do subsistema; o furo genérico de bala
        // por cima só sujaria a marca autoral.
        this.sceneryHits++;
      } else {
        this.effects.mark(point, normal);
        this.effects.impact(point, normal);
      }
    }
    this.audio.shot(shot.target !== undefined);
  }

  private applyDamage(shot: HitscanResult, direction: Vec3, damage: number, sourceId: string, tags: string[]): void {
    const target = shot.target!;
    const crit = this.rng.next() < Math.max(0, Math.min(0.95, this.stats.crit));
    const final = Math.max(0, damage) * (crit ? 2 : 1);
    const context: DamageContext = {
      attackerId: 1, victimId: target.id, sourceId, attackId: sourceId,
      baseDamage: damage, finalDamage: final, crit,
      procCoefficient: 1, procChainDepth: 0,
      damageTags: tags,
      hitPosition: {...shot.point},
      hitNormal: {...shot.normal},
      forceDirection: normalize(direction, {x: 0, y: 1, z: 0}),
      forceMagnitude: 2,
    };
    this.events.emit('DamageDealt', context);
    // `damage` chama `Health.apply`, que emite `EnemyHit` DEPOIS de a vida aceitar o dano.
    // É esse evento — e só ele — que a `MPCharge` escuta. Erro, cadáver e dano recusado não pagam MP.
    this.targets.damage(target.id, context);
    this.effects.impact(new Vector3(shot.point.x, shot.point.y, shot.point.z), new Vector3(-direction.x, -direction.y, -direction.z));
  }

  /** Alvo sob a mira agora, para o HUD marcar a mira. `undefined` quando não há. */
  aimTarget(aim: WeaponAim): HitCapsule | undefined {
    if (!this.ready) return undefined;
    return hitscan(this.collision, aim.eye, aim.forward, t.range, this.targets.capsules()).target;
  }

  resetAttempt(): void {
    this.cadence.reset();
    this.magazine.cancel();
    this.magazine.ammo = this.magazine.capacity;
    this.effects.clear();
    this.hits = 0; this.shots = 0; this.hitTime = 0; this.sceneryHits = 0;
    this.recoil.fill(0);
    for (const light of this.flashes) light.intensity = 0;
    this.avatar.visual.reloadProgress = -1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.effects.dispose();
    for (const light of this.flashes) light.dispose();
    for (const muzzle of this.muzzles) muzzle.dispose();
    for (const root of this.roots) root.dispose();
    this.container?.dispose();
  }
}

/** Distância angular até um ponto, no plano tangente — usada por HUD e diagnóstico. */
export function tangentDistance(from: Vec3, to: Vec3, up: Vec3): number {
  const delta = sub(to, from);
  return length(sub(delta, scale(up, dot(delta, up))));
}

export const planetWeaponHelpers = {add, normalize};
