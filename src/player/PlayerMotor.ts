import type { DamageContext, GameEvents, Vec3 } from '../core/contracts';
import type { EventBus } from '../core/EventBus';
import type { InputFrame } from '../input/GameInput';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { PLAYER_TUNING as t } from './PlayerTuning';
import {findSafeRecovery,safeRecoverySupport} from './SafeRecovery';

export class PlayerMotor {
  readonly position: Vec3;
  readonly previous: Vec3;
  readonly velocity: Vec3 = {x:0,y:0,z:0};
  private readonly push={x:0,z:0};
  knockback(direction:Vec3,strength:number):void {const length=Math.hypot(direction.x,direction.z);if(length<.001)return;const force=Math.max(0,Math.min(14,strength));this.push.x=direction.x/length*force;this.push.z=direction.z/length*force;}
  readonly safe: Vec3;
  private readonly initialSpawn:Vec3;
  hp: number = t.maxHP;
  maxHP:number=t.maxHP;
  debugInvincible=false;
  moveMultiplier=1;jumpMultiplier=1;extraJumps=0;airJumpsUsed=0;rechargeMultiplier=1;regeneration:number=t.regeneration;armor=0;
  /** Bônus acumulativo de corrida vindo dos itens; 1 = corrida base de 8 m/s. */
  sprintMultiplier=1;
  grounded = true;
  sprinting=false;
  /** Contato com superfície acima da inclinação máxima: o corpo escorrega em vez de ficar suspenso. */
  sliding=false;
  slideSeconds=0;
  /** Episódios de deslizamento nesta tentativa; `slideSeconds` mede só o episódio atual. */
  slides=0;
  dashRemaining=0;dashCooldown=0;dashes=0;private dashDirection={x:0,z:1};private dashAirUsed=0;
  private readonly tapClock=new Map<'x+'|'x-'|'z+'|'z-',number>();
  private lastAxis={x:0,z:0};
  get dashYaw():number{return Math.atan2(this.dashDirection.x,this.dashDirection.z);}
  regenerationDelay=0;
  bumpRemaining=0;
  yaw = 0;
  charges: number = t.dodgeCharges;
  recharge = 0;
  dodgeRemaining = 0;
  invulnerable = 0;
  private dodgeDirection = {x:0,z:1};
  private coyote: number = t.coyoteSeconds;
  private jumpBuffer = 0;
  private airDodged = false;
  private safeElapsed = 0;
  jumps = 0;
  dodges = 0;
  respawns = 0;solidRecoveries=0;
  private retreatRemaining=0;
  private retreatYaw=0;
  wallSliding=false;wallJumps=0;private wallKick=0;private lastWall:string|undefined;
  get dodgeYaw():number{return Math.atan2(this.dodgeDirection.x,this.dodgeDirection.z);}
  /** Collision-constrained repositioning; locomotion and camera remain controllable. */
  barrageRetreat(): void {this.dashRemaining=0;this.retreatRemaining=.6;this.retreatYaw=this.yaw;if(this.grounded){this.velocity.y=8.4;this.grounded=false;this.coyote=0;}}
  get backflipProgress():number {return this.retreatRemaining>0?1-this.retreatRemaining/.6:-1;}
  resetAt(spawn:Vec3):void {this.sliding=false;this.slideSeconds=0;this.dashRemaining=0;this.dashCooldown=0;this.dashAirUsed=0;this.slides=0;this.tapClock.clear();this.lastAxis={x:0,z:0};this.bumpRemaining=0;this.sprinting=false;this.regenerationDelay=0;this.push.x=0;this.push.z=0;this.wallKick=0;this.lastWall=undefined;this.wallSliding=false;this.position.x=spawn.x;this.position.y=spawn.y;this.position.z=spawn.z;Object.assign(this.previous,this.position);Object.assign(this.safe,this.position);this.velocity.x=0;this.velocity.y=0;this.velocity.z=0;this.hp=this.maxHP;this.grounded=true;this.charges=t.dodgeCharges;this.recharge=0;this.dodgeRemaining=0;this.retreatRemaining=0;this.airDodged=false;this.airJumpsUsed=0;this.jumpBuffer=0;this.coyote=t.coyoteSeconds;this.invulnerable=1;}
  constructor(private readonly world: CollisionWorld,private readonly events: EventBus<GameEvents>,spawn: Vec3) {
    this.initialSpawn={...spawn};
    this.position={x:spawn.x,y:spawn.y,z:spawn.z};this.previous={...this.position};this.safe={...this.position};
  }
  fixedUpdate(dt: number,input: InputFrame,yaw: number): void {
    if(this.hp<=0)return;
    if(this.world.insideSolid(this.position,t.height)){
      const destination=findSafeRecovery(this.world,this.safe,this.initialSpawn);
      if(destination)Object.assign(this.safe,destination);
      // O dash também precisa morrer aqui: senão o resto do deslocamento empurra de volta para a emenda.
      Object.assign(this.position,this.safe);Object.assign(this.previous,this.safe);this.velocity.x=0;this.velocity.y=0;this.velocity.z=0;this.push.x=0;this.push.z=0;this.dodgeRemaining=0;this.retreatRemaining=0;this.dashRemaining=0;this.sliding=false;this.slideSeconds=0;this.sprinting=false;this.solidRecoveries++;
    }
    Object.assign(this.previous,this.position);this.yaw=yaw;
    this.bumpRemaining=Math.max(0,this.bumpRemaining-dt);this.wallKick=Math.max(0,this.wallKick-dt);this.wallSliding=false;if(this.grounded)this.lastWall=undefined;
    this.invulnerable=Math.max(0,this.invulnerable-dt);this.regenerationDelay=Math.max(0,this.regenerationDelay-dt);
    this.coyote=this.grounded?t.coyoteSeconds:Math.max(0,this.coyote-dt);
    this.jumpBuffer=input.jump?t.jumpBufferSeconds:Math.max(0,this.jumpBuffer-dt);
    if(this.charges<t.dodgeCharges) {
      this.recharge+=dt*this.rechargeMultiplier;
      if(this.recharge>=t.dodgeRechargeSeconds) {this.charges++;this.recharge-=t.dodgeRechargeSeconds;}
    } else this.recharge=0;
    let x=input.x,z=input.z;const magnitude=Math.hypot(x,z);if(magnitude>1){x/=magnitude;z/=magnitude;}
    if(magnitude<.1||input.fire||input.charging||this.retreatRemaining>0)this.sprinting=false;
    const moveX=x*Math.cos(yaw)+z*Math.sin(yaw);const moveZ=z*Math.cos(yaw)-x*Math.sin(yaw);
    this.updateDash(dt,input,yaw,moveX,moveZ);
    const wall=!this.grounded&&Math.hypot(moveX,moveZ)>.1?this.world.sweepSphere({x:this.position.x,y:this.position.y+.9,z:this.position.z},{x:moveX*.55,y:0,z:moveZ*.55},t.radius,true):undefined;
    if(wall&&(wall.normal.x||wall.normal.z)&&wall.collider.max.y>this.position.y+.7){
      if(this.velocity.y<0){this.wallSliding=true;this.velocity.y=Math.max(-3,this.velocity.y);}
      if(input.jump&&this.coyote<=0&&this.lastWall!==wall.collider.id){this.velocity.x=wall.normal.x*7;this.velocity.z=wall.normal.z*7;this.velocity.y=Math.sqrt(2*t.gravity*1.8);this.wallKick=.28;this.lastWall=wall.collider.id;this.jumpBuffer=0;this.wallJumps++;this.events.emit('SkillUsed',{entityId:1,skillId:'wall_jump'});}
    }
    // Esquiva durante o dash era cobrada e não deslocava, porque o bloco do dash sobrescreve dx/dz.
    if(input.dodge && this.charges>0 && this.dodgeRemaining<=0 && this.dashRemaining<=0 && (this.grounded || !this.airDodged)) {
      const length=Math.hypot(moveX,moveZ);
      this.dodgeDirection=length>0?{x:moveX/length,z:moveZ/length}:{x:Math.sin(yaw),z:Math.cos(yaw)};
      this.sprinting=magnitude>.1&&!input.fire&&!input.charging;this.dodgeRemaining=t.dodgeSeconds;this.invulnerable=t.dodgeIFrames;this.charges--;this.dodges++;
      if(!this.grounded)this.airDodged=true;
      this.events.emit('Dodged',{entityId:1,direction:{...this.dodgeDirection,y:0}});
    }
    if(this.jumpBuffer>0 && this.coyote>0) {
      this.velocity.y=Math.sqrt(2*t.gravity*t.jumpApex*this.jumpMultiplier);this.grounded=false;this.coyote=0;this.jumpBuffer=0;this.jumps++;
      this.events.emit('SkillUsed',{entityId:1,skillId:'jump'});
    } else if(input.jump&&this.jumpBuffer>0&&!this.grounded&&this.airJumpsUsed<Math.max(0,Math.floor(this.extraJumps))) {
      this.velocity.y=Math.sqrt(2*t.gravity*t.jumpApex*this.jumpMultiplier);this.coyote=0;this.jumpBuffer=0;this.airJumpsUsed++;this.jumps++;
      this.events.emit('SkillUsed',{entityId:1,skillId:'air_jump'});
    }
    const control=this.grounded?1:t.airControl;
    const speed=t.speed*this.moveMultiplier*(this.sprinting?t.sprintMultiplier*this.sprintMultiplier:1)*(input.charging?.7:1);
    const accel=this.wallKick>0?0:1-Math.exp(-dt*control/t.accelerationSeconds);
    this.velocity.x+=(moveX*speed-this.velocity.x)*accel;
    this.velocity.z+=(moveZ*speed-this.velocity.z)*accel;
    const wasGrounded=this.grounded;
    let dx=this.velocity.x*dt,dz=this.velocity.z*dt;
    if(this.dodgeRemaining>0) {
      const active=Math.min(dt,this.dodgeRemaining);
      const from=1-this.dodgeRemaining/t.dodgeSeconds,to=from+active/t.dodgeSeconds;
      const smooth=(p:number)=>p*p*(3-2*p),travel=t.dodgeDistance*(smooth(to)-smooth(from));
      dx=this.dodgeDirection.x*travel+this.velocity.x*(dt-active);
      dz=this.dodgeDirection.z*travel+this.velocity.z*(dt-active);
      this.dodgeRemaining=this.dodgeRemaining-dt<1e-8?0:this.dodgeRemaining-dt;
    }
    if(this.retreatRemaining>0) {
      const active=Math.min(dt,this.retreatRemaining);this.retreatRemaining=Math.max(0,this.retreatRemaining-dt);
      dx-=Math.sin(this.retreatYaw)*4/.6*active;dz-=Math.cos(this.retreatYaw)*4/.6*active;
    }
    if(this.dashRemaining>0) {
      const active=Math.min(dt,this.dashRemaining);
      const from=1-this.dashRemaining/t.dashSeconds,to=from+active/t.dashSeconds;
      const smooth=(p:number)=>1-(1-p)*(1-p),travel=t.dashDistance*(smooth(to)-smooth(from));
      dx=this.dashDirection.x*travel+this.velocity.x*(dt-active);
      dz=this.dashDirection.z*travel+this.velocity.z*(dt-active);
      this.dashRemaining=this.dashRemaining-dt<1e-8?0:this.dashRemaining-dt;
    }
    dx+=this.push.x*dt;dz+=this.push.z*dt;const damping=Math.exp(-dt*7);this.push.x*=damping;this.push.z*=damping;
    const oldY=this.position.y;
    this.velocity.y=Math.max(-t.terminalVelocity,this.velocity.y-t.gravity*dt);
    const motion=this.world.constrainPlayer(this.position,{x:dx,y:this.velocity.y*dt,z:dz},t.radius,t.height);
    if(Math.hypot(motion.x-dx,motion.z-dz)>.02&&Math.hypot(dx,dz)/dt>3&&this.bumpRemaining===0){this.bumpRemaining=.24;this.sprinting=false;if(this.dodgeRemaining>0)this.dodgeRemaining=0;this.events.emit('BodyBumped',{entityId:1,strength:Math.min(1,Math.hypot(dx,dz)/dt/13)});}
    const beforeX=this.position.x,beforeZ=this.position.z;
    let verticalContact=false;
    if(wasGrounded){this.world.move(this.position,motion.x,motion.z,t.radius,t.height,t.stepHeight,true);this.position.y+=motion.y;}
    else if(this.world.moveAirborne(this.position,motion,t.radius,t.height,Math.cos(t.maxSlopeDegrees*Math.PI/180))){verticalContact=true;this.velocity.y=0;}
    if(this.dodgeRemaining===0&&this.retreatRemaining===0&&this.dashRemaining===0){this.velocity.x=(this.position.x-beforeX)/dt;this.velocity.z=(this.position.z-beforeZ)/dt;}
    const allowedHeight=oldY+(wasGrounded?t.stepHeight:.005);
    const ground=this.world.groundAt(this.position.x,this.position.z,allowedHeight,t.maxSlopeDegrees);
    this.grounded=false;
    // Follow descending treads; compensate the rounded capsule's contact offset on walkable slopes.
    // Airborne snapping requires an actual collision and remains below the maximum slope contact gap.
    const supportGap=wasGrounded?t.stepHeight:verticalContact?t.radius*(1/Math.cos(t.maxSlopeDegrees*Math.PI/180)-1)+.005:.002;
    if(this.velocity.y<=0 && this.position.y<=ground+supportGap && oldY>=ground-(wasGrounded?t.stepHeight:.01)) {
      this.position.y=ground;this.velocity.y=0;this.grounded=true;this.airDodged=false;this.airJumpsUsed=0;this.dashAirUsed=0;
    }
    this.resolveSteepSlope(dt,ground,oldY,wasGrounded);
    if(this.grounded) {
      this.safeElapsed+=dt;
      if(this.safeElapsed>=t.safeGroundInterval){if(safeRecoverySupport(this.world,this.position))Object.assign(this.safe,this.position);this.safeElapsed=0;}
    } else this.safeElapsed=0;
    if(this.position.y<t.voidHeight) this.respawn();
    if(this.hp>0&&this.regenerationDelay===0)this.hp=Math.min(this.maxHP,this.hp+this.regeneration*dt);
  }
  /**
   * Arrancada direcional, também no ar, com custo de carga aérea e recarga.
   * O deslocamento passa pelas mesmas varreduras de colisão do movimento normal — não atravessa parede.
   *
   * A INTENÇÃO vem pronta em `input.dash` (detectada na captura, viaja no pacote de rede).
   * Quando o quadro não traz o campo — testes antigos, ferramentas — o motor ainda detecta
   * o duplo toque sozinho, para não depender de quem constrói o `InputFrame`.
   */
  private updateDash(dt:number,input:InputFrame,yaw:number,moveX:number,moveZ:number):void {
    this.dashCooldown=Math.max(0,this.dashCooldown-dt);
    for(const [key,clock] of this.tapClock){const left=clock-dt;if(left<=0)this.tapClock.delete(key);else this.tapClock.set(key,left);}
    const axes:[('x+'|'x-'|'z+'|'z-'),number,number][]=[['x+',input.x,this.lastAxis.x],['x-',-input.x,-this.lastAxis.x],['z+',input.z,this.lastAxis.z],['z-',-input.z,-this.lastAxis.z]];
    let detected:'x+'|'x-'|'z+'|'z-'|undefined,pressed:'x+'|'x-'|'z+'|'z-'|undefined;
    for(const [key,current,previous] of axes){
      if(!(current>.5&&previous<=.5))continue;
      pressed??=key;
      if(this.tapClock.has(key))detected=key;else this.tapClock.set(key,t.dashDoubleTapSeconds);
    }
    this.lastAxis={x:input.x,z:input.z};
    const requested=input.dash===undefined?detected:(input.dash?(pressed??detected??this.facingAxis(input)):undefined);
    if(!requested||this.dashRemaining>0||this.dashCooldown>0||this.dodgeRemaining>0||this.retreatRemaining>0)return;
    if(!this.grounded&&this.dashAirUsed>=t.dashAirCharges)return;
    const local=requested==='x+'?{x:1,z:0}:requested==='x-'?{x:-1,z:0}:requested==='z+'?{x:0,z:1}:{x:0,z:-1};
    const length=Math.hypot(moveX,moveZ);
    this.dashDirection=length>.1?{x:moveX/length,z:moveZ/length}:{x:local.x*Math.cos(yaw)+local.z*Math.sin(yaw),z:local.z*Math.cos(yaw)-local.x*Math.sin(yaw)};
    this.dashRemaining=t.dashSeconds;this.dashCooldown=t.dashCooldownSeconds;this.dashes++;this.tapClock.clear();
    if(!this.grounded)this.dashAirUsed++;
    this.events.emit('SkillUsed',{entityId:1,skillId:'dash'});
  }
  /** Eixo dominante ainda pressionado; usado quando a intenção chega sem borda no mesmo quadro. */
  private facingAxis(input:InputFrame):'x+'|'x-'|'z+'|'z-' {
    if(Math.abs(input.x)>Math.abs(input.z))return input.x>0?'x+':'x-';
    if(Math.abs(input.z)>0)return input.z>0?'z+':'z-';
    return 'z+';
  }
  /**
   * Em superfície acima da inclinação máxima o corpo apoia na malha real e escorrega ladeira abaixo.
   * Sem isto a cápsula podia ficar suspensa contra a face íngreme, porque `groundAt` a descarta.
   */
  private resolveSteepSlope(dt:number,walkable:number,oldY:number,wasGrounded:boolean):void {
    if(this.grounded||this.velocity.y>0||this.dodgeRemaining>0||this.dashRemaining>0){this.sliding=false;this.slideSeconds=0;return;}
    const support=this.world.surfaceAt?.(this.position.x,this.position.z,oldY+(wasGrounded?t.stepHeight:.05));
    if(!support||support.slopeDegrees<=t.maxSlopeDegrees||support.height<=walkable+1e-4){this.sliding=false;this.slideSeconds=0;return;}
    const gap=t.radius*(1/Math.cos(Math.min(84,support.slopeDegrees)*Math.PI/180)-1)+.05;
    if(this.position.y>support.height+gap||oldY<support.height-.35){this.sliding=false;this.slideSeconds=0;return;}
    // A face íngreme NÃO sustenta e NÃO reposiciona o corpo. Fixar/elevar a altura aqui colava o
    // jogador na beirada do penhasco para sempre — exatamente o "ficar suspenso" que se quer evitar.
    // A varredura da cápsula já impede penetrar a rampa; aqui só somamos o empurrão ladeira abaixo
    // enquanto a gravidade continua integrando normalmente.
    if(!this.sliding)this.slides++;
    this.sliding=true;this.sprinting=false;this.slideSeconds+=dt;
    // Escorregar tem saída: há contato com o solo, então o salto e os recursos aéreos voltam.
    this.coyote=t.coyoteSeconds;this.airDodged=false;this.airJumpsUsed=0;this.dashAirUsed=0;
    const downX=support.normal.x,downZ=support.normal.z,length=Math.hypot(downX,downZ);
    if(length<1e-4)return;
    const steepness=Math.sin(support.slopeDegrees*Math.PI/180);
    this.velocity.x+=downX/length*t.slideAcceleration*steepness*dt-this.velocity.x*t.slideFriction*dt;
    this.velocity.z+=downZ/length*t.slideAcceleration*steepness*dt-this.velocity.z*t.slideFriction*dt;
    const planar=Math.hypot(this.velocity.x,this.velocity.z);
    if(planar>t.slideMaxSpeed){this.velocity.x*=t.slideMaxSpeed/planar;this.velocity.z*=t.slideMaxSpeed/planar;}
    // Desprendimento: a varredura trata o contato como piso e zera a queda, o que prendia o corpo
    // na beira. Como a face não sustenta, a descida é forçada e o corpo é afastado NA DIREÇÃO DA
    // NORMAL (para fora do sólido), então o empurrão nunca enfia ninguém dentro da geometria.
    this.velocity.y=Math.min(this.velocity.y,-2);
    const descent=Math.abs(this.velocity.y)*dt;
    this.position.y=Number.isFinite(walkable)&&this.position.y-descent<walkable?Math.max(walkable,this.position.y-descent):this.position.y-descent;
    const release=Math.min(t.slideMaxSpeed,t.slideAcceleration*steepness)*dt;
    this.position.x+=downX/length*release;this.position.z+=downZ/length*release;
  }
  private respawn(): void {
    const damage=this.maxHP*t.voidDamageFraction;
    const context: DamageContext={attackerId:0,victimId:1,sourceId:'void',attackId:'void_return',baseDamage:damage,finalDamage:damage,crit:false,procCoefficient:0,procChainDepth:0,damageTags:['environment'],hitPosition:{...this.position},hitNormal:{x:0,y:1,z:0},forceDirection:{x:0,y:0,z:0},forceMagnitude:0};
    this.applyDamage(context);
    const destination=findSafeRecovery(this.world,this.safe,this.initialSpawn);
    if(destination)Object.assign(this.safe,destination);
    Object.assign(this.position,this.safe);Object.assign(this.previous,this.safe);
    this.velocity.x=0;this.velocity.y=0;this.velocity.z=0;this.sprinting=false;this.dodgeRemaining=0;
    // Sem zerar o dash, o resto do deslocamento continuava a partir do ponto seguro.
    this.dashRemaining=0;this.dashAirUsed=0;this.sliding=false;this.slideSeconds=0;
    this.push.x=0;this.push.z=0;this.retreatRemaining=0;this.wallKick=0;this.wallSliding=false;this.lastWall=undefined;this.jumpBuffer=0;this.safeElapsed=0;
    this.invulnerable=t.respawnProtection;this.grounded=true;this.airDodged=false;this.airJumpsUsed=0;this.respawns++;
  }
  applyDamage(context: DamageContext): void {
    if(this.debugInvincible||this.hp<=0 || context.victimId!==1 || (this.invulnerable>0 && context.sourceId!=='void'))return;
    const applied=context.sourceId==='void'?context.finalDamage:context.finalDamage*100/(100+Math.max(0,this.armor));
    if(applied<=0)return;this.regenerationDelay=2;
    context={...context,finalDamage:applied};this.hp=Math.max(0,this.hp-applied);
    if(context.sourceId!=='void'){this.invulnerable=Math.max(this.invulnerable,.2);this.knockback(context.forceDirection,context.forceMagnitude);}
    this.events.emit('DamageTaken',context);this.events.emit('PlayerHit',context);
    if(this.hp===0)this.events.emit('PlayerKilled',context);
  }
}

