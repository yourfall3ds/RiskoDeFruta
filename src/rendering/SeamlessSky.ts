import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

const skyMaterials=new WeakMap<Scene,ShaderMaterial>();
export function reviewSkyBlend(scene:Scene,enabled:boolean):void{skyMaterials.get(scene)?.setFloat('seamBlend',enabled?1:0);}

/** Estado do céu pedido pelo clima. Todos os campos são contínuos: 0 = céu original intacto. */
export interface SkyWeather {
  /** Cor para a qual o panorama é puxado (nuvem, tempestade, noite). */
  tint:Color3;
  /** 0..1 — quanto da cor de cobertura entra. */
  coverage:number;
  /** 0..1 — escurecimento noturno, preservando o recorte das ilhas contra o céu. */
  night:number;
}

/**
 * Aplica o clima ao céu REAL.
 *
 * O domo é um `ShaderMaterial` próprio e não recebe `scene.clearColor`: sem estes uniformes, chover
 * ou anoitecer deixava o panorama azul fixo por trás da chuva. A textura original nunca é alterada —
 * a cobertura e a noite são feitas na amostragem.
 */
export function applySkyWeather(scene:Scene,weather:SkyWeather):void {
  const material=skyMaterials.get(scene);
  if(!material)return;
  material.setColor3('skyTint',weather.tint);
  material.setFloat('skyCoverage',Math.max(0,Math.min(1,weather.coverage)));
  material.setFloat('skyNight',Math.max(0,Math.min(1,weather.night)));
}

/** Periodic edge blending on the sphere; the original panorama stays untouched. */
export function createSeamlessSky(scene:Scene):Mesh {
  const sky=CreateSphere('continuous-cosmic-sky',{diameter:900,segments:64},scene);
  sky.isPickable=false;sky.applyFog=false;sky.infiniteDistance=true;
  sky.rotation.y=Math.PI*.90;sky.rotation.x=.14;
  const material=new ShaderMaterial('periodic-panorama',scene,{
    vertexSource:'precision highp float; attribute vec3 position; attribute vec2 uv; uniform mat4 worldViewProjection; varying vec2 vUV; void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.);}',
    fragmentSource:`precision highp float;varying vec2 vUV;uniform sampler2D panorama;uniform float seamBlend;
      uniform vec3 skyTint;uniform float skyCoverage;uniform float skyNight;
      void main(){vec2 uv=vec2(clamp(vUV.x,0.,1.),clamp(vUV.y,.002,.998));
        vec3 a=pow(texture2D(panorama,uv).rgb,vec3(2.2));
        vec3 b=pow(texture2D(panorama,vec2(1.-uv.x,uv.y)).rgb,vec3(2.2));
        float edge=smoothstep(0.,.085,min(uv.x,1.-uv.x));
        vec3 color=mix(a,mix((a+b)*.5,a,edge),seamBlend);
        // Cobertura: o panorama é puxado para a cor do tempo, mais forte perto do zênite.
        float height=smoothstep(.15,.85,1.-uv.y);
        color=mix(color,skyTint,skyCoverage*(.45+.55*height));
        // Noite: escurece preservando contraste, com leve deslocamento para o azul.
        float luminance=dot(color,vec3(.299,.587,.114));
        vec3 dark=mix(vec3(luminance)*vec3(.55,.68,1.),color,.35)*.28;
        color=mix(color,dark,skyNight);
        gl_FragColor=vec4(color,1.);
      }`,
  },{attributes:['position','uv'],uniforms:['worldViewProjection','seamBlend','skyTint','skyCoverage','skyNight'],samplers:['panorama']});
  skyMaterials.set(scene,material);material.setFloat('seamBlend',1);
  material.setColor3('skyTint',new Color3(.5,.53,.58));material.setFloat('skyCoverage',0);material.setFloat('skyNight',0);
  material.backFaceCulling=false;material.disableDepthWrite=true;
  const texture=new Texture('/environment/cosmic-sky-v3.png',scene,false,false);
  texture.wrapU=Texture.WRAP_ADDRESSMODE;texture.wrapV=Texture.CLAMP_ADDRESSMODE;
  material.setTexture('panorama',texture);sky.material=material;
  // Infinite-distance translation is recomputed from the active camera each frame.
  // Freezing here pins the dome to spawn and eventually puts the player outside it.
  return sky;
}
