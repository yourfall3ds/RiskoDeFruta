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

export type MenuScreen='raiz'|'personagem'|'opcoes'|'abandonar';

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
      ready.onclick=event=>{this.disableLobby();realStart?.call(play,event);};
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
      barra.append(ready,this.back());
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
  setRoster(players:readonly {name:string;classe?:string;pronto?:boolean}[]):void {
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
    // O foco acompanha a navegação: sem isso o teclado continuaria na tela anterior, que é uma
    // falha real de acessibilidade e também de conforto no controle/teclado.
    this.screens.get(screen)?.querySelector<HTMLElement>('button,[tabindex]')?.focus();
  }

  get screen():MenuScreen {return this.current;}

  /** `Esc` dentro de uma subtela volta para a raiz em vez de sair do menu. */
  back():HTMLButtonElement {
    const button=document.createElement('button');
    button.type='button';
    button.className='rdf-menu-back';
    button.textContent='◂ VOLTAR';
    button.onclick=()=>this.show('raiz');
    return button;
  }

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
