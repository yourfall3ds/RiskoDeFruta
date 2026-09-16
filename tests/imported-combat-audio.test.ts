import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {WeaponAudio} from '../src/audio/RecordedAudio';
import {corpseLaunch} from '../src/enemies/EnemyImpact';
import type {DamageContext} from '../src/core/contracts';

it('routes punches, kicks, received damage and flight to separate real recordings',async()=>{
 const groups=['melee-punch','melee-heavy-punch','melee-kick','melee-heavy-kick','melee-swing','melee-launch','body-ground','player-hit'];
 const starts:string[]=[],stops:number[]=[];let decoded=0;
 const parameter=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},setTargetAtTime(){}});
 const node=()=>({connect(){},disconnect(){},gain:parameter(),pan:parameter()});
 class Context {
  state='running';currentTime=2;destination={};resume(){return Promise.resolve();}close(){return Promise.resolve();}
  createGain(){return node();}createStereoPanner(){return node();}
  decodeAudioData(data:ArrayBuffer){decoded++;return Promise.resolve({duration:5,group:groups[new Uint8Array(data)[0]!]});}
  createBufferSource(){return{...node(),buffer:null as unknown as {group:string},playbackRate:parameter(),start(){starts.push(this.buffer.group);},stop(t:number){stops.push(t);},onended:null};}
 }
 vi.stubGlobal('AudioContext',Context);
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>Object.fromEntries(groups.map((g,i)=>[g,[String(i)]])),arrayBuffer:async()=>new Uint8Array([Number(url)||0]).buffer})));
 const audio=new WeaponAudio({enemyOverrides:null});
 try{
  audio.unlock();await vi.waitFor(()=>expect(decoded).toBe(groups.length+3));
  audio.meleeSwing();audio.skillImpact('unarmed_right-cross');audio.skillImpact('unarmed_uppercut');
  audio.skillImpact('unarmed_left-kick');audio.skillImpact('unarmed_spin-kick');audio.playerHurt('melee');
  audio.meleeLaunch(30);expect(starts).not.toContain('melee-launch');
  audio.meleeLaunch(2);audio.meleeLaunch(2);audio.bodyGround();
  expect(starts).toEqual(['melee-swing','melee-punch','melee-heavy-punch','melee-kick','melee-heavy-kick','player-hit','melee-launch','body-ground']);
  expect(stops).toEqual([3.1]);
 }finally{audio.dispose();vi.unstubAllGlobals();}
});

it('ships only valid selected PCM recordings and uses them in the manifest',()=>{
 const report=JSON.parse(readFileSync('docs/transformice-combat-import.json','utf8'));
 const manifest=JSON.parse(readFileSync('public/audio/foley-manifest.json','utf8'));
 expect(report.recordings).toHaveLength(10);
 for(const entry of report.recordings){
  const bytes=readFileSync('public'+entry.file);
  expect(bytes.toString('ascii',0,4)).toBe('RIFF');expect(bytes.toString('ascii',8,12)).toBe('WAVE');
  expect(manifest[entry.group]).toContain(entry.file);expect(entry.seconds).toBeGreaterThan(0);
 }
 expect(manifest['player-hit']).toEqual(manifest['melee-punch']);
});

it('heavy melee really launches the corpse faster, with a bounded impulse',()=>{
 const hit:DamageContext={attackerId:1,victimId:2,sourceId:'unarmed_spin-kick',attackId:'spin-kick',baseDamage:44,finalDamage:44,crit:false,procCoefficient:0,procChainDepth:0,hitPosition:{x:0,y:0,z:0},hitNormal:{x:0,y:0,z:-1},damageTags:['melee_heavy'],forceMagnitude:12,forceDirection:{x:0,y:0,z:1}};
 expect(corpseLaunch(hit)).toEqual({x:0,y:4,z:10});
 expect(corpseLaunch({...hit,forceMagnitude:100})).toEqual({x:0,y:4,z:10});
 expect(corpseLaunch({...hit,damageTags:['bullet']})).toEqual({x:0,y:2.2,z:3});
});
