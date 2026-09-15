import {it,expect} from 'vitest';
import {reloadMovement} from '../src/player/ReloadMovement';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
it('keeps sprint, jump and dodge responsive while a reload suppresses firing intent',()=>{
 const world=new CollisionWorld();world.surfaces.push({id:'floor',x:0,z:0,width:200,depth:200,height:0});
 const p=new PlayerMotor(world,new EventBus(),{x:0,y:0,z:0});p.sprinting=true;
 for(let i=0;i<30;i++)p.fixedUpdate(1/60,reloadMovement({...EMPTY_INPUT,z:1,fire:true},true),0);
 expect(p.sprinting).toBe(true);expect(p.velocity.z).toBeGreaterThan(8);
 p.fixedUpdate(1/60,reloadMovement({...EMPTY_INPUT,z:1,jump:true},true),0);expect(p.grounded).toBe(false);expect(p.velocity.y).toBeGreaterThan(0);
 expect(reloadMovement({...EMPTY_INPUT,dodge:true,reload:true},true).dodge).toBe(true);
 p.fixedUpdate(1/60,reloadMovement({...EMPTY_INPUT,z:1,fire:true},false),0);expect(p.sprinting).toBe(false);
});
it('layers reload arms over moving legs without importing the reload root translation',async()=>{
 const {NullEngine}=await import('@babylonjs/core/Engines/nullEngine');const {Scene}=await import('@babylonjs/core/scene');const {TransformNode}=await import('@babylonjs/core/Meshes/transformNode');const {Animation}=await import('@babylonjs/core/Animations/animation');const {AnimationGroup}=await import('@babylonjs/core/Animations/animationGroup');const {Vector3,Quaternion}=await import('@babylonjs/core/Maths/math.vector');const {CharacterVisual}=await import('../src/animation/CharacterVisual');
 const e=new NullEngine(),scene=new Scene(e),visual=new CharacterVisual(scene,()=>{}),hips=new TransformNode('Hips',scene),arm=new TransformNode('RightArm',scene);arm.rotationQuaternion=Quaternion.Identity();
 const groups=(visual as unknown as {clips:Map<string,InstanceType<typeof AnimationGroup>>}).clips;
 for(const name of ['Idle','Run','ReloadCast']){const g=new AnimationGroup(name,scene);const a=new Animation(name+'hips','position',60,Animation.ANIMATIONTYPE_VECTOR3);const pos=new Vector3(0,name==='ReloadCast'?99:1,0);a.setKeys([{frame:0,value:pos},{frame:60,value:pos}]);g.addTargetedAnimation(a,hips);const r=new Animation(name+'arm','rotationQuaternion',60,Animation.ANIMATIONTYPE_QUATERNION);const q=Quaternion.RotationAxis(Vector3.Right(),name==='ReloadCast'?.8:0);r.setKeys([{frame:0,value:q},{frame:60,value:q}]);g.addTargetedAnimation(r,arm);groups.set(name,g);}
 const p=new PlayerMotor(new CollisionWorld(),new EventBus(),{x:0,y:0,z:0});p.velocity.z=8.1;p.sprinting=true;visual.ready=true;visual.reloadProgress=.5;
 try{visual.update(p,1,.3,false);expect(hips.position.y).toBeCloseTo(1);expect(arm.rotationQuaternion!.toEulerAngles().x).toBeCloseTo(.8);visual.reloadProgress=-1;visual.update(p,1,.3,false);expect(arm.rotationQuaternion!.toEulerAngles().x).toBeCloseTo(0);expect(hips.position.y).toBeCloseTo(1);}finally{visual.dispose();scene.dispose();e.dispose();}
});

