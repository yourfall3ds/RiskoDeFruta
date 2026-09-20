import type { DamageContext, GameEvents, Vec3 } from '../core/contracts';
import type { EventBus } from '../core/EventBus';
import type { InputFrame } from '../input/GameInput';
import type { CollisionWorld } from '../physics/CollisionWorld';
import {
  FLOOR_COS, contactLift, quaternionFromBasis, tangentFrom,
  type Quat, type SurfaceBasis, type SurfaceFrame,
} from '../physics/SurfaceFrame';
import { add, cross, dot, length, normalize, reject, scale, sub, transport } from '../planet/PlanetFrame';
import { PLAYER_TUNING as t } from './PlayerTuning';
import {findSafeRecovery,safeRecoverySupport} from './SafeRecovery';

/**
 * Motor do jogador — **a mesma classe**, agora com "para cima" injetado.
 *
 * O que NÃO mudou: nenhum campo, método ou evento foi removido ou renomeado, e no mundo plano cada
 * número sai idêntico ao de antes. A camada de habilidades (esquiva com i-frames e cargas, dash de
 * duplo toque com carga aérea, buffer/coyote de salto, saltos aéreos extras, wall-jump/wall-slide,
 * backflip, knockback, HP/armadura/regeneração/dano, multiplicadores de item, ponto seguro) é
 * **UMA SÓ** e roda igual nos dois mundos: não existe um segundo motor simplificado.
 *
 * O que mudou: a aritmética planar deixou de ser "componentes X/Z do mundo" e passou a ser
 * "componentes na base tangente `{right, up, reference}`". No mundo plano essa base é
 * `{(1,0,0), (0,1,0), (0,0,1)}` — exata — então `v·right === v.x` bit a bit e as fórmulas de toque
 * ficam literalmente as mesmas. Num planeta a mesma fórmula passa a valer no plano tangente local.
 *
 * Só a INTEGRAÇÃO tem dois caminhos, porque é ali que a esfera é de verdade:
 *   - plano  (`integrateFlat`)   — `constrainPlayer` + `move`/`moveAirborne` + encaixe por `groundAt`;
 *   - esfera (`integrateRadial`) — gravidade em `−up(p)`, cápsula orientada, sonda de apoio radial,
 *     degrau, TRANSPORTE PARALELO da velocidade e da frente, e vazio por raio.
 *
 * `reference` é a tangente de referência transportada: é o zero do `yaw`. No plano ela é constante
 * `(0,0,1)`, e por isso `yaw` continua sendo o yaw global de sempre. Contrato completo (semântica de
 * `heading`/`yaw` para câmera e visual) em `.temp/real-game-surface-api.md`.
 */
export class PlayerMotor {
  readonly position: Vec3;
  readonly previous: Vec3;
  readonly velocity: Vec3 = {x:0,y:0,z:0};
  /** Vertical local do corpo, em MUNDO. Plano: sempre `(0,1,0)`. */
  readonly up: Vec3 = {x:0,y:1,z:0};
  /** Frente do corpo: unitário TANGENTE em MUNDO. Plano: `(sin yaw, 0, cos yaw)`. */
  readonly forward: Vec3 = {x:0,y:0,z:1};
  /** Tangente de referência, transportada em paralelo. Zero do `yaw`. Plano: `(0,0,1)`. */
  readonly reference: Vec3 = {x:0,y:0,z:1};
  /** Empurrão de knockback em componentes LOCAIS (`x` em `right`, `z` em `reference`). */
  private readonly push={x:0,z:0};
  /** Saiu do apoio por vontade própria (salto, backflip, arremesso). Só a esfera adere ao convés. */
  private launched=false;
  knockback(direction:Vec3,strength:number):void {
    const b=this.referenceBasis();
    const x=dot(direction,b.right),z=dot(direction,b.forward);
    const magnitude=Math.hypot(x,z);if(magnitude<.001)return;
    const force=Math.max(0,Math.min(14,strength));this.push.x=x/magnitude*force;this.push.z=z/magnitude*force;
  }
  readonly safe: Vec3;
  private readonly initialSpawn:Vec3;
  hp: number = t.maxHP;
  maxHP:number=t.maxHP;
  /**
   * QUEM é este motor na faixa 1..4, para o teste de vítima do dano.
   *
   * `applyDamage` comparava com o literal `1`: com quatro jogadores, três eram IMORTAIS (armadilha
   * 8.1 do plano). O padrão continua 1, então o jogo de um jogador — e os testes dele — não muda um
   * bit; o servidor escreve o `entityId` real de cada motor na entrada.
   */
  entityId=1;
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
  /** Normal do apoio e inclinação medidas no último passo — leitura para apresentação e VFX. */
  groundNormal:Vec3={x:0,y:1,z:0};groundSlopeDegrees=0;
  get dodgeYaw():number{return Math.atan2(this.dodgeDirection.x,this.dodgeDirection.z);}
  /** Direção de MUNDO da esquiva/dash em curso (tangente unitária). */
  get dodgeWorldDirection():Vec3 {return tangentFrom(this.referenceBasis(),this.dodgeDirection.x,this.dodgeDirection.z);}
  get dashWorldDirection():Vec3 {return tangentFrom(this.referenceBasis(),this.dashDirection.x,this.dashDirection.z);}
  /** Collision-constrained repositioning; locomotion and camera remain controllable. */
  barrageRetreat(): void {this.dashRemaining=0;this.retreatRemaining=.6;this.retreatYaw=this.yaw;if(this.grounded){this.setRadial(8.4);this.grounded=false;this.launched=true;this.coyote=0;}}
  get backflipProgress():number {return this.retreatRemaining>0?1-this.retreatRemaining/.6:-1;}

  // --- referencial ------------------------------------------------------------------------------
  /** O referencial de superfície em uso. `FlatSurface` por default; `SphereSurface` no planeta. */
  private get surface():SurfaceFrame {return this.world.surface;}
  get spherical():boolean {return this.surface.kind!=='flat';}
  /** Base do corpo: `{up, forward, right = up × forward}`. */
  get basis():SurfaceBasis {return {up:{...this.up},forward:{...this.forward},right:cross(this.up,this.forward)};}
  /** Quaternion de raiz pronto para a malha do personagem. */
  get rotation():Quat {const b=this.basis;return quaternionFromBasis(b.right,b.up,b.forward);}
  get altitude():number {return this.surface.altitude(this.position);}
  /** Velocidade no plano tangente — o `hypot(vx, vz)` de antes. */
  get tangentialSpeed():number {return length(reject(this.velocity,this.up));}
  /** Velocidade ao longo da vertical local — o `velocity.y` de antes. */
  get verticalSpeed():number {return dot(this.velocity,this.up);}
  /** Base de REFERÊNCIA: é nela que vivem `moveX/moveZ`, `dodgeDirection`, `dashDirection`, `push`. */
  private referenceBasis():SurfaceBasis {return {up:this.up,forward:this.reference,right:cross(this.up,this.reference)};}
  /** Reescreve a velocidade inteira a partir das componentes locais — exato no mundo plano. */
  private writeVelocity(b:SurfaceBasis,x:number,z:number,r:number):void {
    this.velocity.x=b.right.x*x+b.forward.x*z+b.up.x*r;
    this.velocity.y=b.right.y*x+b.forward.y*z+b.up.y*r;
    this.velocity.z=b.right.z*x+b.forward.z*z+b.up.z*r;
  }
  private setRadial(value:number):void {
    const tangential=reject(this.velocity,this.up);
    this.velocity.x=tangential.x+this.up.x*value;
    this.velocity.y=tangential.y+this.up.y*value;
    this.velocity.z=tangential.z+this.up.z*value;
  }
  /** Solta do apoio — empurrão, explosão, plataforma que some. */
  leaveGround(radialSpeed=0):void {
    this.grounded=false;this.launched=true;this.coyote=0;
    if(radialSpeed!==0)this.setRadial(radialSpeed);
  }
  /** Reorienta a marcha por uma direção de MUNDO (a frente da câmera). Projeta na tangente. */
  setHeading(heading:Vec3):void {
    const b=this.referenceBasis();
    const tangent=reject(heading,b.up);
    if(length(tangent)<1e-6)return;
    this.yaw=Math.atan2(dot(tangent,b.right),dot(tangent,b.forward));
    this.faceYaw(b);
  }
  /** Gira a marcha no plano tangente. Substitui `yaw += dx`; imune a polo. */
  turn(radians:number):void {this.yaw+=radians;this.faceYaw(this.referenceBasis());}
  private faceYaw(b:SurfaceBasis):void {
    const f=tangentFrom(b,Math.sin(this.yaw),Math.cos(this.yaw));
    this.forward.x=f.x;this.forward.y=f.y;this.forward.z=f.z;
  }
  /** Rederiva `up`/`reference`/`forward` no ponto atual — depois de teleporte, spawn ou recuperação. */
  private adoptFrame(hint:Vec3):void {
    const up=this.surface.up(this.position);
    this.up.x=up.x;this.up.y=up.y;this.up.z=up.z;
    const reference=this.surface.basis(this.position,hint).forward;
    this.reference.x=reference.x;this.reference.y=reference.y;this.reference.z=reference.z;
    this.groundNormal={...this.up};this.groundSlopeDegrees=0;
    this.faceYaw(this.referenceBasis());
  }
  /**
   * A vertical mudou com o passo: leva a velocidade e as tangentes junto, por transporte paralelo.
   * Sem isto a corrida perde velocidade e a direção deriva ao dar a volta no planeta.
   * No mundo plano nada é chamado — a vertical é constante e qualquer reprojeção só somaria ruído.
   */
  private carryFrame():void {
    const movedUp=this.surface.up(this.position);
    const rotate=(v:Vec3):Vec3=>transport(v,this.up,movedUp);
    const carried=rotate(this.velocity);
    this.velocity.x=carried.x;this.velocity.y=carried.y;this.velocity.z=carried.z;
    const reference=normalize(reject(rotate(this.reference),movedUp),this.reference);
    this.reference.x=reference.x;this.reference.y=reference.y;this.reference.z=reference.z;
    this.up.x=movedUp.x;this.up.y=movedUp.y;this.up.z=movedUp.z;
    this.faceYaw(this.referenceBasis());
  }

  /** A new biome becomes the fallback island if a later checkpoint loses valid support. */
  arriveAt(spawn:Vec3):void {Object.assign(this.initialSpawn,spawn);this.resetAt(spawn);}
  resetAt(spawn:Vec3):void {this.sliding=false;this.slideSeconds=0;this.dashRemaining=0;this.dashCooldown=0;this.dashAirUsed=0;this.slides=0;this.tapClock.clear();this.lastAxis={x:0,z:0};this.bumpRemaining=0;this.sprinting=false;this.regenerationDelay=0;this.push.x=0;this.push.z=0;this.wallKick=0;this.lastWall=undefined;this.wallSliding=false;this.position.x=spawn.x;this.position.y=spawn.y;this.position.z=spawn.z;Object.assign(this.previous,this.position);Object.assign(this.safe,this.position);this.velocity.x=0;this.velocity.y=0;this.velocity.z=0;this.hp=this.maxHP;this.grounded=true;this.launched=false;this.charges=t.dodgeCharges;this.recharge=0;this.dodgeRemaining=0;this.retreatRemaining=0;this.airDodged=false;this.airJumpsUsed=0;this.jumpBuffer=0;this.coyote=t.coyoteSeconds;this.invulnerable=1;this.adoptFrame(this.forward);}
  constructor(private readonly world: CollisionWorld,private readonly events: EventBus<GameEvents>,spawn: Vec3) {
    this.initialSpawn={...spawn};
    this.position={x:spawn.x,y:spawn.y,z:spawn.z};this.previous={...this.position};this.safe={...this.position};
    this.adoptFrame({x:0,y:0,z:1});
  }
  /**
   * `heading`: no mundo plano um `number` é o yaw GLOBAL de sempre; num planeta é o yaw LOCAL em
   * torno de `up`, medido de `reference`. Um `Vec3` é sempre uma frente de MUNDO (a da câmera),
   * projetada no plano tangente. Ver `.temp/real-game-surface-api.md` §3.2.
   */
  fixedUpdate(dt: number,input: InputFrame,heading: number|Vec3): void {
    if(this.hp<=0)return;
    const surface=this.surface;
    // Roçar numa faceta empurra para fora (esfera); no plano não existe desencrave por empurrão.
    const contact=surface.depenetrate(this.position,t.radius,t.height);
    if(contact){
      const push=Math.min(contact.depth+1e-3,t.radius);
      this.position.x+=contact.normal.x*push;this.position.y+=contact.normal.y*push;this.position.z+=contact.normal.z*push;
    }
    if(surface.insideSolid(this.position,t.height)){
      const destination=findSafeRecovery(this.world,this.safe,this.initialSpawn);
      if(destination)Object.assign(this.safe,destination);
      // O dash também precisa morrer aqui: senão o resto do deslocamento empurra de volta para a emenda.
      Object.assign(this.position,this.safe);Object.assign(this.previous,this.safe);this.velocity.x=0;this.velocity.y=0;this.velocity.z=0;this.push.x=0;this.push.z=0;this.dodgeRemaining=0;this.retreatRemaining=0;this.dashRemaining=0;this.sliding=false;this.slideSeconds=0;this.sprinting=false;this.solidRecoveries++;
      this.adoptFrame(this.forward);
    }
    Object.assign(this.previous,this.position);
    if(typeof heading==='number'){this.yaw=heading;this.faceYaw(this.referenceBasis());}else this.setHeading(heading);
    const yaw=this.yaw;
    const reference=this.referenceBasis();
    let velocityX=dot(this.velocity,reference.right),velocityZ=dot(this.velocity,reference.forward),radial=dot(this.velocity,reference.up);
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
    /**
     * Parede: varredura na altura do ombro, ao longo da vertical LOCAL. `topGap` é a altura do topo
     * do obstáculo acima do ponto sondado — no mundo plano `collider.max.y − (y + .9)`, de modo que
     * `> −.2` é exatamente o antigo `collider.max.y > position.y + .7`.
     */
    const shoulder=add(this.position,scale(this.up,.9));
    const wall=!this.grounded&&Math.hypot(moveX,moveZ)>.1
      ?surface.sweep(shoulder,tangentFrom(reference,moveX*.55,moveZ*.55),t.radius):undefined;
    if(wall){
      const normalX=dot(wall.normal,reference.right),normalZ=dot(wall.normal,reference.forward);
      if((normalX||normalZ)&&wall.topGap>-.2){
        if(radial<0){this.wallSliding=true;radial=Math.max(-3,radial);}
        if(input.jump&&this.coyote<=0&&this.lastWall!==wall.id){velocityX=normalX*7;velocityZ=normalZ*7;radial=Math.sqrt(2*t.gravity*1.8);this.wallKick=.28;this.lastWall=wall.id;this.jumpBuffer=0;this.wallJumps++;this.launched=true;this.events.emit('SkillUsed',{entityId:1,skillId:'wall_jump'});}
      }
    }
    // Esquiva durante o dash era cobrada e não deslocava, porque o bloco do dash sobrescreve dx/dz.
    if(input.dodge && this.charges>0 && this.dodgeRemaining<=0 && this.dashRemaining<=0 && (this.grounded || !this.airDodged)) {
      const reach=Math.hypot(moveX,moveZ);
      this.dodgeDirection=reach>0?{x:moveX/reach,z:moveZ/reach}:{x:Math.sin(yaw),z:Math.cos(yaw)};
      this.sprinting=magnitude>.1&&!input.fire&&!input.charging;this.dodgeRemaining=t.dodgeSeconds;this.invulnerable=t.dodgeIFrames;this.charges--;this.dodges++;
      if(!this.grounded)this.airDodged=true;
      this.events.emit('Dodged',{entityId:1,direction:tangentFrom(reference,this.dodgeDirection.x,this.dodgeDirection.z)});
    }
    if(this.jumpBuffer>0 && this.coyote>0) {
      radial=Math.sqrt(2*t.gravity*t.jumpApex*this.jumpMultiplier);this.grounded=false;this.launched=true;this.coyote=0;this.jumpBuffer=0;this.jumps++;
      this.events.emit('SkillUsed',{entityId:1,skillId:'jump'});
    } else if(input.jump&&this.jumpBuffer>0&&!this.grounded&&this.airJumpsUsed<Math.max(0,Math.floor(this.extraJumps))) {
      radial=Math.sqrt(2*t.gravity*t.jumpApex*this.jumpMultiplier);this.coyote=0;this.jumpBuffer=0;this.airJumpsUsed++;this.jumps++;this.launched=true;
      this.events.emit('SkillUsed',{entityId:1,skillId:'air_jump'});
    }
    const control=this.grounded?1:t.airControl;
    const speed=t.speed*this.moveMultiplier*(this.sprinting?t.sprintMultiplier*this.sprintMultiplier:1)*(input.charging?.7:1);
    const accel=this.wallKick>0?0:1-Math.exp(-dt*control/t.accelerationSeconds);
    velocityX+=(moveX*speed-velocityX)*accel;
    velocityZ+=(moveZ*speed-velocityZ)*accel;
    const wasGrounded=this.grounded;
    let dx=velocityX*dt,dz=velocityZ*dt;
    if(this.dodgeRemaining>0) {
      const active=Math.min(dt,this.dodgeRemaining);
      const from=1-this.dodgeRemaining/t.dodgeSeconds,to=from+active/t.dodgeSeconds;
      const smooth=(p:number)=>p*p*(3-2*p),travel=t.dodgeDistance*(smooth(to)-smooth(from));
      dx=this.dodgeDirection.x*travel+velocityX*(dt-active);
      dz=this.dodgeDirection.z*travel+velocityZ*(dt-active);
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
      dx=this.dashDirection.x*travel+velocityX*(dt-active);
      dz=this.dashDirection.z*travel+velocityZ*(dt-active);
      this.dashRemaining=this.dashRemaining-dt<1e-8?0:this.dashRemaining-dt;
    }
    dx+=this.push.x*dt;dz+=this.push.z*dt;const damping=Math.exp(-dt*7);this.push.x*=damping;this.push.z*=damping;
    const oldAltitude=surface.altitude(this.position);
    radial=Math.max(-t.terminalVelocity,radial-t.gravity*dt);
    this.writeVelocity(reference,velocityX,velocityZ,radial);
    const evading=this.dodgeRemaining!==0||this.retreatRemaining!==0||this.dashRemaining!==0;
    if(this.spherical)this.integrateRadial(dt,dx,dz,radial,wasGrounded,evading);
    else this.integrateFlat(dt,dx,dz,radial,wasGrounded,evading,oldAltitude);
    if(this.grounded) {
      this.safeElapsed+=dt;
      if(this.safeElapsed>=t.safeGroundInterval){if(safeRecoverySupport(this.world,this.position))Object.assign(this.safe,this.position);this.safeElapsed=0;}
    } else this.safeElapsed=0;
    if(surface.belowVoid(this.position)) this.respawn();
    if(this.hp>0&&this.regenerationDelay===0)this.hp=Math.min(this.maxHP,this.hp+this.regeneration*dt);
  }

  /**
   * Integração do mundo plano — **inalterada**. `constrainPlayer` (corpo contra corpo, co-op),
   * `move` horizontal com degrau + soma vertical quando apoiado, `moveAirborne` contínuo no ar,
   * encaixe por `groundAt` com a folga da cápsula arredondada e escorregamento em face íngreme.
   */
  private integrateFlat(dt:number,dx:number,dz:number,radial:number,wasGrounded:boolean,evading:boolean,oldY:number):void {
    const motion=this.world.constrainPlayer(this.position,{x:dx,y:radial*dt,z:dz},t.radius,t.height);
    if(Math.hypot(motion.x-dx,motion.z-dz)>.02&&Math.hypot(dx,dz)/dt>3&&this.bumpRemaining===0){this.bumpRemaining=.24;this.sprinting=false;if(this.dodgeRemaining>0)this.dodgeRemaining=0;this.events.emit('BodyBumped',{entityId:1,strength:Math.min(1,Math.hypot(dx,dz)/dt/13)});}
    const beforeX=this.position.x,beforeZ=this.position.z;
    let verticalContact=false;
    if(wasGrounded){this.world.move(this.position,motion.x,motion.z,t.radius,t.height,t.stepHeight,true);this.position.y+=motion.y;}
    else if(this.world.moveAirborne(this.position,motion,t.radius,t.height,FLOOR_COS)){verticalContact=true;this.velocity.y=0;}
    if(!evading){this.velocity.x=(this.position.x-beforeX)/dt;this.velocity.z=(this.position.z-beforeZ)/dt;}
    const allowedHeight=oldY+(wasGrounded?t.stepHeight:.005);
    const ground=this.world.groundAt(this.position.x,this.position.z,allowedHeight,t.maxSlopeDegrees);
    this.grounded=false;
    // Follow descending treads; compensate the rounded capsule's contact offset on walkable slopes.
    // Airborne snapping requires an actual collision and remains below the maximum slope contact gap.
    const supportGap=wasGrounded?t.stepHeight:verticalContact?contactLift(t.radius,FLOOR_COS)+.005:.002;
    if(this.velocity.y<=0 && this.position.y<=ground+supportGap && oldY>=ground-(wasGrounded?t.stepHeight:.01)) {
      this.position.y=ground;this.velocity.y=0;this.grounded=true;this.launched=false;this.airDodged=false;this.airJumpsUsed=0;this.dashAirUsed=0;
      this.groundNormal={x:0,y:1,z:0};this.groundSlopeDegrees=0;
    }
    this.resolveSteepSlope(dt,ground,oldY,wasGrounded);
  }

  /**
   * Integração radial — gravidade em `−up(p)`, cápsula orientada, apoio por sonda radial.
   *
   * Apoiado, o passo é PURAMENTE TANGENCIAL e ignora contatos de piso: quem acompanha o relevo é a
   * sonda, dentro de `stepHeight`. É a mesma divisão de trabalho do caminho plano (`move` + encaixe)
   * e é o que impede o travamento contra um leque de triângulos coplanares. No ar o passo é 3D
   * completo e nada é ignorado. Ao fim, o transporte paralelo leva velocidade e tangentes para a
   * nova vertical — é isso que faz a volta completa fechar e o polo deixar de ser caso especial.
   */
  private integrateRadial(dt:number,dx:number,dz:number,radial:number,wasGrounded:boolean,evading:boolean):void {
    const surface=this.surface;
    const reference=this.referenceBasis();
    const onFoot=wasGrounded&&!this.launched;
    const tangent=tangentFrom(reference,dx,dz);
    const delta=onFoot?tangent:add(tangent,scale(this.up,radial*dt));
    const before={...this.position};
    const result=surface.slide(
      this.position,delta,t.radius,t.height,onFoot?t.stepHeight:0,
      {ignoreFloors:onFoot,stepUp:onFoot,floorCos:FLOOR_COS},
    );
    this.carryFrame();
    // A varredura barrou o deslocamento; a velocidade perde a componente que entrava na face —
    // é o equivalente ao `velocity.y = 0` do `moveAirborne` plano, mas para qualquer normal.
    for(const normal of [result.floor,result.ceiling,result.wall]){
      if(!normal)continue;
      const into=dot(this.velocity,normal);
      if(into>=0)continue;
      this.velocity.x-=normal.x*into;this.velocity.y-=normal.y*into;this.velocity.z-=normal.z*into;
    }
    if(!evading){
      const carried=this.referenceBasis();
      const moved=sub(this.position,before);
      this.writeVelocity(carried,dot(moved,carried.right)/dt,dot(moved,carried.forward)/dt,dot(this.velocity,this.up));
    }
    this.grounded=false;
    this.settleRadial(wasGrounded,result.floor);
    this.resolveSteepSlopeRadial(dt);
  }

  /**
   * Encaixe no apoio pela sonda radial.
   *
   * `sticky`: numa superfície curva e facetada cada crista dá ao corpo uma velocidade radial
   * positiva minúscula (a 6,8 m/s sobre facetas de ~1°, ≈ 0,12 m/s). Sem aderência o personagem
   * decolava e voltava a cada quadro e `grounded` piscava metade do tempo. Quem já estava apoiado e
   * NÃO saltou continua colado enquanto houver piso dentro de `stepHeight`; andar para fora da
   * beirada não encontra piso nenhum e a queda acontece normalmente.
   */
  private settleRadial(wasGrounded:boolean,contactFloor:Vec3|undefined):boolean {
    const surface=this.surface;
    const radial=dot(this.velocity,this.up);
    const sticky=wasGrounded&&!this.launched;
    const above=wasGrounded?t.stepHeight:.05;
    const below=wasGrounded?t.stepHeight:Math.max(.05,-radial*.02);
    const sample=surface.support(this.position,above,below+.02);
    if(!sample){
      // Sem sonda, mas a varredura tocou piso real: aceita o contato para não flutuar na borda.
      if(contactFloor&&(sticky||radial<=0)){
        this.landOn(contactFloor,Math.acos(Math.min(1,dot(contactFloor,this.up)))*180/Math.PI);
        const kill=dot(this.velocity,this.up);
        if(kill<0)this.setRadial(0);
      }
      return false;
    }
    if(sample.slopeDegrees>t.maxSlopeDegrees){
      this.groundNormal={...sample.normal};this.groundSlopeDegrees=sample.slopeDegrees;
      return false;
    }
    // Descer acompanha degrau/ladeira; subir também, porque o passo apoiado é tangencial e a rampa
    // fica ACIMA do pé no fim do deslocamento — sem isto não se sobe ladeira nenhuma.
    const lift=contactLift(t.radius,dot(sample.normal,this.up));
    const drop=sample.offset-lift;
    const maxDown=wasGrounded?t.stepHeight:.02+contactLift(t.radius,FLOOR_COS);
    const maxUp=wasGrounded?t.stepHeight:.002;
    if(!sticky&&radial>.001)return false;
    if(drop>maxDown||drop<-maxUp)return false;
    const settled=add(sample.point,scale(this.up,lift));
    this.position.x=settled.x;this.position.y=settled.y;this.position.z=settled.z;
    this.setRadial(0);
    this.landOn(sample.normal,sample.slopeDegrees);
    return true;
  }

  private landOn(normal:Vec3,slopeDegrees:number):void {
    this.grounded=true;this.launched=false;this.airDodged=false;this.airJumpsUsed=0;this.dashAirUsed=0;
    this.groundNormal={...normal};this.groundSlopeDegrees=slopeDegrees;
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
    const reach=Math.hypot(moveX,moveZ);
    this.dashDirection=reach>.1?{x:moveX/reach,z:moveZ/reach}:{x:local.x*Math.cos(yaw)+local.z*Math.sin(yaw),z:local.z*Math.cos(yaw)-local.x*Math.sin(yaw)};
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
    const downX=support.normal.x,downZ=support.normal.z,slope=Math.hypot(downX,downZ);
    if(slope<1e-4)return;
    const steepness=Math.sin(support.slopeDegrees*Math.PI/180);
    this.velocity.x+=downX/slope*t.slideAcceleration*steepness*dt-this.velocity.x*t.slideFriction*dt;
    this.velocity.z+=downZ/slope*t.slideAcceleration*steepness*dt-this.velocity.z*t.slideFriction*dt;
    const planar=Math.hypot(this.velocity.x,this.velocity.z);
    if(planar>t.slideMaxSpeed){this.velocity.x*=t.slideMaxSpeed/planar;this.velocity.z*=t.slideMaxSpeed/planar;}
    // Desprendimento: a varredura trata o contato como piso e zera a queda, o que prendia o corpo
    // na beira. Como a face não sustenta, a descida é forçada e o corpo é afastado NA DIREÇÃO DA
    // NORMAL (para fora do sólido), então o empurrão nunca enfia ninguém dentro da geometria.
    this.velocity.y=Math.min(this.velocity.y,-2);
    const descent=Math.abs(this.velocity.y)*dt;
    this.position.y=Number.isFinite(walkable)&&this.position.y-descent<walkable?Math.max(walkable,this.position.y-descent):this.position.y-descent;
    const release=Math.min(t.slideMaxSpeed,t.slideAcceleration*steepness)*dt;
    this.position.x+=downX/slope*release;this.position.z+=downZ/slope*release;
  }

  /** Mesmo escorregamento, medido na vertical LOCAL: a ladeira abaixo é a tangente da normal. */
  private resolveSteepSlopeRadial(dt:number):void {
    if(this.grounded||dot(this.velocity,this.up)>0||this.dodgeRemaining>0||this.dashRemaining>0){this.sliding=false;this.slideSeconds=0;return;}
    const sample=this.surface.steepSupport(this.position,.05,contactLift(t.radius,FLOOR_COS)+.35);
    if(!sample||sample.slopeDegrees<=t.maxSlopeDegrees||sample.slopeDegrees>=89.5){this.sliding=false;this.slideSeconds=0;return;}
    if(!this.sliding)this.slides++;
    this.sliding=true;this.sprinting=false;this.slideSeconds+=dt;
    this.coyote=t.coyoteSeconds;this.airDodged=false;this.airJumpsUsed=0;this.dashAirUsed=0;
    this.groundNormal={...sample.normal};this.groundSlopeDegrees=sample.slopeDegrees;
    const downhill=reject(sample.normal,this.up);
    const slope=length(downhill);
    if(slope<1e-4)return;
    const steepness=Math.sin(sample.slopeDegrees*Math.PI/180);
    const push=scale(downhill,1/slope*t.slideAcceleration*steepness*dt);
    const drag=t.slideFriction*dt;
    let tangential=reject(this.velocity,this.up);
    tangential=add(add(tangential,push),scale(tangential,-drag));
    const planar=length(tangential);
    if(planar>t.slideMaxSpeed)tangential=scale(tangential,t.slideMaxSpeed/planar);
    const radial=Math.min(dot(this.velocity,this.up),-2);
    this.velocity.x=tangential.x+this.up.x*radial;
    this.velocity.y=tangential.y+this.up.y*radial;
    this.velocity.z=tangential.z+this.up.z*radial;
  }

  private respawn(): void {
    const damage=this.maxHP*t.voidDamageFraction;
    const context: DamageContext={attackerId:0,victimId:this.entityId,sourceId:'void',attackId:'void_return',baseDamage:damage,finalDamage:damage,crit:false,procCoefficient:0,procChainDepth:0,damageTags:['environment'],hitPosition:{...this.position},hitNormal:{...this.up},forceDirection:{x:0,y:0,z:0},forceMagnitude:0};
    this.applyDamage(context);
    const destination=findSafeRecovery(this.world,this.safe,this.initialSpawn);
    if(destination)Object.assign(this.safe,destination);
    Object.assign(this.position,this.safe);Object.assign(this.previous,this.safe);
    this.velocity.x=0;this.velocity.y=0;this.velocity.z=0;this.sprinting=false;this.dodgeRemaining=0;
    // Sem zerar o dash, o resto do deslocamento continuava a partir do ponto seguro.
    this.dashRemaining=0;this.dashAirUsed=0;this.sliding=false;this.slideSeconds=0;
    this.push.x=0;this.push.z=0;this.retreatRemaining=0;this.wallKick=0;this.wallSliding=false;this.lastWall=undefined;this.jumpBuffer=0;this.safeElapsed=0;
    this.invulnerable=t.respawnProtection;this.grounded=true;this.launched=false;this.airDodged=false;this.airJumpsUsed=0;this.respawns++;
    this.adoptFrame(this.forward);
  }
  /**
   * Cura. Mora AQUI, e não em quem chama, para que nenhum sistema de fora escreva `hp` cru.
   *
   * Um morto não é curado por proc: ressuscitar é decisão de renascimento, num bloco próprio, e
   * deixar uma cura tirar alguém do chão por acidente seria exatamente a regra sem dono que o
   * contrato proíbe.
   */
  heal(amount:number):void {
    if(!(amount>0)||this.hp<=0)return;
    this.hp=Math.min(this.maxHP,this.hp+amount);
  }
  applyDamage(context: DamageContext): void {
    if(this.debugInvincible||this.hp<=0 || context.victimId!==this.entityId || (this.invulnerable>0 && context.sourceId!=='void'))return;
    const applied=context.sourceId==='void'?context.finalDamage:context.finalDamage*100/(100+Math.max(0,this.armor));
    if(applied<=0)return;this.regenerationDelay=2;
    context={...context,finalDamage:applied};this.hp=Math.max(0,this.hp-applied);
    if(context.sourceId!=='void'){this.invulnerable=Math.max(this.invulnerable,.2);this.knockback(context.forceDirection,context.forceMagnitude);}
    this.events.emit('DamageTaken',context);this.events.emit('PlayerHit',context);
    if(this.hp===0)this.events.emit('PlayerKilled',context);
  }
}
