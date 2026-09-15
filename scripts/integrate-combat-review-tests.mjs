import fs from 'node:fs';
const edit=(p,fn)=>{const s=fs.readFileSync(p,'utf8'),n=fn(s);if(s===n)throw Error(p);fs.writeFileSync(p,n);};
edit('src/game/EnemySwarm.ts',s=>{
 s="import {enemyImpact} from '../enemies/EnemyImpact';\n"+s;
 const a=s.indexOf("const regular=context.sourceId==='dual_pistols'"),b=s.indexOf('    if(force>.5)',a);
 s=s.slice(0,a)+"const {force,stagger}=enemyImpact(context,a.variant,a.kind,a.staggerCooldown);\n"+s.slice(b);
 return s.replace('if(!regular&&force>3&&a.staggerCooldown<=0)','if(stagger)');
});
edit('src/player/PlayerMotor.ts',s=>s.replace('resetAt(spawn:Vec3):void {this.sprinting=false;','resetAt(spawn:Vec3):void {this.sprinting=false;this.regenerationDelay=0;'));
edit('src/debug/DebugOverlay.ts',s=>s.replace("['heal','Restaurar vida'],", "['heal','Restaurar vida'],['hit-player','Receber dano (QA)'],"));
edit('src/game/PlayerScene.ts',s=>s.replace("    if(name==='loot')",`    if(name==='hit-player'){const invincible=this.player.debugInvincible;this.player.debugInvincible=false;this.player.invulnerable=0;this.player.applyDamage({attackerId:999,victimId:1,sourceId:'qa_enemy',attackId:'qa_damage',baseDamage:25,finalDamage:25,crit:false,procCoefficient:0,procChainDepth:0,damageTags:['enemy'],hitPosition:{...this.player.position},hitNormal:{x:1,y:0,z:0},forceDirection:{x:-1,y:0,z:0},forceMagnitude:2});this.player.debugInvincible=invincible;}
    if(name==='loot')`));
edit('src/combat/DualPistols.ts',s=>s.replace('const direction=this.fan.launch(origin,this.fanDirection,index);',`const chest=this.visual.position.add(new Vector3(0,1.3,0)),toMuzzle=origin.subtract(chest),obstruction=this.worldPick(new Ray(chest,toMuzzle.normalizeToNew(),toMuzzle.length()));
    if(obstruction?.pickedPoint)origin.copyFrom(obstruction.pickedPoint).addInPlace((obstruction.getNormal(true)??this.fanDirection.negate()).scale(.04));
    const direction=this.fan.launch(origin,this.fanDirection,index);`));
edit('tests/mp.test.ts',s=>s.replace("it('double piercer hits more than one target along both gun rays'", "it('fan emits ten traveling shots and damages enemies in its swept area'").replace('for(let i=0;i<8;i++)run.weapons.fixedUpdate(1/60,false);expect(run.targets.map(t=>t.hits)).toEqual([2,2]);expect(run.weapons.skillShots).toBe(2);','for(let i=0;i<120;i++){run.weapons.fixedUpdate(1/60,false);run.weapons.updatePose(1/60);}expect(run.targets.reduce((sum,t)=>sum+t.hits,0)).toBeGreaterThan(0);expect(run.weapons.skillShots).toBe(10);').replace('piercer and storm','fan and storm'));
edit('tests/review-regressions.test.ts',s=>{
 const a=s.indexOf('spy.mockClear();w.releaseSkill(1);'),b=s.indexOf('w.dispose();',a);return s.slice(0,a)+s.slice(b);
});
