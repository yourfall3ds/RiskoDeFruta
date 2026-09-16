import {MaterialPluginBase} from '@babylonjs/core/Materials/materialPluginBase';
import {ShaderLanguage} from '@babylonjs/core/Materials/shaderLanguage';
import type {Material} from '@babylonjs/core/Materials/material';
import type {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type {UniformBuffer} from '@babylonjs/core/Materials/uniformBuffer';
import type {BaseTexture} from '@babylonjs/core/Materials/Textures/baseTexture';
import type {AbstractEngine} from '@babylonjs/core/Engines/abstractEngine';
import type {Nullable} from '@babylonjs/core/types';

/**
 * Mistura estocástica de amostras para chão (terra, pedra, trilha).
 *
 * O plugin troca a leitura de albedo/normal/ARM/AO do PBR do Babylon por uma mistura de três
 * amostras da MESMA textura, cada uma deslocada e girada por um valor determinístico derivado da
 * célula de uma grade triangular. O resultado quebra a repetição visível do tiling sem aumentar a
 * resolução da textura e sem tocar em malha, colisão ou UV: tudo acontece no fragment shader.
 *
 * Não é "mudança de cor": as três amostras vêm de regiões diferentes da textura, e a variação
 * macro (cor/umidade) é um segundo efeito, opcional e separado, por cima disso.
 *
 * Referências do algoritmo em docs/licenses/stochastic-ground.md.
 */

/** Ajustes do plugin. Todos os campos são uniformes simples; nada aqui aloca GPU. */
export interface StochasticGroundSettings {
 /** 0 desliga (amostragem original), 1 usa só a mistura estocástica. Valores intermediários fazem crossfade. */
 strength:number;
 /** Tamanho do retalho na MESMA unidade do UV da textura. ~1 = um retalho por repetição da textura. */
 patchScale:number;
 /** 0..1 — quanto cada retalho pode girar. A normal tangente é girada junto, então 1 é seguro. */
 rotation:number;
 /** Expoente do peso baricêntrico. Maior = retalho mais "chapado", menor = transição mais longa. */
 contrast:number;
 /** 0..1 — variação macro orgânica de cor/umidade por posição de mundo. 0 desliga só a macro. */
 macroStrength:number;
 /** Tamanho da variação macro em unidades de mundo (metros). */
 macroScale:number;
 /** Semente determinística. Mesma semente = mesmo chão em toda sessão e em todo cliente. */
 seed:number;
 /** 0..1 — quanto da variação macro também mexe na rugosidade (solo úmido fica menos áspero). */
 moisture:number;
}

export const DEFAULT_STOCHASTIC_GROUND_SETTINGS:Readonly<StochasticGroundSettings>={
 // patchScale fracionário de propósito: se o retalho casar com a repetição da textura, a grade
 // triangular volta a ser visível justamente onde ela deveria sumir.
 strength:1,patchScale:1.15,rotation:1,contrast:4,
 macroStrength:.5,macroScale:26,seed:17,moisture:.6,
};

const PLUGIN_NAME='StochasticGround';
/** Depois de bump/detail (100..110) e antes do fim; só reescreve leituras já existentes. */
const PLUGIN_PRIORITY:number=260;

type GlslDialect='glsl3';

/**
 * Anchors no shader PBR do Babylon 9.25. Se um deles sumir num upgrade, o teste avisa.
 *
 * Cada anchor engole o FIM DA EXPRESSÃO (`;`, `.rgb;`, `.xyz`) e a substituição devolve esse fim.
 * Isso não é estética — é obrigatório. O `MaterialPluginManager` acrescenta um `\n` ao final de
 * todo trecho injetado (`injectedCode += customCode + "\n"`), e a injeção do plugin roda como
 * `processCodeAfterIncludes`, ou seja ANTES do pré-processador. Se o anchor parasse no `)`, o `;`
 * da instrução cairia sozinho na linha seguinte — e o `ShaderCodeCursor` do Babylon **descarta uma
 * linha que é só `;`**. O resultado era `vec4 albedoTexture=sgSample(...)` sem terminador e
 * `FRAGMENT SHADER ERROR: albedoOpacityOut syntax error`. Ver o teste de pipeline real.
 */
const ANCHORS={
 albedo:'TEXRD\\(\\s*albedoSampler\\s*,\\s*vAlbedoUV\\s*\\+\\s*uvOffset\\s*\\)\\s*;',
 reflectivity:'TEXRD\\(\\s*reflectivitySampler\\s*,\\s*vReflectivityUV\\s*\\+\\s*uvOffset\\s*\\)\\s*;',
 ambient:'TEXRD\\(\\s*ambientSampler\\s*,\\s*vAmbientUV\\s*\\+\\s*uvOffset\\s*\\)\\s*\\.rgb\\s*;',
 bump:'TEXRD\\(\\s*bumpSampler\\s*,\\s*vBumpUV\\s*\\+\\s*uvOffset\\s*\\)\\s*\\.xyz',
 moisture:'float microSurface=reflectivityOut\\.microSurface;float roughness=reflectivityOut\\.roughness;',
} as const;

/**
 * Funções injetadas em CUSTOM_FRAGMENT_DEFINITIONS.
 *
 * Duas regras que o pré-processador do Babylon impõe a este bloco (ele roda DEPOIS da injeção):
 *
 * 1. O `ShaderCodeCursor` quebra cada linha nos `;`. Portanto **nada de `for(...;...;...)`** aqui:
 *    o cabeçalho do laço seria partido em três linhas e não compilaria. Tudo é código reto.
 * 2. Comentário só em linha própria começando com `//`, e sem `;` dentro.
 *
 * O GLSL é ES 3.00 (`texture`/`textureGrad`/`textureLod`), que é o que o plugin exige para manter
 * o mipmap correto atravessando a borda do retalho — por isso ele só liga em WebGL2/WebGPU.
 */
function stochasticGroundFunctions():string{
 return `
// ---- StochasticGround: mistura estocástica de amostras (ver docs/licenses/stochastic-ground.md)
// vStochasticGroundParams = (strength, patchScale, rotation, contrast)
// vStochasticGroundMacro  = (macroStrength, macroScale, seed, moisture)
vec2 sgHash2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}
float sgHash1(vec2 p){return fract(sin(dot(p,vec2(41.7,289.3)))*24634.6345);}
// Grade triangular: qualquer ponto cai dentro de um triângulo e recebe três pesos baricêntricos
// que somam 1. Isso garante transição contínua entre retalhos, sem costura.
void sgTriangleGrid(vec2 st,out vec3 w,out vec2 v1,out vec2 v2,out vec2 v3){
 st*=3.4641016151;
 vec2 skewed=vec2(st.x-0.5773502692*st.y,1.1547005384*st.y);
 vec2 base=floor(skewed);
 vec3 f=vec3(fract(skewed),0.0);f.z=1.0-f.x-f.y;
 float s=step(f.z,0.0),sg=2.0*s-1.0;
 w=vec3(-f.z*sg,s-f.y*sg,s-f.x*sg);
 v1=base+vec2(s,s);v2=base+vec2(s,1.0-s);v3=base+vec2(1.0-s,s);
}
vec2 sgVertexCenter(vec2 v){return vec2(v.x+0.5*v.y,0.8660254038*v.y)*0.2886751346;}
mat2 sgPatchRotation(vec2 v){
 float a=(sgHash1(v+vStochasticGroundMacro.z)-0.5)*6.2831853*vStochasticGroundParams.z;
 float c=cos(a),s=sin(a);return mat2(c,s,-s,c);
}
// Uma amostra: gira o UV em torno do centro do retalho, desloca por um offset determinístico e
// leva as derivadas junto para o mipmap continuar correto atravessando a borda do retalho.
vec4 sgPatch(sampler2D samp,vec2 uv,vec2 dx,vec2 dy,vec2 vert,out mat2 rot){
 mat2 r=sgPatchRotation(vert);rot=r;
 vec2 c=sgVertexCenter(vert)*vStochasticGroundParams.y;
 vec2 st=r*(uv-c)+c+sgHash2(vert+vStochasticGroundMacro.z);
 return textureGrad(samp,st,r*dx,r*dy);
}
vec3 sgBlendWeights(vec3 w){
 vec3 b=pow(max(w,vec3(0.0)),vec3(vStochasticGroundParams.w));
 return b/max(b.x+b.y+b.z,1e-5);
}
// Média ponderada devolve contraste menor que o original (as três amostras se cancelam). O termo
// 1/sqrt(dot(b,b)) devolve o desvio padrão perdido em volta da média da textura (último mip).
vec4 sgSample(sampler2D samp,vec2 uv,float vpAlpha){
 float strength=vStochasticGroundParams.x;
 if(strength<=0.0)return texture(samp,uv);
 vec2 dx=dFdx(uv),dy=dFdy(uv);
 vec3 w;vec2 v1,v2,v3;mat2 r1,r2,r3;
 sgTriangleGrid(uv/vStochasticGroundParams.y,w,v1,v2,v3);
 vec4 c1=sgPatch(samp,uv,dx,dy,v1,r1),c2=sgPatch(samp,uv,dx,dy,v2,r2),c3=sgPatch(samp,uv,dx,dy,v3,r3);
 vec3 b=sgBlendWeights(w);
 vec4 avg=b.x*c1+b.y*c2+b.z*c3;
 vec4 mean=textureLod(samp,uv,20.0);
 vec4 vp=mean+(avg-mean)*inversesqrt(max(dot(b,b),1e-4));
 vec4 mixed=vec4(vp.rgb,mix(avg.a,vp.a,vpAlpha));
 mixed=clamp(mixed,vec4(0.0),vec4(1.0));
 if(strength>=1.0)return mixed;
 return mix(texture(samp,uv),mixed,strength);
}
// Normal: girar o UV gira o gradiente do relevo, então o XY tangente precisa voltar pela mesma
// rotação (n.xy*r == transpose(r)*n.xy). Sem isso o relevo aponta para o lado errado por retalho.
vec4 sgSampleNormal(sampler2D samp,vec2 uv){
 float strength=vStochasticGroundParams.x;
 if(strength<=0.0)return texture(samp,uv);
 vec2 dx=dFdx(uv),dy=dFdy(uv);
 vec3 w;vec2 v1,v2,v3;mat2 r1,r2,r3;
 sgTriangleGrid(uv/vStochasticGroundParams.y,w,v1,v2,v3);
 vec4 c1=sgPatch(samp,uv,dx,dy,v1,r1),c2=sgPatch(samp,uv,dx,dy,v2,r2),c3=sgPatch(samp,uv,dx,dy,v3,r3);
 vec3 b=sgBlendWeights(w);
 vec2 xy=b.x*((c1.xy*2.0-1.0)*r1)+b.y*((c2.xy*2.0-1.0)*r2)+b.z*((c3.xy*2.0-1.0)*r3);
 xy*=inversesqrt(max(dot(b,b),1e-4));
 float len=length(xy);if(len>0.98)xy*=0.98/len;
 vec3 n=vec3(xy,sqrt(max(1.0-dot(xy,xy),1e-4)));
 vec4 blended=vec4(n*0.5+0.5,1.0);
 if(strength>=1.0)return blended;
 return mix(texture(samp,uv),blended,strength);
}
// Variação macro: duas oitavas de ruído de valor em escalas incomensuráveis, na posição de mundo.
// Não segue a grade dos retalhos nem o UV, então não desenha padrão hexagonal/triangular.
float sgValueNoise(vec2 p){
 vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
 float a=sgHash1(i),b=sgHash1(i+vec2(1.0,0.0)),c=sgHash1(i+vec2(0.0,1.0)),d=sgHash1(i+vec2(1.0,1.0));
 return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float sgMacroField(){
 vec2 p=vPositionW.xz/max(vStochasticGroundMacro.y,0.001)+vStochasticGroundMacro.z;
 return sgValueNoise(p)*0.65+sgValueNoise(p*2.37+11.3)*0.35;
}
vec3 sgMacroAlbedo(vec3 albedo){
 float amount=vStochasticGroundMacro.x;
 if(amount<=0.0)return albedo;
 float m=sgMacroField()*2.0-1.0;
 vec3 hue=mix(vec3(0.90,0.94,1.00),vec3(1.03,1.00,0.95),m*0.5+0.5);
 return albedo*(1.0+m*amount*0.20)*mix(vec3(1.0),hue,amount);
}
void sgMacroMoisture(inout float microSurface,inout float roughness){
 float amount=vStochasticGroundMacro.x*vStochasticGroundMacro.w;
 if(amount<=0.0)return;
 float m=sgMacroField()*2.0-1.0;
 roughness=clamp(roughness+m*amount*0.18,0.04,1.0);
 microSurface=clamp(microSurface-m*amount*0.18,0.0,1.0);
}
// ---- fim StochasticGround
`;
}

/**
 * Monta o mapa de injeções do fragment shader.
 *
 * Exportado puro para o teste conseguir conferir os anchors contra o shader real do Babylon sem
 * precisar de GPU nem de engine.
 */
export function buildStochasticGroundFragmentCode(dialect:GlslDialect='glsl3'):Record<string,string>{
 void dialect;
 return {
  CUSTOM_FRAGMENT_DEFINITIONS:stochasticGroundFunctions(),
  // Alfa entra na média simples (vpAlpha=0): realce de contraste em alpha quebraria alpha-test.
  [`!${ANCHORS.albedo}`]:'sgSample(albedoSampler,vAlbedoUV+uvOffset,0.0);',
  // ARM é dado linear (AO/rugosidade/metal): os quatro canais mantêm o contraste original.
  [`!${ANCHORS.reflectivity}`]:'sgSample(reflectivitySampler,vReflectivityUV+uvOffset,1.0);',
  [`!${ANCHORS.ambient}`]:'sgSample(ambientSampler,vAmbientUV+uvOffset,1.0).rgb;',
  // Só a normal tangente. OBJECTSPACE_NORMALMAP lê `TEXRD(bumpSampler,vBumpUV)` e fica de fora:
  // normal em espaço de objeto não tem tangente para girar junto com o retalho.
  [`!${ANCHORS.bump}`]:'sgSampleNormal(bumpSampler,vBumpUV+uvOffset).xyz',
  CUSTOM_FRAGMENT_UPDATE_ALBEDO:'surfaceAlbedo=sgMacroAlbedo(surfaceAlbedo);',
  [`!${ANCHORS.moisture}`]:'float microSurface=reflectivityOut.microSurface;float roughness=reflectivityOut.roughness;sgMacroMoisture(microSurface,roughness);',
 };
}

/** Os anchors usados, para o teste de regressão de upgrade do Babylon. */
export const STOCHASTIC_GROUND_ANCHORS:Readonly<Record<keyof typeof ANCHORS,string>>=ANCHORS;

/**
 * Só o caminho GLSL ES 3.00 (WebGL2) tem textureGrad/textureLod, que são o que mantém o mipmap
 * correto atravessando a borda do retalho. Em WebGL1 o material fica exatamente como estava.
 */
export function supportsStochasticGround(engine:AbstractEngine):boolean{
 const version=(engine as unknown as {webGLVersion?:number}).webGLVersion;
 return engine.isWebGPU===true||(typeof version==='number'&&version>=2);
}

function clamp01(value:number):number{return value<0?0:value>1?1:value;}

export class StochasticGroundPlugin extends MaterialPluginBase{
 static readonly Name=PLUGIN_NAME;
 private readonly _values:StochasticGroundSettings;
 private _dirty=true;
 constructor(material:Material,settings?:Partial<StochasticGroundSettings>){
  super(material,PLUGIN_NAME,PLUGIN_PRIORITY,undefined,true,true);
  this._values={...DEFAULT_STOCHASTIC_GROUND_SETTINGS,...settings};
  this._sanitize();
 }
 override getClassName():string{return 'StochasticGroundPlugin';}
 /** WGSL teria de reescrever os mesmos trechos em outra linguagem; ali o material fica intacto. */
 override isCompatible(shaderLanguage:ShaderLanguage):boolean{return shaderLanguage===ShaderLanguage.GLSL;}
 /** Cópia dos ajustes atuais. Para alterar use {@link update}. */
 get settings():Readonly<StochasticGroundSettings>{return {...this._values};}
 /** Atalho de A/B: `strength` 0 volta à amostragem original sem recompilar shader. */
 get isEnabled():boolean{return this._values.strength>0;}
 set isEnabled(value:boolean){this.update({strength:value?1:0});}
 /**
  * Atualiza uniformes. Se o material já foi congelado, descongela e congela de novo — senão o
  * Babylon pula o bind e o valor novo nunca chega à GPU.
  */
 update(settings:Partial<StochasticGroundSettings>):void{
  Object.assign(this._values,settings);
  this._sanitize();
  this._dirty=true;
  const material=this._material;
  if(material.isFrozen){material.unfreeze();material.markDirty();material.freeze();}
 }
 private _sanitize():void{
  const v=this._values;
  v.strength=clamp01(v.strength);v.rotation=clamp01(v.rotation);
  v.macroStrength=clamp01(v.macroStrength);v.moisture=clamp01(v.moisture);
  v.patchScale=Math.max(v.patchScale,1e-3);v.contrast=Math.max(v.contrast,1);
  v.macroScale=Math.max(v.macroScale,1e-3);
  if(!Number.isFinite(v.seed))v.seed=DEFAULT_STOCHASTIC_GROUND_SETTINGS.seed;
 }
 override getUniforms(shaderLanguage:ShaderLanguage=ShaderLanguage.GLSL):{
  ubo?:Array<{name:string;size?:number;type?:string;arraySize?:number}>;vertex?:string;fragment?:string;
 }{
  const ubo=[
   {name:'vStochasticGroundParams',size:4,type:'vec4'},
   {name:'vStochasticGroundMacro',size:4,type:'vec4'},
  ];
  if(shaderLanguage===ShaderLanguage.WGSL)return {ubo};
  // Engines sem uniform buffer (NullEngine, WebGL1) precisam da declaração solta.
  return {ubo,fragment:'uniform vec4 vStochasticGroundParams;\nuniform vec4 vStochasticGroundMacro;\n'};
 }
 override getCustomCode(shaderType:string,shaderLanguage:ShaderLanguage=ShaderLanguage.GLSL):Nullable<{[pointName:string]:string}>{
  if(shaderType!=='fragment'||shaderLanguage!==ShaderLanguage.GLSL)return null;
  return buildStochasticGroundFragmentCode();
 }
 override bindForSubMesh(uniformBuffer:UniformBuffer):void{
  const v=this._values;
  uniformBuffer.updateFloat4('vStochasticGroundParams',v.strength,v.patchScale,v.rotation,v.contrast);
  uniformBuffer.updateFloat4('vStochasticGroundMacro',v.macroStrength,v.macroScale,v.seed,v.moisture);
  this._dirty=false;
 }
 /** true enquanto um `update` ainda não chegou à GPU. Usado pelo teste e por diagnóstico. */
 get hasPendingUpload():boolean{return this._dirty;}
 override hasTexture(_texture:BaseTexture):boolean{return false;}
 /** O plugin não possui recurso de GPU próprio: nada a liberar além do que o material já libera. */
 override dispose(_forceDisposeTextures?:boolean):void{this._dirty=false;}
}

/** Campos de UV que precisam bater entre albedo/normal/ARM para as três amostras coincidirem. */
const UV_FIELDS=['uScale','vScale','uOffset','vOffset','wAng','coordinatesIndex'] as const;
type UvCarrier=Partial<Record<(typeof UV_FIELDS)[number],number>>;

/**
 * Lista os mapas cujo transform de UV difere do albedo.
 *
 * O deslocamento estocástico é calculado a partir do UV de cada sampler. Se albedo e normal têm
 * escalas diferentes, cada um cai num retalho diferente e o relevo descola da cor. O whitelist do
 * mundo deve usar materiais com o mesmo transform nos três mapas — esta função diz quando não é o caso.
 */
export function stochasticGroundUvMismatch(material:PBRMaterial):string[]{
 const reference=material.albedoTexture as UvCarrier|null;
 if(!reference)return [];
 const mismatched:string[]=[];
 const candidates:Array<[string,UvCarrier|null]>=[
  ['bumpTexture',material.bumpTexture as UvCarrier|null],
  ['metallicTexture',material.metallicTexture as UvCarrier|null],
  ['ambientTexture',material.ambientTexture as UvCarrier|null],
 ];
 for(const [name,texture] of candidates){
  if(!texture)continue;
  if(UV_FIELDS.some(field=>texture[field]!==reference[field]))mismatched.push(name);
 }
 return mismatched;
}

/** Devolve o plugin já instalado no material, ou null. */
export function getStochasticGround(material:Material):StochasticGroundPlugin|null{
 const plugin=material.pluginManager?.getPlugin(PLUGIN_NAME);
 return plugin instanceof StochasticGroundPlugin?plugin:null;
}

/**
 * Instala (ou reconfigura) o plugin num material de chão.
 *
 * Devolve null — deixando o material exatamente como estava — quando a engine não é WebGL2/WebGPU
 * ou quando o material usa WGSL. Chame ANTES de `material.freeze()`.
 */
export function attachStochasticGround(material:PBRMaterial,settings?:Partial<StochasticGroundSettings>):StochasticGroundPlugin|null{
 const existing=getStochasticGround(material);
 if(existing){if(settings)existing.update(settings);return existing;}
 if(material.shaderLanguage!==ShaderLanguage.GLSL)return null;
 const scene=material.getScene();
 if(!scene||!supportsStochasticGround(scene.getEngine()))return null;
 const wasFrozen=material.isFrozen;
 if(wasFrozen)material.unfreeze();
 const plugin=new StochasticGroundPlugin(material,settings);
 if(wasFrozen){material.markDirty();material.freeze();}
 return plugin;
}

/**
 * Instala em todos os materiais PBR da cena cujo nome está no whitelist.
 *
 * O whitelist é a garantia pedida pelo mundo: parede, porta e construção não entram, então o UV
 * delas continua intocado. Devolve os materiais efetivamente afetados.
 */
export function attachStochasticGroundByName(
 materials:Iterable<Material|null|undefined>,
 whitelist:Iterable<string>,
 settings?:Partial<StochasticGroundSettings>,
):StochasticGroundPlugin[]{
 const wanted=new Set(whitelist);
 const attached:StochasticGroundPlugin[]=[];
 for(const material of materials){
  if(!material||!wanted.has(material.name))continue;
  const pbr=material as PBRMaterial;
  if(typeof pbr.albedoTexture==='undefined')continue;
  const plugin=attachStochasticGround(pbr,settings);
  if(plugin)attached.push(plugin);
 }
 return attached;
}
