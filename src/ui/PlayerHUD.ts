import {attemptScore,type AttemptSummary} from '../run/AttemptSummary';
import {perkIcon} from './PerkIcons';
import {DamageFeedback} from './DamageFeedback';
import type {DamageContext} from '../core/contracts';
import type { PlayerMotor } from '../player/PlayerMotor';
import type { DualPistols } from '../combat/DualPistols';
import type { MPCharge } from '../combat/MPCharge';
import type { EnemyReview } from '../game/EnemyReview';
import { createSeed } from '../core/RunRNG';
/** Rótulos do detalhamento da pontuação, no `title` do bloco de score. */
const SCORE_LABEL={kills:'abate'} as const;
export class PlayerHUD {
  readonly element=document.createElement('div');
  private readonly gate: HTMLElement;
  private readonly hp: HTMLElement;
  private readonly charges: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly diagnostic: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly damage=new DamageFeedback();
  private readonly gateKey:(event:KeyboardEvent)=>void;private entered=false;private dead=false;private playActive=false;
  /** Controle acessível de pular a entrada; a cena liga o callback. */
  private readonly skipButton:HTMLButtonElement;
  onSkipIntro:(()=>void)|undefined;
  /** Texto de objetivo publicado pela cena; vazio devolve o rótulo padrão do modo. */
  private objective='';
  setObjective(text:string):void {this.objective=text;}
  constructor(private readonly start: () => void,private readonly farm=false,settings?:{volume:(value:number)=>void;quality:(balanced:boolean)=>void},private readonly mode:'expedition'|'horde'|'classic'='expedition') {
    this.element.id='player-hud';
    this.element.innerHTML=`<div class="field-brand"><span class="eyebrow">AGRO / EXTERMINATION DIVISION</span><strong>GUNSLINGER <span>01</span></strong></div>
      <div class="field-objective"><span>CAMPO DE TREINAMENTO</span><b>Calibre suas pistolas</b></div>
      <div class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="mp-resource" role="meter" aria-label="MP" aria-valuemin="0" aria-valuemax="100"><span>MP</span><div><i></i><em></em><em></em></div><b>100 / 100</b></div><div class="mp-meter" aria-label="Carga de habilidade"><div><i>I</i><i>II</i><i>III</i></div><small>SEGURE BOTÃO DIREITO</small></div>
      <div class="player-vitals"><span>EXTERMINADOR AGRÍCOLA</span><strong class="hp-value">130 / 130</strong><div class="hp-track"><i class="hp-lag"></i><i class="hp-current"></i></div><small>REGENERAÇÃO ATIVA</small></div>
      <div class="player-abilities"><span>ESQUIVA</span><div class="dodge-charges">◆ ◆</div><small>SHIFT · 2 CARGAS</small></div>
      <div class="field-diagnostic" role="status">Carregando personagem…</div>
      <div class="play-gate loading"><div class="gate-card"><span class="eyebrow">MUTANT FARM / CAMPO DE TESTES</span><h1>Pronto para<br>o campo.</h1><p>Explore a pista. Teste as duas pistolas, salte os obstáculos e atravesse os vãos com a esquiva.</p><div class="controls"><span><kbd>W A S D</kbd> Mover</span><span><kbd>MOUSE</kbd> Mirar</span><span><kbd>ESPAÇO</kbd> Saltar</span><span><kbd>SHIFT</kbd> Esquivar</span><span><kbd>CLIQUE</kbd> Disparar</span><span><kbd>R</kbd> Recarregar</span><span><kbd>ESC</kbd> Soltar cursor</span></div><button class="start-play" disabled>Preparando equipamento…</button><small>F1 abre as opções de diagnóstico.</small></div></div>`;
    this.element.insertAdjacentHTML('beforeend','<div class="player-damage-screen" aria-hidden="true"><div class="damage-direction"><i></i></div></div><div class="player-damage-number" role="status"></div>');
    document.body.append(this.element);const film=document.querySelector<HTMLVideoElement>('#boot-menu .loading-film')??document.createElement('video');if(!film.src&&!film.querySelector('source')){film.src='/ui/cosmic-descent-v2.mp4';film.poster='/ui/loading-poster-v2.jpg';film.autoplay=true;film.muted=true;film.loop=true;film.playsInline=true;film.className='loading-film';}this.element.querySelector('.play-gate')!.prepend(film);this.element.querySelector('.play-gate')!.insertAdjacentHTML('beforeend','<div class=loading-progress role=status><span class=loading-stage>CALIBRANDO A QUEDA</span><div class=loading-track><i></i></div><b>0%</b><small>Montando fazendas, rotas e ameaças…</small></div>');document.getElementById('boot-menu')?.remove();document.body.classList.add('game-menu-open');
    this.gate=this.element.querySelector('.play-gate')!;this.hp=this.element.querySelector('.hp-value')!;
    this.charges=this.element.querySelector('.dodge-charges')!;this.crosshair=this.element.querySelector('.crosshair')!;
    this.diagnostic=this.element.querySelector('.field-diagnostic')!;this.button=this.element.querySelector('.start-play')!;
    // Pular a entrada: botão real (clicável, focável por Tab, com rótulo) e atalho de teclado.
    // Fica em `document.body`, NÃO dentro de `#player-hud`: o HUD é `pointer-events:none` e some
    // inteiro sob `body.arrival-in-progress`, que é exatamente quando este controle precisa existir.
    this.skipButton=document.createElement('button');
    this.skipButton.className='intro-skip';this.skipButton.type='button';this.skipButton.hidden=true;
    this.skipButton.innerHTML='PULAR ENTRADA <kbd>ENTER</kbd>';
    this.skipButton.setAttribute('aria-label','Pular a entrada cinematográfica');
    document.body.append(this.skipButton);
    // Estilo é do Codex. Enquanto `.intro-skip` não tiver regra, um posicionamento mínimo mantém o
    // controle utilizável; havendo regra própria, nada é sobrescrito.
    if(typeof getComputedStyle==='function'&&getComputedStyle(this.skipButton).position==='static')
      this.skipButton.style.cssText='position:fixed;right:28px;bottom:28px;z-index:120;padding:10px 16px;font:inherit;font-size:11px;letter-spacing:.14em;color:#fff1ce;background:#0c1c28cc;border:1px solid #e4d6aa55;cursor:pointer';
    this.skipButton.onclick=()=>{this.skipIntro(false);this.onSkipIntro?.();};
    this.button.onclick=()=>{this.setActive(true);start();};
    this.gateKey=event=>{
      if(event.code!=='Enter'&&event.code!=='NumpadEnter')return;
      // Durante a entrada o Enter pula; no portão ele joga. Os dois estados nunca coexistem.
      if(!this.skipButton.hidden){event.preventDefault();this.skipButton.click();return;}
      if(!this.button.disabled&&!this.gate.hidden){event.preventDefault();this.button.click();}
    };window.addEventListener('keydown',this.gateKey);
    if(farm){this.element.classList.add('farm-hud');
      this.element.querySelector('.field-objective span')!.textContent=mode==='expedition'?'EXPEDIÇÃO':'EXPLORE A FAZENDA';
      this.element.querySelector('.gate-card .eyebrow')!.textContent='MUTANT FARM / ILHAS SUSPENSAS';
      this.element.querySelector('h1')!.innerHTML='A colheita<br>se revoltou.';
      // Texto do modo realmente ativo. O antigo prometia item no centro e chefe a cada cinco ondas.
      this.element.querySelector('.gate-card p')!.textContent=mode==='expedition'
        ?'Ative os quatro cálices da expedição e elimine frutas próximas para enchê-los de suco. Sair da área preserva o suco coletado. As pragas nunca param de chegar: concluir não depende de eliminar todas. Com os quatro marcos prontos, derrote a Praga Alfa e atravesse a fenda.'
        :mode==='horde'
        ?'Sobreviva a hordas cada vez mais fortes. Ao vencer cada onda, recolha o item que cai no campo para acumular poder. A cada cinco ondas, enfrente uma Praga Alfa.'
        :'Contenha a infestação até a Praga Alfa aparecer, derrote-a e atravesse a fenda para avançar de estágio.';
      this.element.querySelector('.controls')!.insertAdjacentHTML('beforeend','<span><kbd>DIREITO</kbd> Carregar habilidade</span><span><kbd>E</kbd> Ativar marco / abrir / recolher</span><span><kbd>W A S D</kbd> ×2 Arrancada</span><span><kbd>V</kbd> Corpo a corpo</span>');
    }
    if(farm)this.element.insertAdjacentHTML('beforeend','<div class="class-sigil"><img src="/ui/farm-mark.svg" alt="Divisão agrícola"></div><div class="weapon-readout"><span>PISTOLAS DUPLAS</span><b>50 / 50</b><small>R · RECARREGAR</small></div>');
    const options=document.createElement('div');options.className='game-options';options.innerHTML='<label>Som <input aria-label="Volume do som" type="range" min="0" max="100" value="55"></label>';
    options.querySelector<HTMLInputElement>('input[type=range]')!.oninput=e=>settings?.volume(Number((e.target as HTMLInputElement).value)/100);this.element.querySelector('.gate-card')!.append(options);
    const quality=document.createElement('label');quality.innerHTML='Visual <select aria-label="Qualidade visual"><option value="high">Alta · sombras e oclusão</option><option value="balanced">Equilibrada · mais fluidez</option></select>';quality.querySelector('select')!.onchange=e=>settings?.quality((e.target as HTMLSelectElement).value==='balanced');options.append(quality);
    const fresh=document.createElement('button');fresh.className='new-expedition';fresh.textContent='NOVA EXPEDIÇÃO';fresh.onclick=()=>{const url=new URL(location.href);url.searchParams.set('seed',createSeed());location.assign(url);};options.append(fresh);
    this.element.querySelector('.mp-meter')!.setAttribute('title','Segure o botão direito e solte: I · Leque ricocheteante (0,6 s), II · Barragem com mortal (1,4 s), III · Tempestade da colheita (2,6 s).');
  }
  /** Mostra ou esconde o controle de pular. Esconder também tira o foco do botão. */
  skipIntro(visible:boolean):void {
    if(this.skipButton.hidden===!visible)return;
    this.skipButton.hidden=!visible;
    if(!visible&&document.activeElement===this.skipButton)this.skipButton.blur();
  }
  liveFlightMenu(active:boolean,flight:boolean):void {this.gate.classList.toggle('live-flight',active||flight);document.body.classList.toggle('arrival-in-progress',active||flight);if(active)this.gate.querySelector<HTMLVideoElement>('video')?.pause();}
  arrivalReveal(active:boolean,reveal:number):void {
    if(this.gate.classList.contains('live-flight')){this.gate.hidden=this.playActive&&!this.dead;this.gate.classList.remove('launching');this.gate.style.removeProperty('opacity');return;}
    if(active&&reveal<1){this.gate.hidden=false;this.gate.classList.add('launching');this.gate.style.opacity=String(1-reveal);const film=this.gate.querySelector<HTMLVideoElement>('video');if(film?.paused)void film.play().catch(()=>{});}
    else if(this.gate.classList.contains('launching')){this.gate.classList.remove('launching');this.gate.style.removeProperty('opacity');this.gate.hidden=this.playActive&&!this.dead;this.gate.querySelector<HTMLVideoElement>('video')?.pause();}
  }
  hit(context:DamageContext,yaw:number,hp:number,maxHP:number):void {this.damage.hit(context.finalDamage,Math.min(1,(hp+context.finalDamage)/maxHP),context.forceDirection,yaw);}
  /** `true` depois de `ready()`: a barra não volta se um carregamento tardio chamar `loading`. */
  private loaded=false;
  loading(done:number,total:number,label:string):void {if(this.loaded)return;const progress=this.element.querySelector('.loading-progress') as HTMLElement;progress.hidden=false;(progress.querySelector('i') as HTMLElement).style.width=Math.floor(done/total*100)+'%';progress.querySelector('b')!.textContent=Math.floor(done/total*100)+'%';progress.querySelector('.loading-stage')!.textContent=label;this.gate.classList.add('loading');}
  ready(): void {this.loading(1,1,'ROTA PRONTA · EQUIPAMENTO PRONTO');this.gate.classList.remove('loading');
    // A barra terminada continuava desenhada a 100% por cima do menu pronto. `.loading` só escondia
    // os controles; o próprio bloco de progresso nunca saía.
    (this.element.querySelector('.loading-progress') as HTMLElement).hidden=true;this.loaded=true;
    this.button.disabled=false;this.button.textContent='PRESS START · JOGAR' ;this.diagnostic.textContent=this.farm?(this.mode==='expedition'?'Rota da expedição pronta · quatro marcos no mapa':'Siga o caminho até o celeiro'):'Pista pronta · Carregador de 50 balas';}
  fatalReaction(active:boolean,progress=0):void {this.element.classList.toggle('fatal-reaction',active);this.element.style.setProperty('--fatal-flash',String(Math.max(0,1-progress*14)));if(active){this.skipIntro(false);this.gate.hidden=true;this.button.disabled=true;}}
  defeated(summary:AttemptSummary,retry?:()=>void): void {
    this.skipIntro(false);this.fatalReaction(false);this.dead=true;this.gate.hidden=false;this.gate.classList.remove('loading');this.gate.classList.add('defeated');document.body.classList.add('game-menu-open');
    this.gate.querySelector<HTMLVideoElement>('video')?.pause();this.element.querySelector('.gate-card .eyebrow')!.textContent='EXPEDIÇÃO ENCERRADA';
    this.element.querySelector('h1')!.textContent='A última colheita.';
    const objectives=summary.objectives,expedition=objectives.mode==='expedition';
    const reached=expedition
      ?objectives.bossDefeated?'fenda atravessada'
        :objectives.phase==='rift'?'fenda aberta'
        :objectives.phase==='boss'?'diante da Praga Alfa'
        :`${objectives.completed??0} de ${objectives.total??0} marcos`
      :objectives.mode==='horde'?`horda ${summary.wave}`
      :objectives.bossDefeated?'Praga Alfa derrotada':'infestação em curso';
    this.element.querySelector('.gate-card p')!.textContent=`Você caiu. Sua história ficou no campo. Estágio ${summary.stage} · Nível ${summary.level} · ${reached}.`;
    this.gate.querySelector('.defeat-report')?.remove();
    const itemCount=summary.items.reduce((total,item)=>total+item.count,0);
    // Pontuação por marco efetivo da expedição; o modo horda legado continua somando hordas.
    const score=attemptScore(summary);
    const number=(value:number)=>value.toLocaleString('pt-BR');
    const milestones=expedition?`${objectives.completed??0} / ${objectives.total??0}`:number(summary.completedWaves);
    const rows:[string,string][]=[
      ['TEMPO VIVO',`${String(Math.floor(summary.time/60)).padStart(2,'0')}:${String(Math.floor(summary.time%60)).padStart(2,'0')}`],
      ['PRAGAS ABATIDAS',number(summary.kills)],
      ['ITENS COLETADOS',number(itemCount)],
      [score.progressLabel,milestones],
      ['ESTÁGIO ALCANÇADO',number(summary.stage)],
      ['CRÉDITOS RESTANTES',number(summary.credits)],
    ];
    const report=document.createElement('section');report.className='defeat-report';report.setAttribute('aria-label','Relatório da partida');
    const breakdown=[`${SCORE_LABEL.kills} ${number(score.kills)}`,`${expedition?'marco':'horda'} ${number(score.progress)}`,`item ${number(score.items)}`,`tempo ${number(score.time)}`]
      .concat(score.boss?[`Praga Alfa ${number(score.boss)}`]:[]).concat(score.stage?[`estágios ${number(score.stage)}`]:[]).join(' · ');
    report.innerHTML=`<div class="defeat-score" title="${breakdown}"><span>PONTUAÇÃO DA EXPEDIÇÃO</span><strong>${number(score.total)}</strong></div><dl>${rows.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
    this.gate.append(report);
    this.gate.querySelector('.defeat-items')?.remove();
    const items=document.createElement('section');items.className='defeat-items';items.tabIndex=0;items.setAttribute('aria-label','Itens da tentativa');
    items.innerHTML='<h2>SUA COLHEITA</h2><p>Melhorias coletadas nesta tentativa</p><div>'+summary.items.map(item=>`<article><i class="item-icon" style='${perkIcon(item.icon)}'></i><span>${item.name}</span><b>×${item.count}</b></article>`).join('')+'</div>'+(summary.items.length?'':'<p>Nenhum item coletado. Abra baús e recolha as recompensas das hordas para ganhar poder.</p>');this.gate.append(items);
    this.button.disabled=false;this.button.textContent='RENASCER';
    this.gate.querySelector('.return-menu')?.remove();const menu=document.createElement('button');menu.className='return-menu';menu.textContent='VOLTAR AO MENU';this.button.after(menu);
    const leave=(play:boolean)=>{
      if(!retry){location.reload();return;}
      retry();this.dead=false;this.entered=false;this.gate.classList.remove('defeated');items.remove();menu.remove();report.remove();
      this.damage.flash=0;this.damage.hold=0;this.damage.amount=0;this.damage.trail=1;
      this.element.querySelector('.gate-card .eyebrow')!.textContent='MUTANT FARM / ILHAS SUSPENSAS';this.element.querySelector('h1')!.textContent='A colheita se revoltou.';
      this.element.querySelector('.gate-card p')!.textContent=this.mode==='expedition'?'Explore as ilhas, ative os quatro cálices e encha-os com o suco das frutas derrotadas. Depois, enfrente a Praga Alfa.':'Sobreviva às hordas, recolha itens e explore os campos.';
      this.button.textContent='PRESS START · JOGAR';this.button.onclick=()=>{this.setActive(true);this.start();};this.setActive(play);if(play)this.start();
    };
    this.button.onclick=()=>leave(true);menu.onclick=()=>leave(false);
  }

  setActive(active: boolean): void {this.playActive=active;const film=this.gate.querySelector<HTMLVideoElement>('video');if(active)film?.pause();else if(film)void film.play().catch(()=>{});document.body.classList.toggle('game-menu-open',!active);this.gate.hidden=active;if(active)this.entered=true;else if(this.entered&&!this.dead){this.element.querySelector('h1')!.textContent='Campo pausado.';this.button.textContent='CONTINUAR EXPEDIÇÃO →';}}
  update(player: PlayerMotor,pistols: DualPistols,error: string,mp: MPCharge,enemies:Pick<EnemyReview,'count'|'kills'|'status'>,dt=1/60): void {
    const ammo=this.element.querySelector('.weapon-readout b');if(ammo){ammo.textContent=pistols.magazine.ammo+' / '+pistols.magazine.capacity;this.element.querySelector('.weapon-readout small')!.textContent=pistols.magazine.reloading?'RECARREGANDO · '+Math.round(pistols.magazine.progress*100)+'%':'R · RECARREGAR';}
    const resource=this.element.querySelector('.mp-resource')!;resource.setAttribute('aria-valuenow',String(Math.round(mp.current)));(resource.querySelector('i') as HTMLElement).style.width=mp.current+'%';resource.querySelector('b')!.textContent=Math.floor(mp.current)+' / 100';resource.classList.toggle('mp-low',mp.current<25);
    this.hp.textContent=`${Math.ceil(player.hp)} / ${player.maxHP}`;
    (this.element.querySelector('.hp-current') as HTMLElement).style.width=`${player.hp/player.maxHP*100}%`;
    this.damage.update(dt,player.hp/player.maxHP);
    (this.element.querySelector('.hp-lag') as HTMLElement).style.width=this.damage.trail*100+'%';
    const screen=this.element.querySelector('.player-damage-screen') as HTMLElement;screen.style.opacity=String(Math.min(.9,this.damage.flash*2)+(player.hp/player.maxHP<.25?.12:0));
    (screen.querySelector('.damage-direction') as HTMLElement).style.transform='rotate('+this.damage.angle+'rad)';
    const loss=this.element.querySelector('.player-damage-number') as HTMLElement;loss.textContent=this.damage.flash>0?'−'+this.damage.amount+' HP':'';loss.style.opacity=String(Math.min(1,this.damage.flash*3));
    this.element.querySelector('.player-vitals')!.classList.toggle('taking-damage',this.damage.flash>0);
    this.element.querySelector('.player-vitals small')!.textContent=player.regenerationDelay>0?'SOB ATAQUE':player.hp/player.maxHP<.25?'VIDA CRÍTICA':'REGENERAÇÃO ATIVA';
    this.element.querySelector('.player-abilities small')!.textContent=player.sprinting?'CORRENDO · TIRO/PARAR INTERROMPE':'SHIFT · ROLAR E CORRER';
    this.charges.textContent='◆ '.repeat(player.charges)+'◇ '.repeat(2-player.charges);
    this.crosshair.classList.toggle('hit',pistols.hitTime>0);
    const distance=Math.hypot(player.position.x,player.position.z-29);
    this.element.querySelector('.field-objective b')!.textContent=this.objective||(this.farm?(distance<5?'Celeiro alcançado':`Chegue ao celeiro · ${Math.round(distance)} m`):`${enemies.count} espécimes · ${enemies.kills} abatidos`);
    this.element.querySelector('.field-objective')!.setAttribute('title',`${enemies.status}${this.farm?'':' · Espécimes de treino voltam após 8 segundos.'}`);
    this.element.querySelectorAll('.mp-meter i').forEach((segment,index)=>segment.classList.toggle('charged',mp.tier>index));
    this.element.querySelector('.mp-meter small')!.textContent=pistols.stormRemaining>0?'TEMPESTADE DA COLHEITA':mp.held&&mp.current<25?'MP INSUFICIENTE':mp.held?['CARREGANDO','LEQUE RICOCHETEANTE','BARRAGEM COM MORTAL','TEMPESTADE DA COLHEITA'][mp.tier]!:'SEGURE BOTÃO DIREITO';
    if(error){this.diagnostic.textContent=`Falha ao carregar personagem: ${error}`;this.button.textContent='Recarregue a página para tentar novamente';}
    else if(pistols.cadence.shots+pistols.skillShots>0)this.diagnostic.textContent=`${pistols.hits} acertos · ${pistols.cadence.shots+pistols.skillShots} disparos · ${mp.releases} habilidades`;
  }
  dispose(): void {window.removeEventListener('keydown',this.gateKey);this.onSkipIntro=undefined;this.skipButton.remove();document.body.classList.remove('game-menu-open','arrival-in-progress');this.element.remove();}
}
