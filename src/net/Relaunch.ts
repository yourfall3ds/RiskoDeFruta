/**
 * ENTRAR NUMA SALA SEM RECARREGAR A PÁGINA.
 *
 * ## O que foi medido
 *
 * Criar ou entrar numa sala devolvia o jogador à tela de carregamento por cerca de 40 segundos. A
 * causa tem duas metades, e só uma delas é evitável:
 *
 * 1. **A recarga da PÁGINA.** `startOnline` gravava a intenção e chamava `location.assign()`. Isso
 *    joga fora o contexto WebGL, os shaders compilados, os módulos já avaliados e o motor Babylon
 *    inteiro — tudo para reconstruir exatamente os mesmos objetos. É puro desperdício, e é o que
 *    este módulo remove.
 * 2. **A troca de MUNDO.** Fora do co-op o mapa padrão é o PLANETA (`WorldSelection.usePlanetWorld`
 *    devolve `true` sem parâmetro nenhum); dentro do co-op é a FAZENDA (`online=1` devolve `false`).
 *    São dois adaptadores de mundo diferentes, com colisão, navegação e cenário próprios. Trocar de
 *    um para o outro exige construir a cena de novo — isso NÃO é evitável sem mexer em regra de
 *    mundo, que está fora deste trabalho.
 *
 * Então o que sobra é: a cena é reconstruída (inevitável), mas a PÁGINA não (evitável). Quem
 * reconstrói é `Application`, pelo mesmo caminho que o `F1 → reiniciar` já usa há muito tempo.
 *
 * ## Por que um registro global e não um parâmetro
 *
 * `browserMultiplayer()` é criado dentro de `PlayerHUD`, que é criado dentro de `PlayerScene`, que
 * é criada por `Application`. Passar a função para baixo por essa cadeia obrigaria quatro
 * construtores a conhecer um conceito que só interessa às duas pontas. O registro é um ponteiro só,
 * com uma queda honesta: sem ninguém registrado, o comportamento volta a ser a recarga de página,
 * que é o que os testes e `jogar-coop.ps1` continuam exercitando.
 */

/** Por que o jogo está sendo relançado. A `Application` não precisa disto hoje; o log precisa. */
export type RelaunchReason = 'entrar' | 'sair';

let handler: ((reason: RelaunchReason) => void) | undefined;

/** `Application` se registra no arranque e se desregistra ao ser descartada. */
export function setRelaunchHandler(fn: ((reason: RelaunchReason) => void) | undefined): void {
  handler = fn;
}

/**
 * Relança o jogo no lugar, se alguém sabe como. Devolve `false` quando não há quem faça — e aí
 * quem chamou recarrega a página, como sempre fez.
 */
export function relaunch(reason: RelaunchReason): boolean {
  const fn = handler;
  if (!fn) return false;
  try { fn(reason); return true; }
  // Uma falha aqui não pode deixar o jogador preso no menu: a recarga de página é a rede de
  // segurança, e ela ainda funciona.
  catch { return false; }
}

/** `true` quando existe caminho em processo. Só para diagnóstico. */
export function canRelaunch(): boolean { return !!handler; }
