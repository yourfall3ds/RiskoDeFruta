import {it,expect} from 'vitest';
import {RunProgression} from '../src/run/RunProgression';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
import {EMPTY_INPUT} from '../src/input/InputFrame';
function fixture(count:number){const world=new CollisionWorld();world.surfaces.push({id:'floor',x:0,z:0,width:100,depth:100,height:0});const events=new EventBus<GameEvents>(),run=new RunProgression(events),player=new PlayerMotor(world,events,{x:0,y:0,z:0});for(let i=0;i<count;i++)run.addItem('feather');player.extraJumps=run.stats.extraJumps;player.jumpMultiplier=run.stats.jump;return {world,run,player};}
const tick=(player:PlayerMotor,jump=false)=>player.fixedUpdate(1/60,{...EMPTY_INPUT,jump},0);
it.each([0,1,2,5])('%i feathers add exactly that many aerial jumps without changing launch height',count=>{
 const {run,player}=fixture(count);expect(run.stats.jump).toBe(1);expect(run.stats.extraJumps).toBe(count);
 tick(player,true);const launch=player.velocity.y;expect(player.airJumpsUsed).toBe(0);
 for(let i=0;i<count;i++){for(let n=0;n<5;n++)tick(player);tick(player,true);expect(player.velocity.y).toBeCloseTo(launch);expect(player.airJumpsUsed).toBe(i+1);}
 for(let n=0;n<5;n++)tick(player);tick(player,true);expect(player.jumps).toBe(count+1);expect(player.velocity.y).toBeLessThan(launch);
 for(let n=0;n<240;n++)tick(player);expect(player.grounded).toBe(true);expect(player.airJumpsUsed).toBe(0);
 const before=player.jumps;tick(player,true);for(let n=0;n<10;n++)tick(player);tick(player,true);expect(player.jumps-before).toBe(count>0?2:1);
});
it('allows an aerial rescue after coyote time and resets spent charges on respawn',()=>{
 const {world,player}=fixture(2);world.surfaces.length=0;for(let i=0;i<12;i++)tick(player);tick(player,true);expect(player.airJumpsUsed).toBe(1);expect(player.velocity.y).toBeGreaterThan(8);
 player.resetAt({x:0,y:0,z:0});expect(player.airJumpsUsed).toBe(0);expect(player.extraJumps).toBe(2);
});
it('extra jumps respect ceilings and leave height bonuses on other items independent',()=>{
 const {world,run,player}=fixture(3);run.addItem('perk_51');expect(run.stats.jump).toBeCloseTo(1.18);expect(run.stats.extraJumps).toBe(3);
 world.boxes.push({id:'ceiling',min:{x:-5,y:2.5,z:-5},max:{x:5,y:3,z:5}});tick(player,true);
 let peak=0;for(let i=0;i<30;i++){tick(player,i===4||i===8||i===12);peak=Math.max(peak,player.position.y);}
 expect(peak).toBeLessThanOrEqual(.701);
});
