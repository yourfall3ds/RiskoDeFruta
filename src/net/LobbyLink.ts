import type { PlayerClassId } from '../run/PlayerClass';

/**
 * O QUE A INTERFACE PODE SABER DA SALA — e nada além disso.
 *
 * `MenuShell` e `PlayerHUD` não podem importar o SDK do Colyseus: hoje eles rodam em testes de DOM
 * sem servidor nenhum, e um `import` de rede lá dentro obrigaria toda a suíte de interface a subir
 * uma sala. Este contrato é a fronteira: quem implementa é `NetworkClient` (online), e quem
 * consome vê apenas nomes, classes e prontidão.
 */
export interface LobbyPlayer {
  readonly id: string;
  readonly entityId: number;
  readonly name: string;
  /** `undefined` enquanto o jogador não escolheu — é o que trava a largada. */
  readonly classId: PlayerClassId | undefined;
  readonly ready: boolean;
  readonly host: boolean;
  readonly self: boolean;
  /**
   * A conexão dele está de pé?
   *
   * `false` é a JANELA DE VOLTA aberta: caiu, e a sala está segurando o lugar por trinta segundos
   * (ver `FarmRoom.onLeave`). Sem isto na tela, o companheiro simplesmente PARA no meio do campo e
   * quem ficou não tem como distinguir "a internet dele caiu" de "ele largou o teclado".
   */
  readonly connected: boolean;
}

export type LobbyPhase = 'lobby' | 'playing';

export interface LobbyLink {
  readonly players: readonly LobbyPlayer[];
  readonly phase: LobbyPhase;
  readonly isHost: boolean;
  /**
   * O ENDEREÇO PÚBLICO da sala (`host:porta`), dito pelo próprio servidor.
   *
   * É o valor que entra no código curto. Deduzir daqui do cliente não serve: o cliente conhece o
   * endereço por onde ELE entrou (`localhost`, para o anfitrião), e é justamente esse que não
   * funciona para o convidado. Quem sabe o endereço certo é o servidor, que já o calcula para o
   * `publicAddress` do Colyseus.
   */
  readonly address: string;
  /** O nome da sala, editável pelo anfitrião. Vazio até a primeira réplica chegar. */
  readonly roomName: string;
  /**
   * O mapa da sala, como o SERVIDOR o tem (`''` é a fazenda). Estado autoritativo: é o mesmo para
   * todos, e a tela nunca o guarda por conta própria — senão cada um veria um mapa.
   */
  readonly mapId: string;
  /** PEDIR a troca de mapa. A sala decide: só o anfitrião, só no lobby, nunca na contagem. */
  selectMap(id: string): void;
  /** Motivo, quando a sala caiu ou nunca subiu. Vazio enquanto está tudo de pé. */
  readonly failure: string;
  /** Devolve a função de cancelar a inscrição; o HUD a chama ao ser descartado. */
  onChange(listener: () => void): () => void;
  chooseClass(id: PlayerClassId): void;
  setReady(ready: boolean): void;
  setSetting(key: string, value: string): void;
  /** Renomear a sala. Só o anfitrião é atendido — a recusa é do servidor, como qualquer ajuste. */
  rename(name: string): void;
  /** Expulsar. Só o anfitrião. */
  kick(playerId: string): void;
  /** Encerrar a sala para todos. Só o anfitrião. */
  closeRoom(): void;
  /** Sair por vontade própria. */
  leaveRoom(): void;
  /** A sala acabou (encerrada, expulso, queda). O argumento é o que dizer ao jogador. */
  onClosed(listener: (reason: string) => void): () => void;
}
