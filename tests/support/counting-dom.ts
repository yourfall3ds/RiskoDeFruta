/**
 * DOM mínimo que CONTA mutações, para medir o custo do HUD sem browser.
 *
 * A suíte roda em Node puro: não há `jsdom`/`happy-dom` instalados e o pedido é explícito em não
 * trazer dependência pesada só para isto. Este arquivo implementa a fatia de DOM que `CombatHUD`
 * realmente usa — criar elemento, `innerHTML` (com parse de verdade, senão `querySelector` não
 * acharia nada), `style`, `textContent`, atributos, `hidden`, `append`/`remove` e um `window` com
 * `addEventListener`/`AbortSignal` — e incrementa um contador a cada escrita.
 *
 * LIMITES HONESTOS: isto NÃO mede FPS, layout, style recalc nem paint. Mede quantas operações de
 * escrita no DOM e quantos nós por atualização o HUD produz. É exatamente o eixo que o HUD
 * controla; o custo de renderização real continua sendo QA de browser.
 */

export interface DomMetrics {
 /** Nós criados por `document.createElement`. */
 elementsCreated:number;
 /** Nós criados pelo parse de um `innerHTML` — o custo que o HUD antigo pagava por atualização. */
 elementsParsed:number;
 innerHTML:number;style:number;text:number;attribute:number;className:number;hidden:number;inserted:number;removed:number;
}

const zeroed=():DomMetrics=>({elementsCreated:0,elementsParsed:0,innerHTML:0,style:0,text:0,attribute:0,className:0,hidden:0,inserted:0,removed:0});

/** Soma das escritas no DOM (não conta criação de nó, que aparece em `elementsCreated/Parsed`). */
export const domWrites=(m:DomMetrics):number=>m.innerHTML+m.style+m.text+m.attribute+m.className+m.hidden+m.inserted+m.removed;
export const domNodes=(m:DomMetrics):number=>m.elementsCreated+m.elementsParsed;
export const copyMetrics=(m:DomMetrics):DomMetrics=>({...m});
export function deltaMetrics(before:DomMetrics,after:DomMetrics):DomMetrics {
 const out=zeroed();
 for(const key of Object.keys(out) as (keyof DomMetrics)[])out[key]=after[key]-before[key];
 return out;
}

const VOID_TAGS=new Set(['br','hr','img','input','meta','link']);

class CountingStyle {
 private readonly values=new Map<string,string>();
 constructor(private readonly metrics:DomMetrics){}
 private read(name:string):string {return this.values.get(name)??'';}
 private write(name:string,value:string):void {this.metrics.style++;this.values.set(name,value);}
 get width():string {return this.read('width');} set width(value:string){this.write('width',value);}
 get left():string {return this.read('left');} set left(value:string){this.write('left',value);}
 get top():string {return this.read('top');} set top(value:string){this.write('top',value);}
 get opacity():string {return this.read('opacity');} set opacity(value:string){this.write('opacity',value);}
 get display():string {return this.read('display');} set display(value:string){this.write('display',value);}
 setProperty(name:string,value:string):void {this.write(name,value);}
 getPropertyValue(name:string):string {return this.read(name);}
 /** Valores vindos do markup inicial: estado de partida, não mutação medida. */
 seed(declaration:string):void {
  for(const rule of declaration.split(';')){const at=rule.indexOf(':');if(at>0)this.values.set(rule.slice(0,at).trim(),rule.slice(at+1).trim());}
 }
 serialize():string {return [...this.values].map(([name,value])=>`${name}:${value}`).join(';');}
}

export class FakeText {
 parentNode:FakeElement|null=null;
 constructor(public data:string){}
}
export type FakeNode=FakeText|FakeElement;

export class FakeElement {
 readonly childNodes:FakeNode[]=[];
 readonly style:CountingStyle;
 readonly classList={toggle:(name:string,force?:boolean):void=>{
  const has=this.classNameValue.split(' ').includes(name),want=force??!has;
  if(want===has)return;
  this.className=want?`${this.classNameValue} ${name}`.trim():this.classNameValue.split(' ').filter(c=>c!==name).join(' ');
 }};
 parentNode:FakeElement|null=null;
 id='';
 private readonly attributes=new Map<string,string>();
 private classNameValue='';
 private hiddenValue=false;
 constructor(readonly tagName:string,private readonly dom:CountingDom){this.style=new CountingStyle(dom.metrics);}

 get className():string {return this.classNameValue;}
 set className(value:string){this.dom.metrics.className++;this.classNameValue=value;}
 get hidden():boolean {return this.hiddenValue;}
 set hidden(value:boolean){this.dom.metrics.hidden++;this.hiddenValue=value;}

 setAttribute(name:string,value:string):void {this.dom.metrics.attribute++;this.seedAttribute(name,value);}
 getAttribute(name:string):string|null {
  if(name==='class')return this.classNameValue;
  if(name==='id')return this.id;
  if(name==='style')return this.style.serialize();
  return this.attributes.get(name)??null;
 }
 /** Aplica um atributo sem contar como mutação: usado pelo parse do markup e pelo `setAttribute`. */
 seedAttribute(name:string,value:string):void {
  if(name==='class'){this.classNameValue=value;return;}
  if(name==='id'){this.id=value;return;}
  if(name==='hidden'){this.hiddenValue=true;return;}
  if(name==='style'){this.style.seed(value);return;}
  this.attributes.set(name,value);
 }

 get children():FakeElement[] {return this.childNodes.filter((n):n is FakeElement=>n instanceof FakeElement);}
 get firstElementChild():FakeElement|null {return this.children[0]??null;}

 /** Insere sem contar (parse do markup). */
 adopt(node:FakeNode):void {node.parentNode=this;this.childNodes.push(node);}
 append(...nodes:(FakeNode|string)[]):void {
  for(const node of nodes){
   const child=typeof node==='string'?new FakeText(node):node;
   this.dom.metrics.inserted++;this.adopt(child);
  }
 }
 remove():void {
  const parent=this.parentNode;if(!parent)return;
  const at=parent.childNodes.indexOf(this);if(at>=0)parent.childNodes.splice(at,1);
  this.parentNode=null;this.dom.metrics.removed++;
 }

 get textContent():string {
  let out='';
  for(const node of this.childNodes)out+=node instanceof FakeText?node.data:node.textContent;
  return out;
 }
 set textContent(value:string){
  this.dom.metrics.text++;this.childNodes.length=0;
  if(value!=='')this.adopt(new FakeText(value));
 }

 get innerHTML():string {return this.childNodes.map(node=>node instanceof FakeText?node.data:node.outerHTML).join('');}
 set innerHTML(html:string){this.dom.metrics.innerHTML++;this.childNodes.length=0;parseInto(this,html,this.dom);}
 get outerHTML():string {
  const parts=[this.tagName];
  if(this.classNameValue)parts.push(`class="${this.classNameValue}"`);
  if(this.id)parts.push(`id="${this.id}"`);
  const declaration=this.style.serialize();if(declaration)parts.push(`style="${declaration}"`);
  for(const [name,value] of this.attributes)parts.push(`${name}="${value}"`);
  if(this.hiddenValue)parts.push('hidden');
  const open=parts.join(' ');
  return VOID_TAGS.has(this.tagName)?`<${open}>`:`<${open}>${this.innerHTML}</${this.tagName}>`;
 }

 matches(selector:string):boolean {
  if(selector.startsWith('.'))return this.classNameValue.split(' ').includes(selector.slice(1));
  if(selector.startsWith('#'))return this.id===selector.slice(1);
  return this.tagName===selector;
 }
 querySelector(selector:string):FakeElement|null {return this.querySelectorAll(selector)[0]??null;}
 querySelectorAll(selector:string):FakeElement[] {
  const found:FakeElement[]=[];
  const walk=(node:FakeElement):void=>{for(const child of node.children){if(child.matches(selector))found.push(child);walk(child);}};
  walk(this);return found;
 }
}

function findTagEnd(html:string,from:number):number {
 let quote='';
 for(let i=from+1;i<html.length;i++){
  const ch=html[i]!;
  if(quote){if(ch===quote)quote='';continue;}
  if(ch==='"'||ch==='\'')quote=ch;
  else if(ch==='>')return i;
 }
 return html.length;
}

const ATTRIBUTE=/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*)))?/g;

function parseInto(host:FakeElement,html:string,dom:CountingDom):void {
 const stack:FakeElement[]=[host];
 const push=(node:FakeNode):void=>{stack[stack.length-1]!.adopt(node);};
 let i=0;
 while(i<html.length){
  const lt=html.indexOf('<',i);
  if(lt<0){push(new FakeText(html.slice(i)));break;}
  if(lt>i)push(new FakeText(html.slice(i,lt)));
  const gt=findTagEnd(html,lt),raw=html.slice(lt+1,gt);i=gt+1;
  if(raw.startsWith('/')){if(stack.length>1)stack.pop();continue;}
  const space=raw.search(/\s/),tag=(space<0?raw:raw.slice(0,space)).replace(/\/$/,'').toLowerCase();
  const element=dom.parsedElement(tag);
  if(space>=0){
   ATTRIBUTE.lastIndex=0;const attributes=raw.slice(space);
   for(let m=ATTRIBUTE.exec(attributes);m;m=ATTRIBUTE.exec(attributes))element.seedAttribute(m[1]!,m[2]??m[3]??m[4]??'');
  }
  push(element);
  if(!VOID_TAGS.has(tag)&&!raw.endsWith('/'))stack.push(element);
 }
}

interface FakeKeyEvent {code:string;preventDefault():void}
type KeyHandler=(event:FakeKeyEvent)=>void;

class FakeWindow {
 private readonly handlers=new Map<string,Set<KeyHandler>>();
 /** Quantos ouvintes continuam presos ao `window`: o teste de vazamento observa isto. */
 get listenerCount():number {let total=0;for(const set of this.handlers.values())total+=set.size;return total;}
 addEventListener(type:string,handler:KeyHandler,options?:{signal?:AbortSignal}):void {
  const set=this.handlers.get(type)??new Set<KeyHandler>();this.handlers.set(type,set);set.add(handler);
  options?.signal?.addEventListener('abort',()=>{set.delete(handler);});
 }
 removeEventListener(type:string,handler:KeyHandler):void {this.handlers.get(type)?.delete(handler);}
 /** Dispara um `keydown` determinístico; devolve se alguém chamou `preventDefault`. */
 dispatchKey(code:string):boolean {
  let prevented=false;
  for(const handler of this.handlers.get('keydown')??[])handler({code,preventDefault(){prevented=true;}});
  return prevented;
 }
}

export class CountingDom {
 readonly metrics:DomMetrics=zeroed();
 readonly window=new FakeWindow();
 readonly body:FakeElement;
 constructor(){this.body=new FakeElement('body',this);}
 createElement(tag:string):FakeElement {this.metrics.elementsCreated++;return new FakeElement(tag,this);}
 createTextNode(data:string):FakeText {return new FakeText(data);}
 /** Nó nascido de um `innerHTML`: contabilizado à parte para separar parse de construção manual. */
 parsedElement(tag:string):FakeElement {this.metrics.elementsParsed++;return new FakeElement(tag,this);}
 getElementById(id:string):FakeElement|null {return this.body.querySelectorAll(`#${id}`)[0]??null;}
 querySelector(selector:string):FakeElement|null {return this.body.querySelector(selector);}
 querySelectorAll(selector:string):FakeElement[] {return this.body.querySelectorAll(selector);}
 reset():void {Object.assign(this.metrics,zeroed());}
}

interface GlobalScope {document?:unknown;window?:unknown}

const saved:{document:unknown;window:unknown}[]=[];

/** Publica o DOM de contagem em `globalThis`. Chame antes de construir o HUD. */
export function installCountingDom():CountingDom {
 const scope=globalThis as unknown as GlobalScope;
 saved.push({document:scope.document,window:scope.window});
 const dom=new CountingDom();
 scope.document=dom;scope.window=dom.window;
 return dom;
}
export function uninstallCountingDom():void {
 const previous=saved.pop();if(!previous)return;
 const scope=globalThis as unknown as GlobalScope;
 scope.document=previous.document;scope.window=previous.window;
}
