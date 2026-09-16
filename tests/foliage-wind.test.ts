import {describe,it,expect} from 'vitest';
import '@babylonjs/core/Shaders/pbr.vertex';
import '@babylonjs/core/Shaders/pbr.fragment';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {WebGL2ShaderProcessor} from '@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors';
import {Scene} from '@babylonjs/core/scene';
import {CreateBox} from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {
 DEFAULT_FOLIAGE_WIND,FOLIAGE_WIND_PROFILES,attachFoliageWind,buildFoliageWindVertexCode,
 foliageWindProfile,getFoliageWind,hasFoliageWind,
} from '../src/world/materials/FoliageWindPlugin';
import {FoliageWind,applyFoliageMaterials} from '../src/world/materials/FoliageMaterials';

/**
 * Vento de vegetação.
 *
 * O teste de shader roda o pipeline REAL do Babylon (resolve `#include`, aplica a injeção do plugin
 * antes do pré-processador, quebra as linhas nos `;` e emite GLSL ES 3.00) — só a compilação na GPU
 * fica de fora. Foi assim que a entrega do chão estocástico pegou um `;` perdido que o teste de
 * regex não via.
 */
async function compileFoliageVertex(attach:boolean):Promise<string>{
 const engine=new NullEngine();
 const internals=engine as unknown as Record<string,unknown>;
 internals['_webGLVersion']=2;
 internals['_shaderProcessor']=new WebGL2ShaderProcessor();
 Object.defineProperty(engine,'shaderPlatformName',{get:()=>'WEBGL2',configurable:true});
 engine.getCaps().standardDerivatives=true;engine.getCaps().textureLOD=true;
 let captured='';
 const create=engine.createShaderProgram.bind(engine);
 engine.createShaderProgram=((context:never,vertex:string,fragment:string,defines:string,gl:never)=>{
  captured=vertex;return create(context,vertex,fragment,defines,gl);
 }) as typeof engine.createShaderProgram;
 const scene=new Scene(engine);
 try{
  new HemisphericLight('sky',Vector3.Up(),scene);
  const mesh=CreateBox('fern_02',{size:1},scene);
  const material=new PBRMaterial('fern_02',scene);
  const texture=new Texture('/textures/fern/Diffuse.png',scene,undefined,undefined,undefined,undefined,()=>{});
  material.albedoTexture=texture;mesh.material=material;
  if(attach)expect(attachFoliageWind(material,foliageWindProfile('fern_02')??{})).not.toBeNull();
  const internal=texture.getInternalTexture();if(internal)internal.isReady=true;
  for(let attempt=0;attempt<120&&!captured;attempt++){
   if(material.isReadyForSubMesh(mesh,mesh.subMeshes[0]!))break;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 }finally{scene.dispose();engine.dispose();}
 return captured;
}

describe('shader de vento',()=>{
 it('injeta o deslocamento no vertex shader real, depois de finalWorld e antes da projeção',async()=>{
  const shader=await compileFoliageVertex(true);
  expect(shader).toContain('fwDisplacement');
  // Declarados como uniform solto ou dentro do UBO do material, conforme a engine; o que importa
  // é que os dois cheguem ao shader emitido.
  expect(shader).toMatch(/vFoliageWindPhase/);
  expect(shader).toMatch(/vFoliageWindDir/);
  const injection=shader.indexOf('worldPos.xyz+=fwDisplacement');
  expect(injection).toBeGreaterThan(0);
  // `finalWorld` precisa existir ANTES (é dele que sai a raiz da instância)...
  expect(shader.indexOf('finalWorld')).toBeLessThan(injection);
  // ...e a projeção precisa acontecer DEPOIS, senão o deslocamento não aparece na tela.
  expect(shader.indexOf('gl_Position')).toBeGreaterThan(injection);
  // vPositionW reescrito junto: iluminação e especular seguem o vértice deslocado.
  expect(shader).toContain('vPositionW=vec3(worldPos)');
  // O pré-processador descarta linha que é só `;`: nenhuma instrução pode ter ficado órfã.
  for(const line of shader.split('\n'))expect(line.trim()).not.toBe(';');
 });

 it('deixa o shader intacto quando o plugin não é instalado',async()=>{
  const shader=await compileFoliageVertex(false);
  expect(shader).not.toContain('fwDisplacement');
  expect(shader).not.toContain('vFoliageWindPhase');
 });

 it('mantém a raiz fixa e a ponta livre no perfil de altura declarado no shader',()=>{
  const code=buildFoliageWindVertexCode().CUSTOM_VERTEX_DEFINITIONS!;
  // Altura medida contra a TRANSLAÇÃO da instância, não contra o Y absoluto: uma árvore no terraço
  // balança igual a uma no vale.
  expect(code).toContain('clamp((world.y-root.y)/reference,0.0,1.0)');
  // Expoente de rigidez: na base o termo zera, então o tronco não escorrega.
  expect(code).toContain('pow(up,max(vFoliageWindDir.z,0.001))');
  expect(code).toContain('if(sway<=0.0)return vec3(0.0)');
  // Fase e intensidade saem da posição da própria planta: cada instância balança diferente.
  expect(code).toContain('dot(root.xz');
  expect(code).toContain('fwHash(root.xz');
  // Nenhum laço `for`: o cursor de shader do Babylon quebra as linhas nos `;` e partiria o cabeçalho.
  expect(code).not.toContain('for(');
 });
});

describe('ajuste por família de vegetação',()=>{
 it('dá copa lenta e alta e capa rápida e baixa, sempre com raiz mais firme que a ponta',()=>{
  const grass=foliageWindProfile('grass_medium_01')!,fern=foliageWindProfile('fern_02')!,tree=foliageWindProfile('island_tree_01_leaves')!;
  expect(grass.heightReference!).toBeLessThan(fern.heightReference!);
  expect(fern.heightReference!).toBeLessThan(tree.heightReference!);
  expect(tree.frequency!).toBeLessThan(grass.frequency!);
  // Amplitude em METROS e baixa: nada de tronco de borracha.
  for(const profile of FOLIAGE_WIND_PROFILES)expect(profile.settings.amplitude!).toBeLessThan(.25);
  // Copa grande precisa da rigidez maior, senão o tronco inteiro anda junto.
  expect(tree.stiffness!).toBeGreaterThan(fern.stiffness!);
  expect(foliageWindProfile('Barn red weathered wood')).toBeNull();
  expect(foliageWindProfile('Leaf litter soil')).toBeNull();
 });

 it('normaliza a direção e recusa ajustes inválidos',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
   const material=new PBRMaterial('fern_02',scene);
   const plugin=attachFoliageWind(material,{directionX:3,directionZ:4,amplitude:-1,frequency:0,stiffness:99})!;
   expect(plugin.settings.directionX).toBeCloseTo(.6,5);
   expect(plugin.settings.directionZ).toBeCloseTo(.8,5);
   expect(plugin.settings.amplitude).toBe(0);
   expect(plugin.settings.frequency).toBe(DEFAULT_FOLIAGE_WIND.frequency);
   expect(plugin.settings.stiffness).toBeLessThanOrEqual(8);
  }finally{scene.dispose();engine.dispose();}
 });
});

describe('integração com os materiais do mundo',()=>{
 function world(){
  const engine=new NullEngine(),scene=new Scene(engine);
  const withAlpha=(name:string)=>{
   const material=new PBRMaterial(name,scene);
   const texture=new Texture('/textures/'+name+'.png',scene,undefined,undefined,undefined,undefined,()=>{});
   texture.hasAlpha=true;material.albedoTexture=texture;return material;
  };
  const fern=withAlpha('fern_02'),leaves=withAlpha('island_tree_01_leaves.001'),grass=withAlpha('grass_medium_01');
  const trail=withAlpha('Highland worn earth trails');
  trail.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND;
  const wall=new PBRMaterial('Barn red weathered wood',scene);
  const soil=new PBRMaterial('Leaf litter soil',scene);
  return{engine,scene,fern,leaves,grass,trail,wall,soil};
 }

 it('liga alpha-test, dois lados e vento só na vegetação, e tira a trilha do passe transparente',()=>{
  const {engine,scene,fern,leaves,grass,trail,wall,soil}=world();
  try{
   const setup=applyFoliageMaterials([fern,leaves,grass,trail,wall,soil,null]);
   expect(setup.plugins).toHaveLength(3);
   expect(setup.decals).toEqual([trail]);
   for(const material of [fern,leaves,grass]){
    expect(material.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_ALPHATEST);
    expect(material.twoSidedLighting).toBe(true);
    expect(hasFoliageWind(material)).toBe(true);
   }
   // Copa com corte mais baixo: o corte alto comia a ponta da folha e lia como copa rala.
   expect(leaves.alphaCutOff).toBeLessThan(fern.alphaCutOff);
   // Trilha vira alpha-test: volta a escrever profundidade e sai da ordenação por distância.
   expect(trail.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_ALPHATEST);
   expect(hasFoliageWind(trail)).toBe(false);
   // Parede e chão ficam exatamente como estavam.
   expect(hasFoliageWind(wall)).toBe(false);
   expect(hasFoliageWind(soil)).toBe(false);
   expect(wall.twoSidedLighting).toBe(false);
  }finally{scene.dispose();engine.dispose();}
 });

 it('avança um relógio próprio, sobrevive ao congelamento e devolve tudo no dispose',()=>{
  const {engine,scene,fern,leaves,grass,wall}=world();
  try{
   const wind=new FoliageWind([fern,leaves,grass,wall]);
   expect(wind.materials).toBe(3);
   wind.update(.5);wind.update(.25);
   expect(wind.seconds).toBeCloseTo(.75,6);
   // Passo inválido não mexe no relógio: quadro perdido não teleporta a vegetação.
   wind.update(Number.NaN);wind.update(-1);
   expect(wind.seconds).toBeCloseTo(.75,6);

   // Material com vento NÃO pode ser congelado: congelado o Babylon pula o bind e o tempo não sobe.
   // É exatamente o filtro que `FarmWorld` e `RegionPresentation` aplicam antes de `freeze()`.
   const frozen=[fern,leaves,grass,wall].filter(material=>!hasFoliageWind(material));
   expect(frozen).toEqual([wall]);

   const uploads:Record<string,number[]>={};
   const buffer={updateFloat4:(name:string,a:number,b:number,c:number,d:number)=>{uploads[name]=[a,b,c,d];}};
   getFoliageWind(fern)!.bindForSubMesh(buffer as never);
   expect(uploads['vFoliageWindPhase']![0]).toBeCloseTo(.75,6);
   expect(uploads['vFoliageWindDir']![2]).toBeGreaterThan(1);

   wind.dispose();wind.update(1);
   expect(wind.seconds).toBe(0);
  }finally{scene.dispose();engine.dispose();}
 });
});
