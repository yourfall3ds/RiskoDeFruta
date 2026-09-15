import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CharacterVisual } from '../animation/CharacterVisual';
import { PlayerMotor } from '../player/PlayerMotor';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/contracts';
import type { RemoteSample } from './NetworkClient';

interface Remote { motor: PlayerMotor; visual: CharacterVisual; seen: number }

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
        remote = { motor, visual, seen: this.frame };
        this.remotes.set(id, remote);
      }
      remote.seen = this.frame;
      const m = remote.motor, s = sample.state;
      Object.assign(m.previous, m.position);
      m.position.x = sample.x; m.position.y = sample.y; m.position.z = sample.z;
      if (dt > 0) { m.velocity.x = (m.position.x - m.previous.x) / dt; m.velocity.y = (m.position.y - m.previous.y) / dt; m.velocity.z = (m.position.z - m.previous.z) / dt; }
      m.yaw = sample.yaw; m.grounded = s.grounded; m.sprinting = s.sprinting; m.dodgeRemaining = s.dodgeRemaining; m.hp = s.hp; m.maxHP = s.maxHP;
      remote.visual.update(m, 1, dt, false);
    }
    for (const [id, remote] of this.remotes) if (remote.seen !== this.frame) { remote.visual.dispose(); this.remotes.delete(id); }
  }

  dispose(): void { for (const remote of this.remotes.values()) remote.visual.dispose(); this.remotes.clear(); }
}
