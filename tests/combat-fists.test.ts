import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {MorphTarget} from '@babylonjs/core/Morph/morphTarget';
import {CharacterVisual} from '../src/animation/CharacterVisual';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';

it('ships a separate closed-glove shape and leaves the gun-grip geometry as the default',()=>{
 const b=readFileSync('public/models/gunslinger.glb'),length=b.readUInt32LE(12),g=JSON.parse(b.toString('utf8',20,20+length));
 const mesh=g.meshes[0],slot=mesh.extras.targetNames.indexOf('CombatFists');expect(slot).toBeGreaterThanOrEqual(0);expect(mesh.weights[slot]).toBe(0);
 const accessor=g.accessors[mesh.primitives[0].targets[slot].POSITION],view=g.bufferViews[accessor.bufferView];
 const offset=28+length+(view.byteOffset??0)+(accessor.byteOffset??0);let changed=0;
 for(let i=0;i<accessor.count;i++){
  const delta=[0,1,2].map(c=>b.readFloatLE(offset+i*12+c*4));
  expect(delta.every(Number.isFinite)).toBe(true);expect(Math.hypot(...delta)).toBeLessThan(22);
  if(Math.hypot(...delta)>.001)changed++;
 }
 expect(changed).toBeGreaterThan(200);expect(changed/accessor.count).toBeLessThan(.08);
 for(const name of ['Aim','Fire_L','Fire_R','RecordedFall','RecordedHit'])expect(g.animations.some((a:{name:string})=>a.name===name)).toBe(true);
});

it('closes the glove in unarmed combat and restores the original pistol grip after drawing',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),visual=new CharacterVisual(scene,()=>{}),fist=new MorphTarget('CombatFists',0);
 (visual as unknown as {fists:MorphTarget[]}).fists.push(fist);
 const player=new PlayerMotor(new CollisionWorld(),new EventBus(),{x:0,y:0,z:0});
 try{
  visual.unarmedStance=true;for(let i=0;i<40;i++)visual.update(player,1,1/60,false);
  expect(fist.influence).toBeGreaterThan(.99);
  visual.unarmedStance=false;for(let i=0;i<40;i++)visual.update(player,1,1/60,true);
  expect(fist.influence).toBeLessThan(.001);
 }finally{visual.dispose();scene.dispose();engine.dispose();}
});
