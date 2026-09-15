import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {PistolMagazine} from './PistolMagazine';
import {ShellCasings} from '../vfx/ShellCasings';
import {RicochetFan} from './RicochetFan';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3,Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { Scene } from '@babylonjs/core/scene';
import type { RandomStream } from '../core/RunRNG';
import type { EventBus } from '../core/EventBus';
import type { DamageContext,GameEvents } from '../core/contracts';
import type { CharacterVisual } from '../animation/CharacterVisual';
import type { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import type { TrainingYard, TrainingTarget } from '../world/TrainingYard';
import type { MPTier } from './MPCharge';
import type { WeaponAudio } from '../audio/WeaponAudio';
import { ShotEffects } from '../vfx/ShotEffects';
import {PickingInfo} from '@babylonjs/core/Collisions/pickingInfo';
import {sweepBox,type CollisionWorld} from '../physics/CollisionWorld';
import { PistolCadence } from './PistolCadence';
import { PISTOL_TUNING as t } from '../player/PlayerTuning';

export class DualPistols {
  readonly magazine=new PistolMagazine();private readonly casings:ShellCasings;
  readonly cadence=new PistolCadence();
  readonly effects: ShotEffects;
  private readonly reloadMagazines:Mesh[]=[];private readonly tossStarts:({position:Vector3;rotation:Quaternion}|undefined)[]=[];
  private readonly weapons: TransformNode[]=[];
  private readonly muzzle: TransformNode[]=[];
  private readonly recoil=[0,0];
  private readonly gripRotations: (Quaternion | undefined)[]=[];
  private readonly flashLights:PointLight[]=[];
  private container: AssetContainer | undefined;
  private disposed=false;
  ready=false;
  error='';
  hitTime=0;
  hits=0;
  lastImpact='—';
  lastSide: 0 | 1=0;
  stormRemaining=0;
  skillShots=0;
  private actionClock:(()=>number)|undefined;private actionDuration=0;private fanTotal=10;private barrageTotal=14;private fanInterval=.055;private barrageInterval=.6/14;
  private stormClock=0;
  private stormTarget=0;private barrageIndex=14;private barrageClock=0;private barrageDirection=Vector3.Forward();private fanIndex=10;private fanClock=0;private fanDirection=Vector3.Forward();readonly fan:RicochetFan;
  constructor(private readonly scene: Scene,private readonly camera: ThirdPersonCamera,private readonly visual: CharacterVisual,private readonly yard: Pick<TrainingYard,'targets'>&{collision?:CollisionWorld},private readonly rng: RandomStream,private readonly events: EventBus<GameEvents>,private readonly audio: WeaponAudio) {
    this.effects=new ShotEffects(scene);this.casings=new ShellCasings(scene,yard.collision,audio);
    this.fan=new RicochetFan((ray,ignore)=>{
      let hit=this.worldPick(ray);let targetId:number|undefined;
      for(const target of this.yard.targets){if(ignore.has(target.id)||!target.mesh.isPickable||!target.mesh.isEnabled())continue;const candidate=this.targetPick(ray,target,.65);if(candidate.hit&&(!hit||candidate.distance<hit.distance)){hit=candidate;targetId=target.id;}}
      if(!hit?.hit||!hit.pickedPoint)return;return{point:hit.pickedPoint,normal:hit.getNormal(true)??ray.direction.negate(),distance:hit.distance,...(targetId===undefined?{}:{targetId})};
    },(hit,dir)=>{const target=hit.targetId===undefined?undefined:this.yard.targets.find(t=>t.id===hit.targetId);if(target)this.damageTarget(target,hit.point,dir,18,'ricochet_fan');else{this.effects.mark(hit.point,hit.normal);this.effects.impact(hit.point,hit.normal);}},(from,to)=>this.effects.arcTrail(from,to));
    const magazineMaterial=new PBRMaterial('pistol-magazine-steel',scene);magazineMaterial.albedoColor=new Color3(.11,.13,.13);magazineMaterial.metallic=.85;magazineMaterial.roughness=.36;
    for(let side=0;side<2;side++) {
      const magazine=CreateBox('replacement-magazine-'+side,{width:.045,height:.13,depth:.06},scene);magazine.material=magazineMaterial;magazine.isPickable=false;magazine.setEnabled(false);this.reloadMagazines.push(magazine);
      const root=new TransformNode(`pistol-${side}`,scene);this.weapons.push(root);
      const muzzle=new TransformNode(`muzzle-${side}`,scene);muzzle.parent=root;muzzle.position.set(0,.154,.341);this.muzzle.push(muzzle);
      const light=new PointLight(`muzzle-light-${side}`,Vector3.Zero(),scene);light.parent=muzzle;light.diffuse=new Color3(1,.65,.25);light.range=2;light.intensity=0;this.flashLights.push(light);
    }
  }
  async load(): Promise<void> {
    try {
      const container=await LoadAssetContainerAsync('/models/pistol.glb',this.scene);
      if(this.disposed){container.dispose();return;}this.container=container;
      for(let side=0;side<2;side++) {
        const instance=container.instantiateModelsToScene(name=>`pistol-${side}-${name}`,false,{doNotInstantiate:true});
        for(const node of instance.rootNodes)node.parent=this.weapons[side]!;
        for(const root of instance.rootNodes)for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.receiveShadows=true;}
      }
      this.ready=true;
    }catch(error){if(!this.disposed)this.error=error instanceof Error?error.message:'Falha na pistola';}
  }
  muzzlePose(side:0|1):{position:Vector3;direction:Vector3}{const node=this.muzzle[side]!;node.computeWorldMatrix(true);return{position:node.getAbsolutePosition(),direction:node.getDirection(Vector3.Forward())};}
  requestReload():boolean{if(this.barrageIndex<this.barrageTotal||this.stormRemaining>0||this.fanIndex<this.fanTotal)return false;if(!this.magazine.request())return false;this.audio.reload?.();return true;}
  updatePose(dt: number): void {
    for(let side=0;side<2;side++) {
      this.recoil[side]=Math.max(0,this.recoil[side]!-dt);
      const root=this.weapons[side]!;const hand=this.visual.hands[side];
      root.setEnabled(this.visual.ready);
      const grip=this.visual.grips?.[side];
      const intensity=this.recoil[side]!/t.recoilSeconds;
      this.flashLights[side]!.intensity=intensity>.6?(intensity-.6)*4:0;
      if(grip){
        const p=this.magazine.progress,air=this.magazine.reloading&&p>.18&&p<.84;grip.computeWorldMatrix(true);const gripPosition=grip.getAbsolutePosition(),gripRotation=Quaternion.Identity();grip.getWorldMatrix().decompose(undefined,gripRotation);
        if(air){let start=this.tossStarts[side];if(!start){start={position:gripPosition.subtract(this.visual.position),rotation:gripRotation.clone()};this.tossStarts[side]=start;}const flight=(p-.18)/.66;
          root.parent=null;Vector3.LerpToRef(start.position.add(this.visual.position),gripPosition,flight*flight,root.position);root.position.y+=Math.sin(Math.PI*flight)*1.12;root.rotationQuaternion=Quaternion.RotationAxis(new Vector3(Math.cos(this.camera.camera.rotation.y),0,-Math.sin(this.camera.camera.rotation.y)),flight*Math.PI*4).multiply(Quaternion.Slerp(start.rotation,gripRotation,flight));
        }else{this.tossStarts[side]=undefined;root.parent=grip;root.position.setAll(0);root.rotationQuaternion=Quaternion.Identity();}
        root.computeWorldMatrix(true);const magazine=this.reloadMagazines[side]!;magazine.setEnabled(air&&p>.38&&p<.66);
        if(magazine.isEnabled()){const phase=(p-.38)/.28;Vector3.LerpToRef(this.visual.position.add(new Vector3(side===0?.25:-.25,.88,.08)),root.getAbsolutePosition(),phase,magazine.position);magazine.rotationQuaternion=root.rotationQuaternion?.clone()??Quaternion.Identity();}
        continue;
      }
      root.position.copyFrom(hand?.getAbsolutePosition()??this.visual.position.add(new Vector3(side===0?.35:-.35,1.2,.3)));
      const kick=this.recoil[side]!/t.recoilSeconds;
      this.flashLights[side]!.intensity=kick>.6?(kick-.6)*4:0;
      root.rotationQuaternion??=Quaternion.Identity();
      if(this.visual.dodging&&hand&&this.gripRotations[side]) {
        const handRotation=Quaternion.Identity();hand.getWorldMatrix().decompose(undefined,handRotation);
        root.rotationQuaternion.copyFrom(handRotation.multiply(this.gripRotations[side]!));
      }else {
        root.lookAt(root.position.add(this.camera.forward).addInPlaceFromFloats(0,kick*.035,0));
        if(hand){const handRotation=Quaternion.Identity();hand.getWorldMatrix().decompose(undefined,handRotation);this.gripRotations[side]=handRotation.conjugate().multiply(root.rotationQuaternion);}
      }
      root.position.addInPlace(Vector3.Forward().applyRotationQuaternion(root.rotationQuaternion).scale(.045));root.computeWorldMatrix(true);
    }
    this.hitTime=Math.max(0,this.hitTime-dt);this.effects.update(dt);this.casings.update(dt);
  }
  fixedUpdate(dt: number,fire: boolean): void {
    this.magazine.update(dt);this.visual.reloadProgress=this.magazine.reloading?this.magazine.progress:-1;
    if(this.magazine.ammo===0&&!this.magazine.reloading)this.requestReload();
    this.cadence.update(dt,fire&&!this.magazine.reloading&&this.magazine.ammo>0&&this.visual.ready&&this.barrageIndex>=this.barrageTotal&&this.stormRemaining<=0&&this.fanIndex>=this.fanTotal,side=>this.shoot(side));
    if(this.actionClock&&this.actionClock()>=this.actionDuration){this.fanIndex=this.fanTotal;this.barrageIndex=this.barrageTotal;this.stormRemaining=0;}
    if(this.fanIndex<this.fanTotal){this.fanClock-=dt;if(this.actionClock)this.fanClock=this.fanIndex*this.fanInterval-this.actionClock();if(this.fanClock<=0){this.launchFanBullet(this.fanIndex++);this.fanClock+=this.fanInterval;}}this.fan.update(dt);
    if(this.barrageIndex<this.barrageTotal){this.barrageClock-=dt;if(this.actionClock)this.barrageClock=this.barrageIndex*this.barrageInterval-this.actionClock();if(this.barrageClock<=0){const i=this.barrageIndex++,angle=(i/(this.barrageTotal-1)-.5)*.75,dir=this.barrageDirection.clone();dir.x=this.barrageDirection.x*Math.cos(angle)+this.barrageDirection.z*Math.sin(angle);dir.z=this.barrageDirection.z*Math.cos(angle)-this.barrageDirection.x*Math.sin(angle);this.skillRay((i%2) as 0|1,dir,'backflip_barrage',24,false);this.barrageClock+=this.barrageInterval;}}

    if(this.stormRemaining<=0)return;
    this.stormRemaining=this.actionClock?Math.max(0,this.actionDuration-this.actionClock()):Math.max(0,this.stormRemaining-dt);this.stormClock-=dt;
    if(this.stormClock>0)return;this.stormClock+=1/20;
    const origin=this.visual.position.add(new Vector3(0,1.3,0));
    const candidates=this.yard.targets.filter(target=>{const offset=target.mesh.getBoundingInfo().boundingBox.centerWorld.subtract(origin);return target.mesh.isPickable&&offset.length()<60&&Vector3.Dot(offset.normalize(),this.camera.forward)>.35;});
    if(!candidates.length)return;
    const target=candidates[this.stormTarget++%candidates.length]!;
    const aimPosition=target.mesh.getBoundingInfo().boundingBox.centerWorld;this.visual.stormAim((this.skillShots%2) as 0|1,aimPosition);
    this.skillRay((this.skillShots%2) as 0|1,aimPosition.subtract(origin).normalize(),'harvest_storm',18,false,aimPosition);
  }
  releaseSkill(tier: Exclude<MPTier,0>,prepared=false,duration?:number,clock?:()=>number): void {
    this.fanIndex=this.fanTotal;this.barrageIndex=this.barrageTotal;this.stormRemaining=0;this.actionClock=clock;this.actionDuration=duration??0;this.visual.release();
    const id=tier===1?'ricochet_fan':tier===2?'backflip_barrage':'harvest_storm';
    this.events.emit('SkillUsed',{entityId:1,skillId:id});
    if(tier===3){this.stormRemaining=duration??3;this.stormClock=0;return;}
    if(tier===1){this.fanTotal=duration?48:10;this.fanInterval=duration?duration/this.fanTotal:.055;this.fanDirection.copyFrom(this.camera.forward);this.fanIndex=0;this.fanClock=prepared?0:.18;this.visual.beginFanCast?.(prepared);return;}
    this.barrageTotal=duration?Math.min(48,Math.round(duration*14)):14;this.barrageInterval=duration?duration/this.barrageTotal:.6/14;this.barrageIndex=0;this.barrageClock=0;this.barrageDirection.copyFrom(this.camera.forward);
  }
  resetAttempt():void {this.cancelSkills();this.magazine.ammo=this.magazine.capacity;this.cadence.reset();this.casings.clear();this.effects.clear();this.hits=0;this.skillShots=0;this.hitTime=0;this.lastImpact="—";this.recoil.fill(0);for(const light of this.flashLights)light.intensity=0;for(const m of this.reloadMagazines)m.setEnabled(false);}
  cancelSkills():void {this.magazine.cancel();this.visual.reloadProgress=-1;this.actionClock=undefined;this.fan.clear();this.fanIndex=this.fanTotal;this.barrageIndex=this.barrageTotal;this.stormRemaining=0;}
  private launchFanBullet(index:number):void {
    const side=(index%2) as 0|1,muzzle=this.muzzle[side]!;muzzle.computeWorldMatrix(true);const origin=muzzle.getAbsolutePosition().clone();
    const chest=this.visual.position.add(new Vector3(0,1.3,0)),toMuzzle=origin.subtract(chest),obstruction=this.worldPick(new Ray(chest,toMuzzle.normalizeToNew(),toMuzzle.length()));
    if(obstruction?.pickedPoint)origin.copyFrom(obstruction.pickedPoint).addInPlace((obstruction.getNormal(true)??this.fanDirection.negate()).scale(.04));
    const direction=this.fan.launch(origin,this.fanDirection,index,this.fanTotal);this.visual.fanAim?.(side,direction);this.visual.fire(side);this.effects.muzzle(origin);this.casings.eject(origin,this.camera.forward,side);this.recoil[side]=t.recoilSeconds;this.skillShots++;this.audio.shot(false);
  }
  private worldPick(ray:Ray):PickingInfo|null {
    if(!this.yard.collision?.geometry){const hit=this.scene.pickWithRay(ray,mesh=>mesh.isPickable&&!this.yard.targets.some(t=>t.mesh===mesh||t.meshes?.includes(mesh as typeof t.mesh)));return hit?.hit?hit:null;}
    const hit=this.yard.collision.raycast(ray);if(!hit)return null;const result=new PickingInfo();result.hit=true;result.distance=hit.distance;result.pickedPoint=hit.point;result.getNormal=()=>hit.normal;return result;
  }
  private targetPick(ray:Ray,target:TrainingTarget,padding=0):PickingInfo {
    // Bounding volumes are updated by the animated actor. No per-shot CPU skinning or triangle walk.
    const box=target.mesh.getBoundingInfo().boundingBox,hit=sweepBox(ray.origin,ray.direction.scale(ray.length),{id:String(target.id),min:box.minimumWorld.add(new Vector3(-padding,-padding,-padding)),max:box.maximumWorld.add(new Vector3(padding,padding,padding))});const result=new PickingInfo();if(hit&&padding>0){const contact=ray.origin.add(ray.direction.scale(hit.time*ray.length)),surface=Vector3.Clamp(contact,box.minimumWorld,box.maximumWorld),delta=surface.subtract(ray.origin),length=delta.length();if(length>.001){const cover=this.worldPick(new Ray(ray.origin,delta.scale(1/length),length));if(cover&&cover.distance<length-.015)return result;}}if(hit){result.hit=true;result.distance=hit.time*ray.length;result.pickedMesh=target.mesh;result.pickedPoint=ray.origin.add(ray.direction.scale(result.distance));result.getNormal=()=>new Vector3(hit.normal.x,hit.normal.y,hit.normal.z);}return result;
  }
  private aimPick(ray:Ray):PickingInfo|null {
    let hit=this.worldPick(ray);for(const target of this.yard.targets){if(!target.mesh.isPickable||!target.mesh.isEnabled())continue;const candidate=this.targetPick(ray,target);if(candidate.hit&&(!hit||candidate.distance<hit.distance))hit=candidate;}return hit;
  }
  private skillRay(side:0|1,dir:Vector3,id:string,damage:number,pierce:boolean,aimPoint?:Vector3): void {
    const muzzle=this.muzzle[side]!;muzzle.computeWorldMatrix(true);const origin=muzzle.getAbsolutePosition().clone();
    if(aimPoint)dir=aimPoint.subtract(origin).normalize();
    else {
      const aim=this.aimPick(new Ray(this.camera.camera.position,dir,t.range));
      dir=(aim?.pickedPoint??this.camera.camera.position.add(dir.scale(t.range))).subtract(origin).normalize();
    }
    const ray=new Ray(origin,dir,t.range);
    const obstruction=this.worldPick(ray);
    const distance=obstruction?.hit?obstruction.distance:t.range;
    const targets=this.yard.targets.filter(target=>target.mesh.isPickable).map(target=>({target,hit:this.targetPick(ray,target,id==='backflip_barrage'?.85:0)})).filter(result=>result.hit.hit&&result.hit.distance<distance).sort((a,b)=>a.hit.distance-b.hit.distance);
    for(const {target,hit} of pierce?targets:targets.slice(0,1))this.damageTarget(target,hit.pickedPoint!,dir,damage,id);
    const end=!pierce&&targets[0]?.hit.pickedPoint?targets[0].hit.pickedPoint:origin.add(dir.scale(distance));
    if(obstruction?.hit&&(pierce||targets.length===0)){this.effects.mark(end,obstruction.getNormal(true)??dir.negate());this.effects.impact(end,obstruction.getNormal(true)??dir.negate());}
    if(pierce)this.effects.piercer(origin,end);else this.effects.tracer(origin,end);this.effects.muzzle(origin);this.casings.eject(origin,this.camera.forward,side);this.visual.fire(side);this.recoil[side]=t.recoilSeconds;this.skillShots++;
    this.audio.shot(targets.length>0);
  }
  private damageTarget(target:TrainingTarget,hit:Vector3,dir:Vector3,damage:number,id:string): void {
    const context:DamageContext={attackerId:1,victimId:target.id,sourceId:id,attackId:id,baseDamage:damage,finalDamage:damage,crit:false,procCoefficient:id==='ricochet_fan'?.3:1,procChainDepth:0,damageTags:['bullet','skill'],hitPosition:{x:hit.x,y:hit.y,z:hit.z},hitNormal:{x:-dir.x,y:-dir.y,z:-dir.z},forceDirection:{x:dir.x,y:dir.y,z:dir.z},forceMagnitude:5};
    this.events.emit('DamageDealt',context);target.onHit?.(context);target.hits++;this.hits++;this.hitTime=.12;target.ring?.scaling.setAll(1.15);this.effects.impact(hit,dir.negate());
  }
  private shoot(side: 0 | 1): void {
    if(!this.magazine.consume())return;
    this.lastSide=side;this.recoil[side]=t.recoilSeconds;this.visual.fire(side);
    const spread=t.spreadDegrees*Math.PI/180;
    const dir=this.camera.forward.clone();dir.x+=this.rng.range(-spread,spread);dir.y+=this.rng.range(-spread,spread);dir.normalize();
    const aim=this.aimPick(new Ray(this.camera.camera.position,dir,t.range));
    const aimPoint=aim?.pickedPoint??this.camera.camera.position.add(dir.scale(t.range));
    const muzzle=this.muzzle[side]!;muzzle.computeWorldMatrix(true);const origin=muzzle.getAbsolutePosition().clone();
    const shot=aimPoint.subtract(origin);const ray=new Ray(origin,shot.normalize(),Vector3.Distance(origin,aimPoint)+.05);
    const result=this.aimPick(ray);
    this.lastImpact=result?.pickedMesh?.name??'céu';
    const hit=result?.pickedPoint??aimPoint;
    this.effects.muzzle(origin);this.casings.eject(origin,this.camera.forward,side);this.effects.tracer(origin,hit);
    if(result?.hit)this.effects.impact(hit,result.getNormal(true)??dir.negate());
    this.camera.impulse(.009);
    const target=this.yard.targets.find(target=>target.mesh===result?.pickedMesh||!!result?.pickedMesh&&target.meshes?.includes(result.pickedMesh as typeof target.mesh));
    if(result?.hit&&!target)this.effects.mark(hit,result.getNormal(true)??dir.negate());
    if(target) {
      const normal=result?.getNormal(true)??Vector3.Up();
      const context: DamageContext={attackerId:1,victimId:target.id,sourceId:'dual_pistols',attackId:side===0?'right':'left',baseDamage:t.damage,finalDamage:t.damage,crit:false,procCoefficient:1,procChainDepth:0,damageTags:['bullet'],hitPosition:{x:hit.x,y:hit.y,z:hit.z},hitNormal:{x:normal.x,y:normal.y,z:normal.z},forceDirection:{x:dir.x,y:dir.y,z:dir.z},forceMagnitude:2};
      this.events.emit('DamageDealt',context);target.onHit?.(context);target.hits++;this.hits++;this.hitTime=.12;
      target.ring?.scaling.setAll(1.08);
    }
    this.audio.shot(Boolean(target));
  }
  dispose(): void {this.disposed=true;this.cancelSkills();this.effects.dispose();this.casings.dispose();for(const magazine of this.reloadMagazines)magazine.dispose();for(const root of this.weapons)root.dispose();this.container?.dispose();}
}

