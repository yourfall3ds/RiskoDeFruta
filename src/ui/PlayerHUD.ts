import {attemptScore,type AttemptSummary} from '../run/AttemptSummary';
import {perkIcon} from './PerkIcons';
import {DamageFeedback} from './DamageFeedback';
import type {DamageContext} from '../core/contracts';
import type { PlayerMotor } from '../player/PlayerMotor';
import type { DualPistols } from '../combat/DualPistols';
import type { MPCharge } from '../combat/MPCharge';
import type { EnemyReview } from '../game/EnemyReview';
import { createSeed } from '../core/RunRNG';
import { weaponReadout,type WeaponReadoutView } from './WeaponReadout';
import { ClassSelect } from './ClassSelect';
import { MenuShell } from './MenuShell';
import { DEFAULT_PLAYER_CLASS,type PlayerClassId } from '../run/PlayerClass';

/**
 * A porta da escolha de classe, do ponto de vista do menu.
 *
 * `initial` é a classe já persistida (ver `PlayerClassChoice`) e `choose` avisa a cena, que é quem
 * reequipa. Ausente = cena sem seleção (pátio de treino), e o menu não desenha o bloco.
 */
export interface ClassPicker {
  readonly initial: PlayerClassId;
  choose(id: PlayerClassId): void;
}
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
  /** Cartão da transição de estágio. Criado no construtor, vive fora de `#player-hud`. */
  private readonly journeyCard!:HTMLElement;
  private journeyKey='';
  /**
   * Publica a conclusão do estágio: etapa, destino, detalhe (incluindo erro de carregamento com a
   * contagem da nova tentativa) e a barra de andamento. Só escreve no DOM quando o texto muda.
   */
  stageJourney(journey:{active:boolean;label:string;detail:string;destination:string;progress:number;failed:boolean}):void {
    const card=this.journeyCard;
    if(!card)return;
    if(!journey.active){if(!card.hidden){card.hidden=true;this.journeyKey='';}return;}
    card.hidden=false;
    const percent=`${Math.round(Math.max(0,Math.min(1,journey.progress))*1000)/10}%`;
    const key=`${journey.label}|${journey.destination}|${journey.detail}|${percent}|${journey.failed}`;
    if(key===this.journeyKey)return;
    this.journeyKey=key;
    card.classList.toggle('journey-failed',journey.failed);
    card.querySelector('.stage-journey-step')!.textContent=journey.label;
    card.querySelector('.stage-journey-destination')!.textContent=journey.destination;
    card.querySelector('.stage-journey-detail')!.textContent=journey.detail;
    (card.querySelector('.stage-journey-track i') as HTMLElement).style.width=percent;
  }
  /** Seleção de classe do menu. `undefined` quando a cena não oferece escolha (treino). */
  private readonly classSelect:ClassSelect|undefined;
  /** Composição do menu em telas (raiz / personagem / opções). Ausente no campo de testes. */
  private menu:MenuShell|undefined;
  /** A classe realmente em vigor; o painel de arma e a barra de carga falam por ela. */
  private playerClass:PlayerClassId=DEFAULT_PLAYER_CLASS;
  constructor(private readonly start: () => void,private readonly farm=false,settings?:{volume:(value:number)=>void;quality:(balanced:boolean)=>void},private readonly mode:'expedition'|'horde'|'classic'='expedition',classPicker?:ClassPicker) {
    this.element.id='player-hud';
    this.element.innerHTML=`<div class="field-brand"><span class="eyebrow">AGRO / EXTERMINATION DIVISION</span><strong>GUNSLINGER <span>01</span></strong></div>
      <div class="field-objective"><span>CAMPO DE TREINAMENTO</span><b>Calibre suas pistolas</b></div>
      <div class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="mp-resource" role="meter" aria-label="MP" aria-valuemin="0" aria-valuemax="100"><span>MP</span><div><i></i><em></em><em></em></div><b>100 / 100</b></div><div class="mp-meter" aria-label="Carga de habilidade"><div><i>I</i><i>II</i><i>III</i></div><small>SEGURE Q</small></div>
      <div class="player-vitals"><span>EXTERMINADOR AGRÍCOLA</span><strong class="hp-value">130 / 130</strong><div class="hp-track"><i class="hp-lag"></i><i class="hp-current"></i></div><small>REGENERAÇÃO ATIVA</small></div>
      <div class="player-abilities"><span>ESQUIVA</span><div class="dodge-charges">◆ ◆</div><small>SHIFT · 2 CARGAS</small></div>
      <div class="field-diagnostic" role="status">Carregando personagem…</div>
      <div class="play-gate loading"><div class="gate-card"><span class="eyebrow">MUTANT FARM / CAMPO DE TESTES</span><h1>Pronto para<br>o campo.</h1><p>Explore a pista. Teste as duas pistolas, salte os obstáculos e atravesse os vãos com a esquiva.</p><div class="controls"><span><kbd>W A S D</kbd> Mover</span><span><kbd>MOUSE</kbd> Mirar</span><span><kbd>ESPAÇO</kbd> Saltar</span><span><kbd>SHIFT</kbd> Esquivar</span><span><kbd>CLIQUE</kbd> Disparar</span><span><kbd>DIREITO</kbd> Mirar</span><span><kbd>Q</kbd> Carregar e soltar habilidade</span><span><kbd>R</kbd> Recarregar</span><span><kbd>ESC</kbd> Soltar cursor</span></div><button class="start-play" disabled>Preparando equipamento…</button><small>F1 abre as opções de diagnóstico.</small></div></div>`;
    this.element.insertAdjacentHTML('beforeend','<div class="player-damage-screen" aria-hidden="true"><div class="damage-direction"><i></i></div></div><div class="player-damage-number" role="status"></div>');
    // Cartão da conclusão do estágio: suco recolhido → embarque → viagem → chegada.
    // Fica em `document.body` e não no HUD porque o HUD inteiro some sob `body.arrival-in-progress`,
    // que é exatamente quando a chegada precisa continuar legível.
    this.journeyCard=document.createElement('section');
    this.journeyCard.className='stage-journey';this.journeyCard.hidden=true;
    this.journeyCard.setAttribute('role','status');this.journeyCard.setAttribute('aria-live','polite');
    this.journeyCard.innerHTML='<small class="stage-journey-step"></small><b class="stage-journey-destination"></b><span class="stage-journey-detail"></span><div class="stage-journey-track"><i></i></div>';
    document.body.append(this.journeyCard);
    document.body.append(this.element);const film=document.querySelector<HTMLVideoElement>('#boot-menu .loading-film')??document.createElement('video');if(!film.src&&!film.querySelector('source')){film.src='/ui/cosmic-descent-v2.mp4';film.poster='/ui/loading-poster-v2.jpg';film.autoplay=true;film.muted=true;film.loop=true;film.playsInline=true;film.className='loading-film';}this.element.querySelector('.play-gate')!.prepend(film);this.element.querySelector('.play-gate')!.insertAdjacentHTML('beforeend',/**
     * Tela de carregamento: logo, barra e o corredor.
     *
     * O `.rdf-runner` é o bichinho que corre sobre a barra enquanto o mundo é montado, na
     * tradição de Risk of Rain. Ele não é enfeite: numa montagem que leva dezenas de segundos e
     * trava em passos longos, a porcentagem sozinha parece congelada. Um movimento contínuo, que
     * NÃO depende do progresso, é o que diz "o jogo está vivo" quando o número não muda.
     */
    '<div class=loading-progress role=status>'
      +'<img class=rdf-loading-logo src="/ui/logo-rdf.png" alt="Risco de Fruta" decoding=async>'
      +'<span class=loading-stage>CALIBRANDO A QUEDA</span>'
      // O corredor é `<span>`, e não `<b>` nem `<i>`: `loading()` resolve a barra por
      // `querySelector('i')` e a porcentagem por `querySelector('b')`, então qualquer uma dessas
      // duas etiquetas aqui sequestraria a consulta e quebraria o carregamento.
      +'<div class=loading-track><i></i><span class=rdf-runner aria-hidden=true></span></div>'
      +'<b>0%</b><small>Montando fazendas, rotas e ameaças…</small></div>');document.getElementById('boot-menu')?.remove();document.body.classList.add('game-menu-open');
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
      // O sobretítulo ("MUTANT FARM / ILHAS SUSPENSAS") saiu: era a legenda de um cabeçalho de
      // site em cima do título do próprio jogo, repetindo o que o título já diz.
      (this.element.querySelector('.gate-card .eyebrow') as HTMLElement|null)?.remove();
      this.element.querySelector('h1')!.innerHTML='A colheita<br>se revoltou.';
      /**
       * Texto do modo realmente ativo, em UMA linha.
       *
       * As versões anteriores explicavam a expedição inteira aqui — cálice, horda, chefe, suco,
       * embarque e itens — em três linhas de parágrafo. Menu de jogo não é manual: o que ele
       * precisa entregar é o VERBO do modo, e o resto o jogador descobre jogando (e já está
       * escrito na rota da expedição, dentro da partida, onde é acionável).
       */
      this.element.querySelector('.gate-card p')!.textContent=mode==='expedition'
        ?'Ache o cálice. Encha. Derrote a Praga Alfa. Embarque.'
        :mode==='horde'
        ?'Sobreviva às hordas. Colha o que cai. A Praga Alfa vem a cada cinco.'
        :'Contenha a infestação, derrote a Praga Alfa e atravesse a fenda.';
      // Sem `B` e sem `T`: a arma é a da CLASSE escolhida no menu e não troca dentro da expedição.
      this.element.querySelector('.controls')!.insertAdjacentHTML('beforeend','<span><kbd>DIREITO</kbd> Mira apurada · luneta no sniper</span><span><kbd>RODA</kbd> Zoom da luneta</span><span><kbd>E</kbd> Ativar cálice / abrir / recolher</span><span><kbd>W A S D</kbd> ×2 Arrancada</span><span><kbd>V</kbd> Corpo a corpo</span><span><kbd>Q</kbd> Soldado: I transforma a PRISM · II e III por forma</span>');
    }
    if(farm)this.element.insertAdjacentHTML('beforeend','<div class="class-sigil"><img src="/ui/farm-mark.svg" alt="Divisão agrícola"></div><div class="weapon-readout"><span>PISTOLAS DUPLAS</span><b>50 / 50</b><small>R · RECARREGAR</small></div>');
    const options=document.createElement('div');options.className='game-options';options.innerHTML='<label>Som <input aria-label="Volume do som" type="range" min="0" max="100" value="55"></label>';
    options.querySelector<HTMLInputElement>('input[type=range]')!.oninput=e=>settings?.volume(Number((e.target as HTMLInputElement).value)/100);this.element.querySelector('.gate-card')!.append(options);
    const quality=document.createElement('label');quality.innerHTML='Visual <select aria-label="Qualidade visual"><option value="high">Alta · sombras e oclusão</option><option value="balanced">Equilibrada · mais fluidez</option></select>';quality.querySelector('select')!.onchange=e=>settings?.quality((e.target as HTMLSelectElement).value==='balanced');options.append(quality);
    const fresh=document.createElement('button');fresh.className='new-expedition';fresh.textContent='NOVA EXPEDIÇÃO';fresh.onclick=()=>{const url=new URL(location.href);url.searchParams.set('seed',createSeed());location.assign(url);};options.append(fresh);
    this.element.querySelector('.mp-meter')!.setAttribute('title','Segure Q e solte: I em 0,6 s, II em 1,4 s, III em 2,6 s. O que sai depende da CLASSE — e, no soldado, da forma da PRISM que está nas mãos.');
    // A escolha de classe entra ANTES das opções de som/visual: é a primeira decisão da expedição.
    if(classPicker){
      this.playerClass=classPicker.initial;
      this.classSelect=new ClassSelect(classPicker.initial,id=>{this.playerClass=id;classPicker.choose(id);});
      this.element.querySelector('.gate-card .controls')!.after(this.classSelect.element);
      const controls=this.element.querySelector('.gate-card .controls')!;
      const help=document.createElement('details');help.className='class-controls-help';
      const summary=document.createElement('summary');summary.textContent='VER CONTROLES';
      help.append(summary,controls);this.element.querySelector('.gate-card')!.append(help);
      this.syncClassSelect();
    }
    /**
     * Compõe o menu em telas.
     *
     * Feito DEPOIS de tudo acima porque o shell reposiciona nós que os blocos anteriores acabaram
     * de criar. Nada é recriado — ver `MenuShell` —, então as referências guardadas aqui
     * (`this.button`, `this.classSelect`) continuam apontando para os mesmos elementos.
     */
    const card=this.element.querySelector('.gate-card') as HTMLElement|null;
    if(card)this.menu=new MenuShell(card,{
      title:card.querySelector('h1'),
      tagline:card.querySelector('p'),
      play:this.button,
      classSelect:this.classSelect?.element??null,
      options:card.querySelector('.game-options'),
      controlsHelp:card.querySelector('.class-controls-help'),
      // `:scope >` e não `small` solto: existem `<small>` dentro dos controles e do cartão de
      // classe, e pegar o primeiro da árvore movia o elemento errado para a tela de opções.
      notes:[card.querySelector<HTMLElement>(':scope > small')],
    });
  }

  /**
   * Destranca a escolha SÓ no menu de verdade.
   *
   * `entered` é "esta tentativa já começou" e `dead` é "o relatório de derrota está na tela". Nos
   * dois casos mudar de classe seria trocar de arma no meio de uma corrida, que é o que o pedido
   * proíbe. `VOLTAR AO MENU` zera os dois (ver `defeated`) e a escolha volta a abrir.
   */
  private syncClassSelect():void {this.classSelect?.setLocked(this.entered||this.dead);}

  /** A cena pode corrigir o painel (ex.: PRISM sem rig força o Pistoleiro). */
  showPlayerClass(id:PlayerClassId):void {this.playerClass=id;this.classSelect?.show(id);}
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
    this.button.disabled=false;this.button.textContent='PRESS START · JOGAR' ;this.diagnostic.textContent=this.farm?(this.mode==='expedition'?'Expedição pronta · encontre o cálice nas ilhas':'Siga o caminho até o celeiro'):'DIREITO · MIRAR / Q · CARREGAR E SOLTAR';}
  fatalReaction(active:boolean,progress=0):void {this.element.classList.toggle('fatal-reaction',active);this.element.style.setProperty('--fatal-flash',String(Math.max(0,1-progress*14)));if(active){this.skipIntro(false);this.gate.hidden=true;this.button.disabled=true;}}
  defeated(summary:AttemptSummary,retry?:()=>void|Promise<void>): void {
    this.skipIntro(false);this.fatalReaction(false);this.dead=true;this.syncClassSelect();this.gate.hidden=false;this.gate.classList.remove('loading');this.gate.classList.add('defeated');document.body.classList.add('game-menu-open');
    this.gate.querySelector<HTMLVideoElement>('video')?.pause();this.element.querySelector('.gate-card .eyebrow')!.textContent='EXPEDIÇÃO ENCERRADA';
    this.element.querySelector('h1')!.textContent='A última colheita.';
    const objectives=summary.objectives,expedition=objectives.mode==='expedition';
    const reached=expedition
      ?objectives.phase==='extract'?'cálice cheio · pronto para embarcar'
        :objectives.bossDefeated?'chefe derrotado · cálice incompleto'
        :objectives.phase==='boss'?'na horda final'
        :'em busca do cálice'
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
    const leave=async(play:boolean)=>{
      if(!retry){location.reload();return;}
      this.button.disabled=true;menu.disabled=true;this.button.textContent='SORTEANDO NOVA EXPEDIÇÃO…';
      try{await retry();}catch(error){
        this.button.disabled=false;menu.disabled=false;this.button.textContent='TENTAR NOVAMENTE';
        this.gate.querySelector('.gate-card p')!.textContent=error instanceof Error?error.message:'Não foi possível preparar a nova ilha. Tente novamente.';
        return;
      }
      // RENASCER mantém a classe (é a MESMA expedição repetida); VOLTAR AO MENU destranca a escolha
      // logo abaixo, porque `setActive(false)` deixa `entered` em `false`.
      this.button.disabled=false;this.dead=false;this.entered=false;this.syncClassSelect();this.gate.classList.remove('defeated');items.remove();menu.remove();report.remove();
      this.damage.flash=0;this.damage.hold=0;this.damage.amount=0;this.damage.trail=1;
      this.element.querySelector('.gate-card .eyebrow')!.textContent='MUTANT FARM / ILHAS SUSPENSAS';this.element.querySelector('h1')!.textContent='A colheita se revoltou.';
      this.element.querySelector('.gate-card p')!.textContent=this.mode==='expedition'?'Explore as ilhas e encontre o cálice. Sua ativação inicia a horda final: encha-o de suco e derrote a Praga Alfa.':'Sobreviva às hordas, recolha itens e explore os campos.';
      this.button.textContent='PRESS START · JOGAR';this.button.onclick=()=>{this.setActive(true);this.start();};this.setActive(play);if(play)this.start();
    };
    this.button.onclick=()=>leave(true);menu.onclick=()=>leave(false);
  }

  setActive(active: boolean): void {this.playActive=active;const film=this.gate.querySelector<HTMLVideoElement>('video');if(active)film?.pause();else if(film)void film.play().catch(()=>{});document.body.classList.toggle('game-menu-open',!active);this.gate.hidden=active;if(active)this.entered=true;else if(this.entered&&!this.dead){this.element.querySelector('h1')!.textContent='Campo pausado.';this.button.textContent='CONTINUAR EXPEDIÇÃO →';}
    // Reabrir a pausa sempre cai na raiz: ninguém espera voltar direto na tela de opções em que
    // estava dez minutos antes, e a ação que 99% das vezes se quer é "continuar".
    if(!active)this.menu?.show('raiz');this.syncClassSelect();}
  /**
   * `weapon` é o painel já resolvido (ver `weaponReadout`). Quando ausente, o painel cai no texto
   * das pistolas de sempre — é o caminho do pátio de treino e de qualquer cena sem a PRISM.
   */
  update(player: PlayerMotor,pistols: DualPistols,error: string,mp: MPCharge,enemies:Pick<EnemyReview,'count'|'kills'|'status'>,dt=1/60,weapon?:WeaponReadoutView): void {
    // Resolvido SEMPRE (mesmo sem painel na tela): a barra de carga do `Q` lê os rótulos daqui, e
    // eles dependem da classe e — no soldado — da forma da PRISM que está nas mãos.
    const view=weapon??weaponReadout({playerClass:this.playerClass,holstered:pistols.holstered,
      prismReady:false,prismEquipped:false,prismMode:0,
      prismAmmo:0,prismCapacity:0,prismReloading:false,prismProgress:0,prismBusy:false,
      pistolAmmo:pistols.magazine.ammo,pistolCapacity:pistols.magazine.capacity,
      pistolReloading:pistols.magazine.reloading,pistolProgress:pistols.magazine.progress,
      activeSkill:pistols.stormRemaining>0?'TEMPESTADE DA COLHEITA':''});
    const ammo=this.element.querySelector('.weapon-readout b');if(ammo){
      this.element.querySelector('.weapon-readout span')!.textContent=view.label;
      ammo.textContent=view.ammo;
      this.element.querySelector('.weapon-readout small')!.textContent=view.hint;
    }
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
    // Sem objetivo publicado: na expedição o destino é o cálice sorteado, nunca o celeiro fixo.
    const fallback=this.farm
      ?this.mode==='expedition'?'Explore as ilhas · encontre o cálice'
        :distance<5?'Celeiro alcançado':`Chegue ao celeiro · ${Math.round(distance)} m`
      :`${enemies.count} espécimes · ${enemies.kills} abatidos`;
    this.element.querySelector('.field-objective b')!.textContent=this.objective||fallback;
    this.element.querySelector('.field-objective')!.setAttribute('title',`${enemies.status}${this.farm?'':' · Espécimes de treino voltam após 8 segundos.'}`);
    this.element.querySelectorAll('.mp-meter i').forEach((segment,index)=>segment.classList.toggle('charged',mp.tier>index));
    // Uma habilidade no ar manda; depois a falta de MP (só quando o nível I não é grátis); depois o
    // rótulo do nível carregado, que o painel de arma já resolveu pela classe e pela forma.
    this.element.querySelector('.mp-meter small')!.textContent=view.active
      ?view.active
      :mp.held&&mp.current<25&&!view.freeFirstTier?'MP INSUFICIENTE'
      :mp.held?view.charge[mp.tier]!
      :'SEGURE Q';
    if(error){this.diagnostic.textContent=`Falha ao carregar personagem: ${error}`;this.button.textContent='Recarregue a página para tentar novamente';}
    else if(pistols.cadence.shots+pistols.skillShots>0)this.diagnostic.textContent=`${pistols.hits} acertos · ${pistols.cadence.shots+pistols.skillShots} disparos · ${mp.releases} habilidades`;
  }
  dispose(): void {window.removeEventListener('keydown',this.gateKey);this.onSkipIntro=undefined;this.skipButton.remove();this.classSelect?.dispose();this.journeyCard?.remove();document.body.classList.remove('game-menu-open','arrival-in-progress');this.element.remove();}
}
