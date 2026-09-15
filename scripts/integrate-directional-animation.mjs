import fs from 'node:fs';
const edit=(p,fn)=>{const s=fs.readFileSync(p,'utf8'),n=fn(s);if(s===n)throw Error(p);fs.writeFileSync(p,n);};
edit('src/animation/CharacterVisual.ts',s=>{
 s="import {directionalLocomotion} from './DirectionalLocomotion';\n"+s;
 s=s.replace('private releaseTime=1;', 'private fanCastTime=0;private preparation:{tier:1|2|3;progress:number}|undefined;\n  prepareSkill(tier:1|2|3,progress:number):void {this.preparation={tier,progress};}\n  endPreparation():void {this.preparation=undefined;}\n  beginFanCast(prepared=false):void {this.fanCastTime=prepared?.87:1.05;this.releaseTime=1;}\n  private releaseTime=1;');
 s=s.replace('filter: (name: string) => boolean=()=>true): void', 'filter: (name: string) => boolean=()=>true,weight=this.blend): void').replace('value,this.blend,node.rotationQuaternion','value,weight,node.rotationQuaternion').replace('value,this.blend,node.position','value,weight,node.position');
 s=s.replace('    const speed=Math.hypot',`    if(this.preparation){const {tier,progress}=this.preparation;this.machine.sample(['PrepareFan','PrepareMortal','PrepareStorm'][tier-1]!,progress,dt);this.root.computeWorldMatrix(true);for(const grip of this.grips)grip?.computeWorldMatrix(true);return;}
    this.fanCastTime=Math.max(0,this.fanCastTime-dt);
    const speed=Math.hypot`);
 s=s.replace("    const name=flipping?", "    const locomotion=directionalLocomotion(player.velocity.x,player.velocity.z,player.yaw);\n    const name=flipping?");
 s=s.replace("this.landingTime>0?'Land':speed>4?'Run':speed>.5?'Walk':'Idle'", "this.fanCastTime>0&&speed<.5?'FanCast':this.landingTime>0?'Land':locomotion.primary");
 s=s.replace("name==='Run'?Math.max(.3,speed/9):name==='Walk'?Math.max(.3,speed/2.2):1", "name.startsWith('Run')?Math.max(.3,speed/9):['Walk','WalkBackward','StrafeLeft','StrafeRight'].includes(name)?Math.max(.3,speed/2.2):1");
 s=s.replace("    if(flipping)progress=", "    if(name==='FanCast')progress=1-this.fanCastTime/1.05;\n    else if(flipping)progress=");
 s=s.replace('    this.machine.sample(name,progress,dt,lower,clipName);',`    this.machine.sample(name,progress,dt,lower,clipName);
    if(name===locomotion.primary&&locomotion.weight>0){const second=this.clips.get(locomotion.secondary);if(second)this.sample(second,progress,lower,locomotion.weight);}`);
 s=s.replace("const aim=this.clips.get(charging?'Charge':'Aim');if(aim)this.sample(aim,charging?chargeProgress:0,upper);", "const casting=this.fanCastTime>0,aim=this.clips.get(casting?'FanCast':charging?'Charge':'Aim');if(aim)this.sample(aim,casting?1-this.fanCastTime/1.05:charging?chargeProgress:0,n=>upper(n)||(casting&&n.startsWith('Spine')));");
 s=s.replace("if(release&&this.releaseTime<1)","if(release&&this.releaseTime<1&&this.fanCastTime<=0)");return s;
});
edit('src/combat/DualPistols.ts',s=>s.replace('releaseSkill(tier: Exclude<MPTier,0>):', 'releaseSkill(tier: Exclude<MPTier,0>,prepared=false):').replace('this.fanIndex=0;this.fanClock=0;return;', 'this.fanIndex=0;this.fanClock=prepared?0:.18;this.visual.beginFanCast?.(prepared);return;'));
