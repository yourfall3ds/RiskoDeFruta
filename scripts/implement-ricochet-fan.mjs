import fs from 'node:fs';
function edit(p,fn){const s=fs.readFileSync(p,'utf8'),n=fn(s);if(n===s)throw Error(p);fs.writeFileSync(p,n);}
edit('src/vfx/ShotEffects.ts',s=>s.replace('  piercer(from:',`  arcTrail(from:Vector3,to:Vector3):void {
    const e=this.pool.acquire();if(!e)return;const delta=to.subtract(from);e.from.copyFrom(from);e.direction.copyFrom(delta).normalize();e.distance=delta.length();e.tracer=true;e.mesh.position.copyFrom(from).addInPlace(delta.scale(.5));e.mesh.scaling.set(.065,e.distance,.065);e.mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),e.direction,new Quaternion());e.mesh.setEnabled(true);e.duration=.085;this.active.push(e);
  }
  piercer(from:`));
edit('src/combat/DualPistols.ts',s=>{
 s="import {RicochetFan} from './RicochetFan';\n"+s;
 s=s.replace('private piercerDelay=-1;private piercerDirection=Vector3.Forward();','private fanIndex=10;private fanClock=0;private fanDirection=Vector3.Forward();readonly fan:RicochetFan;');
 s=s.replace('this.effects=new ShotEffects(scene);',`this.effects=new ShotEffects(scene);
    this.fan=new RicochetFan((ray,ignore)=>{
      let hit=this.worldPick(ray);let targetId:number|undefined;
      for(const target of this.yard.targets){if(ignore.has(target.id)||!target.mesh.isPickable||!target.mesh.isEnabled())continue;const candidate=this.targetPick(ray,target);if(candidate.hit&&(!hit||candidate.distance<hit.distance)){hit=candidate;targetId=target.id;}}
      if(!hit?.hit||!hit.pickedPoint)return;return{point:hit.pickedPoint,normal:hit.getNormal(true)??ray.direction.negate(),distance:hit.distance,...(targetId===undefined?{}:{targetId})};
    },(hit,dir)=>{const target=hit.targetId===undefined?undefined:this.yard.targets.find(t=>t.id===hit.targetId);if(target)this.damageTarget(target,hit.point,dir,18,'ricochet_fan');else{this.effects.mark(hit.point,hit.normal);this.effects.impact(hit.point,hit.normal);}},(from,to)=>this.effects.arcTrail(from,to));`);
 s=s.replace('&&this.stormRemaining<=0,side','&&this.stormRemaining<=0&&this.fanIndex>=10,side');
 s=s.replace(/    if\(this.piercerDelay>=0\).*?\r?\n/,`    if(this.fanIndex<10){this.fanClock-=dt;if(this.fanClock<=0){this.launchFanBullet(this.fanIndex++);this.fanClock+=this.fan.interval;}}this.fan.update(dt);\n`);
 s=s.replace("tier===1?'double_piercer'", "tier===1?'ricochet_fan'");
 s=s.replace(/if\(tier===1\)\{this.piercerDirection.*?return;\}/,"if(tier===1){this.fanDirection.copyFrom(this.camera.forward);this.fanIndex=0;this.fanClock=0;return;}");
 s=s.replace('  private worldPick(',`  cancelSkills():void {this.fan.clear();this.fanIndex=10;this.barrageIndex=14;this.stormRemaining=0;}
  private launchFanBullet(index:number):void {
    const side=(index%2) as 0|1,muzzle=this.muzzle[side]!;muzzle.computeWorldMatrix(true);const origin=muzzle.getAbsolutePosition().clone();
    const direction=this.fan.launch(origin,this.fanDirection,index);this.visual.fanAim?.(side,direction);this.visual.fire(side);this.effects.muzzle(origin);this.recoil[side]=t.recoilSeconds;this.skillShots++;this.audio.shot(false);
  }
  private worldPick(`);
 s=s.replace("procCoefficient:1,procChainDepth:0,damageTags:['bullet','skill']", "procCoefficient:id==='ricochet_fan'?.3:1,procChainDepth:0,damageTags:['bullet','skill']");
 s=s.replace('dispose(): void {this.disposed=true;', 'dispose(): void {this.disposed=true;this.cancelSkills();');return s;
});
edit('src/animation/CharacterVisual.ts',s=>s.replace('  stormAim(side:',`  private readonly fanDirections=[Vector3.Forward(),Vector3.Forward()];private readonly fanTime=[0,0];
  fanAim(side:0|1,direction:Vector3):void {this.fanDirections[side]!.copyFrom(direction);this.fanTime[side]=.16;}
  stormAim(side:`).replace('this.styleClock+=dt;', 'this.styleClock+=dt;for(let i=0;i<2;i++)this.fanTime[i]=Math.max(0,this.fanTime[i]!-dt);').replace('}else aimArmAt(arm,grip,direction);','}else aimArmAt(arm,grip,this.fanTime[index]!>0?this.fanDirections[index]!:direction);'));
edit('src/game/PlayerScene.ts',s=>s.replace('this.weapons.stormRemaining=0;', 'this.weapons.cancelSkills();').replace('if(released){this.weapons.releaseSkill(released);','if(released){this.player.sprinting=false;this.weapons.releaseSkill(released);'));
for(const p of ['src/ui/PlayerHUD.ts','src/debug/DebugOverlay.ts'])edit(p,s=>s.replaceAll('Perfurante duplo','Leque ricocheteante').replaceAll('PERFURANTE DUPLO','LEQUE RICOCHETEANTE').replaceAll('Perfurante (QA)','Leque ricocheteante (QA)'));
