import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/** Flowing photographic curtains; alpha silhouette stays fixed while the water moves. */
export class Waterfalls {
  private time=0;
  private readonly material:ShaderMaterial;
  constructor(scene:Scene){
    this.material=new ShaderMaterial('waterfall-flow',scene,{
      vertexSource:`precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 worldViewProjection;varying vec2 vUV;void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}`,
      fragmentSource:`precision highp float;varying vec2 vUV;uniform sampler2D waterfall;uniform float time;void main(){vec4 mask=texture2D(waterfall,vUV);float phase=fract(time*.38);vec2 offset=vec2(.008*sin(vUV.y*24.+time*3.),phase);vec3 flowA=texture2D(waterfall,vec2(vUV.x+offset.x,fract(vUV.y+offset.y))).rgb,flowB=texture2D(waterfall,vec2(vUV.x-offset.x,fract(vUV.y+offset.y+.5))).rgb;vec3 flow=mix(flowA,flowB,abs(phase*2.-1.));float streak=sin(vUV.y*92.+time*29.+sin(vUV.x*37.)*2.);flow*=.84+.16*streak;flow+=pow(max(0.,streak),10.)*.16;float fade=smoothstep(0.,.14,vUV.y)*smoothstep(0.,.025,1.-vUV.y);gl_FragColor=vec4(mix(mask.rgb,flow,.84)*vec3(.83,.93,1.07),mask.a*fade*.82);}`
    },{attributes:['position','uv'],uniforms:['worldViewProjection','time'],samplers:['waterfall'],needAlphaBlending:true});
    this.material.backFaceCulling=false;this.material.setTexture('waterfall',new Texture('/environment/waterfall.png',scene));
    for(const [x,top,z,width,height,yaw] of [[-10,5,22,3.6,24,-.15],[10,5,22,2.5,22,.2],[-21,0,-4,2.4,21,-1.25],[22,0,4,3,23,1.2],[-47,0,-11,2.2,24,0],[44,2,-2,2.4,24,0],[-58,5,14,3.5,30,0],[51,11,38,3.5,33,0],[-37,18,74,3,34,0],[27,24,94,4,37,0],[94,2,-17,5,30,0],[111,12,50,4,33,0],[155,7,23,4.5,31,0]] as const){
      const plane=CreatePlane('falling-water',{width,height,sideOrientation:Mesh.DOUBLESIDE},scene);plane.position.set(x,top-height/2+.03,z);plane.rotation.y=yaw;plane.material=this.material;plane.isPickable=false;plane.freezeWorldMatrix();
    }
  }
  update(dt:number):void {this.time+=dt;this.material.setFloat('time',this.time);}
}
