import {CreateGround} from '@babylonjs/core/Meshes/Builders/groundBuilder';
import {CreateLines} from '@babylonjs/core/Meshes/Builders/linesBuilder';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import type {Scene} from '@babylonjs/core/scene';
import type {PlayerMotor} from '../player/PlayerMotor';
/** Depth cues below the islands and an explicit emergency tether back to stable ground. */
export class AbyssPresentation {
 private time=0;private previousReturns=0;private rescued=0;private falling=false;
 private readonly cloud:ShaderMaterial;private readonly tether;private readonly veil:HTMLDivElement|undefined;
 constructor(private readonly scene:Scene,private readonly player:PlayerMotor){
  this.cloud=new ShaderMaterial('deep-cloud-sea',scene,{vertexSource:'precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 worldViewProjection;varying vec2 vUV;void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.);}',fragmentSource:'precision highp float;varying vec2 vUV;uniform sampler2D sky;uniform float time;void main(){vec2 uv=vec2(fract(vUV.x*.8+time*.0008),.56+vUV.y*.32);vec3 c=texture2D(sky,uv).rgb;float edge=smoothstep(0.,.12,vUV.x)*smoothstep(0.,.12,1.-vUV.x)*smoothstep(0.,.12,vUV.y)*smoothstep(0.,.12,1.-vUV.y);gl_FragColor=vec4(mix(vec3(.13,.21,.40),c, .48),edge*.67);}'} ,{attributes:['position','uv'],uniforms:['worldViewProjection','time'],samplers:['sky'],needAlphaBlending:true});this.cloud.backFaceCulling=false;this.cloud.setTexture('sky',new Texture('/environment/cosmic-sky-v3.png',scene));
  for(const [y,size] of [[-44,360],[-72,600]]){const cloud=CreateGround('clouds-below-floating-islands',{width:size!,height:size!},scene);cloud.position.y=y!;cloud.material=this.cloud;cloud.isPickable=false;cloud.freezeWorldMatrix();}
  this.tether=CreateLines('emergency-recovery-cable',{points:[Vector3.Zero(),Vector3.Zero(),Vector3.Zero()],updatable:true},scene);this.tether.color=new Color3(.55,1,.68);this.tether.isPickable=false;this.tether.setEnabled(false);
  if(typeof document!=='undefined'){this.veil=document.createElement('div');this.veil.className='abyss-recovery';this.veil.hidden=true;document.body.append(this.veil);}
 }
 update(dt:number):void {
  this.time+=dt;this.cloud.setFloat('time',this.time);this.rescued=Math.max(0,this.rescued-dt);
  if(this.player.respawns!==this.previousReturns){this.rescued=this.player.respawns>this.previousReturns?1.2:0;this.previousReturns=this.player.respawns;}
  if(this.player.hp<=0){this.tether.setEnabled(false);if(this.veil)this.veil.hidden=true;return;}
  this.falling=this.player.position.y<-5&&!this.player.grounded;this.tether.setEnabled(this.falling);
  if(this.falling){const a=new Vector3(this.player.position.x,this.player.position.y+1.1,this.player.position.z),b=new Vector3(this.player.safe.x,this.player.safe.y+.2,this.player.safe.z),mid=Vector3.Lerp(a,b,.5);mid.y-=1.2;CreateLines('emergency-recovery-cable',{points:[a,mid,b],instance:this.tether},this.scene);}
  if(this.veil){this.veil.hidden=!this.falling&&this.rescued<=0;this.veil.style.setProperty('--abyss-opacity',String(this.falling?Math.min(.85,Math.max(.08,(-this.player.position.y-5)/26)):this.rescued*.2));this.veil.textContent=this.falling?'CABO DE EMERGÊNCIA ATIVADO':'DE VOLTA AO SOLO FIRME';}
 }
 dispose():void {this.tether.dispose();this.veil?.remove();this.cloud.dispose();}
}
