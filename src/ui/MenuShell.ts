/**
 * O MENU, como menu de jogo — e não como página.
 *
 * ## O problema que isto resolve
 *
 * Tudo que o menu precisava mostrar era empilhado direto dentro de `.gate-card`, na ordem em que
 * cada recurso foi implementado: título, briefing, escolha de classe, botão de começar, volume,
 * qualidade visual, "nova expedição", os controles e ainda a barra de carregamento por cima. Onze
 * blocos soltos numa coluna. Não havia hierarquia nenhuma — e é isso, não a cor nem o canto, que
 * faz uma tela parecer formulário de navegador em vez de jogo.
 *
 * ## O que esta classe faz
 *
 * Ela **não cria interface nova**: ela REORGANIZA a que já existe. Os nós são movidos, nunca
 * recriados, e todos permanecem descendentes de `.gate-card`. Isso é deliberado — `PlayerHUD`
 * guarda referências e faz `querySelector('.gate-card p')`, `'.start-play'`, `'.controls'` e
 * outros; recriar qualquer um desses elementos quebraria os manipuladores de evento já ligados e
 * o estado que a cena controla. Movendo, tudo continua valendo.
 *
 * ## A composição
 *
 * ```
 * ┌─ RAIZ ──────────────┐   uma decisão por vez, no centro da tela
 * │   TÍTULO            │
 * │   uma linha          │
 * │   ▸ JOGAR           │   ação primária, grande, sozinha
 * │   ▸ PERSONAGEM      │   abre a tela de classe
 * │   ▸ OPÇÕES          │   abre a tela de ajustes
 * └─────────────────────┘
 * ```
 *
 * `PERSONAGEM` e `OPÇÕES` são TELAS, não blocos empilhados: entram no lugar da raiz e voltam. O
 * estado vive num atributo `data-screen`, que é o que o CSS lê para mostrar uma e esconder as
 * outras — sem `style.display` espalhado pelo TypeScript.
 */

import type {MultiplayerPort} from '../net/Multiplayer';
import type {RoomBrowserLink,RoomRow} from '../net/RoomBrowser';

export type MenuScreen='raiz'|'personagem'|'opcoes'|'abandonar'|'nome'|'multijogador'|'entrar'|'sala';

/**
 * PARA ONDE A TELA DE PERSONAGEM VOLTA.
 *
 * A regra vive fora da classe porque é uma DECISÃO, e decisão se afirma em teste sem montar DOM
 * nenhum. O erro que ela corrige: o VOLTAR era um botão só, compartilhado por todas as telas, e
 * mandava sempre para `'raiz'`. Quem chegou à escolha de personagem VINDO DA SALA era despejado no
 * menu principal — e a sala continuava aberta, com ele dentro, sem nada na tela dizendo isso.
 *
 * `hasRoomScreen` é condição real, não zelo: o campo de testes monta o menu SEM a tela de sala, e
 * mandar alguém para uma tela que não existe é trocar um destino errado por um pior.
 */
export function classScreenReturn(roomOpen:boolean,hasRoomScreen:boolean):MenuScreen {
  return roomOpen&&hasRoomScreen?'sala':'raiz';
}

export class MenuShell {
  readonly element=document.createElement('div');
  private readonly screens=new Map<MenuScreen,HTMLElement>();
  private readonly nav=document.createElement('nav');
  private current:MenuScreen='raiz';

  /**
   * @param card o `.gate-card` existente, que passa a hospedar o shell.
   * @param parts os nós que já existem e serão REPOSICIONADOS. Qualquer um pode faltar: o menu do
   *   campo de testes, por exemplo, não tem escolha de classe.
   */
  constructor(card:HTMLElement, parts:{
    title?:HTMLElement|null;
    tagline?:HTMLElement|null;
    play?:HTMLElement|null;
    classSelect?:HTMLElement|null;
    options?:HTMLElement|null;
    controlsHelp?:HTMLElement|null;
    notes?:readonly (HTMLElement|null|undefined)[];
  }){
    this.element.className='rdf-menu';
    this.element.dataset['screen']='raiz';

    // ---- raiz -------------------------------------------------------------------------------
    const root=this.makeScreen('raiz');
    // A marca do jogo vem antes do título: ela É o título. O `h1` vira a chamada abaixo dela.
    const logo=document.createElement('img');
    logo.className='rdf-logo';
    logo.src='/ui/logo-rdf.png';
    logo.alt='Risco de Fruta';
    logo.decoding='async';
    root.append(logo);
    if(parts.title){parts.title.classList.add('rdf-menu-title');root.append(parts.title);}
    if(parts.tagline){parts.tagline.classList.add('rdf-menu-tagline');root.append(parts.tagline);}

    this.nav.className='rdf-menu-nav';
    if(parts.play){parts.play.classList.add('rdf-menu-primary');this.nav.append(parts.play);}
    if(parts.options)this.nav.append(this.link('OPÇÕES','opcoes'));
    this.nav.append(this.quit());
    root.append(this.nav);

    // ---- personagem: o LOBBY ----------------------------------------------------------------
    /**
     * Não existe botão "PERSONAGEM" no menu principal. Escolher personagem não é uma opção
     * paralela a jogar — é o primeiro passo DE jogar. Então `PRESS START` abre o lobby, e é o
     * `PRONTO` do lobby que começa a partida de verdade.
     *
     * O desvio é feito envolvendo o manipulador que `PlayerHUD` já ligou no botão, capturado aqui
     * e chamado intacto pelo `PRONTO`. Isso mantém um caminho de início só, e é o que permite que
     * a PAUSA continue funcionando: lá o mesmo botão vira "CONTINUAR EXPEDIÇÃO" e precisa
     * retomar direto, sem passar pelo lobby — `disableLobby()` desarma o desvio no momento em que
     * a partida começa.
     */
    if(parts.classSelect&&parts.play){
      const play=parts.play as HTMLButtonElement;
      const realStart=play.onclick;
      play.onclick=event=>{
        if(!this.lobbyArmed)return realStart?.call(play,event) as void;
        event.preventDefault();
        this.show('personagem');
      };
      const screen=this.makeScreen('personagem');
      const ready=document.createElement('button');
      ready.type='button';
      ready.className='rdf-menu-primary rdf-menu-ready';
      ready.textContent='PRONTO';
      /**
       * `PointerEvent` e não `MouseEvent`: a assinatura de `onclick` na biblioteca DOM atual é
       * `(ev: PointerEvent) => any`, e um `MouseEvent` não satisfaz o tipo. O evento sintético só
       * existe para o caminho em que a SALA manda começar — aí não houve clique nenhum, mas o
       * manipulador original de `PlayerHUD` espera receber um evento.
       */
      this.beginRun=event=>{this.disableLobby();realStart?.call(play,event??new PointerEvent('click'));};
      this.readyButton=ready;
      /**
       * Com sala, o PRONTO deixa de começar a partida: ele ANUNCIA prontidão ao servidor, e quem
       * larga é a sala inteira por unanimidade (ver `FarmRoom`). Sem sala — single-player, que é a
       * esmagadora maioria das sessões — o clique continua começando a partida na hora.
       */
      ready.onclick=event=>{if(this.readyHandler)this.readyHandler();else this.beginRun?.(event);};
      /**
       * CONFIRMAR e VOLTAR ficam FORA do cartão, presos na tela.
       *
       * No Risk of Rain 2 essas duas ações são da TELA, não do painel: o confirmar embaixo ao
       * centro, o voltar no canto inferior direito. Tentei ancorá-los por `position: fixed` de
       * dentro do cartão e não funciona — a tela de menu acaba com um `transform` (a animação de
       * entrada deixa uma matriz identidade cravada), e QUALQUER ancestral com transform vira
       * bloco de contenção, fazendo o `fixed` se prender a ele em vez de à janela.
       *
       * Em vez de caçar transforms um a um, os botões saem do cartão no DOM e vão para uma barra
       * que é filha direta do portão. Aí não existe ancestral para capturá-los.
       */
      const barra=document.createElement('div');
      barra.className='rdf-action-bar';
      // Com sala aberta o retorno é a SALA, não a raiz: quem abriu esta tela foi o lobby.
      barra.append(ready,this.back(()=>classScreenReturn(this.roomOpen,this.screens.has('sala'))));
      (card.parentElement??card).append(barra);
      screen.append(this.heading('ESCOLHA SEU PERSONAGEM'),parts.classSelect,this.roster());
    }

    // ---- opções -----------------------------------------------------------------------------
    if(parts.options){
      const screen=this.makeScreen('opcoes');
      screen.append(this.heading('OPÇÕES'),parts.options);
      // Os avisos soltos ("F1 abre o diagnóstico", "sem troca de arma em campo") saem da tela
      // principal e viram rodapé daqui, que é onde alguém procura por eles.
      for(const note of parts.notes??[])if(note){note.classList.add('rdf-menu-note');screen.append(note);}
      if(parts.controlsHelp)screen.append(parts.controlsHelp);
      screen.append(this.back());
    }

    card.append(this.element);
  }

  /**
   * ABANDONAR EXPEDIÇÃO — só existe com uma partida em curso, e sempre com confirmação.
   *
   * Confirmação não é burocracia aqui: o botão fica na pausa, a um clique de distância de
   * "CONTINUAR", e abandonar joga fora a expedição inteira — itens, estágio e progresso. Um
   * clique errado ali custa a sessão toda. A pergunta fica numa TELA, igual às outras, em vez de
   * um `confirm()` do navegador, que quebraria a apresentação e é bloqueável.
   */
  private abandonLink:HTMLButtonElement|undefined;
  enableAbandon(onAbandon:()=>void):void {
    if(this.abandonLink)return;
    const link=document.createElement('button');
    link.type='button';
    link.className='rdf-menu-link rdf-menu-abandon';
    link.textContent='ABANDONAR EXPEDIÇÃO';
    link.onclick=()=>this.show('abandonar');
    // Antes do SAIR: a ordem da pilha é continuar → ajustar → abandonar → sair do jogo.
    this.nav.insertBefore(link,this.nav.querySelector('.rdf-menu-quit'));
    this.abandonLink=link;

    const screen=this.makeScreen('abandonar');
    const aviso=document.createElement('p');
    aviso.className='rdf-menu-warning';
    aviso.textContent='Você perde os itens, o estágio e todo o progresso desta expedição. Não dá para voltar atrás.';
    const sim=document.createElement('button');
    sim.type='button';
    sim.className='rdf-menu-danger';
    sim.textContent='SIM, ABANDONAR';
    sim.onclick=()=>onAbandon();
    const nao=document.createElement('button');
    nao.type='button';
    nao.className='rdf-menu-back';
    nao.textContent='CONTINUAR JOGANDO';
    nao.onclick=()=>this.show('raiz');
    screen.append(this.heading('ABANDONAR?'),aviso,sim,nao);
  }
  /** Some com a opção quando não há partida em curso (menu inicial e tela de derrota). */
  setAbandonVisible(visible:boolean):void {
    if(this.abandonLink)this.abandonLink.hidden=!visible;
  }

  /**
   * Enquanto armado, `PRESS START` abre o lobby em vez de começar a partida.
   *
   * Desarma na primeira partida — a partir daí o mesmo botão é o "CONTINUAR EXPEDIÇÃO" da pausa,
   * que tem de retomar direto. Um jogador pausando no meio da horda não quer revisitar a tela de
   * escolha de classe (que, aliás, está travada nesse momento).
   */
  private lobbyArmed=true;
  disableLobby():void {this.lobbyArmed=false;}

  /** Largada de verdade: o que o PRONTO fazia sozinho antes de existir sala. */
  /**
   * Começa a partida de verdade. Sem argumento quando quem manda começar é a SALA (unanimidade
   * atingida) — aí não existe clique, e o manipulador original recebe um evento sintético.
   *
   * O tipo é `PointerEvent` porque é o que a assinatura de `onclick` exige na biblioteca DOM
   * atual; `MouseEvent` não satisfaz.
   */
  private beginRun:((event?:PointerEvent)=>void)|undefined;
  private readyButton:HTMLButtonElement|undefined;
  private readyHandler:(()=>void)|undefined;
  /** Liga o PRONTO à sala. Sem chamada, o botão segue exatamente como era no single-player. */
  setReadyHandler(handler:(()=>void)|undefined):void {this.readyHandler=handler;}
  /** Chamado quando o SERVIDOR larga a corrida: entra em campo pelo mesmo caminho de sempre. */
  startRun():void {this.beginRun?.();}
  /** Rótulo do PRONTO, para o lobby dizer o que a sala está esperando. */
  setReadyLabel(text:string):void {if(this.readyButton)this.readyButton.textContent=text;}

  /**
   * Quem está na sala.
   *
   * Hoje lista só a vaga local, porque é essa a verdade: a sala cooperativa existe no servidor
   * (`server/`, Colyseus), mas o menu ainda não está ligado nela — o estado dos outros jogadores
   * não chega até aqui. A lista é montada por `setRoster`, que qualquer código com acesso à sala
   * pode chamar sem mudar nada desta classe. Inventar nomes de jogadores fictícios para "parecer"
   * multijogador seria mentira na tela.
   */
  private readonly rosterList=document.createElement('ul');
  setRoster(players:readonly {id?:string;name:string;classe?:string;pronto?:boolean;caiu?:boolean}[]):void {
    // A MESMA verdade nas duas telas: a lista do lobby de personagem e as quatro vagas da sala são
    // duas apresentações do mesmo roster, e nunca podem discordar.
    this.renderSlots(players);
    this.rosterList.replaceChildren();
    for(const player of players){
      const item=document.createElement('li');
      item.className='rdf-roster-item'+(player.pronto?' pronto':'');
      item.innerHTML=`<b></b><span></span><em></em>`;
      item.querySelector('b')!.textContent=player.name;
      item.querySelector('span')!.textContent=player.classe??'—';
      item.querySelector('em')!.textContent=player.pronto?'PRONTO':'ESCOLHENDO';
      this.rosterList.append(item);
    }
  }
  private roster():HTMLElement {
    const box=document.createElement('div');
    box.className='rdf-roster';
    const label=document.createElement('small');
    label.textContent='NA SALA';
    this.rosterList.className='rdf-roster-list';
    box.append(label,this.rosterList);
    this.setRoster([{name:'VOCÊ',pronto:false}]);
    return box;
  }

  /** Troca de tela. Só escreve o atributo: quem mostra e esconde é a folha de estilo. */
  show(screen:MenuScreen):void {
    if(!this.screens.has(screen))screen='raiz';
    this.current=screen;
    this.element.dataset['screen']=screen;
    // A listagem ao vivo só existe enquanto a tela dela está à vista: uma conexão de lobby aberta
    // para sempre seria uma sala a mais no servidor por jogador parado no menu.
    this.syncBrowser(screen);
    // O foco acompanha a navegação: sem isso o teclado continuaria na tela anterior, que é uma
    // falha real de acessibilidade e também de conforto no controle/teclado.
    this.screens.get(screen)?.querySelector<HTMLElement>('button,[tabindex]')?.focus();
  }

  get screen():MenuScreen {return this.current;}

  /** `Esc` dentro de uma subtela volta para a raiz em vez de sair do menu. */
  /**
   * O VOLTAR, com DESTINO EXPLÍCITO.
   *
   * Voltava sempre para `'raiz'`, para toda tela, porque o botão era um só e não sabia de onde
   * tinha vindo. Na tela de personagem isso é errado quando há sala aberta: o jogador entrou nela
   * VINDO DA SALA, e voltar para o menu principal o tira do lobby sem fechar sala nenhuma — a sala
   * continua de pé, com ele dentro, e a tela não mostra mais isso.
   *
   * O destino é resolvido NO CLIQUE, não na montagem: quando este botão é criado ainda não se sabe
   * se haverá sala. Por isso a função, e não uma constante.
   */
  back(to:MenuScreen|(()=>MenuScreen)='raiz'):HTMLButtonElement {
    const button=document.createElement('button');
    button.type='button';
    button.className='rdf-menu-back';
    button.textContent='◂ VOLTAR';
    button.onclick=()=>this.show(typeof to==='function'?to():to);
    return button;
  }

  /**
   * Existe sala aberta? É o que decide para onde a tela de personagem volta.
   *
   * Dito de fora (`PlayerHUD`, que é quem fala com `RoomSession`) em vez de deduzido da tela atual:
   * inferir "estou no lobby" pelo que está desenhado erra justamente no caso que importa — o
   * jogador está NA tela de personagem, e a sala continua aberta atrás dela.
   */
  private roomOpen=false;
  setRoomOpen(open:boolean):void {this.roomOpen=open;}

  /**
   * SAIR.
   *
   * `window.close()` só funciona numa janela que o próprio script abriu — num separador aberto
   * pelo usuário o navegador ignora, em silêncio, por segurança. Por isso o fecho é TENTADO e,
   * se a janela continuar de pé (verificado no quadro seguinte), o jogo navega para uma tela de
   * despedida. Prometer "sair" e não acontecer nada seria pior do que não ter o botão.
   *
   * No executável de desktop (`JOGAR.cmd` abre uma janela dedicada) o fecho funciona de verdade.
   */
  private quit():HTMLButtonElement {
    const button=document.createElement('button');
    button.type='button';
    button.className='rdf-menu-link rdf-menu-quit';
    button.textContent='SAIR';
    button.onclick=()=>{
      const before=Date.now();
      window.close();
      window.setTimeout(()=>{
        if(Date.now()-before<0)return;
        if(!window.closed)document.body.classList.add('rdf-quit');
      },120);
    };
    return button;
  }

  // ===============================================================================================
  // MULTIJOGADOR — o produto, não a ferramenta
  //
  // O co-op existia e funcionava; o que não existia era CAMINHO até ele. Jogar junto era abrir
  // `localhost:5173/?online=1&seed=f03a9243` e mandar a URL pelo WhatsApp — ferramenta de
  // desenvolvimento, não jogo. Estas telas são esse caminho: MULTIPLAYER → CRIAR SALA, e o que se
  // compartilha é um CÓDIGO curto, que carrega a sala e o endereço de quem a hospeda.
  //
  // O que o jogador NUNCA vê aqui: semente, `roomId`, `?online=1`, endereço de servidor ou porta.
  // Tudo isso continua existindo por baixo, exatamente como estava — ver `OnlineIntent`.
  //
  // Todo o ciclo de vida da sala é BOTÃO: criar, renomear, listar, entrar, sair, expulsar e
  // encerrar. Nenhuma dessas ações decide nada aqui: a máquina de lobby (fase, anfitrião,
  // unanimidade estrita, contagem) continua sendo só a da `FarmRoom`, e esta tela a exibe.
  // ===============================================================================================

  private port:MultiplayerPort|undefined;
  private browser:RoomBrowserLink|undefined;
  private unsubscribeBrowser:(()=>void)|undefined;
  private readonly roomsList=document.createElement('ul');
  private readonly roomsNotice=document.createElement('p');
  private readonly salaSlots=document.createElement('ul');
  private readonly salaTitle=document.createElement('h2');
  private readonly salaStatus=document.createElement('p');
  private readonly codeValue=document.createElement('b');
  private readonly hostOnly:HTMLElement[]=[];
  private nameInput:HTMLInputElement|undefined;
  private roomNameInput:HTMLInputElement|undefined;
  private isHost=false;
  private onKick:((playerId:string)=>void)|undefined;
  /** Para onde ir depois de responder o nome. */
  private afterName:MenuScreen='multijogador';

  /**
   * Liga as telas de multijogador. Sem esta chamada o menu segue idêntico ao que era — é o que
   * mantém o campo de testes e a suíte de interface sem rede.
   */
  enableMultiplayer(port:MultiplayerPort):void {
    if(this.port)return;
    this.port=port;

    const entrada=document.createElement('button');
    entrada.type='button';
    entrada.className='rdf-menu-link rdf-menu-multi';
    entrada.textContent='MULTIPLAYER';
    entrada.onclick=()=>{this.afterName='multijogador';this.show(port.savedName()?'multijogador':'nome');};
    // Logo abaixo de INICIAR O JOGO: é a segunda forma de jogar, não um ajuste.
    const primeiro=this.nav.querySelector('.rdf-menu-link');
    if(primeiro)this.nav.insertBefore(entrada,primeiro);else this.nav.append(entrada);

    this.buildNameScreen();
    this.buildBrowserScreen();
    this.buildJoinScreen();
    this.buildRoomScreen();

    const salvo=port.savedName();
    if(this.nameInput)this.nameInput.value=salvo;
    // O nome da sala já vem preenchido com "SALA DE LUCAS" — e continua editável, que é o pedido.
    if(this.roomNameInput)this.roomNameInput.placeholder=salvo?`SALA DE ${salvo.toUpperCase()}`:'NOME DA SALA';

    /**
     * O recado que atravessou a recarga: saiu, foi expulso, o anfitrião encerrou. Quem volta ao
     * menu por uma dessas três portas volta PARA A LISTA e com o motivo escrito, em vez de cair na
     * raiz sem explicação nenhuma.
     */
    const aviso=port.notice();
    if(aviso){this.setBrowserNotice(aviso);if(salvo)this.show('multijogador');}
  }

  /** O nome, perguntado UMA vez e guardado. */
  private buildNameScreen():void {
    const screen=this.makeScreen('nome');
    const input=document.createElement('input');
    input.type='text';input.className='rdf-field';input.maxLength=16;
    input.placeholder='SEU NOME';input.autocomplete='off';input.spellcheck=false;
    this.nameInput=input;
    const confirmar=document.createElement('button');
    confirmar.type='button';
    confirmar.className='rdf-menu-confirm';
    confirmar.textContent='CONFIRMAR';
    const salvar=():void=>{
      const salvo=this.port?.saveName(input.value)??'';
      if(!salvo){input.focus();return;}
      this.show(this.afterName);
    };
    confirmar.onclick=salvar;
    // Enter confirma: perguntar o nome e exigir o mouse para responder seria atrito gratuito.
    input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();salvar();}};
    screen.append(this.heading('QUAL É O SEU NOME?'),input,confirmar,this.back());
  }

  /**
   * A tela de multijogador: AS SALAS primeiro, criar depois, e o código bem no fim.
   *
   * ## A inversão
   *
   * Antes, `ENTRAR EM SALA` abria um campo de código (`3ZP5-VR2M-OYAG`). Isso é a porta dos fundos
   * na frente da casa: a pergunta que o jogador faz ao clicar em "entrar em sala" é *quais salas
   * existem*, e a resposta tem de ser a LISTA — nomes, anfitriões, lotação, clicáveis. O código
   * continua existindo, porque ele resolve o caso que a lista não alcança (alguém de fora do
   * servidor desta instalação), mas como caminho secundário, atrás de `TENHO UM CÓDIGO`.
   *
   * ## Por que agora dá para prometer a lista
   *
   * A lista é do `LobbyRoom`, que vive num servidor. Enquanto cada jogador subia o próprio, a lista
   * era estruturalmente vazia para todos — e era por isso que o código tinha de ser a porta
   * principal. Com `VITE_SERVER` apontando para um servidor comum (ver `ServerAddress` e
   * `.env.example`), todo mundo cai no mesmo lugar e a lista passa a ter o que mostrar.
   */
  private buildBrowserScreen():void {
    const screen=this.makeScreen('multijogador');

    // ---- as salas: o conteúdo PRINCIPAL da tela ---------------------------------------------
    const caixa=document.createElement('div');
    caixa.className='rdf-rooms';
    const rotulo=document.createElement('small');
    rotulo.textContent='ENTRAR EM SALA';
    this.roomsList.className='rdf-rooms-list';
    this.roomsNotice.className='rdf-menu-warning rdf-rooms-notice';
    this.roomsNotice.hidden=true;
    caixa.append(rotulo,this.roomsList);
    this.renderRooms([]);

    // ---- criar: a outra metade, abaixo da lista ----------------------------------------------
    const nomeSala=document.createElement('input');
    nomeSala.type='text';nomeSala.className='rdf-field';nomeSala.maxLength=24;
    nomeSala.autocomplete='off';nomeSala.spellcheck=false;
    this.roomNameInput=nomeSala;

    const criar=document.createElement('button');
    criar.type='button';criar.className='rdf-menu-confirm';criar.textContent='CRIAR SALA';
    criar.onclick=()=>{
      const port=this.port;if(!port)return;
      const nome=nomeSala.value.trim();
      port.create(port.savedName(),nome);
      // A tela da sala aparece no CLIQUE, não quando a conexão responde. O roster vazio e o código
      // em reticências são a verdade daquele instante — e são os mesmos que esta tela já mostrava
      // enquanto a boas-vindas não chegava. Esperar aqui seria o único tempo morto que sobrou.
      this.showRoom('',nome);
    };

    // ---- o código: caminho secundário, e escrito como tal -------------------------------------
    const codigo=document.createElement('button');
    codigo.type='button';codigo.className='rdf-menu-link rdf-tenho-codigo';codigo.textContent='TENHO UM CÓDIGO';
    codigo.onclick=()=>this.show('entrar');

    screen.append(this.heading('MULTIPLAYER'),this.roomsNotice,caixa,nomeSala,criar,codigo,this.back());
  }

  /** Entrar por código — o que o amigo de fora ditou. Secundário, e a volta é para a LISTA. */
  private buildJoinScreen():void {
    const screen=this.makeScreen('entrar');
    const dica=document.createElement('p');
    dica.className='rdf-menu-note';
    dica.textContent='O código serve para entrar numa sala que não aparece na lista — a de alguém que joga noutro servidor.';
    const input=document.createElement('input');
    input.type='text';input.className='rdf-field rdf-field-code';input.maxLength=32;
    input.placeholder='X7K2-V4TQ-F9CM';input.autocomplete='off';input.spellcheck=false;
    const erro=document.createElement('p');
    erro.className='rdf-menu-warning';erro.hidden=true;
    const confirmar=document.createElement('button');
    confirmar.type='button';confirmar.className='rdf-menu-confirm';confirmar.textContent='ENTRAR';
    const tentar=():void=>{
      const port=this.port;if(!port)return;
      const motivo=port.joinCode(input.value,port.savedName());
      erro.textContent=motivo;erro.hidden=!motivo;
      if(!motivo)this.showRoom('','');
    };
    confirmar.onclick=tentar;
    input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();tentar();}};
    // VOLTAR aqui é voltar para a LISTA, não para a raiz: quem veio do código veio de lá.
    const voltar=document.createElement('button');
    voltar.type='button';voltar.className='rdf-menu-back';voltar.textContent='◂ VER AS SALAS';
    voltar.onclick=()=>this.show('multijogador');
    screen.append(this.heading('ENTRAR COM CÓDIGO'),dica,input,erro,confirmar,voltar);
  }

  /** A sala: quem está dentro, o código para compartilhar e a largada. */
  private buildRoomScreen():void {
    const screen=this.makeScreen('sala');
    this.salaTitle.className='rdf-screen-title';
    this.salaTitle.textContent='SALA';
    this.salaSlots.className='rdf-slots';
    const codigo=document.createElement('div');
    codigo.className='rdf-code';
    const rotulo=document.createElement('small');
    rotulo.textContent='CÓDIGO';
    this.codeValue.className='rdf-code-value';
    codigo.append(rotulo,this.codeValue);
    const copiar=document.createElement('button');
    copiar.type='button';copiar.className='rdf-menu-link rdf-copy';copiar.textContent='COPIAR CÓDIGO';
    copiar.onclick=()=>{
      const texto=this.codeValue.textContent??'';
      // `clipboard` não existe em `http://` fora de localhost nem em navegador antigo; a falha é
      // silenciosa de propósito — o código está ESCRITO na tela logo acima, que é o caminho que
      // nunca falha.
      try{void navigator.clipboard?.writeText(texto);}catch{/* o código continua legível na tela */}
      copiar.textContent='COPIADO';
      window.setTimeout(()=>{copiar.textContent='COPIAR CÓDIGO';},1400);
    };
    const iniciar=document.createElement('button');
    iniciar.type='button';iniciar.className='rdf-menu-confirm';iniciar.textContent='INICIAR';
    // A largada continua sendo a do lobby que já existe: escolher personagem e apertar PRONTO, com
    // unanimidade decidida pela `FarmRoom`. Esta tela não cria uma segunda máquina de largada —
    // ela leva à escolha de personagem, que é onde o PRONTO mora.
    iniciar.onclick=()=>this.show('personagem');

    // O que está travando a largada, escrito. "Botão morto sem explicação" foi reclamação direta.
    this.salaStatus.className='rdf-menu-note rdf-sala-status';

    /**
     * Renomear é um CAMPO na tela, não um `prompt()` do navegador: o diálogo nativo quebra a
     * apresentação, é bloqueável e não tem nada a ver com o resto do menu — a mesma razão pela qual
     * ABANDONAR virou tela em vez de `confirm()`.
     */
    const campoNome=document.createElement('input');
    campoNome.type='text';campoNome.className='rdf-field rdf-host-only';campoNome.maxLength=24;
    campoNome.placeholder='NOME DA SALA';campoNome.autocomplete='off';campoNome.spellcheck=false;
    const renomear=document.createElement('button');
    renomear.type='button';renomear.className='rdf-menu-link rdf-host-only';renomear.textContent='RENOMEAR SALA';
    const aplicarNome=():void=>{const novo=campoNome.value.trim();if(novo){this.onRename?.(novo.slice(0,24));campoNome.value='';}};
    renomear.onclick=aplicarNome;
    campoNome.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();aplicarNome();}};
    this.hostOnly.push(campoNome);
    const encerrar=document.createElement('button');
    encerrar.type='button';encerrar.className='rdf-menu-link rdf-menu-abandon rdf-host-only';encerrar.textContent='ENCERRAR SALA';
    encerrar.onclick=()=>this.onCloseRoom?.();
    const sair=document.createElement('button');
    sair.type='button';sair.className='rdf-menu-back rdf-sair';sair.textContent='SAIR DA SALA';
    sair.onclick=()=>this.onLeaveRoom?.();
    this.hostOnly.push(renomear,encerrar);

    this.salaSlots.replaceChildren();
    this.renderSlots([]);
    screen.append(this.salaTitle,this.salaSlots,this.salaStatus,codigo,copiar,iniciar,campoNome,renomear,encerrar,sair);
    this.applyHostOnly();
  }

  /** Ações da sala que só a rede pode cumprir. `PlayerHUD` as liga à `LobbyLink`. */
  private onRename:((name:string)=>void)|undefined;
  private onCloseRoom:(()=>void)|undefined;
  private onLeaveRoom:(()=>void)|undefined;
  setRoomActions(actions:{rename?:(name:string)=>void;close?:()=>void;leave?:()=>void;kick?:(playerId:string)=>void}):void {
    this.onRename=actions.rename;this.onCloseRoom=actions.close;this.onLeaveRoom=actions.leave;this.onKick=actions.kick;
  }
  /** Só o anfitrião renomeia, expulsa e encerra — e só ele vê esses botões. */
  setHost(isHost:boolean):void {this.isHost=isHost;this.applyHostOnly();}
  private applyHostOnly():void {for(const node of this.hostOnly)node.hidden=!this.isHost;}
  /** O aviso da sala: o que falta para largar, ou o que deu errado. */
  setRoomStatus(text:string):void {this.salaStatus.textContent=text;}
  /** O código completo, já formatado. Chega depois da boas-vindas, que é quem traz o endereço. */
  setRoomCode(code:string):void {this.codeValue.textContent=code||'…';}
  /** O nome da sala, como o servidor o conhece — inclusive depois de o anfitrião renomear. */
  showRoomName(name:string):void {this.salaTitle.textContent=(name||'SALA').toUpperCase();}
  /** O aviso da tela de salas (saiu, expulso, sala encerrada, servidor fora do ar). */
  setBrowserNotice(text:string):void {this.roomsNotice.textContent=text;this.roomsNotice.hidden=!text;}

  /**
   * Mostra a sala. Chamado pelo menu ao criar/entrar e por quem descobre, depois da recarga, que
   * esta aba está numa sala (`PlayerHUD`).
   */
  showRoom(code:string,roomName:string):void {
    if(!this.screens.has('sala'))return;
    this.roomOpen=true;
    this.setRoomCode(code);
    this.salaTitle.textContent=(roomName||'SALA').toUpperCase();
    this.show('sala');
  }

  /**
   * As quatro vagas: ocupadas por cima, `aguardando…` no resto.
   *
   * Cada linha diz o que a sala está esperando daquele jogador — personagem escolhido e prontidão —
   * porque são exatamente essas duas coisas que a unanimidade estrita da `FarmRoom` exige.
   */
  private renderSlots(players:readonly {id?:string;name:string;classe?:string;pronto?:boolean;caiu?:boolean}[]):void {
    this.salaSlots.replaceChildren();
    for(let i=0;i<4;i++){
      const player=players[i];
      const item=document.createElement('li');
      // `caiu` vence `pronto` na linha: quem perdeu a conexão não está pronto para nada, e mostrar
      // PRONTO ao lado de um companheiro que sumiu é a informação errada na hora errada.
      item.className='rdf-slot'+(player?'':' vazio')+(player?.caiu?' caiu':player?.pronto?' pronto':'');
      item.innerHTML='<i></i><b></b><span></span><em></em>';
      item.querySelector('i')!.textContent=`P${i+1}`;
      item.querySelector('b')!.textContent=player?player.name:'aguardando…';
      item.querySelector('span')!.textContent=player?(player.classe??'escolhendo…'):'';
      item.querySelector('em')!.textContent=player?(player.caiu?'RECONECTANDO…':player.pronto?'PRONTO':'AGUARDANDO'):'';
      // Expulsar: só o anfitrião, e nunca a si mesmo (a primeira vaga é sempre dele).
      if(player&&this.isHost&&i>0&&player.id){
        const expulsar=document.createElement('button');
        expulsar.type='button';expulsar.className='rdf-kick';expulsar.title='Expulsar';expulsar.textContent='✕';
        expulsar.onclick=()=>this.onKick?.(player.id!);
        item.append(expulsar);
      }
      this.salaSlots.append(item);
    }
  }

  /**
   * A lista de salas.
   *
   * Três estados, e eles TÊM de ser distinguíveis — foi pedido explicitamente. "Nenhuma sala
   * aberta" e "não consegui falar com o servidor" produzem a mesma lista vazia na tela e significam
   * coisas opostas: na primeira, criar uma sala resolve; na segunda, criar não vai adiantar nada.
   *
   * Sala cheia (4/4) APARECE — ver a lotação é informação — mas não entra: o botão desabilitado é a
   * recusa, e entrar mesmo assim só produziria uma rejeição do servidor sem explicação.
   */
  private renderRooms(rooms:readonly RoomRow[],erro=''):void {
    this.roomsList.replaceChildren();
    if(erro){
      const quebrado=document.createElement('li');
      quebrado.className='rdf-rooms-empty rdf-rooms-broken';
      quebrado.textContent='NÃO CONSEGUI FALAR COM O SERVIDOR';
      this.roomsList.append(quebrado);
      return;
    }
    if(!rooms.length){
      const vazio=document.createElement('li');
      vazio.className='rdf-rooms-empty';
      vazio.textContent='NENHUMA SALA ABERTA · CRIE A SUA';
      this.roomsList.append(vazio);
      return;
    }
    for(const room of rooms){
      const item=document.createElement('li');
      item.className='rdf-room'+(room.full?' cheia':'');
      const botao=document.createElement('button');
      botao.type='button';
      botao.className='rdf-room-join';
      botao.disabled=room.full;
      botao.innerHTML='<b></b><i></i><span></span>';
      botao.querySelector('b')!.textContent=room.roomName;
      botao.querySelector('i')!.textContent=room.hostName;
      botao.querySelector('span')!.textContent=`${room.players}/${room.max}`;
      if(room.full)botao.title='Sala cheia';
      botao.onclick=()=>this.enterRoom(room);
      item.append(botao);
      this.roomsList.append(item);
    }
  }

  /**
   * O clique numa linha da lista.
   *
   * A lista é VIVA (eventos do `LobbyRoom`, nunca sondagem), mas viva não é instantânea: entre o
   * desenho da linha e o clique cabe a sala encher, entrar em partida ou o anfitrião encerrar. Por
   * isso a linha clicada é reconferida contra a lista DESTE instante antes de qualquer navegação —
   * e a recusa é dita ali mesmo, sem sair da tela, com a lista já atualizada à vista.
   */
  private enterRoom(room:RoomRow):void {
    const port=this.port;if(!port)return;
    const agora=this.browser?.rooms;
    const atual=agora?agora.find(linha=>linha.roomId===room.roomId):room;
    if(!atual){this.setBrowserNotice('ESSA SALA NÃO EXISTE MAIS');this.renderRooms(agora??[],this.browser?.error??'');return;}
    if(atual.full){this.setBrowserNotice('ESSA SALA ENCHEU');this.renderRooms(agora??[],this.browser?.error??'');return;}
    const motivo=port.joinRow(atual,port.savedName());
    if(motivo){this.setBrowserNotice(motivo);return;}
    this.showRoom('',atual.roomName);
  }

  /** Abre a listagem ao vivo enquanto a tela está à vista, e fecha ao sair. Uma conexão, não mais. */
  private syncBrowser(screen:MenuScreen):void {
    const port=this.port;
    if(!port)return;
    if(screen==='multijogador'){
      if(this.browser)return;
      this.browser=port.browse();
      const pintar=():void=>{
        const erro=this.browser?.error??'';
        // Vazio e QUEBRADO não podem parecer a mesma coisa: o erro entra na lista E no aviso.
        this.renderRooms(this.browser?.rooms??[],erro);
        if(erro)this.setBrowserNotice(erro);
      };
      this.unsubscribeBrowser=this.browser.onChange(pintar);
      pintar();
      return;
    }
    this.unsubscribeBrowser?.();this.unsubscribeBrowser=undefined;
    this.browser?.dispose();this.browser=undefined;
  }

  private makeScreen(id:MenuScreen):HTMLElement {
    const section=document.createElement('section');
    section.className='rdf-screen';
    section.dataset['screen']=id;
    this.screens.set(id,section);
    this.element.append(section);
    return section;
  }

  private heading(text:string):HTMLElement {
    const h=document.createElement('h2');
    h.className='rdf-screen-title';
    h.textContent=text;
    return h;
  }

  private link(label:string,target:MenuScreen):HTMLButtonElement {
    const button=document.createElement('button');
    button.type='button';
    button.className='rdf-menu-link';
    button.textContent=label;
    button.onclick=()=>this.show(target);
    return button;
  }
}
