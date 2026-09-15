import {configureSkinning} from './SkinningPolicy';
import {directionalLocomotion} from './DirectionalLocomotion';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
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
  arrivalPose:{height:number;recovery:number;dive?:number;rootLift?:number;sway?:number;position?:{x:number;y:number;z:number}}|undefined;reloadProgress=-1;
  private fanCastTime=0;private preparation:{tier:1|2|3;progress:number}|undefined;
  prepareSkill(tier:1|2|3,progress:number):void {this.preparation={tier,progress};}
  endPreparation():void {this.preparation=undefined;}
  beginFanCast(prepared=false):void {this.fanCastTime=prepared?.87:1.05;this.releaseTime=1;}
  private releaseTime=1;private styleTime=0;private styleClock=0;private readonly styleTargets=[Vector3.Zero(),Vector3.Zero()];private readonly targetTime=[0,0];
  private readonly fanDirections=[Vector3.Forward(),Vector3.Forward()];private readonly fanTime=[0,0];
  fanAim(side:0|1,direction:Vector3):void {this.fanDirections[side]!.copyFrom(direction);this.fanTime[side]=.16;}
  stormAim(side:0|1,point:Vector3):void{this.styleTargets[side]!.copyFrom(point);this.targetTime[side]=.25;this.styleTime=.28;}
  private blend=1;
  private readonly armPose=new Map<TransformNode,Quaternion>();
  ready=false;
  error='';
  dodging=false;
  constructor(private readonly scene: Scene,private readonly onReady: () => void) {this.root=new TransformNode('player-visual',scene);}
  resetAttempt():void {this.deathProgress=undefined;this.deathPosition=undefined;this.machine.reset();this.active='';this.clock=0;this.wasGrounded=true;this.landingTime=0;this.firing.fill(1);this.fanCastTime=0;this.releaseTime=1;this.styleTime=0;this.styleClock=0;this.targetTime.fill(0);this.fanTime.fill(0);this.preparation=undefined;this.skillPerformance=undefined;this.arrivalPose=undefined;this.reloadProgress=-1;this.dodging=false;}
  setSkinning(mode:'auto'|'cpu'):void{configureSkinning(this.meshes,mode);}
  get skinning():string{const skinned=this.meshes.filter(m=>m.skeleton);return skinned.length&&skinned.every(m=>m.computeBonesUsingShaders)?'GPU · ossos em textura':'CPU';}
  async load(): Promise<void> {
    try {
      const imported=await ImportMeshAsync('/models/gunslinger.glb',this.scene);
      if(this.disposed){for(const m of imported.meshes)m.dispose();return;}
      for(const mesh of imported.meshes){if(!mesh.parent)mesh.parent=this.root;mesh.isPickable=false;mesh.receiveShadows=true;mesh.alwaysSelectAsActiveMesh=true;this.meshes.push(mesh);}
      this.setSkinning('auto');
      for(const clip of imported.animationGroups){clip.stop();this.clips.set(clip.name,clip);}
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
  update(player: PlayerMotor,alpha: number,dt: number,aiming: boolean,charging=false,pitch=0,chargeProgress=0): void {
    Vector3.LerpToRef(new Vector3(player.previous.x,player.previous.y,player.previous.z),new Vector3(player.position.x,player.position.y,player.position.z),alpha,this.position);
    this.root.position.copyFrom(this.position);this.root.rotation.z=0;this.root.rotation.x=player.bumpRemaining>0?-Math.sin(player.bumpRemaining/.24*Math.PI)*.055:0;const facing=player.dodgeRemaining>0?player.dodgeYaw:player.yaw;this.root.rotation.y+=Math.atan2(Math.sin(facing-this.root.rotation.y),Math.cos(facing-this.root.rotation.y))*Math.min(1,dt>0?dt*14:1);
    if(!this.ready)return;
    if(this.deathProgress!==undefined){if(this.deathPosition){this.position.copyFromFloats(this.deathPosition.x,this.deathPosition.y,this.deathPosition.z);this.root.position.copyFrom(this.position);}this.machine.sample('FinalDeath',this.deathProgress,dt);this.root.computeWorldMatrix(true);return;}
    if(this.arrivalPose){if(this.arrivalPose.position)this.root.position.copyFromFloats(this.arrivalPose.position.x,this.arrivalPose.position.y,this.arrivalPose.position.z);else this.root.position.y+=this.arrivalPose.height;this.root.position.y+=this.arrivalPose.rootLift??0;this.position.copyFrom(this.root.position);this.root.rotation.z=this.arrivalPose.sway??0;this.root.rotation.x=Math.PI*(this.arrivalPose.dive??0);this.root.rotation.y=player.yaw;const recovery=this.arrivalPose.recovery,state=recovery>0?'ArrivalRecovery':'ArrivalDive';const authored=this.clips.has(state);this.machine.sample(state,authored?recovery:recovery<.18?.6:.82+recovery*.18,dt,()=>true,authored?state:'Jump');this.root.computeWorldMatrix(true);return;}
    if(this.preparation){const {tier,progress}=this.preparation;this.machine.sample(['PrepareFan','PrepareMortal','PrepareStorm'][tier-1]!,progress,dt);this.root.computeWorldMatrix(true);for(const grip of this.grips)grip?.computeWorldMatrix(true);return;}
    this.fanCastTime=Math.max(0,this.fanCastTime-dt);
    const performance=this.skillPerformance,fanActive=performance?.tier===1;const mortalActive=performance?.tier===2;
    const speed=Math.hypot(player.velocity.x,player.velocity.z);
    this.dodging=player.dodgeRemaining>0;
    const flipping=player.backflipProgress>=0&&this.clips.has('Backflip');
    this.landingTime=Math.max(0,this.landingTime-dt);if(player.grounded&&!this.wasGrounded)this.landingTime=.2;this.wasGrounded=player.grounded;
    const locomotion=directionalLocomotion(player.velocity.x,player.velocity.z,player.yaw);
    const name=flipping?'Backflip':player.dodgeRemaining>0?'Dodge':!player.grounded?(player.wallSliding?'WallSlide':player.velocity.y>0?'JumpRise':'JumpFall'):(fanActive||mortalActive||this.fanCastTime>0)&&speed<.5?(mortalActive?'MortalCast':'FanCast'):this.landingTime>0?'Land':locomotion.primary;
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
    const lower=(bone:string)=>!aiming||name==='Dodge'||flipping||!upper(bone);
    this.machine.sample(name,progress,dt,lower,clipName);
    if(name===locomotion.primary&&locomotion.weight>0){const second=this.clips.get(locomotion.secondary);if(second)this.sample(second,progress,lower,locomotion.weight);}
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
