/**
 * O QUE É UM MAPA — e por que o nascimento mora aqui, e não na simulação.
 *
 * ## O erro que este arquivo corrige
 *
 * A fileira de nascimento nasceu dentro da `FarmSimulation`, como constante global: `entityId`
 * entrava, coordenada saía. Funciona enquanto existe um mapa só. Com dois já quebra, e vão existir
 * vários — fazenda, mapa de teste, planeta, arena de chefe, outras ilhas. Cada um tem chão seguro
 * em lugar diferente, e a faixa que é firme na fazenda pode ser abismo na arena.
 *
 * A divisão certa é:
 *
 *     entityId  decide o ASSENTO   (P1 é P1 em qualquer mapa)
 *     mapa      decide a COORDENADA (onde P1 pisa depende de onde ele está)
 *
 * Então a simulação faz `mapa.playerSpawns[entityId - 1]` e não conhece número nenhum. Acrescentar
 * um mapa é acrescentar um objeto — nunca tocar na simulação.
 *
 * ## O que NÃO entra aqui
 *
 * Nada de apresentação: material, céu, vegetação, luz. Isto é o contrato que o SERVIDOR precisa
 * para simular, e o servidor não desenha. O cliente lê o mesmo `id` e monta a cena dele.
 */

/** Um lugar no mundo, com a direção para onde quem nasce ali está olhando. */
export interface SpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Radianos. Ausente significa "a direção padrão do mapa". */
  readonly yaw?: number;
}

export interface MapDefinition {
  readonly id: string;
  readonly displayName: string;
  /**
   * Os quatro assentos, em ordem de `entityId`. Quatro sempre: a sala tem quatro vagas, e um mapa
   * com menos deixaria o quarto jogador sem lugar — melhor faltar mapa do que faltar chão.
   */
  readonly playerSpawns: readonly SpawnPoint[];
  /** Onde um corpo de teste nasce, quando o mapa oferece isso. Só o laboratório usa. */
  readonly enemySpawns?: readonly SpawnPoint[];
  /**
   * O diretor nasce inimigos sozinho. `false` no laboratório: lá o único inimigo é o corpo de teste
   * que o mapa põe, e uma horda caçando os jogadores transforma cada teste de movimento em teste de
   * sobrevivência. Foi o que a primeira corrida no Test Map mostrou: o jogador nasceu no assento, foi
   * empurrado pela horda em saltos de cinco metros e estava morto no servidor em meio minuto.
   *
   * Obrigatório de propósito: um mapa novo tem de DIZER se tem horda, e não herdá-la por omissão.
   */
  readonly horde: boolean;
  /**
   * Os baús da fazenda e os colisores deles. Colisor que o servidor tem e o cliente não desenha é
   * parede invisível: o laboratório declara `false` e não herda caixa nenhuma.
   */
  readonly chests: boolean;
  /** A balsa entre ilhas: uma plataforma que anda. Mesma regra dos baús — sem ela no desenho, sem ela no servidor. */
  readonly ferry: boolean;
}

/**
 * O assento de um jogador, pelo número dele.
 *
 * Fora da faixa — mais jogadores do que assentos — cai no primeiro, e não em `undefined`: um mapa
 * mal declarado tem de pôr o jogador em chão conhecido, não num buraco de memória que vira
 * `NaN` de posição três passos adiante.
 */
export function spawnFor(map: MapDefinition, entityId: number): SpawnPoint {
  const índice = Math.max(0, Math.min(map.playerSpawns.length - 1, entityId - 1));
  return map.playerSpawns[índice]!;
}
