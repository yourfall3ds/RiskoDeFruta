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
}

export type LobbyPhase = 'lobby' | 'playing';

export interface LobbyLink {
  readonly players: readonly LobbyPlayer[];
  readonly phase: LobbyPhase;
  readonly isHost: boolean;
  /** Devolve a função de cancelar a inscrição; o HUD a chama ao ser descartado. */
  onChange(listener: () => void): () => void;
  chooseClass(id: PlayerClassId): void;
  setReady(ready: boolean): void;
  setSetting(key: string, value: string): void;
}
