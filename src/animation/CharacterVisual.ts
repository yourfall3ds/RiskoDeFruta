import {configureSkinning} from './SkinningPolicy';
import {directionalLocomotion} from './DirectionalLocomotion';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import {freefallFlutter,type FlutterBend} from './FreefallFlutter';
import {MELEE_CLIPS,meleeClipProgress} from './MeleeClips';
import type {MeleePhase} from '../combat/UnarmedCombat';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { PlayerMotor } from '../player/PlayerMotor';
import { PLAYER_TUNING as tuning } from '../player/PlayerTuning';
import { AnimationStateMachine } from './AnimationStateMachine';
import {poseAkimbo} from './StylishAim';
import { aimArmAt } from './AimArm';

export class CharacterVisual {
  readonly root: TransformNode;
  readonly position=Vector3.Zero();
  readonly meshes: AbstractMesh[] = [];
  readonly hands: (TransformNode | undefined)[] = [];
  readonly grips: (TransformNode | undefined)[] = [];
  private readonly clips=new Map<string,AnimationGroup>();
  private active='';private wasGrounded=true;private landingTime=0;private readonly machine=new AnimationStateMachine(this.clips,.15);
  private clock=0;
  private disposed=false;
  private readonly firing=[1,1];private lastShotSide=0;
  deathProgress:number|undefined;deathPosition:{x:number;y:number;z:number}|undefined;
  skillPerformance:{tier:1|2|3;progress:number}|undefined;
  /**
   * Entrada da nave e queda.
   *
   * `stride` só existe no prólogo do deck (espera, corrida e salto): quando está presente, a
   * orientação e o clipe vêm da `IntroSequence` em vez do mergulho. Sem `stride` o caminho é
   * exatamente o de antes — o mergulho e a recuperação do `MeteorArrival` seguem intocados.
   */
  arrivalPose:{height:number;recovery:number;dive?:number;rootLift?:number;sway?:number;time?:number;flutter?:number;position?:{x:number;y:number;z:number};
    stride?:{clip:string;progress:number;yaw:number;pitch:number;roll:number}|undefined}|undefined;reloadProgress=-1;
  /**
   * Etapa de combate desarmado em curso.
   *
   * Amostra as ações feitas no Blender usando a fase autoritativa do golpe.
   * O clipe inteiro substitui a locomoção; nenhuma rotação aditiva entorta o rig.
   */
  meleePose:{stepId:string;phase:MeleePhase;progress:number;heavy:boolean}|undefined;
  unarmedStance=false;
  meleeRate=1;
  private airborneSeconds=0;
  private hitReaction=0;
  reactToHit():void {this.hitReaction=.32;}
  private readonly bones=new Map<string,TransformNode>();
  private fanCastTime=0;private preparation:{tier:1|2|3;progress:number}|undefined;
  prepareSkill(tier:1|2|3,progress:number):void {this.preparation={tier,progress};}
  endPreparation():void {this.preparation=undefined;}
  beginFanCast(prepared=false):void {this.fanCastTime=prepared?.87:1.05;this.releaseTime=1;}
  private releaseTime=1;private styleTime=0;private styleClock=0;private readonly styleTargets=[Vector3.Zero(),Vector3.Zero()];private readonly targetTime=[0,0];
  private readonly fanDirections=[Vector3.Forward(),Vector3.Forward()];private readonly fanTime=[0,0];
  fanAim(side:0|1,direction:Vector3):void {this.fanDirections[side]!.copyFrom(direction);this.fanTime[side]=.16;}
  stormAim(side:0|1,point:Vector3):void{this.styleTargets[side]!.copyFrom(point);this.targetTime[side]=.25;this.styleTime=.28;}
  private blend=1;
  /**
   * Orientação amortecida da raiz, guardada FORA de `root.rotation.y`.
   *
   * Antes o amortecimento lia e reescrevia `root.rotation.y`, e qualquer camada que somasse yaw
   * depois (a pose de corpo a corpo faz isso) virava entrada do amortecedor no quadro seguinte:
   * o desvio se acumulava até o regime permanente `yaw/k`, com `k` dependente da taxa de quadros —
   * um giro de ~50° a 60 Hz e mais que o dobro a 120 Hz. Com o estado separado, a camada aditiva
   * soma por cima e desaparece junto com o golpe.
   */
  private facingYaw=0;
  private readonly armPose=new Map<TransformNode,Quaternion>();
  ready=false;
  error='';
  dodging=false;
  constructor(private readonly scene: Scene,private readonly onReady: () => void) {this.root=new TransformNode('player-visual',scene);}
  resetAttempt():void {this.airborneSeconds=0;this.hitReaction=0;this.unarmedStance=false;this.meleeRate=1;this.deathProgress=undefined;this.deathPosition=undefined;this.machine.reset();this.active='';this.clock=0;this.facingYaw=0;this.wasGrounded=true;this.landingTime=0;this.firing.fill(1);this.fanCastTime=0;this.releaseTime=1;this.styleTime=0;this.styleClock=0;this.targetTime.fill(0);this.fanTime.fill(0);this.preparation=undefined;this.skillPerformance=undefined;this.arrivalPose=undefined;this.reloadProgress=-1;this.dodging=false;this.meleePose=undefined;}
  setSkinning(mode:'auto'|'cpu'):void{configureSkinning(this.meshes,mode);}
  get skinning():string{const skinned=this.meshes.filter(m=>m.skeleton);return skinned.length&&skinned.every(m=>m.computeBonesUsingShaders)?'GPU · ossos em textura':'CPU';}
  async load(): Promise<void> {
    try {
      const imported=await ImportMeshAsync('/models/gunslinger.glb',this.scene);
      if(this.disposed){for(const m of imported.meshes)m.dispose();return;}
      for(const mesh of imported.meshes){if(!mesh.parent)mesh.parent=this.root;mesh.isPickable=false;mesh.receiveShadows=true;mesh.alwaysSelectAsActiveMesh=true;this.meshes.push(mesh);}
      this.setSkinning('auto');
      for(const clip of imported.animationGroups){clip.stop();this.clips.set(clip.name,clip);}
      for(const node of imported.transformNodes)this.bones.set(node.name,node);
      this.hands.push(imported.transformNodes.find(n=>n.name==='RightHand'),imported.transformNodes.find(n=>n.name==='LeftHand'));
      this.grips.push(imported.transformNodes.find(n=>n.name==='RightWeaponGrip'),imported.transformNodes.find(n=>n.name==='LeftWeaponGrip'));
      this.ready=true;this.play('Idle');this.onReady();
    } catch(error) {if(!this.disposed)this.error=error instanceof Error?error.message:'Falha no modelo';}
  }
  private play(name: string): void {
    if(name===this.active)return;
    const clip=this.clips.get(name)??this.clips.get('Jump');if(!clip)return;
    for(const group of this.clips.values())group.stop();
    this.active=name;this.clock=0;
  }
  fire(side: 0 | 1): void {this.firing[side]=0;this.lastShotSide=side;}
  /**
   * Altura dos dois pés acima da raiz, depois de o clipe dominante ser amostrado.
   * É a medida que o `FootstepSync` usa para disparar o passo no contato real.
   * Devolve `undefined` enquanto o modelo não estiver pronto ou sem os ossos esperados.
   */
  footHeights():{right:number;left:number}|undefined {
    const right=this.bones.get('RightToeBase')??this.bones.get('RightFoot');
    const left=this.bones.get('LeftToeBase')??this.bones.get('LeftFoot');
    if(!this.ready||!right||!left)return undefined;
    right.computeWorldMatrix(true);left.computeWorldMatrix(true);
    return {right:right.getAbsolutePosition().y-this.root.position.y,left:left.getAbsolutePosition().y-this.root.position.y};
  }
  release(): void {this.releaseTime=0;}
  private sample(clip: AnimationGroup,progress: number,filter: (name: string) => boolean=()=>true,weight=this.blend): void {
    const frame=clip.from+(clip.to-clip.from)*Math.max(0,Math.min(1,progress));
    for(const track of clip.targetedAnimations) {
      const node=track.target as TransformNode;if(!filter(node.name))continue;
      const value: unknown=track.animation.evaluate(frame);
      if(track.animation.targetProperty==='rotationQuaternion' && value instanceof Quaternion && node.rotationQuaternion) Quaternion.SlerpToRef(node.rotationQuaternion,value,weight,node.rotationQuaternion);
      else if(track.animation.targetProperty==='position' && value instanceof Vector3)Vector3.LerpToRef(node.position,value,weight,node.position);
      else if(track.animation.targetProperty==='scaling' && value instanceof Vector3)node.scaling.copyFrom(value);
    }
  }
  /** Additive bends after the clip is sampled; the clip rewrites every joint next frame, so nothing accumulates. */
  private applyFlutter(bends:readonly FlutterBend[]):void {
    const rootWorld=this.root.computeWorldMatrix(true),inverse=new Matrix(),axis=new Vector3(),turn=new Quaternion();
    for(const {bone,axis:index,angle} of bends){
      const node=this.bones.get(bone);if(!node?.rotationQuaternion||angle===0)continue;
      const chain:TransformNode[]=[];for(let n:TransformNode|null=node;n&&n!==this.root;n=n.parent instanceof TransformNode?n.parent:null)chain.unshift(n);
      for(const n of chain)n.computeWorldMatrix(true);
      axis.copyFromFloats(index===0?1:0,index===1?1:0,index===2?1:0);Vector3.TransformNormalToRef(axis,rootWorld,axis);
      node.getWorldMatrix().invertToRef(inverse);Vector3.TransformNormalToRef(axis,inverse,axis);axis.normalize();
      Quaternion.RotationAxisToRef(axis,angle,turn);node.rotationQuaternion.multiplyInPlace(turn).normalize();node.computeWorldMatrix(true);
    }
  }
  update(player: PlayerMotor,alpha: number,dt: number,aiming: boolean,charging=false,pitch=0,chargeProgress=0): void {
    this.airborneSeconds=player.grounded?0:this.airborneSeconds+dt;
    this.hitReaction=Math.max(0,this.hitReaction-dt);
    Vector3.LerpToRef(new Vector3(player.previous.x,player.previous.y,player.previous.z),new Vector3(player.position.x,player.position.y,player.position.z),alpha,this.position);
    this.root.position.copyFrom(this.position);this.root.rotation.z=0;this.root.rotation.x=player.bumpRemaining>0?-Math.sin(player.bumpRemaining/.24*Math.PI)*.055:0;const facing=player.dodgeRemaining>0?player.dodgeYaw:player.yaw;this.facingYaw+=Math.atan2(Math.sin(facing-this.facingYaw),Math.cos(facing-this.facingYaw))*Math.min(1,dt>0?dt*14:1);this.root.rotation.y=this.facingYaw;
    if(!this.ready)return;
    if(this.deathProgress!==undefined){if(this.deathPosition){this.position.copyFromFloats(this.deathPosition.x,this.deathPosition.y,this.deathPosition.z);this.root.position.copyFrom(this.position);}this.machine.sample('FinalDeath',this.deathProgress,dt);this.root.computeWorldMatrix(true);return;}
    if(this.arrivalPose){if(this.arrivalPose.position)this.root.position.copyFromFloats(this.arrivalPose.position.x,this.arrivalPose.position.y,this.arrivalPose.position.z);else this.root.position.y+=this.arrivalPose.height;this.root.position.y+=this.arrivalPose.rootLift??0;this.position.copyFrom(this.root.position);const life=this.arrivalPose.flutter?freefallFlutter(this.arrivalPose.time??0,this.arrivalPose.flutter):undefined;
      const stride=this.arrivalPose.stride;
      if(stride){
        // Prólogo no deck: espera, corrida e salto. Orientação e clipe vêm da entrada, e o
        // amortecedor de facing recebe o mesmo yaw para não dar salto quando o controle voltar.
        this.facingYaw=stride.yaw;
        this.root.rotation.y=stride.yaw+(life?.yaw??0);this.root.rotation.x=stride.pitch+(life?.pitch??0);this.root.rotation.z=stride.roll+(life?.roll??0);
        const clip=this.clips.has(stride.clip)?stride.clip:'Idle';
        this.machine.sample(stride.clip,stride.progress,dt,()=>true,clip);
        if(life)this.applyFlutter(life.bends);
        this.root.computeWorldMatrix(true);for(const hand of this.hands)hand?.computeWorldMatrix(true);for(const grip of this.grips)grip?.computeWorldMatrix(true);
        return;
      }
      this.root.rotation.z=(this.arrivalPose.sway??0)+(life?.roll??0);this.root.rotation.x=Math.PI*(this.arrivalPose.dive??0)+(life?.pitch??0);this.root.rotation.y=player.yaw+(life?.yaw??0);this.facingYaw=player.yaw;const recovery=this.arrivalPose.recovery,state=recovery>0?'ArrivalRecovery':'ArrivalDive';const authored=this.clips.has(state);this.machine.sample(state,authored?recovery:recovery<.18?.6:.82+recovery*.18,dt,()=>true,authored?state:'Jump');if(life)this.applyFlutter(life.bends);this.root.computeWorldMatrix(true);return;}
    if(this.preparation){const {tier,progress}=this.preparation;this.machine.sample(['PrepareFan','PrepareMortal','PrepareStorm'][tier-1]!,progress,dt);this.root.computeWorldMatrix(true);for(const grip of this.grips)grip?.computeWorldMatrix(true);return;}
    this.fanCastTime=Math.max(0,this.fanCastTime-dt);
    const performance=this.skillPerformance,fanActive=performance?.tier===1;const mortalActive=performance?.tier===2;
    const speed=Math.hypot(player.velocity.x,player.velocity.z);
    this.dodging=player.dodgeRemaining>0;
    const flipping=player.backflipProgress>=0&&this.clips.has('Backflip');
    this.landingTime=Math.max(0,this.landingTime-dt);if(player.grounded&&!this.wasGrounded)this.landingTime=.2;this.wasGrounded=player.grounded;
    const locomotion=directionalLocomotion(player.velocity.x,player.velocity.z,player.yaw);
    const longFall=this.airborneSeconds>1.15&&player.velocity.y<-8&&!charging&&!performance&&!this.firing.some(t=>t<1)&&this.clips.has('RecordedFall');
    const name=flipping?'Backflip':player.dodgeRemaining>0?'Dodge':!player.grounded?(player.wallSliding?'WallSlide':player.velocity.y>0?'JumpRise':longFall?'RecordedFall':'JumpFall'):(fanActive||mortalActive||this.fanCastTime>0)&&speed<.5?(mortalActive?'MortalCast':'FanCast'):this.landingTime>0?'Land':locomotion.primary;
    this.play(name);this.clock+=dt*(name.startsWith('Run')?Math.max(.3,speed/9):['Walk','WalkBackward','StrafeLeft','StrafeRight'].includes(name)?Math.max(.3,speed/2.2):1);
    const airborne=['JumpRise','JumpFall','Land','WallSlide'].includes(name),clipName=airborne&&this.clips.has('Jump')?'Jump':name;
    const clip=this.clips.get(clipName)??this.clips.get('Idle')!;
    const frames=clip.to-clip.from;
    const authoredSeconds=frames/60;
    let progress=this.clock/Math.max(.01,authoredSeconds);
    if(name==='FanCast'||name==='MortalCast')progress=fanActive||mortalActive?.48+performance!.progress*.52:1-this.fanCastTime/1.05;
    else if(flipping)progress=player.backflipProgress;
    else if(name==='Dodge')progress=(tuning.dodgeSeconds-player.dodgeRemaining)/tuning.dodgeSeconds;
    else if(name==='JumpRise')progress=.12+.33*(1-Math.min(1,player.velocity.y/Math.sqrt(2*tuning.gravity*tuning.jumpApex*player.jumpMultiplier)));
    else if(name==='JumpFall')progress=.46+.34*Math.min(1,-player.velocity.y/Math.sqrt(2*tuning.gravity*tuning.jumpApex));
    else if(name==='Land')progress=.82+.18*(1-this.landingTime/.2);
    else if(name==='WallSlide')progress=.54;
    else progress%=1;
    this.blend=dt>0?1-Math.exp(-dt/.10):1;
    if(aiming&&name!=='Dodge')for(const [node,rotation] of this.armPose)node.rotationQuaternion?.copyFrom(rotation);
    const upper=(name:string)=>/^(Left|Right)(Arm|ForeArm|Hand|Shoulder)$/.test(name);
    // Durante o corpo a corpo o clipe precisa reescrever TODAS as juntas antes da camada aditiva.
    // Com o filtro de mira ligado, braço, antebraço e ombro não eram reescritos e o
    // `applyFlutter` multiplicava a mesma junta quadro após quadro — o braço girava sem limite.
    if(this.meleePose){
      const {stepId,phase,progress}=this.meleePose,spec=MELEE_CLIPS[stepId];
      if(spec&&this.clips.has(spec.clip)){
        this.machine.sample(spec.clip,meleeClipProgress(stepId,phase,progress),dt*Math.max(1,this.meleeRate));
        this.root.computeWorldMatrix(true);
        for(const hand of this.hands)hand?.computeWorldMatrix(true);
        for(const grip of this.grips)grip?.computeWorldMatrix(true);
        return;
      }
    }
    const lower=(bone:string)=>!aiming||this.unarmedStance||name==='Dodge'||name==='RecordedFall'||flipping||!upper(bone);
    this.machine.sample(name,progress,dt,lower,clipName);
    if(name==='RecordedFall'){
      this.root.computeWorldMatrix(true);for(const grip of this.grips)grip?.computeWorldMatrix(true);return;
    }
    const reaction=this.clips.get('RecordedHit');
    if(reaction&&this.hitReaction>0&&!flipping&&name!=='Dodge'){
      const p=1-this.hitReaction/.32;
      this.sample(reaction,p*.45,bone=>bone.startsWith('Spine')||bone==='neck'||bone==='Head',Math.sin(p*Math.PI)*.35);
    }
    if(name===locomotion.primary&&locomotion.weight>0){
      const second=this.clips.get(locomotion.secondary);
      if(second){
        // Walk and strafe were authored with different stride cycles. Blending their legs at
        // equal normalized time cancels foot lift on diagonals. Keep the dominant support cycle
        // intact; only blend the upper body until phase-aligned directional clips are authored.
        const sameCycle=Math.abs((second.to-second.from)-frames)<.01;
        this.sample(second,progress,bone=>lower(bone)&&(sameCycle||/^(Spine|Head|Neck|(?:Left|Right)(?:Shoulder|Arm|ForeArm|Hand|WeaponGrip))/.test(bone)),locomotion.weight);
      }
    }
    if(this.unarmedStance&&!this.dodging&&!flipping){
      const guard=this.clips.get('ComboRightCross');
      if(guard)this.sample(guard,0,bone=>speed<.1&&player.grounded||upper(bone)||bone.startsWith('Spine'));
      this.root.computeWorldMatrix(true);return;
    }
    for(let side=0;side<2;side++)this.firing[side]=Math.min(1,this.firing[side]!+dt/.21);
    this.releaseTime=Math.min(1,this.releaseTime+dt/.3);this.styleTime=Math.max(0,this.styleTime-dt);this.styleClock+=dt;for(let i=0;i<2;i++)this.fanTime[i]=Math.max(0,this.fanTime[i]!-dt);for(const side of [0,1] as const)this.targetTime[side]=Math.max(0,this.targetTime[side]!-dt);
    if(performance?.tier===3)this.styleTime=Math.max(.2,this.styleTime);
    if(this.reloadProgress>=0){
      const reload=this.clips.get('ReloadCast'),p=this.reloadProgress;
      const weight=Math.min(1,p/.08,(1-p)/.1);
      if(reload)this.sample(reload,p,bone=>/^(Spine|Head|Neck|(?:Left|Right)(?:Shoulder|Arm|ForeArm|Hand|WeaponGrip))/.test(bone),Math.max(0,weight));
      this.root.computeWorldMatrix(true);for(const grip of this.grips)grip?.computeWorldMatrix(true);return;
    }
    if(aiming && name!=='Dodge'&&!flipping) {
      const casting=fanActive||mortalActive||this.fanCastTime>0,aim=this.clips.get(casting?(mortalActive?'MortalCast':'FanCast'):charging?'Charge':'Aim');if(aim)this.sample(aim,casting?(fanActive||mortalActive?.48+performance!.progress*.52:1-this.fanCastTime/1.05):charging?chargeProgress:0,n=>upper(n)||(casting&&n.startsWith('Spine')));
      const release=this.clips.get('Release');if(release&&this.releaseTime<1&&this.fanCastTime<=0)this.sample(release,this.releaseTime,upper);
      for(const side of [0,1] as const) {
        if(this.firing[side]!>=1)continue;
        const fire=this.clips.get(side===0?'Fire_R':'Fire_L');const prefix=side===0?'Right':'Left';
        if(fire)this.sample(fire,this.firing[side]!,name=>(name.startsWith(prefix)&&upper(name))||(side===this.lastShotSide&&!casting&&name.startsWith('Spine')));
      }
      for(const [index,side] of ['Right','Left'].entries()) {
        const arm=this.scene.getTransformNodeByName(`${side}Arm`);
        if(!arm?.rotationQuaternion || !arm.parent)continue;
        const previous=this.armPose.get(arm);if(previous)previous.copyFrom(arm.rotationQuaternion);else this.armPose.set(arm,arm.rotationQuaternion.clone());
        const grip=this.grips[index];if(!grip)continue;
        const direction=new Vector3(Math.sin(player.yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(player.yaw)*Math.cos(pitch));
        const forearm=this.scene.getTransformNodeByName(side+'ForeArm'),hand=this.hands[index];
        if(this.styleTime>0&&forearm&&hand){const sign=index===0?1:-1,cross=(1-Math.cos(this.styleClock*7))*.5,lateral=sign*(.20-.30*cross),forward=.28-.10*cross;
          const wrist=this.position.add(new Vector3(Math.cos(player.yaw)*lateral+Math.sin(player.yaw)*forward,1.30+sign*cross*.025,Math.cos(player.yaw)*forward-Math.sin(player.yaw)*lateral));
          const pole=this.position.add(new Vector3(Math.cos(player.yaw)*sign*.65,.78,-Math.sin(player.yaw)*sign*.65));
          const target=this.targetTime[index]!>0?this.styleTargets[index]!:wrist.add(direction.scale(30));poseAkimbo(arm,forearm,hand,grip,wrist,pole,target);
        }else aimArmAt(arm,grip,this.fanTime[index]!>0?this.fanDirections[index]!:direction);
      }
    }
    this.root.computeWorldMatrix(true);
    for(const hand of this.hands)hand?.computeWorldMatrix(true);
    for(const grip of this.grips)grip?.computeWorldMatrix(true);
  }
  dispose(): void {this.disposed=true;for(const clip of this.clips.values())clip.dispose();this.root.dispose();}
}
