import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { RemotePlayers } from '../src/net/RemotePlayers';
import type { RemoteSample } from '../src/net/NetworkClient';
import type { CollisionWorld } from '../src/physics/CollisionWorld';
import type { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/contracts';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

/**
 * O BONECO DO COMPANHEIRO EXISTE, ANDA E SOME NA HORA CERTA.
 *
 * ## Por que este arquivo, e por que com motor nulo
 *
 * Provei em máquina que dois clientes reais entram na mesma sala, ficam prontos, largam a corrida,
 * andam, atiram e morrem — tudo pelo servidor. O que NÃO consegui provar ali foi o último elo: que
 * o companheiro vira um boneco DESENHADO na minha tela. Esta máquina não aguenta duas instâncias
 * (dois contextos Babylon na mesma GPU travam o navegador), e de dentro da página não há acesso à
 * cena para contar bonecos.
 *
 * `NullEngine` resolve isso: é o Babylon inteiro sem placa de vídeo. A cena existe, os nós existem,
 * o ciclo de vida acontece — só não há pixel. É o bastante para afirmar o que importa aqui, que é
 * CICLO DE VIDA e ALIMENTAÇÃO, não aparência.
 *
 * ## O que é afirmado
 *
 * Um boneco por remoto, nascendo quando o jogador aparece na amostra e sendo DESCARTADO quando ele
 * some dela. O descarte é a metade que costuma faltar: sem ele, quem sai da sala deixa um corpo
 * parado no campo para sempre — e o companheiro que volta ganha um sósia ao lado do próprio corpo.
 */

/** Uma amostra de remoto: a posição interpolada mais o `PlayerState` inteiro, como a rede entrega. */
function amostra(id: string, x: number, z: number, over: Record<string, unknown> = {}): RemoteSample {
  return {
    x, y: 0, z, yaw: 0,
    state: {
      id, entityId: 2, name: id, classId: 0, classChosen: true, ready: true, connected: true,
      x, y: 0, z, yaw: 0, pitch: 0, seq: 1, hp: 100, maxHP: 100,
      grounded: true, sprinting: false, dodgeRemaining: 0, charges: 0, invulnerable: 0,
      ammo: 50, reloading: false, mpSeconds: 0, mpTier: 0,
      skillTier: 0, skillElapsed: 0, skillActive: false,
      ...over,
    } as unknown as RemoteSample['state'],
  };
}

/**
 * Os vizinhos de `RemotePlayers` reduzidos ao que ele de fato chama.
 *
 * A colisão e o barramento são guardados pelo `PlayerMotor` e só consultados quando ele SIMULA — e
 * o motor de um remoto nunca simula: ele recebe a pose pronta da rede. O gerador de sombra só
 * recebe `addShadowCaster` quando a malha carrega.
 */
/**
 * O mundo PLANO, que é o da fazenda.
 *
 * `PlayerMotor` deriva o referencial no nascimento (`adoptFrame`) e para isso pergunta ao mundo
 * qual é o "para cima" e qual a base naquele ponto — é o que permite o planeta esférico. Na fazenda
 * a resposta é sempre a mesma, e é esta.
 */
const colisao = {
  surface: {
    kind: 'flat',
    up: () => ({x: 0, y: 1, z: 0}),
    basis: () => ({up: {x: 0, y: 1, z: 0}, forward: {x: 0, y: 0, z: 1}, right: {x: 1, y: 0, z: 0}}),
    altitude: () => 0,
  },
} as unknown as CollisionWorld;
const eventos = { on: () => () => {}, emit: () => {} } as unknown as EventBus<GameEvents>;
function sombras(): ShadowGenerator {
  return { addShadowCaster: () => {} } as unknown as ShadowGenerator;
}

describe('os bonecos dos outros jogadores', () => {
  it('nasce um por remoto, e o mesmo id não vira dois', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      const remotos = new RemotePlayers(scene, colisao, sombras(), eventos);
      expect(remotos.count).toBe(0);

      remotos.update([amostra('ana', 1, 1), amostra('bento', 5, 5)], 1 / 60);
      expect(remotos.count).toBe(2);

      // O mesmo par, de novo: são os MESMOS bonecos, não quatro.
      remotos.update([amostra('ana', 2, 1), amostra('bento', 6, 5)], 1 / 60);
      expect(remotos.count).toBe(2);

      remotos.dispose();
      expect(remotos.count).toBe(0);
    } finally { scene.dispose(); engine.dispose(); }
  });

  /**
   * O DESCARTE é a metade que costuma faltar. Sem ele, quem sai da sala deixa um corpo parado no
   * campo para sempre — e quem volta depois ganha um sósia ao lado do próprio boneco.
   */
  it('quem some da amostra tem o boneco DESCARTADO', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      const remotos = new RemotePlayers(scene, colisao, sombras(), eventos);
      remotos.update([amostra('ana', 1, 1), amostra('bento', 5, 5)], 1 / 60);
      expect(remotos.count).toBe(2);

      // Bento saiu: a amostra seguinte não o traz.
      remotos.update([amostra('ana', 1, 1)], 1 / 60);
      expect(remotos.count).toBe(1);

      // E a sala esvaziou.
      remotos.update([], 1 / 60);
      expect(remotos.count).toBe(0);
    } finally { scene.dispose(); engine.dispose(); }
  });

  /**
   * A VELOCIDADE do remoto não vem da rede: ela é DERIVADA de duas posições e do tempo entre elas.
   * É dela que sai a locomoção — andar, correr, parar. Um remoto sem velocidade derivada fica
   * deslizando em pose de parado, que é o defeito clássico de boneco de multiplayer.
   */
  it('andar entre dois quadros vira velocidade, e ficar parado não', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      const remotos = new RemotePlayers(scene, colisao, sombras(), eventos);
      const dt = 1 / 60;

      remotos.update([amostra('ana', 0, 0)], dt);
      remotos.update([amostra('ana', 0, 3)], dt);
      const andando = remotos.velocityOf('ana')!;
      expect(andando.z).toBeCloseTo(3 / dt, 1);
      expect(andando.x).toBeCloseTo(0, 5);

      remotos.update([amostra('ana', 0, 3)], dt);
      const parado = remotos.velocityOf('ana')!;
      expect(Math.hypot(parado.x, parado.z)).toBeCloseTo(0, 5);
    } finally { scene.dispose(); engine.dispose(); }
  });

  /**
   * O ESTADO DE COMBATE chega ao boneco. `remoteCombatPose` já é afirmada como regra pura em
   * `tests/remote-presentation`; aqui o que se prova é o FIO — que a regra é de fato aplicada ao
   * `CharacterVisual` do remoto, e não calculada e jogada fora.
   */
  it('a habilidade do remoto chega ao boneco dele', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      const remotos = new RemotePlayers(scene, colisao, sombras(), eventos);
      remotos.update([amostra('ana', 0, 0)], 1 / 60);
      expect(remotos.skillOf('ana')).toBeUndefined();

      remotos.update([amostra('ana', 0, 0, { skillActive: true, skillTier: 2, skillElapsed: 0 })], 1 / 60);
      const pose = remotos.skillOf('ana');
      expect(pose?.tier).toBe(2);

      // E acaba quando o servidor diz que acabou.
      remotos.update([amostra('ana', 0, 0)], 1 / 60);
      expect(remotos.skillOf('ana')).toBeUndefined();
    } finally { scene.dispose(); engine.dispose(); }
  });
});
