/**
 * O PAINEL DE AUDITORIA — `http://<ip>:2567/painel`.
 *
 * Tudo o que se afirma sobre o co-op tem de ser VISÍVEL para quem joga, não só um "passou" no
 * terminal. A página lê `/painel.json` a cada segundo e mostra, por sala, o que o servidor está
 * fazendo de verdade: fase, ticks por segundo, horda, e por jogador as entradas que CHEGARAM, os
 * passos sem entrada, fila, vida, posição e os pedidos de acerto recusados (com o motivo).
 *
 * Como ler: "entradas/s" perto de 60 = o jogo daquele PC está mandando o movimento; 0 = o passo
 * dele está parado (o F1 dele diz por quê). "ticks/s" perto de 60 = o servidor em dia.
 */
export const PAINEL_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel do Co-op</title>
<style>
:root{--bg:#0f1210;--card:#171c18;--line:#2a322c;--text:#e8efe9;--dim:#8a998d;--ok:#5fd07a;--warn:#f0c04a;--bad:#ff6b5e;--accent:#9be15d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,Segoe UI,sans-serif;padding:20px}
h1{font-size:20px;margin:0 0 4px}p.sub{color:var(--dim);margin:0 0 18px}
.room{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:16px}
.head{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:baseline;margin-bottom:10px}
.head b{font-size:16px}.tag{padding:2px 8px;border-radius:99px;background:#223026;color:var(--accent);font-size:12px}
.k{color:var(--dim)}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:6px 8px;border-top:1px solid var(--line);white-space:nowrap}th{color:var(--dim);font-weight:500}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.empty{color:var(--dim);padding:30px;text-align:center}
.legend{color:var(--dim);font-size:12px;margin-top:18px;max-width:900px}
</style></head><body>
<h1>Painel do Co-op</h1><p class="sub">Atualiza sozinho a cada segundo · <span id="clock">—</span></p>
<div id="rooms"><div class="empty">carregando…</div></div>
<div class="legend"><b>Como ler.</b> <b>ticks/s</b> ≈ 60 = servidor em dia. <b>entradas/s</b> ≈ 60 = o PC daquele jogador está mandando o movimento; 0 = o passo dele está parado (o F1 dele diz o motivo). <b>sem entrada/s</b> alto = pacotes não chegam. <b>PC: passo</b> = o que o jogo daquele PC relata: rodando, ou PARADO e o motivo. <b>PC: fps</b> = quadros por segundo naquele PC. <b>fila</b> > 3 = entradas acumulando. <b>recusados</b> = pedidos de acerto que o servidor negou, com o motivo (ponto longe, fonte desconhecida, atirador morto…).</div>
<script>
const cls=(v,good,warn)=>v>=good?'ok':v>=warn?'warn':'bad';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function tick(){
  try{
    const rooms=await (await fetch('/painel.json',{cache:'no-store'})).json();
    document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR');
    const el=document.getElementById('rooms');
    if(!rooms.length){el.innerHTML='<div class="empty">nenhuma sala aberta</div>';return;}
    el.innerHTML=rooms.map(r=>{
      const rej=Object.entries(r.rejectedHits).map(([k,v])=>k+' '+v).join(' · ')||'nenhum';
      const playing=r.phase==='jogando';
      const rows=r.players.map(p=>'<tr><td>P'+p.entityId+' '+esc(p.name)+'</td><td>'+esc(p.classId)+'</td>'
        +'<td class="'+(p.hp>0?'ok':'bad')+'">'+p.hp+'/'+p.maxHP+'</td>'
        +'<td class="'+(playing?cls(p.inputsPerSecond,50,20):'')+'">'+p.inputsPerSecond+'</td>'
        +'<td class="'+(playing?(p.starvedPerSecond>20?'bad':p.starvedPerSecond>5?'warn':'ok'):'')+'">'+p.starvedPerSecond+'</td>'
        +'<td class="'+(p.queue>3?'warn':'')+'">'+p.queue+'</td><td>'+p.staleSeq+'</td><td>'+p.ping+' ms</td>'
        +'<td>'+p.x+', '+p.y+', '+p.z+'</td><td>'+(p.grounded?'sim':'no ar')+'</td><td>'+p.hits+'</td>'
        +'<td class="'+(p.step==='rodando'?'ok':p.step==='sem relato'?'':'bad')+'">'+esc(p.step)+'</td>'
        +'<td class="'+(p.hidden?'':p.fps?cls(p.fps,55,30):'')+'">'+(p.fps||'—')+(p.hidden?' <span class="k">(aba em 2º plano)</span>':'')+'</td>'
        +'<td>'+(p.meshes?p.activeMeshes+' / '+p.meshes:'—')+'</td><td class="k">'+esc(p.gpu||'—')+'</td><td class="warn">'+esc(p.cost||'—')+'</td>'
        +'<td>'+(p.loading?'<span class="warn">carregando</span>':p.ready?'pronto':'—')+'</td></tr>').join('');
      return '<div class="room"><div class="head"><b>'+esc(r.seed)+'</b><span class="tag">'+esc(r.phase)+'</span>'
        +'<span><span class="k">mapa</span> '+esc(r.map)+'</span>'
        +'<span><span class="k">ticks/s</span> <span class="'+cls(r.ticksPerSecond,55,40)+'">'+r.ticksPerSecond+'</span></span>'
        +'<span><span class="k">inimigos</span> '+r.enemiesAlive+' vivos / '+r.enemies+'</span>'
        +(r.loading?'<span class="warn">esperando '+r.loading+' carregar</span>':'')
        +'<span><span class="k">recusados</span> '+esc(rej)+'</span></div>'
        +'<table><tr><th>jogador</th><th>classe</th><th>vida</th><th>entradas/s</th><th>sem entrada/s</th><th>fila</th><th>seq velho</th><th>ping</th><th>posição</th><th>chão</th><th>acertos</th><th>PC: passo</th><th>PC: fps</th><th>PC: malhas ativas/total</th><th>PC: placa</th><th>PC: trechos mais caros por quadro</th><th>estado</th></tr>'+rows+'</table></div>';
    }).join('');
  }catch(e){document.getElementById('rooms').innerHTML='<div class="empty bad">servidor não respondeu</div>';}
}
tick();setInterval(tick,1000);
</script></body></html>`;
