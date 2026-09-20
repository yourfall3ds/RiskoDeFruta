import {PLAYER_CLASSES,PLAYER_CLASS_ORDER,type PlayerClassId} from '../run/PlayerClass';

/**
 * A ESCOLHA DE CLASSE no menu principal.
 *
 * Fica dentro do mesmo cartão do `PRESS START`, porque é lá que a decisão precisa ser tomada: não
 * existe troca de arma em campo, então o menu é o único lugar em que ela pode acontecer. Dois
 * cartões, um deles sempre marcado, com o papel e o resumo escritos — ninguém deveria precisar
 * entrar numa expedição para descobrir o que escolheu.
 *
 * **Trancada durante a tentativa.** `setLocked(true)` desabilita os dois botões e escreve o motivo.
 * Isto é regra de jogo, não estilo: pausar no meio da horda e trocar de arma seria exatamente o que
 * o pedido proíbe. Voltar ao menu destranca.
 *
 * Acessível de verdade: é um `radiogroup` com `aria-checked`, navegável por Tab e acionável por
 * teclado, e o estado travado sai em `aria-disabled` além do `disabled` nativo.
 */
export class ClassSelect {
  readonly element=document.createElement('section');
  private readonly buttons=new Map<PlayerClassId,HTMLButtonElement>();
  private readonly notice: HTMLElement;
  private current: PlayerClassId;
  private locked=false;

  constructor(initial: PlayerClassId, private readonly onChoose: (id: PlayerClassId)=>void) {
    this.current=initial;
    this.element.className='class-select';
    this.element.setAttribute('role','radiogroup');
    this.element.setAttribute('aria-label','Classe do exterminador');
    const title=document.createElement('h2');
    title.className='class-select-title';
    title.textContent='ESCOLHA SUA CLASSE';
    this.element.append(title);
    const list=document.createElement('div');
    list.className='class-select-options';
    for(const id of PLAYER_CLASS_ORDER){
      const definition=PLAYER_CLASSES[id];
      const button=document.createElement('button');
      button.type='button';
      button.className='class-option';
      button.dataset['classId']=id;
      button.setAttribute('role','radio');
      button.innerHTML=`<strong>${definition.name}</strong><em>${definition.role}</em><span>${definition.summary}</span>`;
      button.onclick=()=>this.pick(id);
      this.buttons.set(id,button);
      list.append(button);
    }
    this.element.append(list);
    this.notice=document.createElement('small');
    this.notice.className='class-select-notice';
    this.element.append(this.notice);
    this.applyFallbackStyle();
    this.sync();
  }

  /** A classe marcada agora. */
  get value(): PlayerClassId {return this.current;}

  /** Marca uma classe sem avisar ninguém — usado quando a cena é a dona da verdade. */
  show(id: PlayerClassId): void {this.current=id;this.sync();}

  /**
   * Tranca ou destranca a escolha.
   *
   * Travado, o painel continua LEGÍVEL (o jogador ainda vê com o que está jogando) e diz por que não
   * dá para mudar. Esconder o bloco seria pior: sumiria a informação junto com o controle.
   */
  setLocked(locked: boolean): void {this.locked=locked;this.sync();}

  private pick(id: PlayerClassId): void {
    if(this.locked||id===this.current)return;
    this.current=id;
    this.sync();
    this.onChoose(id);
  }

  private sync(): void {
    for(const [id,button] of this.buttons){
      const chosen=id===this.current;
      button.classList.toggle('chosen',chosen);
      button.setAttribute('aria-checked',String(chosen));
      button.disabled=this.locked;
      button.setAttribute('aria-disabled',String(this.locked));
    }
    this.element.classList.toggle('locked',this.locked);
    if(this.fallback)for(const [id,button] of this.buttons){
      button.style.borderColor=id===this.current?'#ffd98a':'#e4d6aa44';
      button.style.opacity=this.locked?'.55':'1';
      button.style.cursor=this.locked?'default':'pointer';
    }
    this.notice.textContent=this.locked
      ?`Classe travada durante a expedição · ${PLAYER_CLASSES[this.current].name} · volte ao menu para trocar`
      :`Sem troca de arma em campo: a escolha vale a expedição inteira. Padrão: ${PLAYER_CLASSES.gunslinger.name}.`;
  }

  /**
   * Layout mínimo quando a folha de estilo ainda não conhece `.class-select`.
   *
   * O estilo definitivo é do dono da interface; esta guarda só impede que o bloco nasça como texto
   * empilhado e ilegível enquanto a regra não existir. É o mesmo padrão já usado por `.intro-skip`.
   */
  private fallback=false;
  private applyFallbackStyle(): void {
    if(typeof getComputedStyle!=='function')return;
    document.body.append(this.element);
    const styled=getComputedStyle(this.element).display==='grid'
      ||getComputedStyle(this.buttons.get('gunslinger')!).cursor==='pointer';
    this.element.remove();
    if(styled)return;
    this.fallback=true;
    this.element.style.cssText='display:grid;gap:8px;margin:14px 0 4px';
    (this.element.querySelector('.class-select-options') as HTMLElement).style.cssText=
      'display:grid;grid-template-columns:1fr 1fr;gap:10px';
    for(const button of this.buttons.values())
      button.style.cssText='display:grid;gap:4px;text-align:left;padding:10px 12px;font:inherit;'
        +'color:#fff1ce;background:#0c1c28cc;border:1px solid #e4d6aa44;cursor:pointer';
  }

  dispose(): void {this.element.remove();}
}
