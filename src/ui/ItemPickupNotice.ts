import {ITEMS,type ItemDefinition} from '../run/RunProgression';
import {perkIcon} from './PerkIcons';

/** Each pickup keeps its own four-second reading window, including rapid pickups. */
export class ItemPickupNotice {
 private readonly element=document.createElement('aside');
 private readonly icon=document.createElement('div');
 private readonly name=document.createElement('strong');
 private readonly effect=document.createElement('p');
 private readonly queue:ItemDefinition[]=[];
 private timer:ReturnType<typeof setTimeout>|undefined;
 constructor(host:HTMLElement){
  this.element.className='item-pickup-notice';this.element.hidden=true;
  this.element.setAttribute('role','status');this.element.setAttribute('aria-live','polite');
  this.icon.className='item-pickup-icon';this.icon.setAttribute('aria-hidden','true');
  const copy=document.createElement('div'),label=document.createElement('small');
  label.textContent='ITEM ADQUIRIDO';copy.append(label,this.name,this.effect);
  this.element.append(this.icon,copy);host.append(this.element);
 }
 show(id:string):void {
  const item=ITEMS.find(item=>item.id===id);if(!item)return;
  this.queue.push(item);if(this.timer===undefined)this.next();
 }
 private next():void {
  const item=this.queue.shift();
  if(!item){this.element.hidden=true;this.timer=undefined;return;}
  this.icon.setAttribute('style',perkIcon(item.icon));
  this.name.textContent=item.name;this.effect.textContent=item.description;
  this.element.setAttribute('data-rarity',item.rarity);this.element.hidden=false;
  this.timer=setTimeout(()=>this.next(),4000);
 }
 clear():void {if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;this.queue.length=0;this.element.hidden=true;}
 dispose():void {this.clear();this.element.remove();}
}
