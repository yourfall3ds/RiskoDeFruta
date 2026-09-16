import {MaterialPluginBase} from '@babylonjs/core/Materials/materialPluginBase';
import {ShaderLanguage} from '@babylonjs/core/Materials/shaderLanguage';
import type {Material} from '@babylonjs/core/Materials/material';
import type {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type {UniformBuffer} from '@babylonjs/core/Materials/uniformBuffer';
import type {BaseTexture} from '@babylonjs/core/Materials/Textures/baseTexture';
import type {Nullable} from '@babylonjs/core/types';

/**
 * Vento de vegetação, no vértice.
 *
 * Três propriedades que o pedido exige e que definem a implementação:
 *
 * 1. **Raiz fixa.** O deslocamento é proporcional a `pow(altura acima da raiz / referência, rigidez)`.
 *    Na base da planta o expoente zera o termo — o tronco não escorrega no chão. Como a "altura acima
 *    da raiz" é medida contra a TRANSLAÇÃO da matriz de mundo (`finalWorld[3]`), e não contra o Y
 *    absoluto, uma árvore no alto de um terraço se comporta igual a uma no vale.
 * 2. **Fase e intensidade variadas por planta.** A fase sai da posição de mundo da própria instância,
 *    então cada `InstancedMesh`/thin instance de um mesmo lote balança diferente sem uniforme extra —
 *    é o que mantém a compatibilidade com instanciação.
 * 3. **Amplitude baixa, e nada de tronco de borracha.** O termo é uma soma de duas senoides em
 *    frequências incomensuráveis, limitada por `amplitude` em metros; o expoente de rigidez concentra
 *    o movimento na ponta. Uma árvore grande usa `heightReference` grande e rigidez alta: a copa
 *    respira, o tronco não.
 *
 * O deslocamento acontece em `CUSTOM_VERTEX_UPDATE_WORLDPOS`, depois de `worldPos`/`vPositionW`, e
 * reescreve os dois. Não toca em `normalUpdated`: girar a normal de uma folha alpha-test por um
 * deslocamento de centímetros não muda a imagem e custaria uma matriz por vértice.
 *
 * **Material congelado não recebe uniforme novo** — o Babylon pula o bind. Por isso quem instala
 * este plugin precisa manter o material fora do `freeze()`; veja {@link hasFoliageWind}.
 */

export interface FoliageWindSettings {
 /** Amplitude máxima do deslocamento na ponta, em metros. */
 amplitude:number;
 /** Ciclos por segundo da senoide principal. */
 frequency:number;
 /** Altura, em metros, em que o balanço chega ao máximo. */
 heightReference:number;
 /** Expoente do perfil de altura. Maior = base mais firme e movimento mais concentrado na ponta. */
 stiffness:number;
 /** Direção horizontal do vento (normalizada na instalação). */
 directionX:number;directionZ:number;
 /** Semente determinística da variação de fase/intensidade por planta. */
 seed:number;
}

export const DEFAULT_FOLIAGE_WIND:Readonly<FoliageWindSettings>={
 amplitude:.08,frequency:1.25,heightReference:1.6,stiffness:1.6,
 directionX:.82,directionZ:.57,seed:23,
};

/** Ajuste por família de material: capa baixa balança rápido e curto; copa alta, devagar e longe. */
export const FOLIAGE_WIND_PROFILES:readonly{match:RegExp;settings:Partial<FoliageWindSettings>}[]=[
 {match:/grass/i,settings:{amplitude:.055,frequency:1.55,heightReference:.9,stiffness:1.3}},
 {match:/fern/i,settings:{amplitude:.085,frequency:1.3,heightReference:1.5,stiffness:1.5}},
 // Copa grande: referência de altura alta e rigidez alta mantêm o tronco parado.
 {match:/tree|leaves|branches|orchard/i,settings:{amplitude:.17,frequency:.78,heightReference:9,stiffness:2.6}},
];

const PLUGIN_NAME='FoliageWind';
/** Depois de instâncias/ossos, antes da projeção: só reescreve `worldPos`. */
const PLUGIN_PRIORITY:number=280;

/**
 * Funções injetadas em CUSTOM_VERTEX_DEFINITIONS.
 *
 * As mesmas duas regras do pré-processador do Babylon valem aqui: o cursor de shader quebra cada
 * linha nos `;`, então nada de `for(...;...;...)`, e comentário só em linha própria, sem `;`.
 *
 * vFoliageWindPhase = (tempo, amplitude, frequência, alturaReferência)
 * vFoliageWindDir   = (dirX, dirZ, rigidez, semente)
 */
function foliageWindFunctions():string{
 return `
// ---- FoliageWind: balanço de vegetação com raiz fixa
float fwHash(vec2 p){return fract(sin(dot(p,vec2(41.7,289.3)))*24634.6345);}
// Duas senoides em frequências incomensuráveis: o ciclo não fecha, então não aparece pulso regular.
float fwGust(float t,float phase){
 return sin(t+phase)*0.72+sin(t*1.71+phase*1.93)*0.28;
}
vec3 fwDisplacement(vec3 world,vec3 root){
 float reference=max(vFoliageWindPhase.w,0.001);
 float up=clamp((world.y-root.y)/reference,0.0,1.0);
 float sway=pow(up,max(vFoliageWindDir.z,0.001));
 if(sway<=0.0)return vec3(0.0);
 float phase=dot(root.xz,vec2(0.37,0.29))+vFoliageWindDir.w;
 float strength=0.62+0.38*fwHash(root.xz+vFoliageWindDir.w);
 float gust=fwGust(vFoliageWindPhase.x*vFoliageWindPhase.z*6.2831853,phase);
 float reach=gust*sway*vFoliageWindPhase.y*strength;
 // A ponta ENCURTA ao curvar, em vez de esticar: é o que separa flexão de tronco de borracha.
 float drop=abs(reach)*0.22;
 return vec3(vFoliageWindDir.x*reach,-drop,vFoliageWindDir.y*reach);
}
// ---- fim FoliageWind
`;
}

/** Trecho de deslocamento, exportado puro para o teste conferir sem GPU. */
export function buildFoliageWindVertexCode():Record<string,string>{
 return{
  CUSTOM_VERTEX_DEFINITIONS:foliageWindFunctions(),
  // `finalWorld[3].xyz` é a raiz da instância: funciona igual em malha única, InstancedMesh e thin instance.
  CUSTOM_VERTEX_UPDATE_WORLDPOS:'worldPos.xyz+=fwDisplacement(worldPos.xyz,finalWorld[3].xyz);vPositionW=vec3(worldPos);',
 };
}

function clampPositive(value:number,fallback:number):number{return Number.isFinite(value)&&value>0?value:fallback;}

export class FoliageWindPlugin extends MaterialPluginBase{
 static readonly Name=PLUGIN_NAME;
 private readonly _values:FoliageWindSettings;
 /** Relógio próprio em segundos. Avança por `advance`, nunca por `Date.now`. */
 time=0;
 constructor(material:Material,settings?:Partial<FoliageWindSettings>){
  super(material,PLUGIN_NAME,PLUGIN_PRIORITY,undefined,true,true);
  this._values={...DEFAULT_FOLIAGE_WIND,...settings};
  this._sanitize();
 }
 override getClassName():string{return 'FoliageWindPlugin';}
 /** WGSL exigiria reescrever o trecho noutra linguagem; ali o material fica intacto. */
 override isCompatible(shaderLanguage:ShaderLanguage):boolean{return shaderLanguage===ShaderLanguage.GLSL;}
 get settings():Readonly<FoliageWindSettings>{return {...this._values};}
 /** Avança o relógio do vento. O valor é mantido pequeno para não perder precisão em float32. */
 advance(dt:number):void{if(Number.isFinite(dt)&&dt>0)this.time=(this.time+dt)%3600;}
 update(settings:Partial<FoliageWindSettings>):void{
  Object.assign(this._values,settings);this._sanitize();
  const material=this._material;
  if(material.isFrozen){material.unfreeze();material.markDirty();material.freeze();}
 }
 private _sanitize():void{
  const v=this._values;
  v.amplitude=Math.max(0,Math.min(1.5,v.amplitude));
  v.frequency=clampPositive(v.frequency,DEFAULT_FOLIAGE_WIND.frequency);
  v.heightReference=clampPositive(v.heightReference,DEFAULT_FOLIAGE_WIND.heightReference);
  v.stiffness=Math.max(.2,Math.min(8,v.stiffness));
  const length=Math.hypot(v.directionX,v.directionZ)||1;
  v.directionX/=length;v.directionZ/=length;
  if(!Number.isFinite(v.seed))v.seed=DEFAULT_FOLIAGE_WIND.seed;
 }
 override getUniforms(shaderLanguage:ShaderLanguage=ShaderLanguage.GLSL):{
  ubo?:Array<{name:string;size?:number;type?:string;arraySize?:number}>;vertex?:string;fragment?:string;
 }{
  const ubo=[{name:'vFoliageWindPhase',size:4,type:'vec4'},{name:'vFoliageWindDir',size:4,type:'vec4'}];
  if(shaderLanguage===ShaderLanguage.WGSL)return{ubo};
  return{ubo,vertex:'uniform vec4 vFoliageWindPhase;\nuniform vec4 vFoliageWindDir;\n'};
 }
 override getCustomCode(shaderType:string,shaderLanguage:ShaderLanguage=ShaderLanguage.GLSL):Nullable<{[pointName:string]:string}>{
  if(shaderType!=='vertex'||shaderLanguage!==ShaderLanguage.GLSL)return null;
  return buildFoliageWindVertexCode();
 }
 override bindForSubMesh(uniformBuffer:UniformBuffer):void{
  const v=this._values;
  uniformBuffer.updateFloat4('vFoliageWindPhase',this.time,v.amplitude,v.frequency,v.heightReference);
  uniformBuffer.updateFloat4('vFoliageWindDir',v.directionX,v.directionZ,v.stiffness,v.seed);
 }
 override hasTexture(_texture:BaseTexture):boolean{return false;}
 override dispose(_forceDisposeTextures?:boolean):void{this.time=0;}
}

/** Devolve o plugin já instalado no material, ou null. */
export function getFoliageWind(material:Material):FoliageWindPlugin|null{
 const plugin=material.pluginManager?.getPlugin(PLUGIN_NAME);
 return plugin instanceof FoliageWindPlugin?plugin:null;
}

/**
 * `true` quando o material carrega vento.
 *
 * Quem congela materiais PRECISA consultar isto: um material congelado não refaz o bind, e o tempo
 * do vento nunca chegaria à GPU — a vegetação ficaria imóvel numa pose torta.
 */
export function hasFoliageWind(material:Material|null|undefined):boolean{return !!material&&!!getFoliageWind(material);}

/** Instala (ou reconfigura) o vento num material de vegetação. Chame ANTES de qualquer `freeze()`. */
export function attachFoliageWind(material:PBRMaterial,settings?:Partial<FoliageWindSettings>):FoliageWindPlugin|null{
 const existing=getFoliageWind(material);
 if(existing){if(settings)existing.update(settings);return existing;}
 if(material.shaderLanguage!==ShaderLanguage.GLSL)return null;
 const wasFrozen=material.isFrozen;
 if(wasFrozen)material.unfreeze();
 const plugin=new FoliageWindPlugin(material,settings);
 if(wasFrozen){material.markDirty();material.freeze();}
 return plugin;
}

/** Ajuste correspondente ao nome do material, ou null se ele não é vegetação. */
export function foliageWindProfile(name:string):Partial<FoliageWindSettings>|null{
 for(const profile of FOLIAGE_WIND_PROFILES)if(profile.match.test(name))return profile.settings;
 return null;
}
