import {describe, it, expect} from 'vitest';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor, BLAST_IMPULSE_CAP} from '../src/player/PlayerMotor';

/**
 * O salto de foguete.
 *
 * O que se prova aqui é a decomposição: explosão SOB os pés vira altura, explosão AO LADO vira
 * deslocamento, e nenhuma das duas mata. O empurrão puramente tangente de `knockback` não daria
 * a primeira — era exatamente por isso que `blastImpulse` precisou existir.
 */

function motor(): PlayerMotor {
  const collision = new CollisionWorld();
  collision.surfaces.push({id: 'field', x: 0, z: 0, width: 400, depth: 400, height: 0});
  const player = new PlayerMotor(collision, new EventBus<GameEvents>(), {x: 0, y: 0, z: 0});
  return player;
}

const EMPTY = {x: 0, z: 0, jump: false, dodge: false, fire: false, charging: false};

describe('salto de foguete', () => {
  it('explosão SOB os pés vira altura e solta o corpo do chão', () => {
    const player = motor();
    expect(player.grounded).toBe(true);
    // Direção do centro da explosão PARA o corpo: reto para cima.
    player.blastImpulse({x: 0, y: 1, z: 0}, BLAST_IMPULSE_CAP);
    expect(player.grounded, 'saiu do apoio').toBe(false);
    expect(player.verticalSpeed, 'ganhou altura').toBeGreaterThan(5);
  });

  it('sobe MAIS alto que um pulo normal — é mobilidade, não tremor', () => {
    const pulo = motor();
    pulo.fixedUpdate(1 / 60, {...EMPTY, jump: true}, 0);
    const alturaDoPulo = pulo.verticalSpeed;

    const foguete = motor();
    foguete.blastImpulse({x: 0, y: 1, z: 0}, BLAST_IMPULSE_CAP);
    expect(foguete.verticalSpeed).toBeGreaterThan(alturaDoPulo);
  });

  it('explosão AO LADO empurra de lado sem arremessar para o céu', () => {
    const player = motor();
    player.blastImpulse({x: 1, y: 0, z: 0}, BLAST_IMPULSE_CAP);
    expect(player.verticalSpeed, 'nada de altura numa onda horizontal').toBeLessThanOrEqual(0.5);
    // O empurrão tangente aparece no passo seguinte, que é quando `push` é consumido.
    const antes = player.position.x;
    for (let i = 0; i < 20; i++) player.fixedUpdate(1 / 60, EMPTY, 0);
    expect(player.position.x - antes, 'andou para o lado').toBeGreaterThan(0.2);
  });

  it('duas explosões no MESMO passo não empilham altura', () => {
    const uma = motor();
    uma.blastImpulse({x: 0, y: 1, z: 0}, BLAST_IMPULSE_CAP);
    const duas = motor();
    duas.blastImpulse({x: 0, y: 1, z: 0}, BLAST_IMPULSE_CAP);
    duas.blastImpulse({x: 0, y: 1, z: 0}, BLAST_IMPULSE_CAP);
    // Sem isto, um leque de cápsulas atiraria o jogador para fora do planeta.
    expect(duas.verticalSpeed).toBeCloseTo(uma.verticalSpeed, 5);
  });

  it('respeita o teto mesmo pedindo um impulso absurdo', () => {
    const player = motor();
    player.blastImpulse({x: 0, y: 1, z: 0}, 9_000);
    expect(player.verticalSpeed).toBeLessThanOrEqual(BLAST_IMPULSE_CAP + 1e-6);
  });

  it('não causa dano: o arremesso é mobilidade, não autopunição', () => {
    const player = motor();
    const antes = player.hp;
    player.blastImpulse({x: 0, y: 1, z: 0}, BLAST_IMPULSE_CAP);
    expect(player.hp).toBe(antes);
  });

  it('impulso nulo ou negativo não mexe no corpo', () => {
    const player = motor();
    player.blastImpulse({x: 0, y: 1, z: 0}, 0);
    expect(player.grounded).toBe(true);
    player.blastImpulse({x: 0, y: 1, z: 0}, -5);
    expect(player.grounded).toBe(true);
  });
});
