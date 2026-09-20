/**
 * A fatia de DOM que `GameInput` realmente usa, para testar a captura sem browser.
 *
 * A suíte roda em Node puro (sem `jsdom`/`happy-dom`, ver `tests/support/counting-dom.ts`), e a
 * pergunta que este arquivo existe para responder é de REGRA, não de renderização: qual tecla
 * produz qual campo de `InputFrame`. Trocar o especial do botão direito para o `Q` é exatamente o
 * tipo de mudança que só um teste de mapeamento pega — o compilador não vê diferença nenhuma entre
 * ler `secondary` e ler `held.has('KeyQ')`.
 *
 * LIMITE HONESTO: isto não simula foco real, captura de ponteiro real nem rolagem de página. Ele
 * reproduz os sinais que a classe consulta (`pointerLockElement`, `activeElement`, `hidden`) e
 * entrega os eventos que ela assina.
 */

type Handler=(event:never)=>void;

class Emitter {
  private readonly listeners=new Map<string,Set<Handler>>();
  addEventListener(type:string,handler:Handler,_options?:unknown):void {
    let set=this.listeners.get(type);
    if(!set){set=new Set();this.listeners.set(type,set);}
    set.add(handler);
  }
  removeEventListener(type:string,handler:Handler):void {this.listeners.get(type)?.delete(handler);}
  /** Dispara para os inscritos; a cópia evita surpresa se um deles se remover no meio. */
  emit(type:string,event:unknown):void {
    for(const handler of [...(this.listeners.get(type)??[])])handler(event as never);
  }
}

export class FakeCanvas extends Emitter {
  tabIndex=0;
  constructor(private readonly document:FakeDocument){super();}
  focus():void {this.document.activeElement=this;}
  blur():void {if(this.document.activeElement===this)this.document.activeElement=null;}
  requestPointerLock():Promise<void> {this.document.pointerLockElement=this;this.document.emit('pointerlockchange',{});return Promise.resolve();}
}

export class FakeDocument extends Emitter {
  activeElement:unknown=null;
  pointerLockElement:unknown=null;
  hidden=false;
  exitPointerLock():void {this.pointerLockElement=null;this.emit('pointerlockchange',{});}
}

export interface InputDom {
  readonly window:Emitter;
  readonly document:FakeDocument;
  readonly canvas:FakeCanvas;
  /** Move o foco para o canvas SEM travar o ponteiro — o estado "ativo" mais fraco. */
  focus():void;
  /** Trava o ponteiro, como o `Jogar` faz. */
  lock():void;
  key(code:string,down:boolean,repeat?:boolean):void;
  pointer(button:number,down:boolean):void;
  wheel(deltaY:number):void;
  blur():void;
  restore():void;
}

/** Instala os globais e devolve os gatilhos. Sempre chame `restore()` no `finally`. */
export function installInputDom():InputDom {
  const saved={
    window:(globalThis as Record<string,unknown>).window,
    document:(globalThis as Record<string,unknown>).document,
    input:(globalThis as Record<string,unknown>).HTMLInputElement,
    button:(globalThis as Record<string,unknown>).HTMLButtonElement,
  };
  const win=new Emitter();
  const doc=new FakeDocument();
  const canvas=new FakeCanvas(doc);
  const globals=globalThis as Record<string,unknown>;
  globals.window=win;
  globals.document=doc;
  // `GameInput` faz `e.target instanceof HTMLInputElement`: sem os construtores o `instanceof`
  // lança antes de qualquer tecla ser lida.
  if(saved.input===undefined)globals.HTMLInputElement=class {};
  if(saved.button===undefined)globals.HTMLButtonElement=class {};
  const preventable=():{preventDefault():void}=>({preventDefault(){}});
  return {
    window:win,document:doc,canvas,
    focus:()=>{canvas.focus();},
    lock:()=>{doc.pointerLockElement=canvas;},
    key:(code,down,repeat=false)=>{
      win.emit(down?'keydown':'keyup',{...preventable(),code,repeat,target:canvas});
    },
    pointer:(button,down)=>{
      if(down)canvas.emit('mousedown',{...preventable(),button});
      else win.emit('mouseup',{...preventable(),button});
    },
    wheel:deltaY=>{canvas.emit('wheel',{...preventable(),deltaY});},
    blur:()=>{win.emit('blur',{});},
    restore:()=>{
      globals.window=saved.window;
      globals.document=saved.document;
      if(saved.input===undefined)delete globals.HTMLInputElement;
      if(saved.button===undefined)delete globals.HTMLButtonElement;
    },
  };
}
