import {readFileSync,writeFileSync} from 'node:fs';
const edit=(p,a,b)=>{let s=readFileSync(p,'utf8');if(!s.includes(a))throw Error(p+' missing '+a.slice(0,40));writeFileSync(p,s.replace(a,b));};
edit('src/animation/CharacterVisual.ts',"import { aimArmAt }", "import {poseAkimbo} from './StylishAim';\nimport { aimArmAt }");
edit('src/animation/CharacterVisual.ts',"private releaseTime=1;", "private releaseTime=1;private styleTime=0;private styleClock=0;private readonly styleTargets=[Vector3.Zero(),Vector3.Zero()];private readonly targetTime=[0,0];\n  stormAim(side:0|1,point:Vector3):void{this.styleTargets[side]!.copyFrom(point);this.targetTime[side]=.25;this.styleTime=.28;}");
edit('src/animation/CharacterVisual.ts','this.releaseTime=Math.min(1,this.releaseTime+dt/.3);', 'this.releaseTime=Math.min(1,this.releaseTime+dt/.3);this.styleTime=Math.max(0,this.styleTime-dt);this.styleClock+=dt;for(const side of [0,1] as const)this.targetTime[side]=Math.max(0,this.targetTime[side]!-dt);');
edit('src/animation/CharacterVisual.ts','const grip=this.grips[index];if(grip)aimArmAt(arm,grip,new Vector3(Math.sin(player.yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(player.yaw)*Math.cos(pitch)));', `const grip=this.grips[index];if(!grip)continue;
        const direction=new Vector3(Math.sin(player.yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(player.yaw)*Math.cos(pitch));
        const forearm=this.scene.getTransformNodeByName(side+'ForeArm'),hand=this.hands[index];
        if(this.styleTime>0&&forearm&&hand){const sign=index===0?1:-1,cross=(1-Math.cos(this.styleClock*7))*.5,lateral=sign*(.32-.52*cross),forward=.46;
          const wrist=this.position.add(new Vector3(Math.cos(player.yaw)*lateral+Math.sin(player.yaw)*forward,1.27+cross*.10,Math.cos(player.yaw)*forward-Math.sin(player.yaw)*lateral));
          const pole=this.position.add(new Vector3(Math.cos(player.yaw)*sign*.65,.78,-Math.sin(player.yaw)*sign*.65));
          const target=this.targetTime[index]!>0?this.styleTargets[index]!:wrist.add(direction.scale(30));poseAkimbo(arm,forearm,hand,grip,wrist,pole,target);
        }else aimArmAt(arm,grip,direction);`);
edit('src/combat/DualPistols.ts','const aimPosition=target.mesh.getBoundingInfo().boundingBox.centerWorld;', 'const aimPosition=target.mesh.getBoundingInfo().boundingBox.centerWorld;this.visual.stormAim((this.skillShots%2) as 0|1,aimPosition);');
edit('src/vfx/ShotEffects.ts','tracer:boolean }','tracer:boolean;travel:boolean }');
edit('src/vfx/ShotEffects.ts','distance:0,tracer:false}', 'distance:0,tracer:false,travel:false}');
edit('src/vfx/ShotEffects.ts','effect.tracer=false;', 'effect.tracer=false;effect.travel=false;');
edit('src/vfx/ShotEffects.ts','  update(dt: number): void {', `  piercer(from:Vector3,to:Vector3):void {
    const effect=this.pool.acquire();if(!effect)return;const delta=to.subtract(from);effect.from.copyFrom(from);effect.direction.copyFrom(delta).normalize();effect.distance=delta.length();effect.tracer=true;effect.travel=true;effect.mesh.position.copyFrom(from);effect.mesh.scaling.set(.16,.6,.16);effect.mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),effect.direction,new Quaternion());effect.mesh.setEnabled(true);effect.duration=effect.distance/95+.08;this.active.push(effect);
  }
  update(dt: number): void {`);
edit('src/vfx/ShotEffects.ts','const head=e.distance;const tail=0;', 'const head=e.travel?Math.min(e.distance,e.time*95):e.distance;const tail=e.travel?Math.max(0,head-2.3):0;');
edit('src/combat/DualPistols.ts','this.effects.tracer(origin,end);this.effects.muzzle(origin);', "if(pierce)this.effects.piercer(origin,end);else this.effects.tracer(origin,end);this.effects.muzzle(origin);");
