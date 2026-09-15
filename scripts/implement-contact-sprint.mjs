import fs from 'node:fs';
function edit(p,fn){const old=fs.readFileSync(p,'utf8'),s=fn(old);if(s===old)throw Error(p);fs.writeFileSync(p,s);}
edit('src/physics/CollisionWorld.ts',s=>{
 s="import {actorContact,type SolidActor} from './ActorContact';\n"+s;
 s=s.replace('readonly boxes: BoxCollider[] = [];','readonly playerBodies=new Map<number,SolidActor>();\n  readonly boxes: BoxCollider[] = [];');
 s=s.replace('if(a>enter) {','if(a>=enter) {');
 const pos=s.indexOf('  move(position:');
 return s.slice(0,pos)+`  /** Continuous full-height sweep for airborne movement, with sliding instead of wall penetration. */
  moveAirborne(position:Vec3,delta:Vec3,radius:number,height:number):boolean {
    const remaining={...delta};let verticalHit=false;
    for(let iteration=0;iteration<4;iteration++){
      let nearest:{time:number;normal:Vec3}|undefined;
      for(const b of this.nearbyBoxes(position.x+remaining.x*.5,position.z+remaining.z*.5,Math.max(Math.abs(remaining.x),Math.abs(remaining.z))*.5+radius)){
        const box={id:b.id,min:{x:b.min.x-radius,y:b.min.y-height,z:b.min.z-radius},max:{x:b.max.x+radius,y:b.max.y,z:b.max.z+radius}};
        const hit=sweepBox(position,remaining,box);if(hit&&hit.normal.x*remaining.x+hit.normal.y*remaining.y+hit.normal.z*remaining.z< -1e-9&&(!nearest||hit.time<nearest.time))nearest=hit;
      }
      if(!nearest){position.x+=remaining.x;position.y+=remaining.y;position.z+=remaining.z;break;}
      const advance=Math.max(0,nearest.time-.0001);position.x+=remaining.x*advance;position.y+=remaining.y*advance;position.z+=remaining.z*advance;
      const left=1-advance;remaining.x*=left;remaining.y*=left;remaining.z*=left;
      const dot=remaining.x*nearest.normal.x+remaining.y*nearest.normal.y+remaining.z*nearest.normal.z;
      remaining.x-=dot*nearest.normal.x;remaining.y-=dot*nearest.normal.y;remaining.z-=dot*nearest.normal.z;if(nearest.normal.y)verticalHit=true;
    }return verticalHit;
  }
  constrainPlayer(origin:Vec3,delta:Vec3,radius:number,height:number):Vec3 {
    const p={...origin},remaining={...delta};
    for(let i=0;i<3;i++){
      let nearest:ReturnType<typeof actorContact>;
      for(const body of this.playerBodies.values()){if(!body.active())continue;const hit=actorContact(p,remaining,body,radius,height);if(hit&&(!nearest||hit.time<nearest.time))nearest=hit;}
      if(!nearest){p.x+=remaining.x;p.z+=remaining.z;break;}
      const advance=Math.max(0,nearest.time-.0001);p.x+=remaining.x*advance;p.z+=remaining.z*advance;
      remaining.x*=1-advance;remaining.z*=1-advance;const dot=remaining.x*nearest.normal.x+remaining.z*nearest.normal.z;remaining.x-=dot*nearest.normal.x;remaining.z-=dot*nearest.normal.z;
    }return{x:p.x-origin.x,y:delta.y,z:p.z-origin.z};
  }
`+s.slice(pos);
});
edit('src/player/PlayerTuning.ts',s=>s.replace('speed: 9,','speed: 9, sprintMultiplier: 1.4,'));
edit('src/player/PlayerMotor.ts',s=>{
 s=s.replace('grounded = true;','grounded = true;\n  sprinting=false;');
 s=s.replace('resetAt(spawn:Vec3):void {','resetAt(spawn:Vec3):void {this.sprinting=false;');
 s=s.replace('const moveX=x*Math.cos', 'if(magnitude<.1||input.fire||input.charging||this.retreatRemaining>0)this.sprinting=false;\n    const moveX=x*Math.cos');
 s=s.replace('this.dodgeRemaining=t.dodgeSeconds;', 'this.sprinting=magnitude>.1&&!input.fire&&!input.charging;this.dodgeRemaining=t.dodgeSeconds;');
 s=s.replace('t.speed*this.moveMultiplier*(input.charging?.7:1)', 't.speed*this.moveMultiplier*(this.sprinting?t.sprintMultiplier:1)*(input.charging?.7:1)');
 const a=s.indexOf('    this.world.move(this.position,dx'),b=s.indexOf('    const allowedHeight=',a);
 s=s.slice(0,a)+`    const oldY=this.position.y;
    this.velocity.y=Math.max(-t.terminalVelocity,this.velocity.y-t.gravity*dt);
    const motion=this.world.constrainPlayer(this.position,{x:dx,y:this.velocity.y*dt,z:dz},t.radius,t.height);
    const beforeX=this.position.x,beforeZ=this.position.z;
    if(wasGrounded){this.world.move(this.position,motion.x,motion.z,t.radius,t.height,t.stepHeight);this.position.y+=motion.y;}
    else if(this.world.moveAirborne(this.position,motion,t.radius,t.height))this.velocity.y=0;
    if(this.dodgeRemaining===0&&this.retreatRemaining===0){this.velocity.x=(this.position.x-beforeX)/dt;this.velocity.z=(this.position.z-beforeZ)/dt;}
`+s.slice(b);
 s=s.replace('this.velocity.x=0;this.velocity.y=0;this.velocity.z=0;this.dodgeRemaining=0;', 'this.velocity.x=0;this.velocity.y=0;this.velocity.z=0;this.sprinting=false;this.dodgeRemaining=0;');return s;
});
edit('src/game/EnemySwarm.ts',s=>{
 s=s.replace('anim:number;hit:number;', 'anim:number;hit:number;stagger:number;staggerCooldown:number;');
 s=s.replace('anim:0,hit:0,','anim:0,hit:0,stagger:0,staggerCooldown:0,');s=s.replace('actor.hit=0;','actor.hit=0;actor.stagger=0;actor.staggerCooldown=0;');
 s=s.replace('this.tactical?.add(actor.id,at,',`this.world.collision.playerBodies.set(actor.id,{id:actor.id,position:actor.root.position,radius:definition.radius*affix.scale,height:actor.kind==='watermelon'?1.6:2,active:()=>actor!.active&&!actor!.health.dead&&actor!.kind!=='tomato'&&actor!.state!=='spawn'});
    this.tactical?.add(actor.id,at,`);
 const a=s.indexOf('a.hit=.28;'),b=s.indexOf("this.audio?.enemy('hit'",a);
 s=s.slice(0,a)+`a.hit=.10;const regular=context.sourceId==='dual_pistols'||context.procChainDepth>0;
    const force=Math.min(10,context.forceMagnitude*(regular?.18:.65))/(a.variant==='giant'?3:a.kind==='boss'?5:1);
    if(force>.5)a.push.set(context.forceDirection.x*force,0,context.forceDirection.z*force);
    if(!regular&&force>3&&a.staggerCooldown<=0){a.stagger=.18;a.staggerCooldown=.85;if(a.state==='windup'){a.state='chase';a.time=0;a.cooldown=.4;}}
    `+s.slice(b);
 s=s.replace('a.hit=Math.max(0,a.hit-dt);','a.hit=Math.max(0,a.hit-dt);a.stagger=Math.max(0,a.stagger-dt);a.staggerCooldown=Math.max(0,a.staggerCooldown-dt);');
 s=s.replace("a.hit>0?'Hit'", "a.stagger>0?'Hit'").replace("a.state==='recover'&&a.hit===0","a.state==='recover'&&a.stagger===0").replace('a.hit>0?1-a.hit/.28','a.stagger>0?1-a.stagger/.18').replace('Math.min(.65,a.hit*3)','Math.min(.48,a.hit*5)');
 const c=s.indexOf('    // Bodies yield to the player'),d=s.indexOf('    // Local separation only;',c);s=s.slice(0,c)+s.slice(d);
 return s;
});
edit('src/ai/TacticalNavigation.ts',s=>s.replace('radius:.65,height:1.8,maxSpeed:0,separationWeight:8','radius:.32,height:1.8,maxSpeed:0,separationWeight:0'));
edit('src/game/PlayerScene.ts',s=>s.replace('animDt,true,this.charging','animDt,!this.player.sprinting||this.charging,this.charging').replace(' m/s\\nMira',' m/s · ${this.player.sprinting?\'CORRENDO\':\'NORMAL\'}\\nMira'));
fs.appendFileSync('docs/OBJECTIVES_QUEUE.md','\n## Sensação de combate e parkour — pedidos acumulados de 07/09\n\n- [ ] Dano recebido com direção, perda de vida visível, impacto de câmera e áudio destacado.\n- [ ] Reduzir atordoamento dos tiros comuns; impactos fortes com intervalo de reação.\n- [ ] Corpos dos inimigos bloqueiam o jogador sem deslizarem ao encostar.\n- [ ] Após rolar, manter corrida até parar/atirar; preservar velocidade no salto.\n- [ ] Colisão contínua no walljump e parkour, incluindo quinas e tetos.\n- [ ] MP I: sequência em leque de balas curvas que ricocheteiam, sem alvo travado.\n');
