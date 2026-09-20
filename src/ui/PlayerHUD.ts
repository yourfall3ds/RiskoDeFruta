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
import type { LobbyLink } from '../net/LobbyLink';
import { lobbyBlockerText } from '../net/LobbyStatus';
import { browserMultiplayer,type MultiplayerPort } from '../net/Multiplayer';
import { onRoomChange } from '../net/RoomSession';
import { encodeRoomCode,formatRoomCode } from '../net/RoomCode';
import { DEFAULT_PLAYER_CLASS,PLAYER_CLASSES,type PlayerClassId } from '../run/PlayerClass';

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
  /**
   * Reescreve a lista da sala com a classe escolhida agora.
   *
   * Só a vaga local, porque só ela é conhecida aqui — ver `MenuShell.setRoster`. Quando a sala
   * cooperativa estiver ligada ao menu, é esta chamada que ganha os outros jogadores.
   */
  private refreshRoster():void {
    const lobby=this.lobby;
    if(!lobby){this.menu?.setRoster([{name:'VOCÊ',classe:PLAYER_CLASSES[this.playerClass].name,pronto:false}]);return;}
    // Com sala, a lista é a VERDADE do servidor — inclusive a minha própria linha. Misturar a
    // escolha local com o roster remoto faria a tela mostrar um estado que o servidor não tem.
    this.menu?.setRoster(lobby.players.map(p=>({
      id:p.id,
      name:p.self?`VOCÊ · ${p.name}`:p.name,
      pronto:p.ready,
      // Espalhamento condicional e não `classe:…|undefined`: com `exactOptionalPropertyTypes`,
      // `undefined` NÃO é um valor válido para uma propriedade opcional.
      ...(p.classId?{classe:PLAYER_CLASSES[p.classId].name}:{}),
    })));
  }
  /** A sala, quando existe. `undefined` no single-player, que é o caminho padrão. */
  private lobby:LobbyLink|undefined;
  private unsubscribeLobby:(()=>void)|undefined;
  /**
   * `true` quando a CENA desta tela é a da partida — a fazenda, com `NetworkSession` de pé.
   *
   * É a diferença entre o lobby e a partida, e ela decide as duas coisas que importam aqui: quem
   * começa a partida quando a sala larga (a cena do menu precisa ser refeita; a da partida já está
   * no lugar certo) e o que fazer ao sair da sala (voltar ao menu exige refazer a cena só quando
   * saímos de dentro do mundo da fazenda).
   */
  private sceneOnline=false;
  /** A ordem de entrar em campo é dada UMA vez; a sala avisa a fase em cada patch. */
  private entering=false;
  /**
   * Liga o menu à sala cooperativa.
   *
   * Chamado por `PlayerScene` quando a cena tem sessão de rede (`sceneOwned`), e por `RoomSession`
   * quando o MENU abriu a sala sem trocar de cena — que é o caminho normal desde que o lobby
   * deixou de exigir o mundo da fazenda. O PRONTO deixa de começar a partida e passa a anunciar
   * prontidão; quem larga é a sala, por unanimidade.
   */
  attachLobby(lobby:LobbyLink,sceneOwned=false):void {
    // A mesma sala chega duas vezes de propósito: o menu a adota no lobby e a cena da partida a
    // adota de novo ao nascer. A segunda chegada não reinscreve nada — só promove a tela a partida.
    if(this.lobby===lobby){if(sceneOwned&&!this.sceneOnline){this.sceneOnline=true;this.syncLobby();}return;}
    this.detachLobby();
    this.lobby=lobby;
    this.sceneOnline=sceneOwned;
    this.menu?.setReadyHandler(()=>{lobby.chooseClass(this.playerClass);lobby.setReady(true);});
    lobby.chooseClass(this.playerClass);
    // As ações da sala são da REDE; o menu só as dispara. Sair, encerrar e ser expulso terminam
    // todos no mesmo lugar: de volta ao menu, com o motivo escrito (`onClosed`).
    this.menu?.setRoomActions({
      rename:name=>lobby.rename(name),
      kick:id=>lobby.kick(id),
      close:()=>lobby.closeRoom(),
      leave:()=>{lobby.leaveRoom();this.coopExit('VOCÊ SAIU DA SALA');},
    });
    this.unsubscribeLobbyClosed=lobby.onClosed(reason=>this.coopExit(reason));
    this.unsubscribeLobby=lobby.onChange(()=>this.syncLobby());
    // Quem chegou aqui PELO MENU abre direto na sala: foi o que ele pediu dois cliques atrás. Quem
    // chegou pela URL (`?online=1&seed=`) continua caindo na raiz, porque ali não houve sala
    // nenhuma escolhida na interface — e é esse o caminho de desenvolvimento que não pode mudar.
    if(this.multiplayer?.currentRoom())this.menu?.showRoom(this.roomCode(lobby.address),lobby.roomName);
    this.syncLobby();
  }
  /**
   * A tela inteira da sala a partir do estado da sala — e nada além dele.
   *
   * Chamada na inscrição e a cada patch, e não só no `onChange`: a cena da partida nasce com a sala
   * JÁ em `playing` (foi isso que a fez nascer), e esperar por um próximo evento que talvez nunca
   * viesse deixaria o jogador olhando o lobby com o mundo já montado atrás.
   */
  private syncLobby():void {
    const lobby=this.lobby;
    if(!lobby)return;
    this.refreshRoster();
    const mine=lobby.players.find(p=>p.self);
    this.menu?.setReadyLabel(lobby.phase==='playing'?'ENTRANDO…':mine?.ready?'AGUARDANDO A SALA':'PRONTO');
    this.menu?.setHost(lobby.isHost);
    this.menu?.setRoomStatus(lobbyBlockerText(lobby.players,lobby.phase));
    this.menu?.setRoomCode(this.roomCode(lobby.address));
    if(lobby.roomName)this.menu?.showRoomName(lobby.roomName);
    if(lobby.phase!=='playing')return;
    /**
     * A PARTIDA COMEÇOU — e é só aqui que um mapa é construído.
     *
     * Na cena da partida a largada é a de sempre. No MENU, a cena de pé é a de fora (o planeta) e
     * o mundo da fazenda ainda não existe: `enterMatch` é o pedido para construí-lo, e a tela de
     * carregamento que aparece em seguida é a única de todo o caminho do co-op.
     */
    if(this.sceneOnline){this.menu?.startRun();return;}
    if(this.entering)return;
    this.entering=true;
    this.multiplayer?.enterMatch();
  }
  /** Desliga a tela da sala. A conexão não é tocada: quem a fecha é quem a abriu. */
  private detachLobby():void {
    this.unsubscribeLobby?.();this.unsubscribeLobby=undefined;
    this.unsubscribeLobbyClosed?.();this.unsubscribeLobbyClosed=undefined;
    this.lobby=undefined;
    this.menu?.setReadyHandler(undefined);
  }
  private unsubscribeLobbyClosed:(()=>void)|undefined;
  /** Inscrição na sala que vive FORA da cena (`RoomSession`). Desfeita no descarte do HUD. */
  private unsubscribeRoom:(()=>void)|undefined;
  /** O porto de multijogador, quando esta cena o oferece. */
  private multiplayer:MultiplayerPort|undefined;
  /**
   * Sala acabou (saiu, expulso, encerrada): volta ao menu com o motivo escrito.
   *
   * De DENTRO da partida isso exige refazer a cena, porque o mundo da fazenda tem de dar lugar ao
   * de fora. De dentro do LOBBY não exige nada: a cena de fora é a que já está de pé, e o jogador
   * volta para a lista de salas no mesmo quadro, sem tela de carregamento nenhuma.
   */
  private coopExit(reason:string):void {
    if(this.sceneOnline)this.multiplayer?.backToMenu(reason);
    else this.multiplayer?.exitRoom(reason);
  }
  /**
   * O CÓDIGO COMPLETO, montado só quando o endereço chega.
   *
   * O endereço é dito pelo servidor na boas-vindas — o cliente não tem como saber sozinho qual
   * endereço serve ao AMIGO. Enquanto ele não chega, a tela mostra reticências em vez de um código
   * pela metade, que é o que mandaria o convidado para a máquina errada.
   */
  private roomCode(address:string):string {
    const room=this.multiplayer?.currentRoom()??'';
    if(!room||!address)return '';
    return formatRoomCode(encodeRoomCode({room,address,pageHost:location.hostname}));
  }
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
      +'<div class=loading-track><i></i></div>'
      // O corredor fica COLADO no número, correndo parado — não atravessando a barra. É assim em
      // Risk of Rain 2, e a razão é boa: um boneco que anda junto do progresso vira um segundo
      // indicador de progresso, concorrendo com a barra e com a porcentagem pela mesma leitura.
      // Correndo no lugar ele informa outra coisa, que nenhum dos dois informa: que o processo
      // não morreu.
      +'<span class=rdf-runner aria-hidden=true></span>'
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
      /**
       * O sobretítulo ("MUTANT FARM / ILHAS SUSPENSAS") sai do menu: era a legenda de um cabeçalho
       * de site em cima do título do próprio jogo, repetindo o que o título já diz.
       *
       * ESVAZIADO, e não removido. `defeated()` escreve neste mesmo elemento com asserção de não
       * nulo (`querySelector(...)!.textContent=…`); tirá-lo da árvore derrubava a tela de morte
       * com TypeError no momento exato em que o jogador morre. Quem o esconde no menu é o CSS,
       * que o mostra de volta na derrota — onde ele tem conteúdo e função.
       */
      this.element.querySelector<HTMLElement>('.gate-card .eyebrow')!.textContent='';
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
      this.classSelect=new ClassSelect(classPicker.initial,id=>{this.playerClass=id;classPicker.choose(id);this.lobby?.chooseClass(id);this.refreshRoster();});
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
    /**
     * MULTIPLAYER no menu principal.
     *
     * Só nas cenas que oferecem escolha de personagem — o campo de treino não tem co-op, e um botão
     * que leva a uma sala impossível é pior do que a sua ausência.
     */
    if(classPicker){
      this.multiplayer=browserMultiplayer();
      this.menu?.enableMultiplayer(this.multiplayer);
      /**
       * A SALA CHEGA DE FORA DA CENA.
       *
       * Este é o fio que faz o lobby caber no menu: `RoomSession` abre a sala onde o jogador está
       * e avisa aqui, e a tela da sala se monta sobre a cena que já estava de pé. `undefined` é a
       * sala fechando — saiu, foi expulso, o anfitrião encerrou —, e a volta para a lista é
       * imediata pelo mesmo motivo: não há nada para reconstruir.
       */
      this.unsubscribeRoom=onRoomChange((room,notice)=>{
        // O menu precisa saber se há sala para decidir para onde a tela de personagem VOLTA. Quem
        // sabe isso é `RoomSession`, e este é o único ponto por onde a notícia passa.
        this.menu?.setRoomOpen(!!room);
        if(room){this.attachLobby(room);return;}
        this.detachLobby();
        this.refreshRoster();
        // Dentro da partida quem leva o jogador de volta é a reconstrução da cena, com o recado
        // guardado para depois dela (`writeCoopNotice`); escrever na lista aqui seria escrever num
        // menu que está prestes a ser descartado.
        if(this.sceneOnline)return;
        this.menu?.setBrowserNotice(notice);
        this.menu?.show('multijogador');
      });
      /**
       * A sala já aberta NÃO é adotada aqui, e a omissão é deliberada.
       *
       * Quando esta tela nasce com sala aberta, a cena é a da partida — ela só existe porque a sala
       * largou —, e quem sabe disso é `PlayerScene`, que chama `attachLobby(…, true)` logo a
       * seguir. Adotar antes disso faria a tela se ver no lobby com a fase já em `playing` e pedir
       * para entrar em campo de novo: um relançamento atrás do outro, sem fim.
       */
    }
    this.refreshRoster();
    /**
     * Abandonar a expedição: recarrega a página no MESMO seed.
     *
     * Recarregar e não desmontar a cena por dentro porque "abandonar" significa jogar fora todo o
     * estado da tentativa — progressão, itens, horda, estágio, clima e a própria cena 3D. O
     * caminho que já existe e é comprovadamente limpo para isso é o mesmo de `NOVA EXPEDIÇÃO`,
     * que também troca a partida por uma navegação. Mantendo o seed, o jogador volta ao menu da
     * MESMA rota, e não a um mundo sorteado de novo.
     */
    this.menu?.enableAbandon(()=>{location.assign(location.href);});
    this.menu?.setAbandonVisible(false);
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
  /**
   * Progresso do carregamento.
   *
   * ## Por que o número precisava de tratamento
   *
   * A origem do dado é uma contagem de ETAPAS booleanas (dez bandeiras em `PlayerScene`), então o
   * valor cru só existe em múltiplos de 10%, e várias bandeiras viram verdadeiras no mesmo quadro.
   * O resultado na tela era um salto de 70% para 90% com segundos de imobilidade no meio — que é
   * exatamente a leitura de "isto não está ligado em nada".
   *
   * ## O que é feito aqui, e o que NÃO é
   *
   * O alvo continua sendo a verdade medida: nada é inventado e o número nunca ultrapassa a etapa
   * realmente concluída em mais do que a regra abaixo permite. Duas correções:
   *
   * 1. **Interpolação**: o mostrador persegue o alvo em vez de saltar, a ~90% da diferença por
   *    segundo. Uma etapa que conclui instantaneamente ainda leva alguns quadros para aparecer.
   * 2. **Rastejo dentro da etapa**: enquanto uma etapa demorada não termina, o mostrador avança
   *    devagar dentro da faixa DELA, sem nunca chegar ao fim da faixa. É a diferença entre
   *    "travou" e "trabalhando" — e continua honesto, porque a faixa só fecha quando a etapa
   *    fecha de verdade.
   *
   * O valor nunca anda para trás, mesmo que uma bandeira oscile.
   */
  private shownProgress=0;
  private progressTarget=0;
  private progressRaf=0;
  private progressLast=0;
  loading(done:number,total:number,label:string):void {
    if(this.loaded)return;
    const progress=this.element.querySelector('.loading-progress') as HTMLElement;
    progress.hidden=false;
    this.progressTarget=total>0?Math.max(0,Math.min(1,done/total)):0;
    // A largura de uma etapa. O rastejo nunca cruza essa fronteira.
    const passo=total>0?1/total:1;
    progress.querySelector('.loading-stage')!.textContent=label;
    this.gate.classList.add('loading');
    if(this.progressRaf)return;
    const tick=(agora:number):void=>{
      if(this.loaded||this.disposedHud){this.progressRaf=0;return;}
      const dt=this.progressLast?Math.min(.1,(agora-this.progressLast)/1000):.016;
      this.progressLast=agora;
      // Teto do rastejo: a etapa corrente mais 85% dela — perto do fim, sem tocá-lo.
      const teto=Math.min(1,this.progressTarget+passo*.85);
      const alvo=Math.max(this.progressTarget,Math.min(teto,this.shownProgress+dt*passo*.22));
      const passo1=this.shownProgress+(alvo-this.shownProgress)*Math.min(1,dt*3.2);
      // ENCOSTAR NO ALVO. A perseguição é exponencial: ela se APROXIMA do alvo sem nunca chegar.
      // Com o alvo em 1, `Math.floor` do valor perseguido ficava em 99% para sempre — o "travado em
      // 99%" era, em parte, esta assíntota. Meio por cento de distância já é o alvo.
      this.shownProgress=Math.max(this.shownProgress,alvo-passo1<=.005?alvo:passo1);
      const pct=Math.min(100,Math.floor(this.shownProgress*100));
      const barra=progress.querySelector('i') as HTMLElement|null;
      if(barra)barra.style.width=pct+'%';
      const numero=progress.querySelector('b');
      if(numero)numero.textContent=pct+'%';
      this.progressRaf=requestAnimationFrame(tick);
    };
    this.progressRaf=requestAnimationFrame(tick);
  }
  private disposedHud=false;
  ready(): void {
    // O laço de animação para aqui: `loaded` fica verdadeiro logo abaixo e o quadro seguinte sai
    // sozinho, mas cancelar explicitamente evita um quadro órfão entre as duas coisas.
    if(this.progressRaf){cancelAnimationFrame(this.progressRaf);this.progressRaf=0;}
    // O laço para no quadro em que estava, então o último número escrito era o da perseguição (85%,
    // 97%…). Quem lê um relatório de QA lê ESTE texto: ele fecha em 100.
    this.shownProgress=1;this.progressTarget=1;
    const barra=this.element.querySelector('.loading-progress i') as HTMLElement|null;
    if(barra)barra.style.width='100%';
    const numero=this.element.querySelector('.loading-progress b');
    if(numero)numero.textContent='100%';
    this.loading(1,1,'ROTA PRONTA · EQUIPAMENTO PRONTO');this.gate.classList.remove('loading');
    // A barra terminada continuava desenhada a 100% por cima do menu pronto. `.loading` só escondia
    // os controles; o próprio bloco de progresso nunca saía.
    (this.element.querySelector('.loading-progress') as HTMLElement).hidden=true;this.loaded=true;
    this.button.disabled=false;this.button.textContent='PRESS START · JOGAR' ;this.diagnostic.textContent=this.farm?(this.mode==='expedition'?'Expedição pronta · encontre o cálice nas ilhas':'Siga o caminho até o celeiro'):'DIREITO · MIRAR / Q · CARREGAR E SOLTAR';}
  fatalReaction(active:boolean,progress=0):void {this.element.classList.toggle('fatal-reaction',active);this.element.style.setProperty('--fatal-flash',String(Math.max(0,1-progress*14)));if(active){this.skipIntro(false);this.gate.hidden=true;this.button.disabled=true;}}
  defeated(summary:AttemptSummary,retry?:()=>void|Promise<void>): void {
    this.skipIntro(false);this.fatalReaction(false);this.dead=true;this.syncClassSelect();this.gate.hidden=false;this.gate.classList.remove('loading');this.gate.classList.add('defeated');document.body.classList.add('game-menu-open');
    this.gate.querySelector<HTMLVideoElement>('video')?.pause();this.element.querySelector('.gate-card .eyebrow')!.textContent='EXPEDIÇÃO ENCERRADA';
    // "VOCÊ MORREU" primeiro, do tamanho da tela; a frase de luto vira subtítulo. A informação
    // que o jogador precisa no instante em que a tela aparece é O QUE ACONTECEU, não poesia.
    this.element.querySelector('h1')!.innerHTML='VOCÊ MORREU<small>A última colheita.</small>';
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
    if(!active)this.menu?.show('raiz');
    // A partida começou por QUALQUER caminho (lobby, atalho de Enter, retomada): o desvio do
    // lobby sai de cena para sempre nesta sessão, senão a pausa passaria a abrir a escolha de
    // classe em vez de retomar.
    if(active)this.menu?.disableLobby();
    // Abandonar só faz sentido com expedição em curso: aparece a partir da primeira pausa.
    this.menu?.setAbandonVisible(this.entered&&!this.dead);this.syncClassSelect();}
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
  dispose(): void {this.unsubscribeRoom?.();this.unsubscribeRoom=undefined;this.detachLobby();window.removeEventListener('keydown',this.gateKey);this.onSkipIntro=undefined;this.skipButton.remove();this.classSelect?.dispose();this.journeyCard?.remove();document.body.classList.remove('game-menu-open','arrival-in-progress');this.element.remove();}
}
