import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {followSun} from '../src/rendering/FollowingSun';
import {NearbyShadowCasters} from '../src/rendering/NearbyShadowCasters';
it('keeps the shadow focus inside the light projection across distant islands',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(0,2,0),scene),sun=new DirectionalLight('sun',new Vector3(-.6,-1,.4),scene),shadows=new ShadowGenerator(2048,sun);scene.activeCamera=camera;sun.shadowFrustumSize=92;sun.shadowMinZ=1;sun.shadowMaxZ=160;sun.autoCalcShadowZBounds=false;
 try{for(const focus of [new Vector3(0,0,0),new Vector3(431,19,280),new Vector3(720,31,320),new Vector3(610,25,520),new Vector3(2000,80,-1000)]){
  followSun(sun,focus,2048);scene.incrementRenderId();const projected=Vector3.TransformCoordinates(focus,shadows.getTransformMatrix());
  expect(Math.abs(projected.x)).toBeLessThan(.002);expect(Math.abs(projected.y)).toBeLessThan(.002);expect(projected.z).toBeGreaterThan(engine.isNDCHalfZRange?0:-1);expect(projected.z).toBeLessThan(1);
 }}finally{scene.dispose();engine.dispose();}
});
it('selects nearby casters by bounds, enforces the cap, respects visibility and releases only owned casters',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),sun=new DirectionalLight('sun',new Vector3(0,-1,0),scene),shadows=new ShadowGenerator(256,sun),meshes=Array.from({length:24},(_,i)=>{const m=CreateBox('highland-building-'+i,{size:2},scene);m.position.set(500+i,20,280);m.computeWorldMatrix(true);return m;}),other=CreateBox('other-region',{},scene);shadows.addShadowCaster(other,false);
 const selection=new NearbyShadowCasters(meshes,shadows,8);
 try{
  selection.update(1,{x:0,y:0,z:0});expect(selection.count).toBe(0);
  selection.update(1,{x:500,y:20,z:280});expect(selection.count).toBe(8);expect(shadows.getShadowMap()!.renderList).toContain(meshes[0]);
  meshes[0]!.isVisible=false;selection.update(1,{x:500,y:20,z:280});expect(selection.count).toBe(8);expect(shadows.getShadowMap()!.renderList).not.toContain(meshes[0]);
  selection.update(1,{x:0,y:0,z:0});expect(selection.count).toBe(0);expect(shadows.getShadowMap()!.renderList).toHaveLength(1);expect(shadows.getShadowMap()!.renderList![0]).toBe(other);
  selection.update(1,{x:500,y:20,z:280});selection.dispose();selection.dispose();expect(shadows.getShadowMap()!.renderList).toHaveLength(1);expect(shadows.getShadowMap()!.renderList![0]).toBe(other);
 }finally{scene.dispose();engine.dispose();}
});
