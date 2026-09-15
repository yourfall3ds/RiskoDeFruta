import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {RegionPresentation} from '../src/world/streaming/RegionPresentation';
it('restores plants, near tree crown and shadows as the arrival camera descends while world time is frozen',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),sun=new DirectionalLight('sun',new Vector3(-.6,-1,.4),scene),shadows=new ShadowGenerator(256,sun);
 const fern=CreateBox('fern-arrival',{},scene),near=CreateBox('OrchardLOD_01_near_crown',{},scene),medium=CreateBox('OrchardLOD_01_medium_crown',{},scene),barn=CreateBox('barn-arrival',{},scene);
 const presentation=new RegionPresentation(scene,[fern,near,medium,barn],shadows);
 try{
  presentation.update(0,{x:0,y:900,z:0});expect(fern.isVisible).toBe(false);expect(near.isVisible).toBe(false);expect(medium.isVisible).toBe(false);
  presentation.update(0,{x:0,y:100,z:0});expect(medium.isVisible).toBe(true);expect(near.isVisible).toBe(false);
  presentation.update(0,{x:0,y:10,z:0});expect(fern.isVisible).toBe(true);expect(near.isVisible).toBe(true);expect(medium.isVisible).toBe(false);expect(shadows.getShadowMap()!.renderList).toContain(barn);
  presentation.update(0,{x:0,y:900,z:0});expect(near.isVisible).toBe(false);expect(fern.isVisible).toBe(false);expect(shadows.getShadowMap()!.renderList).not.toContain(barn);
 }finally{presentation.dispose();scene.dispose();engine.dispose();}
});
