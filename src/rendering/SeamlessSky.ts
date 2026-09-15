import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

const skyMaterials=new WeakMap<Scene,ShaderMaterial>();
export function reviewSkyBlend(scene:Scene,enabled:boolean):void{skyMaterials.get(scene)?.setFloat('seamBlend',enabled?1:0);}
/** Periodic edge blending on the sphere; the original panorama stays untouched. */
export function createSeamlessSky(scene:Scene):Mesh {
  const sky=CreateSphere('continuous-cosmic-sky',{diameter:900,segments:64},scene);
  sky.isPickable=false;sky.applyFog=false;sky.infiniteDistance=true;
  sky.rotation.y=Math.PI*.90;sky.rotation.x=.14;
  const material=new ShaderMaterial('periodic-panorama',scene,{
    vertexSource:'precision highp float; attribute vec3 position; attribute vec2 uv; uniform mat4 worldViewProjection; varying vec2 vUV; void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.);}',
    fragmentSource:`precision highp float;varying vec2 vUV;uniform sampler2D panorama;uniform float seamBlend;
      void main(){vec2 uv=vec2(clamp(vUV.x,0.,1.),clamp(vUV.y,.002,.998));
        vec3 a=pow(texture2D(panorama,uv).rgb,vec3(2.2));
        vec3 b=pow(texture2D(panorama,vec2(1.-uv.x,uv.y)).rgb,vec3(2.2));
        float edge=smoothstep(0.,.085,min(uv.x,1.-uv.x));
        vec3 color=mix(a,mix((a+b)*.5,a,edge),seamBlend);
        gl_FragColor=vec4(color,1.);
      }`,
  },{attributes:['position','uv'],uniforms:['worldViewProjection','seamBlend'],samplers:['panorama']});
  skyMaterials.set(scene,material);material.setFloat('seamBlend',1);
  material.backFaceCulling=false;material.disableDepthWrite=true;
  const texture=new Texture('/environment/cosmic-sky-v3.png',scene,false,false);
  texture.wrapU=Texture.WRAP_ADDRESSMODE;texture.wrapV=Texture.CLAMP_ADDRESSMODE;
  material.setTexture('panorama',texture);sky.material=material;
  // Infinite-distance translation is recomputed from the active camera each frame.
  // Freezing here pins the dome to spawn and eventually puts the player outside it.
  return sky;
}
