import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {ParticleSystem} from '@babylonjs/core/Particles/particleSystem';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {WeatherCycle} from '../src/world/WeatherCycle';
import {WeatherPresentation,RAIN_CAPACITY,MOTE_TEXTURE} from '../src/world/WeatherPresentation';
import {RAIN_LAYERS,RAIN_TOTAL_CAPACITY} from '../src/world/rain/RainLayers';
import {RAIN_STREAK_TEXTURE,RAIN_SPLASH_TEXTURE,RAIN_HAZE_TEXTURE,ATLAS_CELL,ATLAS_LAST_CELL} from '../src/world/rain/RainAtlas';
import {SPLASH_CAPACITY,QUERY_BUDGET_PER_SECOND,type RainWorldQuery} from '../src/world/rain/RainSurface';

const ground=(scene:Scene,name:string)=>{const m=new PBRMaterial(name,scene);m.roughness=.8;m.albedoColor=new Color3(.5,.42,.33);return m;};
const rainy=()=>{const c=new WeatherCycle();c.manualPhase='rain';return c;};
const layer=(scene:Scene,id:string)=>scene.particleSystems.find((p):p is ParticleSystem=>p.name==='weather-rain-'+id&&p instanceof ParticleSystem);
const flatWorld=(height=0):RainWorldQuery=>({surfaceAt:()=>({height,normal:{x:0,y:1,z:0}}),insideSolid:()=>false});

const soak=(weather:WeatherPresentation,cycle:WeatherCycle,seconds:number,viewer={x:0,y:1.7,z:0})=>{
 for(let i=0;i<Math.round(seconds*60);i++)weather.update(cycle,viewer,1/60);
};

it('builds three rain layers with real depth separation and no full-screen sheet',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),weather=new WeatherPresentation(scene);
 try{
  soak(weather,rainy(),2);
  const near=layer(scene,'near')!,mid=layer(scene,'mid')!,far=layer(scene,'far')!;
  for(const [label,system] of [['near',near],['mid',mid],['far',far]] as const)expect(system,label).toBeDefined();
  // O orçamento somado é MENOR que as 900 partículas da versão reprovada.
  expect(RAIN_CAPACITY).toBe(RAIN_TOTAL_CAPACITY);
  expect(near.getCapacity()+mid.getCapacity()+far.getCapacity()).toBeLessThan(900);
  // Profundidade: escala, opacidade e velocidade separadas, não 900 riscos iguais.
  expect(near.maxSize).toBeGreaterThan(mid.maxSize);
  expect(far.maxSize).toBeGreaterThan(near.maxSize*3);
  expect(near.color1.a).toBeGreaterThan(far.color1.a*3);
  expect(Math.abs(near.direction1.y)).toBeGreaterThan(Math.abs(far.direction1.y)*2);
  expect(far.maxEmitBox.x).toBeGreaterThan(mid.maxEmitBox.x);
  // Atlas autoral com dezesseis variações congeladas por gota — não uma animação, não um ícone.
  expect(near.particleTexture?.name).toBe(RAIN_STREAK_TEXTURE);
  expect(near.isAnimationSheetEnabled).toBe(true);
  expect(near.spriteCellWidth).toBe(ATLAS_CELL);
  expect(near.endSpriteCellID).toBe(ATLAS_LAST_CELL);
  expect(near.spriteRandomStartCell).toBe(true);
  expect(near.spriteCellChangeSpeed).toBe(0);
  // O véu é um cartão no mundo, com a textura de haste; não um quad de tela cheia.
  expect(far.particleTexture?.name).toBe(RAIN_HAZE_TEXTURE);
  expect(far.isBillboardBased).toBe(true);
  // Nada reaproveitado dos VFX do totem em lugar nenhum.
  for(const system of [near,mid,far])expect(system.particleTexture?.name).not.toContain('expedition');
  // Rastro esticado ao longo da velocidade: é o vento que o inclina.
  expect(near.billboardMode).toBe(ParticleSystem.BILLBOARDMODE_STRETCHED);
  expect(mid.billboardMode).toBe(ParticleSystem.BILLBOARDMODE_STRETCHED);
 }finally{weather.dispose();scene.dispose();engine.dispose();}
});

it('shares one coherent wind across every layer and keeps the boxes on the camera',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),weather=new WeatherPresentation(scene);
 try{
  const cycle=rainy();
  soak(weather,cycle,3);
  const viewer={x:41,y:6.2,z:-17};
  for(let i=0;i<30;i++)weather.update(cycle,viewer,1/60);
  const wind=weather.currentWind;
  const horizontal=[];
  for(const spec of RAIN_LAYERS){
   const system=layer(scene,spec.id)!;
   // A caixa viaja com a câmera, senão a chuva fica para trás ao correr.
   expect(system.emitter).toMatchObject(viewer);
   const drift={x:(system.direction1.x+system.direction2.x)/2,z:(system.direction1.z+system.direction2.z)/2};
   const length=Math.hypot(drift.x,drift.z);
   expect(drift.x/length).toBeCloseTo(wind.x,4);
   expect(drift.z/length).toBeCloseTo(wind.z,4);
   horizontal.push(length);
   // A gota sempre cai; o vento inclina, não vira ventania horizontal.
   expect(system.direction1.y).toBeLessThan(0);
   expect(length).toBeLessThan(Math.abs(system.direction1.y));
  }
  // Camadas distantes derivam menos que as de perto: paralaxe de vento.
  expect(horizontal[0]!).toBeGreaterThan(horizontal[2]!);
 }finally{weather.dispose();scene.dispose();engine.dispose();}
});

it('fades the layers in by intensity instead of switching the whole storm on at once',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),weather=new WeatherPresentation(scene);
 try{
  const cycle=new WeatherCycle();
  // Crepúsculo tem chuva fraca (0,25): véu presente, gotas de perto ainda não.
  cycle.manualPhase='dusk';
  soak(weather,cycle,2);
  expect(layer(scene,'far')!.emitRate).toBeGreaterThan(0);
  expect(layer(scene,'near')?.emitRate ?? 0).toBe(0);
  cycle.manualPhase='rain';
  soak(weather,cycle,2);
  expect(layer(scene,'near')!.emitRate).toBeGreaterThan(0);
  expect(layer(scene,'mid')!.emitRate).toBeGreaterThan(layer(scene,'near')!.emitRate);
  cycle.manualPhase='sun';
  soak(weather,cycle,2);
  for(const spec of RAIN_LAYERS)expect(layer(scene,spec.id)!.emitRate,spec.id).toBe(0);
 }finally{weather.dispose();scene.dispose();engine.dispose();}
});

it('places splashes only on surfaces the world reports, within a bounded query budget',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),weather=new WeatherPresentation(scene);
 try{
  const cycle=rainy();
  // Sem consulta de mundo não existe respingo. Nada de plano de chão inventado.
  soak(weather,cycle,3);
  expect(scene.particleSystems.find(p=>p.name==='weather-splash')).toBeUndefined();
  expect(weather.worldQueries).toBe(0);

  let calls=0;
  weather.world={surfaceAt:(x,z)=>{calls++;return {height:.5+Math.sin(x)*.1+Math.cos(z)*.1,normal:{x:0,y:1,z:0}};},insideSolid:()=>false};
  const seconds=8;
  soak(weather,cycle,seconds);
  const splash=scene.particleSystems.find((p):p is ParticleSystem=>p.name==='weather-splash'&&p instanceof ParticleSystem)!;
  expect(splash).toBeDefined();
  expect(splash.getCapacity()).toBe(SPLASH_CAPACITY);
  expect(splash.particleTexture?.name).toBe(RAIN_SPLASH_TEXTURE);
  // Flipbook que abre e some, deitado no chão e sem billboard.
  expect(splash.spriteCellLoop).toBe(false);
  expect(splash.spriteCellChangeSpeed).toBeGreaterThan(0);
  expect(splash.isBillboardBased).toBe(false);
  expect(splash.direction1.y).toBe(1);
  expect(splash.manualEmitCount).toBeLessThanOrEqual(SPLASH_CAPACITY);
  // Orçamento: longe de um raycast por partícula. 8 s a 60 Hz seriam 480 oportunidades.
  expect(calls).toBe(weather.worldQueries);
  expect(calls).toBeLessThanOrEqual(Math.ceil(QUERY_BUDGET_PER_SECOND*(seconds+3))+4);
  expect(calls).toBeGreaterThan(0);
 }finally{weather.dispose();scene.dispose();engine.dispose();}
});

it('suppresses close rain when the camera itself is under cover',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),weather=new WeatherPresentation(scene);
 try{
  const cycle=rainy(),viewer={x:0,y:1.7,z:0};
  weather.world=flatWorld(0);
  soak(weather,cycle,3,viewer);
  expect(weather.viewerCovered).toBe(false);
  const open=layer(scene,'near')!.emitRate as number;
  expect(open).toBeGreaterThan(0);
  // Telhado acima da cabeça: as gotas de perto e do meio cessam…
  weather.world=flatWorld(viewer.y+6);
  soak(weather,cycle,3,viewer);
  expect(weather.viewerCovered).toBe(true);
  expect(layer(scene,'near')!.emitRate).toBe(0);
  expect(layer(scene,'mid')!.emitRate).toBe(0);
  // …mas o véu distante continua, porque a chuva lá fora não parou.
  expect(layer(scene,'far')!.emitRate).toBeGreaterThan(0);
  // De volta ao aberto, volta tudo.
  weather.world=flatWorld(0);
  soak(weather,cycle,3,viewer);
  expect(layer(scene,'near')!.emitRate).toBe(open);
 }finally{weather.dispose();scene.dispose();engine.dispose();}
});

it('wets the ground fast, dries it slowly and gives each material its own response',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),weather=new WeatherPresentation(scene);
 const soil=ground(scene,'Leaf litter soil'),stone=ground(scene,'Cliff stone rock');
 ground(scene,'Barn red weathered wood'); // fora da whitelist: nunca entra
 const originals={soil:soil.roughness,stone:stone.roughness,albedo:soil.albedoColor.clone()};
 try{
  const cycle=rainy();
  soak(weather,cycle,30);
  expect(weather.trackedMaterials).toBe(2);
  expect(weather.wetness).toBeGreaterThan(.8);
  expect(soil.roughness).toBeLessThan(originals.soil!);
  expect(soil.albedoColor.r).toBeLessThan(originals.albedo.r);
  // Terra segura mais água que pedra.
  const soilDrop=1-soil.roughness!/originals.soil!,stoneDrop=1-stone.roughness!/originals.stone!;
  expect(soilDrop).toBeGreaterThan(stoneDrop);

  // Chuva para: o chão continua molhado por um tempo — é isso que a versão anterior não fazia.
  cycle.manualPhase='sun';
  soak(weather,cycle,12);
  expect(weather.wetness).toBeGreaterThan(.45);
  expect(soil.roughness).toBeLessThan(originals.soil!*.95);
  // Só bem depois é que seca.
  soak(weather,cycle,240);
  expect(weather.wetness).toBeLessThan(.08);
 }finally{
  weather.dispose();
  // Restaura EXATAMENTE os valores originais; o plugin do terreno e o fluxo PBR ficam intactos.
  expect(soil.roughness).toBe(originals.soil);
  expect(stone.roughness).toBe(originals.stone);
  expect(soil.albedoColor.equals(originals.albedo)).toBe(true);
  scene.dispose();engine.dispose();
 }
});

it('lets the streaming drop a region without keeping its ground materials alive',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),weather=new WeatherPresentation(scene),cycle=new WeatherCycle();
 try{
  const kept=ground(scene,'Sunlit farm track'),transient=ground(scene,'Leaf litter soil');
  weather.update(cycle,{x:0,y:0,z:0},9);
  expect(weather.trackedMaterials).toBe(2);
  // A verificação antiga lia `_wasDisposed`, que não existe no Material do Babylon instalado: o
  // Map forte segurava para sempre o material de toda região descartada. Agora o dispose limpa.
  transient.dispose();
  expect(weather.trackedMaterials).toBe(1);
  weather.update(cycle,{x:0,y:0,z:0},9);
  expect(weather.trackedMaterials).toBe(1);
  expect(scene.materials).toContain(kept);
 }finally{weather.dispose();scene.dispose();engine.dispose();}
});

it('disposes every system, restores the scene and stops the rain loop',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),weather=new WeatherPresentation(scene);
 const cues:number[]=[];
 try{
  ground(scene,'soil');
  weather.onRain=value=>cues.push(value);
  weather.world=flatWorld(0);
  const cycle=rainy();
  soak(weather,cycle,6);
  expect(scene.particleSystems.length).toBeGreaterThanOrEqual(4);
  expect(cues.some(v=>v>0)).toBe(true);
 }finally{
  weather.dispose();
  // Nada sobra em cena e o áudio recebe silêncio antes de o gancho sumir.
  expect(scene.particleSystems.filter(p=>p.name.startsWith('weather-'))).toHaveLength(0);
  expect(cues.at(-1)).toBe(0);
  // E atualizar depois do dispose não recria nada.
  weather.update(rainy(),{x:0,y:0,z:0},1/60);
  expect(scene.particleSystems.filter(p=>p.name.startsWith('weather-'))).toHaveLength(0);
  expect(weather.worldQueries).toBe(0);
  scene.dispose();engine.dispose();
 }
});

it('keeps the ambient pollen on its own dedicated texture and out of the rain',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),weather=new WeatherPresentation(scene);
 try{
  const cycle=new WeatherCycle();cycle.manualPhase='sun';
  soak(weather,cycle,2);
  const motes=scene.particleSystems.find((p):p is ParticleSystem=>p.name==='weather-motes'&&p instanceof ParticleSystem)!;
  expect(motes.particleTexture?.name).toBe(MOTE_TEXTURE);
  expect(motes.emitRate).toBeGreaterThan(0);
  cycle.manualPhase='rain';
  soak(weather,cycle,2);
  expect(motes.emitRate).toBe(0);
 }finally{weather.dispose();scene.dispose();engine.dispose();}
});
