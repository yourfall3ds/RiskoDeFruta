import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CollisionWorld,sweepBox } from '../src/physics/CollisionWorld';
import { PlayerMotor } from '../src/player/PlayerMotor';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/contracts';
import { EMPTY_INPUT } from '../src/input/GameInput';
import type { InputFrame } from '../src/input/GameInput';
import { PLAYER_TUNING as tuning } from '../src/player/PlayerTuning';
import { PistolCadence } from '../src/combat/PistolCadence';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
const dt=1/60;
function setup(size=200) {
  const world=new CollisionWorld();world.surfaces.push({id:'floor',x:0,z:0,width:size,depth:size,height:0});
  const events=new EventBus<GameEvents>();const player=new PlayerMotor(world,events,{x:0,y:0,z:0});
  return {world,events,player};
}
function tick(player: PlayerMotor,count: number,input: Partial<InputFrame>={}){for(let i=0;i<count;i++)player.fixedUpdate(dt,{...EMPTY_INPUT,...input},0);}
describe('M1 locomotion',()=>{
  it('completes a four-metre airborne barrage and clears its state at stage spawn',()=>{const {player}=setup();player.barrageRetreat();let peak=0;for(let i=0;i<36;i++){tick(player,1);peak=Math.max(peak,player.position.y);}expect(player.position.z).toBeCloseTo(-4,3);expect(peak).toBeGreaterThan(1);player.resetAt(new Vector3(2,5,31));expect(player.position).toEqual({x:2,y:5,z:31});expect(player.backflipProgress).toBe(-1);expect(player.velocity).toEqual({x:0,y:0,z:0});expect(player.charges).toBe(2);});
  it('accepts Babylon vectors without copying their private storage into simulation',()=>{
    const {world,events}=setup();const player=new PlayerMotor(world,events,new Vector3(1,0,-10));tick(player,10);
    expect(player.position).toEqual({x:1,y:0,z:-10});
  });
  it('has unpenalized strafe/backward movement and normalized diagonals',()=>{
    const distances:number[]=[];
    for(const input of [{x:0,z:1},{x:1,z:0},{x:0,z:-1},{x:1,z:1}]){
      const {player}=setup();tick(player,180,input);distances.push(Math.hypot(player.position.x,player.position.z));
      expect(Math.hypot(player.velocity.x,player.velocity.z)).toBeCloseTo(5.4,3);
    }
    for(const d of distances)expect(d).toBeCloseTo(distances[0]!,5);
  });
  it('jumps close to 2.2 m and cannot double jump',()=>{
    const {player}=setup();tick(player,1,{jump:true});let highest=0;
    for(let i=0;i<80;i++){tick(player,1,{jump:i===10});highest=Math.max(highest,player.position.y);}
    expect(highest).toBeGreaterThan(2.08);expect(highest).toBeLessThan(2.3);expect(player.jumps).toBe(1);expect(player.grounded).toBe(true);
  });
  it('supports coyote time and a buffered landing jump',()=>{
    const {player,world}=setup();tick(player,1);world.surfaces.length=0;tick(player,4);tick(player,1,{jump:true});expect(player.jumps).toBe(1);
    const second=setup();second.player.position.y=.1;second.player.grounded=false;second.player.velocity.y=-2;
    tick(second.player,10); // expire initial coyote and land
    tick(second.player,1,{jump:true});
    for(let i=0;i<54;i++)tick(second.player,1);
    tick(second.player,1,{jump:true});
    tick(second.player,8);expect(second.player.jumps).toBe(2);
  });
  it('covers 6 m per dodge, spends two charges and recharges sequentially',()=>{
    const {player,events}=setup();let hooks=0;events.on('Dodged',()=>hooks++);
    tick(player,1,{dodge:true});tick(player,Math.ceil(tuning.dodgeSeconds/dt)-1);expect(player.position.z).toBeCloseTo(6,5);
    tick(player,1,{dodge:true});tick(player,Math.ceil(tuning.dodgeSeconds/dt)-1);expect(player.position.z).toBeCloseTo(12,5);expect(player.charges).toBe(0);expect(hooks).toBe(2);
    tick(player,1,{dodge:true});expect(hooks).toBe(2);
    tick(player,Math.ceil((tuning.dodgeRechargeSeconds-2*tuning.dodgeSeconds)/dt)+2);expect(player.charges).toBe(1);
  });
  it('allows only one air dodge before landing',()=>{
    const {player}=setup();tick(player,1,{jump:true});tick(player,1,{dodge:true});tick(player,15);tick(player,1,{dodge:true});expect(player.dodges).toBe(1);
  });
  it('returns from the void and emits the exact 25% HP DamageContext',()=>{
    const {player,events}=setup();let damage=0;events.on('PlayerHit',context=>{damage=context.finalDamage;});
    player.position.y=-26;player.grounded=false;tick(player,1);
    expect(player.position.y).toBe(0);expect(damage).toBe(32.5);expect(player.hp).toBeCloseTo(97.5,0);expect(player.respawns).toBe(1);expect(player.invulnerable).toBe(1);
  });
});
describe('M1 collision',()=>{
  it('does not tunnel during dodge and slides along walls',()=>{
    const {world,player}=setup();world.boxes.push({id:'thin-wall',min:{x:-10,y:0,z:2},max:{x:10,y:3,z:2.05}});
    tick(player,1,{dodge:true});tick(player,65,{x:1,z:1});expect(player.position.z).toBeLessThan(1.69);expect(player.position.x).toBeGreaterThan(.5);
  });
  it('walks a 0.4 m step but blocks a 0.6 m step',()=>{
    for(const height of [.4,.6]){const {world,player}=setup();world.boxes.push({id:'step',min:{x:-5,y:0,z:1},max:{x:5,y:height,z:4}});tick(player,20,{z:1});if(height===.4)expect(player.position.y).toBeCloseTo(.4);else expect(player.position.z).toBeLessThan(.69);}
  });
  it('conservatively sweeps the camera sphere and rejects a clear ray',()=>{
    const wall={id:'wall',min:{x:-1,y:0,z:-3},max:{x:1,y:4,z:-2}};
    const hit=sweepBox({x:0,y:1.7,z:0},{x:0,y:0,z:-7},wall,.25);
    expect(hit?.time).toBeCloseTo(1.75/7);expect(sweepBox({x:4,y:1,z:0},{x:0,y:0,z:-7},wall,.25)).toBeUndefined();
  });
  it('stops an upward jump against a ceiling',()=>{
    const {world,player}=setup();world.boxes.push({id:'ceiling',min:{x:-4,y:2.5,z:-4},max:{x:4,y:3,z:4}});
    tick(player,1,{jump:true});let peak=0;for(let i=0;i<60;i++){tick(player,1);peak=Math.max(peak,player.position.y);}
    expect(peak).toBeLessThanOrEqual(.701);expect(player.grounded).toBe(true);
  });
});
describe('M1 weapons and art',()=>{
  it('alternates pistols at 6.7 shots/s while held and never reloads',()=>{
    const cadence=new PistolCadence();const sides:number[]=[];
    for(let i=0;i<600;i++)cadence.update(dt,true,side=>sides.push(side));
    expect(sides.length).toBe(67);sides.forEach((side,i)=>expect(side).toBe(i%2));
    for(let i=0;i<600;i++)cadence.update(dt,false,()=>{throw new Error('Released trigger fired');});
    expect(cadence.shots).toBe(67);
  });
  it('ships one skinned mesh with useful locomotion and newly authored combat clips',()=>{
    const bytes=readFileSync('public/models/gunslinger.glb');const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    const names=gltf.animations.map((a:{name:string})=>a.name);
    for(const name of ['Run','Walk','Dodge','Aim','Fire_R','Fire_L','Charge','Release'])expect(names).toContain(name);
    expect(names).not.toContain('Draw');expect(gltf.meshes.length).toBe(1);expect(gltf.skins.length).toBe(1);expect(bytes.length).toBeLessThan(4_000_000);
  });
});
