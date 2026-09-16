import {describe,it,expect,beforeAll} from 'vitest';
import '@babylonjs/core/Shaders/pbr.fragment';
import '@babylonjs/core/Shaders/ShadersInclude/bumpFragment';
import '@babylonjs/core/Shaders/ShadersInclude/pbrBlockAlbedoOpacity';
import {ShaderStore} from '@babylonjs/core/Engines/shaderStore';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {WebGL2ShaderProcessor} from '@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors';
import {Scene} from '@babylonjs/core/scene';
import {CreateGround} from '@babylonjs/core/Meshes/Builders/groundBuilder';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {
 DEFAULT_STOCHASTIC_GROUND_SETTINGS,STOCHASTIC_GROUND_ANCHORS,StochasticGroundPlugin,
 attachStochasticGround,attachStochasticGroundByName,buildStochasticGroundFragmentCode,
 getStochasticGround,stochasticGroundUvMismatch,supportsStochasticGround,
} from '../src/world/materials/StochasticGroundPlugin';

/**
 * Pipeline real de shader, sem GPU.
 *
 * O NullEngine sozinho não processa shader nenhum. Ligando nele a versão WebGL2 e o
 * `WebGL2ShaderProcessor` de verdade, o Babylon roda o caminho completo: resolve os `#include`,
 * chama a injeção do plugin (que entra como `processCodeAfterIncludes`, ANTES do pré-processador),
 * avalia `#ifdef`, quebra as linhas nos `;` e converte para GLSL ES 3.00. O que sai daqui é
 * exatamente o texto que o navegador manda para o driver — só a compilação na GPU fica de fora.
 *
 * Foi aqui que a falha de QA aparece sem navegador: testar só os regex contra o shader-fonte
 * passava, e mesmo assim o shader emitido vinha sem o `;` de `vec4 albedoTexture=...`.
 */
interface GroundOptions {plugin:boolean;bump?:boolean;arm?:boolean;ambient?:boolean;strength?:number}

async function compileGroundFragment(options:GroundOptions):Promise<string>{
 const engine=new NullEngine();
 const internals=engine as unknown as Record<string,unknown>;
 internals['_webGLVersion']=2;
 internals['_shaderProcessor']=new WebGL2ShaderProcessor();
 Object.defineProperty(engine,'shaderPlatformName',{get:()=>'WEBGL2',configurable:true});
 engine.getCaps().standardDerivatives=true;engine.getCaps().textureLOD=true;
 let captured='';
 const create=engine.createShaderProgram.bind(engine);
 engine.createShaderProgram=((context:never,vertex:string,fragment:string,defines:string,gl:never)=>{
  captured=fragment;return create(context,vertex,fragment,defines,gl);
 }) as typeof engine.createShaderProgram;
 const scene=new Scene(engine);
 try{
  new HemisphericLight('sky',Vector3.Up(),scene);
  const mesh=CreateGround('chao',{width:10,height:10},scene);
  const material=new PBRMaterial('Leaf litter soil',scene);
  const map=(file:string,gamma:boolean)=>{
   const texture=new Texture(`/textures/brown_mud_02/${file}.jpg`,scene,undefined,undefined,undefined,undefined,()=>{});
   texture.uScale=12;texture.vScale=12;texture.gammaSpace=gamma;return texture;
  };
  material.albedoTexture=map('Diffuse',true);
  if(options.bump!==false)material.bumpTexture=map('nor_gl',false);
  if(options.arm!==false){material.metallicTexture=map('arm',false);material.metallic=1;material.useRoughnessFromMetallicTextureGreen=true;}
  if(options.ambient)material.ambientTexture=map('arm',false);
  mesh.material=material;
  if(options.plugin)expect(attachStochasticGround(material,{strength:options.strength??1})).not.toBeNull();
  // NullEngine não decodifica imagem: as texturas precisam se declarar prontas na mão.
  for(const texture of [material.albedoTexture,material.bumpTexture,material.metallicTexture,material.ambientTexture]){
   const internal=(texture as Texture|null)?.getInternalTexture();
   if(internal)internal.isReady=true;
  }
  for(let attempt=0;attempt<120&&!captured;attempt++){
   if(material.isReadyForSubMesh(mesh,mesh.subMeshes[0]!))break;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 }finally{scene.dispose();engine.dispose();}
 if(!captured)throw new Error('o pipeline não chegou a emitir fragment shader');
 return captured;
}

/** Bloco de funções que o plugin injeta, já dentro do shader final. */
function stochasticBlock(fragment:string):string{
 const start=fragment.indexOf('// ---- StochasticGround');
 const end=fragment.indexOf('// ---- fim StochasticGround');
 return start<0||end<0?'':fragment.slice(start,end);
}

function balance(source:string,open:string,close:string):number{
 let depth=0;
 for(const character of source){if(character===open)depth++;else if(character===close)depth--;}
 return depth;
}

function pbrFragmentSource():string{
 return [
  ShaderStore.ShadersStore['pbrPixelShader'],
  ShaderStore.IncludesShadersStore['bumpFragment'],
  ShaderStore.IncludesShadersStore['pbrBlockAlbedoOpacity'],
 ].join('\n');
}

describe('chão estocástico — pipeline real de shader (sem GPU)',()=>{
 let withPlugin='';
 let without='';
 beforeAll(async()=>{
  [withPlugin,without]=await Promise.all([
   compileGroundFragment({plugin:true,ambient:true}),
   compileGroundFragment({plugin:false,ambient:true}),
  ]);
 },60000);

 it('emite a leitura de albedo como instrução COMPLETA, com o ponto e vírgula',()=>{
  // Regressão direta da falha de QA em GPU: "FRAGMENT SHADER ERROR albedoOpacityOut syntax error".
  // O MaterialPluginManager acrescenta "\n" a todo trecho injetado; como a injeção roda antes do
  // pré-processador, o `;` órfão caía sozinho numa linha — e o ShaderCodeCursor do Babylon
  // DESCARTA linha que é só ";". O anchor precisa engolir o terminador e devolvê-lo.
  expect(withPlugin).toContain('vec4 albedoTexture=sgSample(albedoSampler,vAlbedoUV+uvOffset,0.0);');
  expect(withPlugin).toContain('vec4 surfaceMetallicOrReflectivityColorMap=sgSample(reflectivitySampler,vReflectivityUV+uvOffset,1.0);');
  expect(withPlugin).toContain('vec3 ambientOcclusionColorMap=sgSample(ambientSampler,vAmbientUV+uvOffset,1.0).rgb;');
  expect(withPlugin).toContain('sgSampleNormal(bumpSampler,vBumpUV+uvOffset).xyz');
 });

 it('não deixa nenhuma linha que seja só ";" — é a que o Babylon apaga',()=>{
  // ShaderCodeCursor.lines: "If trimmedLine == ';', we must not push, to be backward compatible".
  // Linha `);` ou `,vBumpInfos.y);` sobrevive e o GLSL ignora a quebra; só o `;` sozinho some.
  expect(withPlugin.split('\n').filter(line=>line.trim()===';')).toEqual([]);
  expect(without.split('\n').filter(line=>line.trim()===';')).toEqual([]);
 });

 it('toda função sg* chamada está definida antes do uso',()=>{
  const defined=new Map<string,number>();
  for(const match of withPlugin.matchAll(/^(?:vec[234]|float|void|mat2) (sg[A-Za-z0-9]+)\(/gm)){
   if(!defined.has(match[1]!))defined.set(match[1]!,match.index!);
  }
  expect(defined.size).toBe(13);
  const called=new Set<string>();
  for(const match of withPlugin.matchAll(/\b(sg[A-Za-z0-9]+)\(/g)){
   const name=match[1]!;
   called.add(name);
   expect(defined.has(name),`${name} usada sem definição`).toBe(true);
   expect(defined.get(name)!,`${name} usada antes de ser definida`).toBeLessThanOrEqual(match.index!);
  }
  expect(called.has('sgSample')).toBe(true);
  expect(called.has('sgSampleNormal')).toBe(true);
 });

 it('declara os uniformes do plugin antes da primeira leitura deles',()=>{
  // Com webGLVersion 2 o Babylon usa uniform buffer: a declaração entra no bloco do material.
  expect(withPlugin).toContain('vec4 vStochasticGroundParams;');
  expect(withPlugin).toContain('vec4 vStochasticGroundMacro;');
  for(const name of ['vStochasticGroundParams','vStochasticGroundMacro']){
   const declaration=withPlugin.indexOf(`vec4 ${name};`);
   const firstUse=withPlugin.indexOf(`${name}.`);
   expect(declaration).toBeGreaterThanOrEqual(0);
   expect(declaration).toBeLessThan(firstUse);
  }
 });

 it('aplica a variação macro em cor e em umidade',()=>{
  expect(withPlugin).toContain('surfaceAlbedo=sgMacroAlbedo(surfaceAlbedo);');
  expect(withPlugin).toContain('sgMacroMoisture(microSurface,roughness);');
 });

 it('não sobra leitura original nos mapas tratados e os parênteses fecham',()=>{
  for(const sampler of ['albedoSampler','reflectivitySampler','ambientSampler']){
   expect(withPlugin).not.toContain(`TEXRD(${sampler},v`);
  }
  expect(withPlugin).not.toContain('TEXRD(bumpSampler,vBumpUV+uvOffset)');
  expect(balance(withPlugin,'(',')')).toBe(0);
  expect(balance(withPlugin,'{','}')).toBe(0);
 });

 it('o bloco injetado sobrevive à quebra de linha por ponto e vírgula do Babylon',()=>{
  const block=stochasticBlock(withPlugin);
  expect(block.length).toBeGreaterThan(500);
  // O ShaderCodeCursor parte toda linha nos `;`: um `for(int i=0;i<3;i++)` viraria três linhas.
  expect(block).not.toMatch(/\bfor\s*\(/);
  expect(balance(block,'{','}')).toBe(0);
  expect(block).toContain('textureGrad(');
  expect(block).toContain('textureLod(');
  // Três amostras por mapa é o que quebra a repetição; menos que isso seria só mudar cor.
  expect(block.match(/sgPatch\(samp,uv,dx,dy,v[123],r[123]\)/g)).toHaveLength(6);
 });

 it('sem o plugin o shader sai limpo — a diferença é só o plugin',()=>{
  expect(without).not.toMatch(/\bsg[A-Z]/);
  expect(without).toContain('vec4 albedoTexture=TEXRD(albedoSampler,vAlbedoUV+uvOffset);');
  expect(withPlugin.length).toBeGreaterThan(without.length);
 });

 it('chão sem normal e sem ARM continua compilando o mesmo caminho',async()=>{
  const minimal=await compileGroundFragment({plugin:true,bump:false,arm:false});
  expect(minimal).toContain('vec4 albedoTexture=sgSample(albedoSampler,vAlbedoUV+uvOffset,0.0);');
  expect(minimal).not.toContain('sgSampleNormal(bumpSampler');
  expect(minimal).not.toContain('sgSample(reflectivitySampler');
  expect(minimal.split('\n').map(line=>line.trim())).not.toContain(';');
  expect(balance(minimal,'(',')')).toBe(0);
  expect(balance(minimal,'{','}')).toBe(0);
 },60000);

 it('o A/B é uniforme, não recompilação: strength 0 gera o MESMO shader',async()=>{
  const off=await compileGroundFragment({plugin:true,ambient:true,strength:0});
  expect(off).toBe(withPlugin);
 },60000);
});

describe('chão estocástico — anchors contra o shader do Babylon 9.25',()=>{
 it('cada anchor casa a quantidade esperada de vezes',()=>{
  const source=pbrFragmentSource();
  const matches=(pattern:string)=>(source.match(new RegExp(pattern,'g'))??[]).length;
  expect(matches(STOCHASTIC_GROUND_ANCHORS.albedo)).toBe(1);
  expect(matches(STOCHASTIC_GROUND_ANCHORS.reflectivity)).toBe(1);
  expect(matches(STOCHASTIC_GROUND_ANCHORS.ambient)).toBe(1);
  expect(matches(STOCHASTIC_GROUND_ANCHORS.bump)).toBe(2);
  expect(matches(STOCHASTIC_GROUND_ANCHORS.moisture)).toBe(1);
 });

 it('todo anchor termina num fim de expressão, nunca num parêntese solto',()=>{
  // É a regra que veio da falha de QA: o `\n` que o manager acrescenta não pode órfãozar o
  // terminador da instrução. Quem escrever um anchor novo tem que respeitar isso.
  for(const [name,pattern] of Object.entries(STOCHASTIC_GROUND_ANCHORS)){
   expect(pattern.endsWith('\\)'),`anchor ${name} para no parêntese`).toBe(false);
  }
  const code=buildStochasticGroundFragmentCode();
  expect(code[`!${STOCHASTIC_GROUND_ANCHORS.albedo}`]).toMatch(/;$/);
  expect(code[`!${STOCHASTIC_GROUND_ANCHORS.reflectivity}`]).toMatch(/;$/);
  expect(code[`!${STOCHASTIC_GROUND_ANCHORS.ambient}`]).toMatch(/\.rgb;$/);
  expect(code[`!${STOCHASTIC_GROUND_ANCHORS.bump}`]).toMatch(/\.xyz$/);
 });
});

/**
 * Porta em JS da grade triangular do shader, lendo as constantes DO PRÓPRIO GLSL.
 *
 * É o ponto onde um erro de digitação some silenciosamente: escalas que não são exatamente
 * inversas fazem os retalhos desalinharem e a grade triangular aparece no chão. Os testes abaixo
 * usam os números reais do shader, então um dígito trocado lá quebra aqui.
 */
function triangleGridFromShader(glsl:string){
 const number=(pattern:RegExp):number=>{
  const match=glsl.match(pattern);
  if(!match||match[1]===undefined)throw new Error('constante não encontrada no shader: '+pattern);
  return Number(match[1]);
 };
 const gridScale=number(/st\*=([\d.]+);/);
 const skewX=number(/st\.x-([\d.]+)\*st\.y/);
 const skewY=number(/,([\d.]+)\*st\.y\)/);
 const centerY=number(/return vec2\(v\.x\+0\.5\*v\.y,([\d.]+)\*v\.y\)/);
 const centerScale=number(/\*v\.y\)\*([\d.]+);/);
 const grid=(u:number,v:number)=>{
  const st=[u*gridScale,v*gridScale] as const;
  const skewed=[st[0]-skewX*st[1],skewY*st[1]] as const;
  const base=[Math.floor(skewed[0]),Math.floor(skewed[1])] as const;
  const fx=skewed[0]-base[0],fy=skewed[1]-base[1],fz=1-fx-fy;
  const s=fz<=0?1:0,sg=2*s-1;
  return {
   weights:[-fz*sg,s-fy*sg,s-fx*sg] as [number,number,number],
   vertices:[[base[0]+s,base[1]+s],[base[0]+s,base[1]+1-s],[base[0]+1-s,base[1]+s]] as Array<[number,number]>,
  };
 };
 const center=(vertex:[number,number]):[number,number]=>
  [(vertex[0]+.5*vertex[1])*centerScale,centerY*vertex[1]*centerScale];
 return {gridScale,skewX,skewY,centerY,centerScale,grid,center};
}

/** Hash determinístico só para o teste de continuidade: um valor arbitrário por retalho. */
function vertexValue(vertex:[number,number]):number{
 return Math.abs(Math.sin(vertex[0]*127.1+vertex[1]*311.7)*43758.5453)%1;
}

describe('chão estocástico — grade de retalhos',()=>{
 const shader=triangleGridFromShader(buildStochasticGroundFragmentCode()['CUSTOM_FRAGMENT_DEFINITIONS']!);

 it('usa a geometria triangular correta (constantes conferidas contra sqrt(3))',()=>{
  expect(shader.gridScale).toBeCloseTo(2*Math.sqrt(3),6);
  expect(shader.skewX).toBeCloseTo(1/Math.sqrt(3),6);
  expect(shader.skewY).toBeCloseTo(2/Math.sqrt(3),6);
  expect(shader.centerY).toBeCloseTo(Math.sqrt(3)/2,6);
  // A escala do centro precisa ser o inverso exato da escala da grade, senão os retalhos andam.
  expect(shader.centerScale).toBeCloseTo(1/shader.gridScale,6);
 });

 it('os três pesos somam 1 e nunca ficam negativos (sem costura nem buraco)',()=>{
  for(let i=0;i<4000;i++){
   const u=(i*0.61803398875)%1*37-18,v=Math.sin(i*1.7)*23;
   const {weights}=shader.grid(u,v);
   expect(weights[0]+weights[1]+weights[2]).toBeCloseTo(1,5);
   for(const w of weights)expect(w).toBeGreaterThanOrEqual(-1e-6);
  }
 });

 it('mantém os três retalhos vizinhos do ponto amostrado',()=>{
  for(let i=0;i<2000;i++){
   const u=Math.cos(i*2.3)*15,v=Math.sin(i*0.9)*15;
   const {vertices}=shader.grid(u,v);
   for(const vertex of vertices){
    const [cx,cy]=shader.center(vertex);
    expect(Math.hypot(cx-u,cy-v)).toBeLessThan(1);
   }
  }
 });

 it('a mistura é contínua ao atravessar a borda do retalho',()=>{
  const blend=(u:number,v:number)=>{
   const {weights,vertices}=shader.grid(u,v);
   return weights.reduce((sum,w,index)=>sum+w*vertexValue(vertices[index]!),0);
  };
  const step=1e-5;
  let worst=0;
  for(let i=0;i<6000;i++){
   const u=Math.cos(i*1.13)*9,v=Math.sin(i*2.71)*9;
   worst=Math.max(worst,Math.abs(blend(u+step,v+step)-blend(u,v)));
  }
  // Uma descontinuidade de verdade saltaria na ordem de 1 (valores por retalho são 0..1).
  expect(worst).toBeLessThan(1e-3);
 });
});

describe('chão estocástico — ciclo de vida no material',()=>{
 function makeScene(webGLVersion:number){
  const engine=new NullEngine();
  (engine as unknown as {_webGLVersion:number})._webGLVersion=webGLVersion;
  return {engine,scene:new Scene(engine)};
 }
 function makeGround(scene:Scene,name='Leaf litter soil'){
  const material=new PBRMaterial(name,scene);
  const map=(file:string,gamma:boolean)=>{
   const texture=new Texture(`/textures/brown_mud_02/${file}.jpg`,scene,undefined,undefined,undefined,undefined,()=>{});
   texture.uScale=12;texture.vScale=12;texture.gammaSpace=gamma;return texture;
  };
  material.albedoTexture=map('Diffuse',true);
  material.bumpTexture=map('nor_gl',false);
  material.metallicTexture=map('arm',false);
  material.useRoughnessFromMetallicTextureGreen=true;
  material.useAmbientOcclusionFromMetallicTextureRed=true;
  return material;
 }

 it('não toca no material quando a engine não é WebGL2',()=>{
  const {engine,scene}=makeScene(1);
  try{
   expect(supportsStochasticGround(engine)).toBe(false);
   const material=makeGround(scene);
   expect(attachStochasticGround(material)).toBeNull();
   expect(getStochasticGround(material)).toBeNull();
  }finally{scene.dispose();engine.dispose();}
 });

 it('instala uma vez só e reaproveita a instância ao reconfigurar',()=>{
  const {engine,scene}=makeScene(2);
  try{
   const material=makeGround(scene);
   const plugin=attachStochasticGround(material,{patchScale:2});
   expect(plugin).toBeInstanceOf(StochasticGroundPlugin);
   expect(plugin!.settings.patchScale).toBe(2);
   const again=attachStochasticGround(material,{patchScale:3});
   expect(again).toBe(plugin);
   expect(plugin!.settings.patchScale).toBe(3);
   expect(getStochasticGround(material)).toBe(plugin);
   expect(material.getClassName()).toBe('PBRMaterial');
  }finally{scene.dispose();engine.dispose();}
 });

 it('sobe os ajustes como dois vec4 e saneia valores fora de faixa',()=>{
  const {engine,scene}=makeScene(2);
  try{
   const material=makeGround(scene);
   const plugin=attachStochasticGround(material,{strength:5,patchScale:0,contrast:.1,seed:9,macroStrength:-2})!;
   expect(plugin.settings.strength).toBe(1);
   expect(plugin.settings.patchScale).toBeGreaterThan(0);
   expect(plugin.settings.contrast).toBe(1);
   expect(plugin.settings.macroStrength).toBe(0);
   const uploads:Record<string,number[]>={};
   const buffer={updateFloat4:(name:string,x:number,y:number,z:number,w:number)=>{uploads[name]=[x,y,z,w];}};
   expect(plugin.hasPendingUpload).toBe(true);
   plugin.bindForSubMesh(buffer as never);
   expect(plugin.hasPendingUpload).toBe(false);
   expect(uploads['vStochasticGroundParams']![0]).toBe(1);
   expect(uploads['vStochasticGroundMacro']![2]).toBe(9);
   // A/B sem recompilar: strength 0 devolve a amostragem original dentro do próprio shader.
   plugin.isEnabled=false;
   plugin.bindForSubMesh(buffer as never);
   expect(uploads['vStochasticGroundParams']![0]).toBe(0);
   expect(plugin.isEnabled).toBe(false);
   plugin.isEnabled=true;
   plugin.bindForSubMesh(buffer as never);
   expect(uploads['vStochasticGroundParams']![0]).toBe(1);
  }finally{scene.dispose();engine.dispose();}
 });

 it('declara os uniformes no UBO e também soltos, para engines sem uniform buffer',()=>{
  const {engine,scene}=makeScene(2);
  try{
   const plugin=attachStochasticGround(makeGround(scene))!;
   const uniforms=plugin.getUniforms();
   expect(uniforms.ubo?.map(entry=>entry.name)).toEqual(['vStochasticGroundParams','vStochasticGroundMacro']);
   expect(uniforms.ubo?.every(entry=>entry.size===4&&entry.type==='vec4')).toBe(true);
   expect(uniforms.fragment).toContain('uniform vec4 vStochasticGroundParams;');
   expect(plugin.getCustomCode('vertex')).toBeNull();
   expect(Object.keys(plugin.getCustomCode('fragment')!)).toHaveLength(7);
  }finally{scene.dispose();engine.dispose();}
 });

 it('aponta mapas com transform de UV divergente do albedo',()=>{
  const {engine,scene}=makeScene(2);
  try{
   const material=makeGround(scene);
   expect(stochasticGroundUvMismatch(material)).toEqual([]);
   (material.bumpTexture as Texture).uScale=6;
   expect(stochasticGroundUvMismatch(material)).toEqual(['bumpTexture']);
  }finally{scene.dispose();engine.dispose();}
 });

 it('aplica só nos nomes do whitelist e sobrevive a material congelado',()=>{
  const {engine,scene}=makeScene(2);
  try{
   const track=makeGround(scene,'Sunlit farm track');
   const soil=makeGround(scene,'Leaf litter soil');
   const wall=makeGround(scene,'Barn red weathered wood');
   const attached=attachStochasticGroundByName(scene.materials,['Sunlit farm track','Leaf litter soil']);
   expect(attached).toHaveLength(2);
   expect(getStochasticGround(wall)).toBeNull();
   expect(getStochasticGround(track)).not.toBeNull();
   soil.freeze();
   const plugin=getStochasticGround(soil)!;
   plugin.update({strength:.35});
   expect(soil.isFrozen).toBe(true);
   expect(plugin.settings.strength).toBeCloseTo(.35);
   expect(plugin.hasPendingUpload).toBe(true);
  }finally{scene.dispose();engine.dispose();}
 });

 it('some junto com o material, sem recurso de GPU pendurado',()=>{
  const {engine,scene}=makeScene(2);
  try{
   const material=makeGround(scene);
   const plugin=attachStochasticGround(material)!;
   expect(plugin.hasTexture(material.albedoTexture as never)).toBe(false);
   const actives:never[]=[];
   plugin.getActiveTextures(actives);
   expect(actives).toHaveLength(0);
   material.dispose(true,true);
   expect(scene.materials).toHaveLength(0);
   expect(plugin.hasPendingUpload).toBe(false);
  }finally{scene.dispose();engine.dispose();}
 });

 it('mantém os padrões documentados no DELIVERY',()=>{
  expect(DEFAULT_STOCHASTIC_GROUND_SETTINGS).toEqual({
   strength:1,patchScale:1.15,rotation:1,contrast:4,
   macroStrength:.5,macroScale:26,seed:17,moisture:.6,
  });
  expect(StochasticGroundPlugin.Name).toBe('StochasticGround');
 });
});
