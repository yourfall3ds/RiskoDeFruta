import { createServer } from 'node:net';

/**
 * Escolha de porta LIVRE, e não a porta 2567 cravada.
 *
 * No desenvolvimento a porta é combinada: `npm run server` sobe na 2567 e o `jogar-coop.ps1`
 * sabe disso. No aplicativo instalado não há combinação nenhuma — quem abre o jogo pode ter a 2567
 * ocupada por qualquer coisa (inclusive por uma SEGUNDA cópia do próprio jogo, que é exatamente o
 * caso de dois irmãos na mesma máquina). Cravar a porta faria o segundo a abrir morrer com
 * `EADDRINUSE` antes de desenhar a janela, e o sintoma para o jogador seria "o jogo não abre".
 *
 * A preferência ainda começa na 2567 porque, quando ela está livre, o endereço fica igual ao do
 * desenvolvimento — o que torna um relato de bug comparável entre os dois caminhos.
 */
export const PORTA_PREFERIDA = 2567;

/**
 * Verdadeiro se dá para ESCUTAR nessa porta neste host, agora.
 *
 * O teste é abrir e fechar um servidor de verdade. Não há como perguntar ao sistema "esta porta
 * está livre?" sem a corrida embutida: entre a pergunta e o `listen` de verdade alguém pode tomá-la.
 * Por isso quem chama tem de tratar `EADDRINUSE` no `listen` final mesmo assim — esta função
 * reduz a chance, não a elimina.
 */
export function portaLivre(porta: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const sonda = createServer();
    // `exclusive` desliga o compartilhamento de porta entre workers do Node: sem ele a sonda pode
    // "conseguir" escutar numa porta que outro processo do MESMO programa já usa, e o resultado
    // seria dizer que está livre quando não está.
    sonda.once('error', () => resolve(false));
    sonda.once('listening', () => sonda.close(() => resolve(true)));
    sonda.listen({ port: porta, host, exclusive: true });
  });
}

/**
 * Pede ao SISTEMA uma porta efêmera livre (porta 0) e devolve o número que ele deu.
 *
 * É o caminho sem corrida de verdade para "qualquer porta serve": o sistema operacional escolhe
 * entre as que ele sabe estarem livres. A janela entre fechar a sonda e escutar de verdade
 * continua existindo, mas o sistema evita reciclar uma porta recém-liberada, então na prática ela
 * não morde.
 */
export function portaEfemera(host = '0.0.0.0'): Promise<number> {
  return new Promise((resolve, reject) => {
    const sonda = createServer();
    sonda.once('error', reject);
    sonda.once('listening', () => {
      const info = sonda.address();
      const porta = typeof info === 'object' && info ? info.port : 0;
      sonda.close(() => (porta ? resolve(porta) : reject(new Error('sistema não devolveu porta'))));
    });
    sonda.listen({ port: 0, host, exclusive: true });
  });
}

/**
 * A porta em que o servidor embutido vai subir: a primeira preferida que estiver livre, ou uma
 * efêmera quando todas estiverem ocupadas.
 *
 * A lista de preferidas existe para o caso comum ser previsível (2567, depois 2568…), e o
 * `portaEfemera` existe para o caso extremo NUNCA virar um jogo que não abre.
 */
export async function escolherPorta(
  preferidas: readonly number[] = [PORTA_PREFERIDA, PORTA_PREFERIDA + 1, PORTA_PREFERIDA + 2],
  host = '0.0.0.0',
): Promise<number> {
  for (const porta of preferidas) if (await portaLivre(porta, host)) return porta;
  return portaEfemera(host);
}
