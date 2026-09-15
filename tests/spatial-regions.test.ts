import {it,expect} from 'vitest';
import {SpatialRegionInterest,FARM_REGIONS} from '../src/world/streaming/SpatialRegionInterest';
import {RegionResidency} from '../src/world/streaming/RegionResidency';
import {RegionPresentation} from '../src/world/streaming/RegionPresentation';
import {REGION_PASSAGES,passageCollider} from '../src/world/streaming/RegionPassages';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
it('starts with only the nearby city and keeps an in-flight frontier request within hysteresis',()=>{
 const policy=new SpatialRegionInterest(FARM_REGIONS);expect(policy.requests({x:0,y:0,z:0}).map(r=>r.id)).toEqual(['farm-city']);expect(policy.requests({x:80,y:2,z:45}).map(r=>r.id)).toContain('solar-frontier');expect(policy.requests({x:70,y:2,z:45}).map(r=>r.id)).toContain('solar-frontier');expect(policy.requests({x:0,y:0,z:0}).map(r=>r.id)).not.toContain('solar-frontier');
});
it('an occupied faraway region remains loaded until its last owner leaves',async()=>{
 const policy=new SpatialRegionInterest(FARM_REGIONS),disposed:string[]=[],pool=new RegionResidency(2,1,async request=>({activate(){},dispose(){disposed.push(request.id);}}));
 pool.request(policy.requests({x:285,y:15,z:147}));await pool.settled();const release=pool.retain('solar-frontier');pool.request(policy.requests({x:0,y:0,z:0}));expect(pool.readyIds).toContain('solar-frontier');release();await pool.settled();expect(pool.readyIds).toEqual(['farm-city']);expect(disposed).toContain('solar-frontier');pool.dispose();
});
it.each(REGION_PASSAGES)('unready passage $id stops walking and airborne movement before the missing bridge',passage=>{
 const world=new CollisionWorld(),gate=passageCollider(passage);world.movingBoxes.push(gate);world.surfaces.push({id:'approach',x:passage.x,z:passage.z,width:12,depth:12,height:passage.y});
 const p=new PlayerMotor(world,new EventBus(),{x:passage.x-2,y:passage.y,z:passage.z});for(let i=0;i<60;i++)p.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},Math.PI/2);expect(p.position.x).toBeLessThan(gate.min.x);
 const airborne={x:passage.x-2,y:passage.y+2,z:passage.z};world.moveAirborne(airborne,{x:8,y:0,z:0},.32,1.8);expect(airborne.x).toBeLessThan(gate.min.x);
 world.movingBoxes.length=0;for(let i=0;i<30;i++)p.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},Math.PI/2);expect(p.position.x).toBeGreaterThan(gate.max.x);
});
it('presentation releases its observer and shadows without touching a neighboring region',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),light=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(256,light),tree=CreateBox('tree-a',{},scene),barn=CreateBox('barn-a',{},scene),other=CreateBox('barn-b',{},scene),material=new PBRMaterial('Barn red weathered wood',scene);barn.material=material;
 const a=new RegionPresentation(scene,[tree,barn],shadows),b=new RegionPresentation(scene,[other],shadows);
 try{a.update(.3,{x:300,y:0,z:0});expect(tree.isVisible).toBe(false);expect(other.isVisible).toBe(true);expect(material.maxSimultaneousLights).toBe(4);a.dispose();a.dispose();expect(tree.isVisible).toBe(true);expect(shadows.getShadowMap()!.renderList).not.toContain(barn);expect(shadows.getShadowMap()!.renderList).toContain(other);scene.onAfterRenderObservable.notifyObservers(scene);expect(material.isFrozen).toBe(false);b.dispose();expect(scene.onAfterRenderObservable.hasObservers()).toBe(false);}finally{scene.dispose();engine.dispose();}
});
