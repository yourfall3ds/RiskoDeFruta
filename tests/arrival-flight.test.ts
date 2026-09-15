import {it,expect} from 'vitest';
import {MeteorArrival} from '../src/player/MeteorArrival';
it('flies continuously from high altitude to the actual landing point and stays headfirst through impact and then recovers',()=>{
 const flight=new MeteorArrival(),landing={x:431,y:18.6,z:280},yaw=.7;flight.start();let previous=flight.position(landing,yaw),impacts=0;
 expect(previous.y).toBeCloseTo(918.6);expect(flight.dive).toBe(1);expect(flight.reveal).toBe(0);
 for(let i=0;i<480;i++){flight.update(1/120,()=>impacts++);const p=flight.position(landing,yaw);expect(p.y).toBeLessThanOrEqual(previous.y+1e-8);expect(Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z)).toBeLessThan(4);previous=p;}
 expect(flight.height).toBeCloseTo(0,6);expect(flight.position(landing,yaw).x).toBeCloseTo(landing.x,6);expect(flight.dive).toBe(1);expect(flight.active).toBe(true);
 flight.update(2.01,()=>impacts++);expect(impacts).toBe(1);expect(flight.active).toBe(false);expect(flight.recovery).toBe(1);
});
it('freezes on pause, ignores invalid deltas and restarts the reveal and impact latch',()=>{
 const f=new MeteorArrival();f.start();f.update(2,()=>{});const h=f.height;f.update(0,()=>{});f.update(NaN,()=>{});f.update(-5,()=>{});expect(f.height).toBe(h);expect(f.reveal).toBe(1);f.update(100,()=>{});f.start();expect(f.height).toBe(900);expect(f.impact).toBe(false);expect(f.reveal).toBe(0);
});

it('places the actual visual root on the flight path while leaving the physical player safely on terrain',async()=>{
 const {NullEngine}=await import('@babylonjs/core/Engines/nullEngine');const {Scene}=await import('@babylonjs/core/scene');const {CharacterVisual}=await import('../src/animation/CharacterVisual');const {PlayerMotor}=await import('../src/player/PlayerMotor');const {CollisionWorld}=await import('../src/physics/CollisionWorld');const {EventBus}=await import('../src/core/EventBus');
 const engine=new NullEngine(),scene=new Scene(engine),visual=new CharacterVisual(scene,()=>{}),player=new PlayerMotor(new CollisionWorld(),new EventBus(),{x:0,y:5,z:29}),f=new MeteorArrival();visual.ready=true;f.start();
 try{for(const dt of [0,1.6,1.6,.8,2.01]){f.update(dt,()=>{});const p=f.position(player.position,player.yaw);visual.ready=f.active;visual.arrivalPose=f.active?{position:p,rootLift:f.rootLift,height:f.height,dive:f.dive,recovery:f.recovery}:undefined;visual.update(player,1,1/60,false);expect(visual.root.position.x).toBeCloseTo(p.x);expect(visual.root.position.y).toBeCloseTo(p.y+(f.active?f.rootLift:0));expect(visual.root.position.z).toBeCloseTo(p.z);expect(player.position).toEqual({x:0,y:5,z:29});}expect(visual.root.rotation.x).toBe(0);}finally{visual.dispose();scene.dispose();engine.dispose();}
});

it('keeps headfirst orientation through ground contact and a readable impact hold',()=>{const f=new MeteorArrival();f.start();for(const t of [3.8,.19,.01,.3]){f.update(t,()=>{});expect(f.dive).toBe(1);expect(f.rootLift).toBeCloseTo(1.7);}f.update(.8,()=>{});expect(f.dive).toBeGreaterThan(0);expect(f.dive).toBeLessThan(1);f.update(1,()=>{});expect(f.dive).toBe(0);expect(f.rootLift).toBe(0);});

it("continues the same sway phase when leaving the live menu",()=>{const f=new MeteorArrival();const clock=7.35;f.start(clock);expect(f.sway).toBeCloseTo(Math.sin(clock*2)*.035);f.update(.01,()=>{});expect(Math.abs(f.sway-Math.sin(clock*2)*.035)).toBeLessThan(.001);});
