import type { LobbyPlayer } from './LobbyLink';

/**
 * O QUE ESTÁ TRAVANDO A LARGADA, escrito.
 *
 * A `FarmRoom` exige unanimidade ESTRITA: todos prontos e todos com personagem escolhido. Do lado
 * de dentro isso é uma linha de código; do lado do jogador era um botão que não fazia nada e não
 * explicava — a reclamação foi literal. Esta função é a tradução da condição do servidor em frase,
 * e não decide nada: quem larga continua sendo a sala.
 *
 * Pura de propósito, para o teste poder cobrir cada caso sem subir servidor nenhum.
 */
export function lobbyBlockerText(players: readonly LobbyPlayer[], phase: 'lobby' | 'playing' = 'lobby'): string {
  if (phase === 'playing') return 'A PARTIDA COMEÇOU';
  if (!players.length) return 'AGUARDANDO A SALA RESPONDER';
  const slot = (player: LobbyPlayer): string => `P${player.entityId}`;
  const semClasse = players.filter(player => !player.classId);
  if (semClasse.length) return semClasse.map(player => `${slot(player)} ${player.name} ainda não escolheu personagem`).join(' · ');
  const semPronto = players.filter(player => !player.ready);
  if (semPronto.length) return semPronto.map(player => `${slot(player)} ${player.name} ainda não deu PRONTO`).join(' · ');
  return 'TODOS PRONTOS · A PARTIDA VAI COMEÇAR';
}
