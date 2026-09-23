import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CharacterVisual } from '../animation/CharacterVisual';
import { PlayerMotor } from '../player/PlayerMotor';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/contracts';
import type { RemoteSample } from './NetworkClient';
import { SKILL_CUES } from '../combat/SkillTimeline';

interface Remote {
  motor: PlayerMotor; visual: CharacterVisual; seen: number;
  /** Munição do quadro anterior: é a QUEDA dela que denuncia um tiro que não vi acontecer. */
  ammo: number;
  /** Relógio local da recarga, e o lado do próximo coice. Ver `update`. */
  reloadClock: number; fireSide: 0 | 1;
}

/**
 * Duração NOMINAL da recarga do remoto, em segundos.
 *
 * A duração real é por arma (`PrismTuning.reloadSeconds` vai de 2,6 a 3,2) e a ARMA do outro
 * jogador não é replicada — só o booleano `reloading`. Então este número move a animação, não a
 * cronometra: o que encerra a recarga é o booleano voltar a ser falso, e o progresso é cortado em 1
 * até lá. Trocar isto por precisão de verdade exige replicar a arma, e aí o número sai daqui.
 */
const NOMINAL_RELOAD = 2.8;

/**
 * Apresenta os outros jogadores: um `CharacterVisual` por remoto, alimentado por um `PlayerMotor`
 * que não simula — recebe a pose interpolada da rede. `aiming=false` de propósito: a mira de braço do
 * `CharacterVisual` procura ossos por nome na cena inteira e, com dois pistoleiros, moveria o esqueleto errado.
 */
export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>();
  private frame = 0;
  constructor(private readonly scene: Scene, private readonly collision: CollisionWorld, private readonly shadows: ShadowGenerator, private readonly events: EventBus<GameEvents>) {}

  get count(): number { return this.remotes.size; }

  update(samples: RemoteSample[], dt: number): void {
    this.frame++;
    for (const sample of samples) {
      const id = sample.state.id;
      let remote = this.remotes.get(id);
      if (!remote) {
        const motor = new PlayerMotor(this.collision, this.events, { x: sample.x, y: sample.y, z: sample.z });
        const visual = new CharacterVisual(this.scene, () => { for (const mesh of visual.meshes) this.shadows.addShadowCaster(mesh, false); });
        void visual.load();
        remote = { motor, visual, seen: this.frame, ammo: sample.state.ammo, reloadClock: 0, fireSide: 0 };
        this.remotes.set(id, remote);
      }
      remote.seen = this.frame;
      const m = remote.motor, s = sample.state;
      Object.assign(m.previous, m.position);
      m.position.x = sample.x; m.position.y = sample.y; m.position.z = sample.z;
      if (dt > 0) { m.velocity.x = (m.position.x - m.previous.x) / dt; m.velocity.y = (m.position.y - m.previous.y) / dt; m.velocity.z = (m.position.z - m.previous.z) / dt; }
      m.yaw = sample.yaw; m.grounded = s.grounded; m.sprinting = s.sprinting; m.dodgeRemaining = s.dodgeRemaining; m.hp = s.hp; m.maxHP = s.maxHP;
      applyCombatPose(remote, s, dt);
      remote.visual.update(m, 1, dt, false);
    }
    for (const [id, remote] of this.remotes) if (remote.seen !== this.frame) { remote.visual.dispose(); this.remotes.delete(id); }
  }

  dispose(): void { for (const remote of this.remotes.values()) remote.visual.dispose(); this.remotes.clear(); }

  /**
   * A velocidade DERIVADA de um remoto, e a pose de habilidade DELE.
   *
   * Existem para que o fio possa ser afirmado sem GPU (`tests/remote-avatars`): a regra pura já é
   * coberta, e o que falta provar é que ela chega ao boneco em vez de ser calculada e descartada.
   * Leitura apenas — nada aqui muda estado.
   */
  velocityOf(id: string): {x: number; y: number; z: number} | undefined {
    const v = this.remotes.get(id)?.motor.velocity;
    return v ? {x: v.x, y: v.y, z: v.z} : undefined;
  }
  skillOf(id: string): {tier: 1 | 2 | 3; progress: number} | undefined {
    return this.remotes.get(id)?.visual.skillPerformance;
  }
  /** Onde o remoto está sendo DESENHADO (a amostra interpolada): é sobre essa cabeça que a etiqueta de debug flutua. */
  positionOf(id: string): {x: number; y: number; z: number} | undefined {
    const p = this.remotes.get(id)?.motor.position;
    return p ? {x: p.x, y: p.y, z: p.z} : undefined;
  }
}

/**
 * A POSE DE HABILIDADE DO OUTRO JOGADOR, derivada do que a rede já traz.
 *
 * `skillActive`, `skillTier` e `skillElapsed` viajam no `PlayerState` desde o bloco F e ninguém os
 * lia: o companheiro soltava a ULTIMATE e, na tela do amigo, continuava parado. A pose não é
 * replicada de propósito — o contrato manda mandar a CAUSA e deixar cada cliente derivar —, mas
 * derivar exige alguém derivando, e este era o lado que faltava.
 *
 * O progresso é o mesmo que `SkillTimeline.actionProgress` usa: decorrido sobre a duração da fala
 * daquele grau. Função pura e exportada para poder ser afirmada sem montar Babylon.
 */
export function remoteSkillPose(active: boolean, tier: number, elapsed: number): {tier: 1 | 2 | 3; progress: number} | undefined {
  if (!active || tier < 1 || tier > 3) return undefined;
  const grade = tier as 1 | 2 | 3;
  const total = SKILL_CUES[grade].voiceEnd;
  return {tier: grade, progress: Math.min(1, Math.max(0, elapsed / total))};
}

/**
 * Tiro, recarga e habilidade do remoto — o que a rede trazia e a apresentação descartava.
 *
 * O TIRO é inferido da QUEDA da munição, e não de um evento: `ammo` é estado replicado, e um
 * pacote de evento perdido deixaria o coice sem acontecer. Cada queda vale um coice, alternando as
 * mãos como o pistoleiro local faz — várias balas num mesmo patch viram um coice só, que é o que se
 * consegue ver de qualquer maneira. Recarga NÃO conta como tiro: lá a munição SOBE.
 */
export interface RemoteCombatPose {
  skill: {tier: 1 | 2 | 3; progress: number} | undefined;
  /** `-1` quando não há recarga — é o valor que `CharacterVisual` entende como "sem recarga". */
  reloadProgress: number;
  /** Houve um coice neste quadro. */
  fired: boolean;
  /** O relógio da recarga para o próximo quadro. */
  reloadClock: number;
}

export function remoteCombatPose(
  previous: {ammo: number; reloadClock: number},
  s: {ammo: number; reloading: boolean; skillActive: boolean; skillTier: number; skillElapsed: number},
  dt: number,
): RemoteCombatPose {
  const reloading = s.reloading;
  const reloadClock = reloading ? previous.reloadClock + Math.max(0, dt) : 0;
  return {
    skill: remoteSkillPose(s.skillActive, s.skillTier, s.skillElapsed),
    reloadProgress: reloading ? Math.min(1, reloadClock / NOMINAL_RELOAD) : -1,
    fired: s.ammo < previous.ammo && !reloading,
    reloadClock,
  };
}

function applyCombatPose(remote: Remote, s: RemoteSample['state'], dt: number): void {
  const pose = remoteCombatPose(remote, s, dt);
  remote.visual.skillPerformance = pose.skill;
  remote.visual.reloadProgress = pose.reloadProgress;
  if (pose.fired) { remote.visual.fire(remote.fireSide); remote.fireSide = remote.fireSide === 0 ? 1 : 0; }
  remote.reloadClock = pose.reloadClock;
  remote.ammo = s.ammo;
}
