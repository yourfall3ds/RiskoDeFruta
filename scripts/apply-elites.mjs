import {readFileSync,writeFileSync} from 'node:fs';
const path='src/game/EnemySwarm.ts';let s=readFileSync(path,'utf8');
const edits=[
 ["import { PopulationBudget }", "import { ENEMY_AFFIXES,chooseVariant,type EnemyVariant } from '../enemies/EnemyAffixes';\nimport { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';\nimport { PopulationBudget }"],
 ['interface Actor {id:number;kind:EnemyKind;', 'interface Actor {id:number;kind:EnemyKind;variant:EnemyVariant;scale:number;push:Vector3;'],
 ['private containers=new Map<string,AssetContainer>();','private containers=new Map<string,AssetContainer>();private readonly eliteMaterials=new Map<string,PBRMaterial>();'],
 ['spawn(kind:EnemyKind,position?:Vec3):boolean',"spawn(kind:EnemyKind,position?:Vec3,variant:EnemyVariant=kind==='boss'?'normal':chooseVariant(this.rng.stream('elite').next(),this.director.time)):boolean"],
 ['const definition=ENEMIES[kind];let actor','const definition=ENEMIES[kind],affix=ENEMY_AFFIXES[variant];let actor'],
 ['actor={id,kind,root,visual,body,health,target,clips,','actor={id,kind,variant,scale:definition.scale,push:Vector3.Zero(),root,visual,body,health,target,clips,'],
 ['actor.active=true;actor.health=','actor.variant=variant;actor.scale=definition.scale*affix.scale;actor.push.setAll(0);actor.active=true;actor.health='],
 ['definition.hp*(1+(this.progression.stage-1)*.35),this.events);actor.healthTrail','definition.hp*affix.health*(1+(this.progression.stage-1)*.35),this.events);actor.healthTrail'],
 ['actor.root.scaling.setAll(definition.scale)','actor.root.scaling.setAll(actor.scale)'],
 ['definition.radius,definition.speed);this.audio','definition.radius*affix.scale,definition.speed*affix.speed);this.audio'],
 ["const finalDamage=context.procChainDepth>0?context.finalDamage:context.baseDamage*stats.damage*(context.damageTags.includes('skill')?stats.mp:1)*(crit?2:1);","const rawDamage=context.procChainDepth>0?context.finalDamage:context.baseDamage*stats.damage*(context.damageTags.includes('skill')?stats.mp:1)*(crit?2:1);const finalDamage=rawDamage*100/(100+ENEMY_AFFIXES[a.variant].armor);"],
 ['applied,ENEMIES[a.kind].scale)','applied,a.scale)'],
 ["this.progression.reward(a.kind==='boss');","this.progression.reward(a.kind==='boss',ENEMY_AFFIXES[a.variant].gold);"],
 ["if(a.state!=='chase')return;","if(a.state!=='chase'||a.push.lengthSquared()>.25)return;"],
 ['Boolean(behavior.ranged),def.speed);','Boolean(behavior.ranged),def.speed*ENEMY_AFFIXES[a.variant].speed);'],
 ['let speed=ENEMIES[a.kind].speed;','let speed=ENEMIES[a.kind].speed*ENEMY_AFFIXES[a.variant].speed;'],
 ['*ENEMIES[a.kind].scale;a.gait','*a.scale;a.gait'],
 ['ENEMIES[a.kind].radius+.9','ENEMIES[a.kind].radius*ENEMY_AFFIXES[a.variant].scale+.9'],
];
for(const [from,to] of edits){if(!s.includes(from))throw Error('Missing edit '+from);s=s.replaceAll(from,to);}writeFileSync(path,s);
