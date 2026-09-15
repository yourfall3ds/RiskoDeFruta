import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Skeleton} from '@babylonjs/core/Bones/skeleton';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {configureSkinning} from '../src/animation/SkinningPolicy';
it.each([true,false])('uses a texture palette only on supported hardware: %s',supported=>{
 const engine=new NullEngine();engine.getCaps().textureFloat=supported;engine.getCaps().maxVertexTextureImageUnits=supported?16:0;
 const scene=new Scene(engine),skeleton=new Skeleton('rig','rig',scene),body=CreateBox('body',{},scene),hat=CreateBox('hat',{},scene);body.skeleton=skeleton;
 try{configureSkinning([body,hat]);expect(body.computeBonesUsingShaders).toBe(supported);expect(skeleton.isUsingTextureForMatrices).toBe(supported);configureSkinning([body,hat],'cpu');expect(body.computeBonesUsingShaders).toBe(false);expect(skeleton.isUsingTextureForMatrices).toBe(false);configureSkinning([body,hat]);expect(body.computeBonesUsingShaders).toBe(supported);expect(hat.skeleton).toBeNull();}finally{scene.dispose();engine.dispose();}
});
