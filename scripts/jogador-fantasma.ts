/**
 * UM SEGUNDO JOGADOR DE VERDADE, SEM PLACA DE VÍDEO.
 *
 * Esta máquina não aguenta duas instâncias do jogo: dois contextos Babylon na mesma GPU travam o
 * navegador — medido, a segunda aba emperra e o painel do navegador cai junto. Mas o companheiro
 * não precisa de gráficos para ser um companheiro: precisa de uma CONEXÃO, de um `PlayerState` e de
 * entrada. Então este processo entra na MESMA sala pelo MESMO SDK do jogo, escolhe personagem, fica
 * pronto, anda e atira. Quem prova que funciona é a OUTRA ponta: o navegador tem de ver a vaga
 * preencher, o nome aparecer e o boneco se mexer.
 *
 * ## O erro que este arquivo existe para não repetir
 *
 * A primeira versão mandava a entrada por `room.send('input', …)`. A entrada NÃO é uma mensagem
 * comum: ela vai pelo canal dedicado do netcode (`defineInput`, com buffer por cliente e campo de
 * sequência). Mandar um tipo não registrado fez o servidor DERRUBAR o cliente — e o mais traiçoeiro
 * é que o processo caído continuava imprimindo "andando", porque o estado local dele nunca soube da
 * queda. Por isso este arquivo é TypeScript e importa o `NetInput` do projeto: para falar a mesma
 * língua, e não uma parecida.
 *
 * Uso:  npx tsx scripts/jogador-fantasma.ts <roomId> [nome] [segundos] [andar|parado]
 *
 * `parado` fica no assento, de frente para +z, sem atirar — a Fase 1 do Test Map (dois jogadores
 * lado a lado). A cada 2 s ele informa o próprio ping (como o jogo faz) e diz o elenco que VÊ: é a
 * prova, deste lado, de que ele enxerga o outro jogador onde o outro está.
 */
import { Client } from '@colyseus/sdk';
import { NetInput, BUTTON } from '../src/net/NetInput';
import type { FarmState } from '../server/schema';

const [, , roomId, nome = 'FANTASMA', segundos = '240', modo = 'andar'] = process.argv;
if (!roomId) { console.error('falta o roomId'); process.exit(1); }
const parado = modo === 'parado';

const diga = (...partes: unknown[]) => console.log('[fantasma]', ...partes);

const client = new Client('ws://127.0.0.1:2567');
const sala = await client.joinById<FarmState>(roomId, { name: nome });
diga('entrei', JSON.stringify({ sessao: sala.sessionId, sala: sala.roomId }));

// A boas-vindas é uma mensagem como outra qualquer; sem um ouvinte o SDK reclama no terminal.
sala.onMessage('welcome', () => diga('recebi a boas-vindas'));
sala.onMessage('runStarting', () => diga('a contagem começou'));
sala.onMessage('runStarted', () => diga('A CORRIDA LARGOU'));

sala.send('chooseClass', { classId: 'gunslinger' });
sala.send('setReady', { ready: true });
diga('escolhi pistoleiro e dei PRONTO');

/** O canal de entrada do netcode — o MESMO que o jogo usa. */
const entrada = sala.input({ type: NetInput });

let seq = 0, passo = 0;
const fim = Date.now() + Number(segundos) * 1000;
const relogio = setInterval(() => {
  if (Date.now() > fim) {
    clearInterval(relogio);
    const meu = sala.state?.players?.get?.(sala.sessionId);
    diga('saindo', JSON.stringify({ x: meu?.x?.toFixed(2), z: meu?.z?.toFixed(2), vida: meu?.hp, municao: meu?.ammo }));
    void sala.leave(true).then(() => process.exit(0), () => process.exit(0));
    return;
  }
  // Um quadrado, atirando na segunda metade de cada volta: movimento visível e munição caindo.
  // Parado, a entrada continua saindo (zerada): é o eco dela que mede o ping.
  const lado = Math.floor(passo / 90) % 4;
  const passos: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const [x, z] = parado ? [0, 0] : passos[lado]!;
  entrada.data.x = x; entrada.data.z = z;
  entrada.data.yaw = parado ? 0 : Math.atan2(x, z); entrada.data.pitch = 0;
  entrada.data.buttons = !parado && passo % 180 > 90 ? BUTTON.FIRE : 0;
  entrada.data.interactOption = 0; entrada.data.seq = ++seq;
  entrada.send();
  passo++;
  if (passo % 120 === 0) {
    // O ping, como o jogo informa (`NetworkClient`): só depois da primeira medida.
    const ms = sala.clock.smoothedRtt();
    if (ms > 0) sala.send('rtt', { ms: Math.round(ms) });
    // O elenco que ESTE cliente vê — número, nome, posição, vida e ping de cada um.
    const vistos: string[] = [];
    sala.state?.players?.forEach(p => { vistos.push(`P${p.entityId} ${p.name} (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) vida ${p.hp} ping ${p.ping}`); });
    diga(parado ? 'parado, vendo' : 'andando, vendo', JSON.stringify({ fase: sala.state?.phase, vistos }));
  }
}, 1000 / 60);
