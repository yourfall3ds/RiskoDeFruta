from pathlib import Path
p=Path('src/camera/ThirdPersonCamera.ts');s=p.read_text(encoding='utf-8');a=s.index('    const pivot=new Vector3(position.x,position.y+.76');b=s.index('    const weight=Math.min',a)
s=s[:a]+'''    const pivot=new Vector3(position.x,position.y+1.05,position.z);let close:Vector3|undefined,bestDistance=0;
    for(const angle of [0,.65,-.65,1.25,-1.25]){
      const direction=forward.scale(Math.cos(angle)).add(right.scale(Math.sin(angle)));
      const delta=direction.scale(3.45-progress*.22).add(right.scale(tier===2?-.38:.38));delta.y=.22;
      const hit=this.world.sweepSphere(pivot,delta,.16,true),fraction=hit?Math.max(0,hit.time-.05):1;
      const distance=delta.length()*fraction;if(distance>bestDistance){bestDistance=distance;close=pivot.add(delta.scale(fraction));}if(distance>2.6)break;
    }
    // A blocked close must never put the camera inside the character. Retain the normal camera if enclosed.
    if(!close||bestDistance<1.35)return;
'''+s[b:];p.write_text(s,encoding='utf-8')
p=Path('src/game/PlayerScene.ts');s=p.read_text(encoding='utf-8').replace('this.elements.update(animDt);','this.elements.update(this.poseReview?0:animDt);');s=s.replace("this.visual.prepareSkill(tier,.94);}","this.visual.prepareSkill(tier,.94);for(const side of [0,1] as const)this.elements.emit('electricity',this.weapons.muzzlePose(side).position,.55);this.elements.update(.12);}");p.write_text(s,encoding='utf-8')
