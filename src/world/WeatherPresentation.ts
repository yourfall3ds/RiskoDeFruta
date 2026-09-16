import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {ParticleSystem} from '@babylonjs/core/Particles/particleSystem';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {DefaultRenderingPipeline} from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import {applySkyWeather} from '../rendering/SeamlessSky';
import type {WeatherCycle,WeatherStop} from './WeatherCycle';
import {RAIN_STREAK_TEXTURE,RAIN_SPLASH_TEXTURE,RAIN_HAZE_TEXTURE,ATLAS_CELL,ATLAS_LAST_CELL,SPLASH_FLIPBOOK_FPS} from './rain/RainAtlas';
import {RAIN_LAYERS,RAIN_TOTAL_CAPACITY,layerIntensity,type RainLayerId,type RainLayerSpec} from './rain/RainLayers';
import {rainWind,windDrift,type RainWind} from './rain/RainWind';
import {RainSurfaceSampler,SPLASH_CAPACITY,type RainWorldQuery,type SplashPlacement} from './rain/RainSurface';
import {WetnessField,WET_ROUGHNESS_DROP,WET_ALBEDO_DROP,WET_SPECULAR_GAIN} from './rain/WetnessField';

/** Gotas vivas somadas nas três camadas. Menor que as 900 da versão anterior. */
export const RAIN_CAPACITY=RAIN_TOTAL_CAPACITY;
/** Partículas secas (poeira/pólen) no pior caso. */
export const MOTE_CAPACITY=180;
/** Raio da caixa de poeira em torno da câmera, em metros. */
export const RAIN_RADIUS=16;
/** Materiais de chão que a umidade pode escurecer/lustrar. Whitelist explícita. */
export const WET_MATERIAL_PATTERN=/soil|ground|terrain|dirt|track|trilha|coast_land|leaf litter|farm track|rock|stone/i;
/** Textura dedicada do pólen (autoria do Codex); nada reaproveitado dos VFX do totem. */
export const MOTE_TEXTURE='/textures/weather-mote.svg';
/** Atlas de rastros — a chuva em si. Mantido exportado para o QA e os testes. */
export const RAIN_TEXTURE=RAIN_STREAK_TEXTURE;

interface WetRecord {
  material:PBRMaterial;
  roughness:number;
  albedo:Color3;
  /** `undefined` quando o material não expõe o parâmetro nesta versão do Babylon. */
  specular:number|undefined;
  forget:()=>void;
}

interface RainLayer {spec:RainLayerSpec;system:ParticleSystem}

/**
 * Aplica o estado do `WeatherCycle` à cena: céu, sol, preenchimento, névoa, exposição, chuva,
 * poeira ambiente e umidade do chão.
 *
 * ## Chuva
 * Três camadas com papéis distintos (`rain/RainLayers`), um vento coerente compartilhado
 * (`rain/RainWind`), respingos amostrados em superfícies REAIS com orçamento de consultas
 * (`rain/RainSurface`) e um chão que molha rápido e seca devagar (`rain/WetnessField`).
 * As texturas são atlas autorais gerados por `scripts/build-rain-atlas.py` — não há shader de
 * tela cheia nem ruído branco fazendo o papel de chuva.
 *
 * ## Integração opcional com o mundo
 * `world` aceita qualquer objeto com `surfaceAt` (e, se houver, `insideSolid`) — o `CollisionWorld`
 * do jogo já satisfaz a interface. O dono da cena liga com **uma linha**:
 *
 * ```ts
 * this.weatherView.world = this.collision;
 * ```
 *
 * Sem isso a chuva roda inteira, apenas sem respingo e sem supressão sob cobertura. Nada de plano
 * de chão inventado.
 *
 * O céu é o `ShaderMaterial` do `SeamlessSky` e NÃO recebe `scene.clearColor` — por isso a cobertura
 * e a noite vão por `applySkyWeather`, senão choveria sob um azul fixo.
 */
export class WeatherPresentation {
  private sun:DirectionalLight|undefined;
  private fill:HemisphericLight|undefined;
  private pipeline:DefaultRenderingPipeline|undefined;
  private readonly layers=new Map<RainLayerId,RainLayer>();
  private splash:ParticleSystem|undefined;
  private motes:ParticleSystem|undefined;
  private disposed=false;

  /** Umidade exposta: o nível global do campo, já com histerese. */
  get wetness():number {return this.wet.level;}
  private readonly wet=new WetnessField();
  private readonly surfaces=new RainSurfaceSampler();
  /** Fila de respingos deste quadro, consumida pelo `startPositionFunction`. */
  private readonly pendingSplashes:SplashPlacement[]=[];
  private clock=0;
  private wind:RainWind=rainWind(0,0);

  /**
   * Consulta de mundo OPCIONAL. `undefined` desliga respingo e supressão sob cobertura.
   * Ver o bloco de integração na documentação da classe.
   */
  world:RainWorldQuery|undefined;

  /** Materiais de chão já capturados, com os valores ORIGINAIS para restaurar no `dispose`. */
  private readonly tracked=new Map<PBRMaterial,WetRecord>();
  private materialScan=0;
  /** Chamado quando a intensidade da chuva muda; o áudio decide se e como tocar. */
  onRain:((intensity:number)=>void)|undefined;
  private lastRainCue=-1;

  constructor(private readonly scene:Scene){
    this.sun=scene.lights.find((light):light is DirectionalLight=>light instanceof DirectionalLight);
    this.fill=scene.lights.find((light):light is HemisphericLight=>light instanceof HemisphericLight);
    this.pipeline=scene.postProcessRenderPipelineManager?.supportedPipelines
      ?.find((pipe):pipe is DefaultRenderingPipeline=>pipe instanceof DefaultRenderingPipeline);
  }

  // ---------------------------------------------------------------- leitura para QA e testes
  /** Quantas partículas cada camada pode ter e quantas está emitindo agora. */
  get layerStatus():{id:RainLayerId;capacity:number;emitRate:number}[] {
    return [...this.layers.values()].map(({spec,system})=>({id:spec.id,capacity:spec.capacity,emitRate:system.emitRate as number}));
  }
  get splashCapacity():number {return SPLASH_CAPACITY;}
  /** Vento compartilhado por todas as camadas neste quadro. */
  get currentWind():RainWind {return this.wind;}
  /** Consultas feitas ao mundo desde a criação — o teste confere o orçamento contra isto. */
  get worldQueries():number {return this.surfaces.queries;}
  /** `true` quando a câmera está sob cobertura e a chuva de perto é suprimida. */
  get viewerCovered():boolean {return this.surfaces.viewerCovered;}
  /** Quantos materiais de chão estão registrados. Usado pelo teste de retenção do streaming. */
  get trackedMaterials():number {return this.tracked.size;}

  // ---------------------------------------------------------------- construção das camadas
  private ensureLayer(spec:RainLayerSpec):ParticleSystem|undefined {
    const existing=this.layers.get(spec.id);
    if(existing||this.disposed)return existing?.system;
    try{
      const system=new ParticleSystem('weather-rain-'+spec.id,spec.capacity,this.scene);
      system.particleTexture=new Texture(spec.haze?RAIN_HAZE_TEXTURE:RAIN_STREAK_TEXTURE,this.scene);
      if(!spec.haze){
        // Banco de variações, não animação: cada gota congela numa das dezesseis células.
        system.isAnimationSheetEnabled=true;
        system.spriteCellWidth=ATLAS_CELL;system.spriteCellHeight=ATLAS_CELL;
        system.startSpriteCellID=0;system.endSpriteCellID=ATLAS_LAST_CELL;
        system.spriteCellChangeSpeed=0;system.spriteRandomStartCell=true;
      }
      system.emitter=Vector3.Zero();
      system.minEmitBox=new Vector3(-spec.radius,spec.bottom,-spec.radius);
      system.maxEmitBox=new Vector3(spec.radius,spec.top,spec.radius);
      system.minSize=spec.minSize;system.maxSize=spec.maxSize;
      system.minLifeTime=spec.minLife;system.maxLifeTime=spec.maxLife;
      system.emitRate=0;
      system.gravity=new Vector3(0,-spec.fall*.45,0);
      system.minEmitPower=spec.fall*.55;system.maxEmitPower=spec.fall*.8;
      system.blendMode=ParticleSystem.BLENDMODE_STANDARD;
      // Esticado ao longo da velocidade: é o vento que inclina o rastro, não um ângulo fixo.
      if(spec.stretched)system.billboardMode=ParticleSystem.BILLBOARDMODE_STRETCHED;
      else{system.billboardMode=ParticleSystem.BILLBOARDMODE_Y;}
      system.isBillboardBased=true;
      system.start();
      this.layers.set(spec.id,{spec,system});
      return system;
    }catch(error){console.warn('Camada de chuva indisponível: '+spec.id,error);return undefined;}
  }

  /**
   * Respingos. Cartão deitado no chão (`isBillboardBased=false` com direção para cima), posicionado
   * um a um pela fila que o amostrador produz — nunca no emissor genérico.
   */
  private ensureSplash():ParticleSystem|undefined {
    if(this.splash||this.disposed)return this.splash;
    try{
      const system=new ParticleSystem('weather-splash',SPLASH_CAPACITY,this.scene);
      system.particleTexture=new Texture(RAIN_SPLASH_TEXTURE,this.scene);
      system.isAnimationSheetEnabled=true;
      system.spriteCellWidth=ATLAS_CELL;system.spriteCellHeight=ATLAS_CELL;
      system.startSpriteCellID=0;system.endSpriteCellID=ATLAS_LAST_CELL;
      system.spriteCellChangeSpeed=SPLASH_FLIPBOOK_FPS;system.spriteCellLoop=false;
      system.spriteRandomStartCell=false;
      system.emitter=Vector3.Zero();
      system.minSize=.28;system.maxSize=.52;
      system.minLifeTime=.34;system.maxLifeTime=.46;
      system.emitRate=0;system.manualEmitCount=0;
      system.gravity=Vector3.Zero();
      system.minEmitPower=0;system.maxEmitPower=0;
      system.color1=new Color3(.86,.92,1).toColor4(.55);
      system.color2=new Color3(.7,.82,.94).toColor4(.4);
      system.colorDead=new Color3(.62,.74,.88).toColor4(0);
      system.blendMode=ParticleSystem.BLENDMODE_STANDARD;
      // Deitado no chão: sem billboard, com a normal apontando para cima.
      system.isBillboardBased=false;
      system.direction1=new Vector3(0,1,0);system.direction2=new Vector3(0,1,0);
      const queue=this.pendingSplashes;
      system.startPositionFunction=(_world,position)=>{
        const placement=queue.shift();
        if(placement)position.copyFromFloats(placement.x,placement.y+.02,placement.z);
        else position.setAll(0);
      };
      system.start();
      this.splash=system;
    }catch(error){console.warn('Respingo indisponível',error);}
    return this.splash;
  }

  /** Poeira/pólen das fases secas: sobe devagar, some na chuva. */
  private ensureMotes():ParticleSystem|undefined {
    if(this.motes||this.disposed)return this.motes;
    try{
      const system=new ParticleSystem('weather-motes',MOTE_CAPACITY,this.scene);
      system.particleTexture=new Texture(MOTE_TEXTURE,this.scene);
      system.emitter=Vector3.Zero();
      system.minEmitBox=new Vector3(-RAIN_RADIUS,0,-RAIN_RADIUS);
      system.maxEmitBox=new Vector3(RAIN_RADIUS,7,RAIN_RADIUS);
      system.color1=new Color3(1,.94,.76).toColor4(.26);
      system.color2=new Color3(.86,.9,.7).toColor4(.16);
      system.colorDead=new Color3(.8,.82,.7).toColor4(0);
      system.minSize=.04;system.maxSize=.11;
      system.minLifeTime=3.5;system.maxLifeTime=7;
      system.emitRate=0;
      system.gravity=new Vector3(0,.25,0);
      system.direction1=new Vector3(-.35,.12,-.35);
      system.direction2=new Vector3(.35,.4,.35);
      system.minEmitPower=.12;system.maxEmitPower=.5;
      system.blendMode=ParticleSystem.BLENDMODE_ADD;
      system.start();
      this.motes=system;
    }catch(error){console.warn('Poeira ambiente indisponível',error);}
    return this.motes;
  }

  // ---------------------------------------------------------------- umidade do chão
  /**
   * Captura os materiais de chão uma vez a cada poucos segundos (regiões entram por streaming) e
   * guarda os valores ORIGINAIS antes de molhar qualquer coisa.
   *
   * O registro sai pelo `onDisposeObservable` do próprio material: a verificação antiga lia
   * `_wasDisposed`, que não existe no `Material` do Babylon instalado, e este `Map` forte retinha
   * os materiais de toda região descartada pelo streaming.
   */
  private captureGround(dt:number):void {
    this.materialScan-=dt;
    if(this.materialScan>0)return;
    this.materialScan=4;
    for(const material of this.scene.materials){
      if(!(material instanceof PBRMaterial)||this.tracked.has(material))continue;
      if(!WET_MATERIAL_PATTERN.test(material.name))continue;
      const observer=material.onDisposeObservable.add(()=>{this.tracked.delete(material);this.wet.forget(material.name);});
      const specular=(material as PBRMaterial&{metallicF0Factor?:number}).metallicF0Factor;
      this.tracked.set(material,{material,roughness:material.roughness??.8,albedo:material.albedoColor.clone(),
        specular:typeof specular==='number'?specular:undefined,
        forget:()=>{if(observer)material.onDisposeObservable.remove(observer);}});
      this.wet.track(material.name);
    }
  }

  /**
   * Molhar = mais liso, mais escuro e um pouco mais especular, sempre calculado a partir do valor
   * ORIGINAL e com a umidade PRÓPRIA daquele material. Nada de substituir material, nada de passe
   * extra: o plugin estocástico do terreno e o fluxo PBR continuam exatamente como estavam.
   */
  private applyWetness():void {
    for(const record of this.tracked.values()){
      const material=record.material;
      const wetness=this.wet.wetnessOf(material.name);
      material.roughness=record.roughness*(1-WET_ROUGHNESS_DROP*wetness);
      material.albedoColor.copyFrom(record.albedo).scaleInPlace(1-WET_ALBEDO_DROP*wetness);
      if(record.specular!==undefined){
        (material as PBRMaterial&{metallicF0Factor:number}).metallicF0Factor=
          Math.min(1,record.specular*(1+WET_SPECULAR_GAIN*wetness));
      }
    }
  }

  // ---------------------------------------------------------------- laço
  /** `viewer` é a câmera: as caixas de chuva e poeira viajam com ela. */
  update(cycle:WeatherCycle,viewer:Vec3,dt=0):void {
    if(this.disposed)return;
    const step=Number.isFinite(dt)&&dt>0?Math.min(dt,.25):0;
    this.clock+=step;
    this.captureGround(step);
    this.apply(cycle.sample(),viewer,step);
  }

  apply(state:WeatherStop,viewer:Vec3,dt=0):void {
    if(this.disposed)return;
    const step=Number.isFinite(dt)&&dt>0?Math.min(dt,.25):0;
    if(this.sun){
      this.sun.diffuse=new Color3(...state.sun);
      this.sun.intensity=state.sunIntensity;
    }
    if(this.fill){
      this.fill.diffuse=new Color3(...state.fill);
      // Contraste real das fases escuras: o preenchimento SOBE, então os inimigos continuam
      // separados do fundo em vez de sumirem junto com o sol.
      this.fill.intensity=state.fillIntensity*state.readability;
    }
    this.scene.fogColor=new Color3(...state.fog);
    this.scene.fogStart=state.fogStart;
    this.scene.fogEnd=state.fogEnd;
    if(this.pipeline?.imageProcessing)this.pipeline.imageProcessing.exposure=state.exposure;
    // O céu tem shader próprio; sem isto choveria sob panorama azul fixo.
    applySkyWeather(this.scene,{tint:new Color3(...state.skyTint),coverage:state.skyCoverage,night:state.skyNight});
    // Reflexo ambiente acompanha a escuridão; o realce de contraste fica na luz de preenchimento.
    this.scene.environmentIntensity=.85*(1-.55*state.skyNight);

    // Umidade com histerese: sobe em segundos, seca em minutos, varia por material.
    this.wet.update(step,state.wetness);
    this.applyWetness();

    this.updateRain(state,viewer,step);

    const motes=state.motes>.02?this.ensureMotes():this.motes;
    if(motes){
      motes.emitter=new Vector3(viewer.x,viewer.y,viewer.z);
      motes.emitRate=Math.round(MOTE_CAPACITY*.5*state.motes*(1-state.rain));
    }
    // Avisa o áudio só quando a intensidade muda de verdade, não a cada quadro.
    const cue=Math.round(state.rain*10)/10;
    if(cue!==this.lastRainCue){this.lastRainCue=cue;this.onRain?.(cue);}
  }

  private updateRain(state:WeatherStop,viewer:Vec3,dt:number):void {
    this.wind=rainWind(this.clock,state.rain);
    // Sob cobertura a chuva de perto cessa, e com ela o respingo.
    const placements=this.surfaces.update(dt,viewer,state.rain,this.world);
    const exposure=this.surfaces.viewerCovered?0:1;

    for(const spec of RAIN_LAYERS){
      const intensity=layerIntensity(spec,state.rain)*(spec.id==='far'?1:exposure);
      const system=intensity>.01?this.ensureLayer(spec):this.layers.get(spec.id)?.system;
      if(!system)continue;
      system.emitter=new Vector3(viewer.x,viewer.y,viewer.z);
      system.emitRate=Math.round(spec.emitRate*intensity);
      // Vento coerente: a mesma direção nas três camadas, com a fração de cada uma.
      const drift=windDrift(this.wind,spec.windFactor);
      const spread=spec.haze?.35:.12;
      system.direction1=new Vector3(drift.x-spread*spec.fall,-spec.fall,drift.z-spread*spec.fall);
      system.direction2=new Vector3(drift.x+spread*spec.fall,-spec.fall,drift.z+spread*spec.fall);
      const alpha=spec.alpha*intensity;
      system.color1=new Color3(.78,.86,.95).toColor4(alpha);
      system.color2=new Color3(.58,.7,.84).toColor4(alpha*.72);
      system.colorDead=new Color3(.5,.62,.76).toColor4(0);
    }

    if(!placements.length&&!this.splash)return;
    const splash=this.ensureSplash();
    if(!splash)return;
    splash.emitter=new Vector3(viewer.x,viewer.y,viewer.z);
    // A fila é consumida pelo `startPositionFunction`; o que sobrar é descartado no quadro seguinte.
    this.pendingSplashes.length=0;
    this.pendingSplashes.push(...placements.slice(0,SPLASH_CAPACITY));
    splash.manualEmitCount=this.pendingSplashes.length;
  }

  dispose():void {
    this.disposed=true;
    // Devolve os materiais de chão exatamente como estavam antes do clima e solta os observadores.
    for(const record of this.tracked.values()){
      record.forget();
      record.material.roughness=record.roughness;
      record.material.albedoColor.copyFrom(record.albedo);
      if(record.specular!==undefined)(record.material as PBRMaterial&{metallicF0Factor:number}).metallicF0Factor=record.specular;
    }
    this.tracked.clear();this.wet.clear();this.surfaces.reset();this.pendingSplashes.length=0;
    for(const {system} of this.layers.values()){system.stop();system.dispose();}
    this.layers.clear();
    this.splash?.stop();this.splash?.dispose();this.splash=undefined;
    this.motes?.stop();this.motes?.dispose();this.motes=undefined;
    // O laço de chuva não pode continuar tocando depois que a apresentação sai de cena.
    this.onRain?.(0);this.onRain=undefined;this.lastRainCue=-1;
    this.world=undefined;
    this.sun=undefined;this.fill=undefined;this.pipeline=undefined;
  }
}
