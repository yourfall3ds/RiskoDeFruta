/**
 * ROBÔS VISÍVEIS: jogadores de teste que entram NA SUA SALA e que você VÊ no jogo.
 *
 * Todo teste de co-op tem de ser auditável por quem joga. Estes robôs não rodam escondidos: entram
 * pela mesma semente que você abriu (`?online=1&seed=casa`), aparecem como jogadores na sua tela,
 * andam em círculo, pulam e atiram no inimigo vivo mais próximo pelo MESMO caminho do jogo — o
 * aviso de disparo (`shot`, que desenha o rastro na sua tela) e o pedido de acerto (`hit`, que o
 * servidor valida e aplica). O que eles fazem aparece também no painel: http://<ip>:2567/painel
 *
 * Uso:  npx tsx --tsconfig server/tsconfig.json scripts/robos-visiveis.ts <semente> [quantos=1] [classe=soldier] [segundos=300]
 *
 * Entre na sala primeiro (lobby), depois rode isto: os robôs dão PRONTO e esperam você.
 */
import { Client, type Room } from '@colyseus/sdk';
import { NetInput, BUTTON } from '../src/net/NetInput';
import type { FarmState } from '../server/schema';

const [, , seed, quantos = '1', classe = 'soldier', segundos = '300', servidor = 'ws://127.0.0.1:2567'] = process.argv;
if (!seed) { console.error('uso: robos-visiveis.ts <semente> [quantos] [classe] [segundos]'); process.exit(1); }
const arma = classe === 'soldier' ? { weapon: 'prism', source: 'prism_assault', base: 7, rate: 9 }
  : classe === 'marijuano' ? { weapon: 'smg', source: 'silk_smg', base: 5.5, rate: 11 }
  : { weapon: 'pistols', source: 'dual_pistols', base: 12, rate: 3.3 };
const diga = (...p: unknown[]) => console.log('[robôs]', ...p);

async function robo(indice: number): Promise<void> {
  const sala: Room<FarmState> = await new Client(servidor).joinOrCreate<FarmState>('farm', { seed, name: `ROBÔ ${indice + 1}` });
  sala.onMessage('*', () => {});
  let largou = false; sala.onMessage('runStarted', () => { largou = true; diga(`robô ${indice + 1}: a corrida largou`); });
  sala.send('chooseClass', { classId: classe });
  sala.send('setReady', { ready: true });
  diga(`robô ${indice + 1} entrou na sala ${sala.roomId} como ${classe} e deu PRONTO — esperando você`);

  const entrada = sala.input({ type: NetInput });
  let seq = 0, passo = 0, tiros = 0, relogioTiro = 0;
  const fim = Date.now() + Number(segundos) * 1000;
  await new Promise<void>(resolve => {
    const loop = setInterval(() => {
      if (Date.now() > fim) { clearInterval(loop); resolve(); return; }
      seq++; passo++;
      const st: any = sala.state, eu = st?.players?.get(sala.sessionId);
      // Círculo lento com um pulo a cada ~3 s: movimento e animação fáceis de ver.
      const ang = passo / 120 + indice * 2;
      let yaw = ang + Math.PI / 2, buttons = passo % 180 === 0 ? BUTTON.JUMP : 0;
      if (largou && eu && eu.hp > 0) {
        let alvo: any, melhor = 60;
        st.enemies.forEach((e: any) => { if (!e.alive) return; const d = Math.hypot(e.x - eu.x, e.z - eu.z); if (d < melhor) { melhor = d; alvo = e; } });
        if (alvo) {
          yaw = Math.atan2(alvo.x - eu.x, alvo.z - eu.z);
          relogioTiro += 1 / 60;
          if (relogioTiro >= 1 / arma.rate) {
            relogioTiro = 0; tiros++;
            const de = { x: eu.x, y: eu.y + 1.4, z: eu.z }, ate = { x: alvo.x, y: alvo.y + 1, z: alvo.z };
            sala.send('shot', { weapon: arma.weapon, mode: 0, from: de, to: ate });
            sala.send('hit', { enemy: alvo.id, base: arma.base, tags: ['bullet'], source: arma.source, attack: `robo${indice}#${tiros}`, weak: false, proc: 0, point: ate, force: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, forceMagnitude: 2 });
          }
        }
      }
      Object.assign(entrada.data, { x: 0, z: largou ? 1 : 0, yaw, pitch: 0, buttons, interactOption: 0, seq });
      entrada.send();
      if (passo % 600 === 0 && eu) diga(`robô ${indice + 1}: vida ${Math.round(eu.hp)} · tiros ${tiros} · pos ${eu.x.toFixed(1)},${eu.z.toFixed(1)}`);
    }, 1000 / 60);
  });
  diga(`robô ${indice + 1} saindo (${tiros} tiros)`);
  await sala.leave(true);
}

await Promise.all(Array.from({ length: Number(quantos) }, (_, i) => robo(i)));
process.exit(0);
