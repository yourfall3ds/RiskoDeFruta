import { describe, it, expect } from 'vitest';
import { remoteCombatPose, remoteSkillPose } from '../src/net/RemotePlayers';
import { SKILL_CUES } from '../src/combat/SkillTimeline';

/**
 * O QUE O AMIGO VÊ QUANDO VOCÊ ATIRA, RECARREGA E SOLTA A ULTIMATE.
 *
 * ## O que estava errado
 *
 * O `PlayerState` replica `ammo`, `reloading`, `skillTier`, `skillElapsed` e `skillActive` desde o
 * bloco F. `RemotePlayers` lia SEIS campos — posição, `yaw`, `grounded`, `sprinting`,
 * `dodgeRemaining` e vida — e descartava o resto. O resultado no jogo: o companheiro atirava,
 * recarregava e soltava a habilidade, e na sua tela ele continuava só andando. Os dados chegavam; a
 * apresentação não os usava.
 *
 * A pose NÃO é replicada de propósito — o contrato manda mandar a CAUSA e deixar cada cliente
 * derivar a animação, que é o que evita mandar nome de clipe pela rede. Mas derivar exige alguém
 * derivando, e esse era o lado que faltava.
 *
 * ## Por que estes casos, e não uma captura de tela
 *
 * A decisão inteira é uma função pura de estado replicado. Afirmá-la aqui pega a divergência onde
 * ela nasce, sem Babylon, sem GPU e sem duas janelas abertas — e as duas janelas continuam sendo o
 * teste seguinte, não o substituto deste.
 */

const parado = {ammo: 50, reloading: false, skillActive: false, skillTier: 0, skillElapsed: 0};

describe('a habilidade do outro jogador', () => {
  it('não existe enquanto ela não está ativa', () => {
    expect(remoteSkillPose(false, 2, 1.5)).toBeUndefined();
  });

  it('ativa, sai com o grau e o progresso da fala daquele grau', () => {
    const pose = remoteSkillPose(true, 2, SKILL_CUES[2].voiceEnd / 2)!;
    expect(pose.tier).toBe(2);
    expect(pose.progress).toBeCloseTo(.5, 5);
  });

  it.each([1, 2, 3] as const)('o grau %i fecha em 1 no fim da fala, e não passa disso', tier => {
    expect(remoteSkillPose(true, tier, SKILL_CUES[tier].voiceEnd)!.progress).toBe(1);
    expect(remoteSkillPose(true, tier, SKILL_CUES[tier].voiceEnd * 3)!.progress).toBe(1);
  });

  /**
   * `skillTier` é `uint8` e chega ZERO para quem nunca usou habilidade. Sem esta guarda,
   * `SKILL_CUES[0]` é `undefined` e a divisão vira `NaN` — um progresso que não é número põe o
   * esqueleto do amigo numa pose indefinida, sem erro nenhum no console.
   */
  it('grau fora de 1..3 não vira pose, nem com o sinalizador ligado', () => {
    expect(remoteSkillPose(true, 0, 1)).toBeUndefined();
    expect(remoteSkillPose(true, 7, 1)).toBeUndefined();
  });
});

describe('o tiro do outro jogador', () => {
  it('a QUEDA da munição é o coice: quem gasta uma bala dá um coice', () => {
    const pose = remoteCombatPose({ammo: 50, reloadClock: 0}, {...parado, ammo: 49}, 1 / 60);
    expect(pose.fired).toBe(true);
  });

  it('munição parada não dá coice nenhum', () => {
    expect(remoteCombatPose({ammo: 50, reloadClock: 0}, parado, 1 / 60).fired).toBe(false);
  });

  /**
   * Na recarga a munição SOBE, e uma subida nunca foi tiro. O caso existe porque a regra é escrita
   * como comparação de números: sem excluir a recarga, o primeiro quadro em que o pente enche
   * poderia ser lido como disparo se a ordem dos campos mudasse.
   */
  it('recarregando não sai coice, mesmo com a munição mexendo', () => {
    const pose = remoteCombatPose({ammo: 50, reloadClock: 0}, {...parado, ammo: 10, reloading: true}, 1 / 60);
    expect(pose.fired).toBe(false);
  });
});

describe('a recarga do outro jogador', () => {
  it('sem recarga o progresso é -1, que é como o boneco entende "não estou recarregando"', () => {
    expect(remoteCombatPose({ammo: 50, reloadClock: 0}, parado, 1 / 60).reloadProgress).toBe(-1);
  });

  it('recarregando, o progresso anda com o tempo e o relógio acumula', () => {
    let estado = {ammo: 50, reloadClock: 0};
    const primeiro = remoteCombatPose(estado, {...parado, reloading: true}, .5);
    expect(primeiro.reloadProgress).toBeGreaterThan(0);
    estado = {ammo: 50, reloadClock: primeiro.reloadClock};
    const segundo = remoteCombatPose(estado, {...parado, reloading: true}, .5);
    expect(segundo.reloadProgress).toBeGreaterThan(primeiro.reloadProgress);
  });

  /**
   * A duração real da recarga é por ARMA e a arma do remoto não é replicada. Então o relógio local
   * move a animação e o BOOLEANO a encerra — o progresso é cortado em 1 até o sinalizador cair, em
   * vez de estourar para além do fim do clipe.
   */
  it('o progresso nunca passa de 1, por mais que a recarga demore', () => {
    expect(remoteCombatPose({ammo: 50, reloadClock: 99}, {...parado, reloading: true}, .5).reloadProgress).toBe(1);
  });

  it('quando a recarga acaba, o relógio zera junto', () => {
    const pose = remoteCombatPose({ammo: 50, reloadClock: 2.5}, parado, 1 / 60);
    expect(pose.reloadClock).toBe(0);
    expect(pose.reloadProgress).toBe(-1);
  });
});
