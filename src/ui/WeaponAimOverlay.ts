export type WeaponAimKind='pistols'|'assault'|'sniper'|'grenade'|'smg';
export interface WeaponAimView {active:boolean;kind:WeaponAimKind;zoom:number}

/** Screen-centred optics only; camera magnification and ballistics remain in the game. */
export class WeaponAimOverlay {
 private readonly element=document.createElement('div');
 private readonly style=document.createElement('style');
 private readonly zoom:HTMLElement;
 private key='';
 constructor(){
  this.element.className='weapon-aim-overlay';this.element.hidden=true;
  this.element.setAttribute('aria-hidden','true');
  const ticks=[-3,-2,-1,1,2,3].map(n=>`<path d="M ${500+n*55} 491 v 18 M 491 ${500+n*55} h 18"/>`).join('');
  this.element.innerHTML=`<div class="prism-reflex"><svg viewBox="0 0 24 24" fill="none"><path d="M 1 7 V 1 H 7 M 17 1 H 23 V 7 M 23 17 V 23 H 17 M 7 23 H 1 V 17" stroke="#b9f7ff" stroke-width="1.3"/><circle cx="12" cy="12" r="1.4" fill="#b9f7ff"/></svg></div>
   <div class="prism-scope"><svg viewBox="0 0 1000 1000" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="500" cy="500" r="486" stroke="rgba(100,224,245,.3)" stroke-width="2"/>
    <g stroke="rgba(0,0,0,.85)" stroke-width="3"><path d="M 0 500 H 478 M 522 500 H 1000 M 500 0 V 478 M 500 522 V 1000"/>${ticks}</g>
    <g stroke="#baf7ff" stroke-width="1"><path d="M 0 500 H 478 M 522 500 H 1000 M 500 0 V 478 M 500 522 V 1000"/>${ticks}</g>
    <circle cx="500" cy="500" r="3" fill="#fa8069"/>
   </svg><div class="prism-optic-label"><span>PRISM · ÓPTICA DE ÍONS</span><strong class="prism-optic-zoom"></strong><small>SCROLL · AJUSTAR ZOOM</small></div></div>`;
  this.zoom=this.element.querySelector('.prism-optic-zoom')!;
  this.style.textContent=`
   .weapon-aim-overlay{position:fixed;inset:0;pointer-events:none;z-index:18;overflow:hidden}
   .weapon-aim-overlay[hidden]{display:none}
   .prism-scope,.prism-reflex{display:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
   body[data-weapon-aim="sniper"] .prism-scope{display:block;width:82vmin;height:82vmin;border-radius:50%;border:3px solid #1c2931;box-shadow:0 0 0 100vmax rgba(3,7,12,.97),inset 0 0 35px 4px rgba(0,15,25,.55)}
   .prism-scope svg{width:100%;height:100%;display:block}
   .prism-optic-label{position:absolute;left:0;right:0;bottom:12%;display:grid;gap:7px;text-align:center;color:#c6f6ff;text-shadow:0 1px 4px #000;font-family:monospace}
   .prism-optic-label span{font-size:10px;letter-spacing:2px}.prism-optic-label strong{font-size:20px;font-weight:500}.prism-optic-label small{font-size:10px;letter-spacing:1px;opacity:.7}
   body[data-weapon-aim="assault"] .prism-reflex{display:block;width:22px;height:22px;filter:drop-shadow(0 1px 2px #000)}
   body[data-weapon-aim="assault"] #player-hud .crosshair,body[data-weapon-aim="sniper"] #player-hud .crosshair,body[data-weapon-aim="grenade"] #player-hud .crosshair{visibility:hidden}
   body[data-weapon-aim="sniper"] .mp-meter{visibility:hidden}
   body[data-weapon-aim="sniper"] #player-hud,body[data-weapon-aim="sniper"] #run-hud{z-index:19}
   body[data-weapon-aim="sniper"] .player-damage-screen,body[data-weapon-aim="sniper"] .player-damage-number{z-index:20}
   body[data-weapon-aim="pistols"] #player-hud .crosshair{scale:.82}
   body.game-menu-open .weapon-aim-overlay,body.arrival-in-progress .weapon-aim-overlay{display:none}
  `;
  document.head.append(this.style);document.body.append(this.element);
 }
 update(view:WeaponAimView):void {
  const key=view.active?`${view.kind}:${view.zoom.toFixed(1)}`:'';
  if(key===this.key)return;this.key=key;this.element.hidden=!view.active;
  if(view.active){document.body.dataset.weaponAim=view.kind;this.zoom.textContent=`${view.zoom.toFixed(1)}×`;}
  else delete document.body.dataset.weaponAim;
 }
 dispose():void{delete document.body.dataset.weaponAim;this.element.remove();this.style.remove();}
}
