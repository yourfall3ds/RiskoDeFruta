import fs from 'node:fs';
const edit=(p,fn)=>{const s=fs.readFileSync(p,'utf8'),n=fn(s);if(s===n)throw Error(p);fs.writeFileSync(p,n);};
edit('src/player/PlayerMotor.ts',s=>s.replace('sprinting=false;','sprinting=false;\n  regenerationDelay=0;').replace('this.invulnerable=Math.max(0,this.invulnerable-dt);','this.invulnerable=Math.max(0,this.invulnerable-dt);this.regenerationDelay=Math.max(0,this.regenerationDelay-dt);').replace('this.position.y<=ground &&','this.position.y<=ground+.002 &&').replace('if(this.hp>0)this.hp=Math.min','if(this.hp>0&&this.regenerationDelay===0)this.hp=Math.min').replace('context={...context,finalDamage:applied};','if(applied<=0)return;this.regenerationDelay=2;\n    context={...context,finalDamage:applied};'));
edit('src/ui/PlayerHUD.ts',s=>{
 s="import {DamageFeedback} from './DamageFeedback';\nimport type {DamageContext} from '../core/contracts';\n"+s;
 s=s.replace('private entered=false;', 'private readonly damage=new DamageFeedback();\n  private entered=false;');
 s=s.replace('<div class="hp-track"><i></i></div>','<div class="hp-track"><i class="hp-lag"></i><i class="hp-current"></i></div>');
 s=s.replace('document.body.append(this.element);',`this.element.insertAdjacentHTML('beforeend','<div class="player-damage-screen" aria-hidden="true"><div class="damage-direction"><i></i></div></div><div class="player-damage-number" role="status"></div>');\n    document.body.append(this.element);`);
 s=s.replace('  ready(): void', `  hit(context:DamageContext,yaw:number,hp:number,maxHP:number):void {this.damage.hit(context.finalDamage,Math.min(1,(hp+context.finalDamage)/maxHP),context.forceDirection,yaw);}\n  ready(): void`);
 s=s.replace("enemies:Pick<EnemyReview,'count'|'kills'|'status'>): void", "enemies:Pick<EnemyReview,'count'|'kills'|'status'>,dt=1/60): void");
 s=s.replace("this.element.querySelector('.hp-track i')", "this.element.querySelector('.hp-current')");
 s=s.replace("    this.charges.textContent=",`    this.damage.update(dt,player.hp/player.maxHP);
    (this.element.querySelector('.hp-lag') as HTMLElement).style.width=this.damage.trail*100+'%';
    const screen=this.element.querySelector('.player-damage-screen') as HTMLElement;screen.style.opacity=String(Math.min(.9,this.damage.flash*2)+(player.hp/player.maxHP<.25?.12:0));
    (screen.querySelector('.damage-direction') as HTMLElement).style.transform='rotate('+this.damage.angle+'rad)';
    const loss=this.element.querySelector('.player-damage-number') as HTMLElement;loss.textContent=this.damage.flash>0?'−'+this.damage.amount+' HP':'';loss.style.opacity=String(Math.min(1,this.damage.flash*3));
    this.element.querySelector('.player-vitals')!.classList.toggle('taking-damage',this.damage.flash>0);
    this.element.querySelector('.player-vitals small')!.textContent=player.regenerationDelay>0?'SOB ATAQUE':player.hp/player.maxHP<.25?'VIDA CRÍTICA':'REGENERAÇÃO ATIVA';
    this.element.querySelector('.player-abilities small')!.textContent=player.sprinting?'CORRENDO · TIRO/PARAR INTERROMPE':'SHIFT · ROLAR E CORRER';
    this.charges.textContent=`);
 return s;
});
edit('src/camera/ThirdPersonCamera.ts',s=>s.replace('private kick=0;','private kick=0;private hurtKick=0;private hurtSide=1;').replace('  update(position:',`  hurt(strength:number,side:number):void {this.hurtKick=Math.min(.13,this.hurtKick+strength*this.shake);this.hurtSide=side<0?-1:1;}\n  update(position:`).replace('0,this.kick,0','0,this.kick+this.hurtKick,0').replace('    this.initialized=true;','    this.camera.rotation.z=this.hurtKick*this.hurtSide*.4;this.hurtKick*=Math.exp(-dt*9);\n    this.initialized=true;'));
edit('src/audio/RecordedAudio.ts',s=>{
 s=s.replace('private loading=false;', 'private duckUntil=0;private loading=false;');
 s=s.replace('this.buffers.get(group);', "this.buffers.get(group==='player-hit'?'heavy':group);");
 s=s.replace('this.voices>=20','this.voices>=(group===\'player-hit\'?22:18)');
 s=s.replace('gain.gain.value=volume;', "gain.gain.value=volume*(group!=='player-hit'&&context.currentTime<this.duckUntil?.35:1);");
 return s.replace(' impact(heavy=false)'," playerHurt():void {if(this.context)this.duckUntil=this.context.currentTime+.25;this.play('player-hit',.95,.82,0,.12);}\n impact(heavy=false)");
});
edit('src/game/PlayerScene.ts',s=>s.replace("this.events.on('PlayerHit',()=>{this.camera.impulse(.065);this.audio.impact(true);});", "this.events.on('PlayerHit',context=>{this.hud.hit(context,this.input.yaw,this.player.hp,this.player.maxHP);this.camera.hurt(.18,context.forceDirection.x*Math.cos(this.input.yaw)-context.forceDirection.z*Math.sin(this.input.yaw));this.audio.playerHurt();});").replace("this.mp,this.enemies);","this.mp,this.enemies,animDt);"));
fs.appendFileSync('src/style.css',`\n.player-damage-screen{position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;background:radial-gradient(ellipse at center,transparent 42%,#d52b2470 77%,#960e17d9 100%)}
.damage-direction{position:absolute;width:230px;height:230px;left:calc(50% - 115px);top:calc(50% - 115px)}.damage-direction i{position:absolute;left:80px;top:0;width:70px;height:22px;border-top:6px solid #ff6856;border-radius:50%;filter:drop-shadow(0 0 6px #c80000)}
.player-damage-number{position:fixed;left:calc(50% + 45px);top:58%;z-index:7;color:#ff9686;font:bold 22px system-ui;pointer-events:none;text-shadow:0 2px 4px #380400}
.hp-track{position:relative;overflow:hidden}.hp-track i.hp-lag{position:absolute;left:0;top:0;bottom:0;background:#ffe2a0;transition:none}.hp-track i.hp-current{position:relative;z-index:1}.player-vitals.taking-damage{filter:drop-shadow(0 0 10px #ec352980)}.player-vitals.taking-damage .hp-value{color:#ffb3a0}
`);
