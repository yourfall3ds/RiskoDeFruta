import {waveRewardSite,sitesAsFields,surfaceRewardGround} from './WaveRewardSite';
import {resolveRewardPlacement,type RewardSource} from './RewardAnchor';
import type {Vec3} from '../core/contracts';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import {quaternionFromBasis} from '../physics/SurfaceFrame';
import type {WorldSite} from '../world/GameWorld';
import {RadialProps} from '../physics/RadialProps';
import {RunRNG} from '../core/RunRNG';
import {DistrictContracts} from './DistrictContracts';
import {barnChestColliders,cityChestColliders,frontierChestColliders,highlandChestColliders,rootwoodChestColliders} from '../world/ExplorationSites';
import type {BoxCollider} from '../physics/CollisionWorld';
import {LootDrops} from './LootDrops';
import type {CollisionWorld} from '../physics/CollisionWorld';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import {Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { PlayerMotor } from '../player/PlayerMotor';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/contracts';
import type { RandomStream } from '../core/RunRNG';
import { type ItemDefinition,type RunProgression } from './RunProgression';
import {BASE_COST,HOME_CHESTS,SITE_CHESTS,chestName,chestPrice as priceOf} from './ChestCatalog';
import type {PurchaseChannel} from './RunEconomy';

export interface Interactable {id:string;name:string;kind:'supply'|'shop'|'altar';x:number;z:number;y:number;cost:number;used:boolean;loot?:ItemDefinition;ejected?:boolean;root?:TransformNode;openClips?:AnimationGroup[];opening?:number;
  /** Quantas vezes ESTE interativo já foi comprado. Só o altar passa de 1 — ver `chestPrice`. */
  uses?:number;
  /** Vertical LOCAL do baú. Ausente no mundo plano, onde ela é sempre `+Y`. */
  up?:Vec3;
  /** Sítio que hospeda o baú, quando ele veio de colocação por mapa. */
  siteId?:string}

/**
 * De onde sai a colocação de baús quando o mapa não é a fazenda autoral.
 *
 * `surface` é uma FUNÇÃO de propósito: `configurePlanet` troca o `surface` do `CollisionWorld`
 * depois que o mapa carrega, e guardar o `FlatSurface` inicial num campo congelaria a colocação no
 * plano. Ausente ⇒ leio `world.surface`, que já é um getter.
 */
export interface LootPlacementSource {
  spawn?:Vec3;
  readonly sites:readonly WorldSite[];
  surface?():SurfaceFrame;
  /** Mesma semente ⇒ mesmo mapa de baús. Default: hash dos ids dos sítios. */
  readonly seed?:string|number;
  /** Âncoras autorais preferidas — celeiros, varandas, plataformas. */
  readonly structures?:readonly {readonly id:string;readonly position:Vec3;readonly up?:Vec3}[];
}

// Catálogo, preço e nome moram em `ChestCatalog` desde o bloco F: o servidor cobra pela MESMA
// fórmula e valida a MESMA lista. Reexportados aqui porque a curva e o HUD sempre os leram deste
// módulo — mudar o caminho de importação de meia dúzia de arquivos não acrescentaria autoridade.
export {CHEST_PRICE_GROWTH,CHEST_PRICE_STAGE_STEP,CHEST_PRICE_CAP,ALTAR_REUSE_GROWTH,chestPrice} from './ChestCatalog';
const nameOf=chestName;
export class RunInteractables {
  readonly entries:Interactable[]=[];nearest:Interactable|undefined;message='';messageTime=0;ready=false;error='';private disposed=false;private rewardRetry=0;
  /** Compras já feitas NESTA fase. É o expoente do preço progressivo — ver `chestPrice`. */
  opened=0;
  /** Preço que o PRÓXIMO baú comum vai cobrar. Diagnóstico e HUD. */
  get nextSupplyCost():number {return priceOf('supply',this.run.stage,this.opened);}
  /** Repõe o preço de tudo o que ainda não foi comprado. Idempotente. */
  private reprice():void {
    for(const entry of this.entries)entry.cost=priceOf(entry.kind,this.run.stage,this.opened,entry.uses??0);
  }
  private readonly rift:TransformNode;private riftLight:PointLight;private time=0;
  readonly drops:LootDrops;
  readonly contracts=new DistrictContracts();
  get districtContract(){return this.contracts.nearest(this.player.position);}
  get waveRewardGuide(){
    const radial=this.radial,p=this.player.position;
    const span=(landing:{x:number;y:number;z:number}):number=>
      radial?radial.planarDistance(p,landing):Math.hypot(landing.x-p.x,landing.z-p.z);
    const drop=this.drops.active.filter(d=>d.waveField).sort((a,b)=>span(a.landing)-span(b.landing))[0];
    return drop?{drop,distance:span(drop.landing)}:undefined;
  }
  get nearestLoot(){return this.drops.nearest(this.player.position);}
  private readonly extraColliders:BoxCollider[]=[];
  /** Quantos baús são do sítio inicial autoral — nunca são substituídos pela colocação de mapa. */
  private homeCount=0;
  private placement:LootPlacementSource|undefined;
  private placementKey='';
  /**
   * Corpos sólidos dos baús no mundo radial. Vazio no mundo plano, onde quem responde continua
   * sendo `world.movingBoxes`. Entregue à integração por `withProps(collision.surface, props)` —
   * ver `.temp/real-game-loot-api.md` §7.
   */
  readonly props=new RadialProps();
  private container:AssetContainer|undefined;
  private altarContainer:AssetContainer|undefined;
  private portal:ShaderMaterial;
  private offering:StandardMaterial|undefined;
  private readonly scene:Scene;
  constructor(scene:Scene,private readonly player:PlayerMotor,private readonly run:RunProgression,private readonly events:EventBus<GameEvents>,private readonly rng:RandomStream,private readonly world:CollisionWorld){
    this.scene=scene;this.drops=new LootDrops(scene,world);
    // A lista é a do `ChestCatalog` — a MESMA que o servidor valida em `ChestEconomy`.
    for(const spec of HOME_CHESTS)this.entries.push({...spec,name:nameOf(spec.kind),cost:BASE_COST[spec.kind],used:false});
    this.homeCount=this.entries.length;
    for(const spec of SITE_CHESTS)this.entries.push({...spec,name:nameOf(spec.kind),cost:BASE_COST[spec.kind],used:false});
    this.extraColliders.push(...cityChestColliders(),...frontierChestColliders(),...highlandChestColliders(),...rootwoodChestColliders(),...barnChestColliders());world.movingBoxes.push(...this.extraColliders);
    this.rift=new TransformNode('stage-wormhole',scene);this.rift.position.set(0,7.6,33);const material=new StandardMaterial('rift-energy',scene);material.emissiveColor=new Color3(.34,.07,1);material.disableLighting=true;
    for(let i=0;i<4;i++){const ring=CreateTorus('wormhole-ring',{diameter:4+i*.13,thickness:.065,tessellation:80},scene);ring.parent=this.rift;ring.rotation.x=Math.PI/2+i*.08;ring.material=material;ring.isPickable=false;}
    this.portal=new ShaderMaterial('wormhole-depth',scene,{vertexSource:'precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 worldViewProjection;varying vec2 vUV;void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}',fragmentSource:'precision highp float;varying vec2 vUV;uniform sampler2D cosmos;uniform float time;void main(){vec2 p=(vUV-.5)*2.;float r=length(p);float a=atan(p.y,p.x)+time*.15-r*5.;vec2 q=vec2(.36,.27)+vec2(cos(a),sin(a))*(.04+r*.1);vec3 c=texture2D(cosmos,q).rgb;float rim=pow(r,6.);c=c*vec3(.28,.18,.5)+vec3(.18,.015,.45)*rim;gl_FragColor=vec4(c,1.-smoothstep(.95,1.,r));}'},{attributes:['position','uv'],uniforms:['worldViewProjection','time'],samplers:['cosmos'],needAlphaBlending:true});this.portal.backFaceCulling=false;this.portal.setTexture('cosmos',new Texture('/environment/cosmic-sky-v3.png',scene));
    const depth=CreateDisc('wormhole-inner-depth',{radius:2.13,tessellation:80},scene);depth.parent=this.rift;depth.material=this.portal;depth.isPickable=false;
    this.riftLight=new PointLight('wormhole-light',this.rift.position.clone(),scene);this.riftLight.diffuse=new Color3(.53,.19,1);this.riftLight.range=12;this.riftLight.intensity=0;this.rift.setEnabled(false);
  }
  /** Referencial CORRENTE — nunca guardado, porque `configurePlanet` o troca depois do load. */
  private get surface():SurfaceFrame {return this.placement?.surface?.()??this.world.surface;}
  /** Referencial radial, ou `undefined` enquanto o mundo for plano. */
  private get radial():SurfaceFrame|undefined {const s=this.surface;return s.kind==='sphere'?s:undefined;}

  /**
   * Liga a colocação de baús por MAPA. Chamar depois de `world.load()` — antes disso os sítios não
   * existem e o referencial ainda é plano.
   *
   * Idempotente: mesma semente e mesmos sítios devolvem exatamente as mesmas posições, e baús já
   * abertos continuam abertos. Passar `undefined` volta à colocação autoral da fazenda.
   */
  configurePlacement(source:LootPlacementSource|undefined):void {
    const key=source?`${source.seed??''}|${source.sites.map(s=>s.id).join(',')}|${source.spawn?`${source.spawn.x},${source.spawn.y},${source.spawn.z}`:''}`:'';
    if(key===this.placementKey)return;
    this.placement=source;this.placementKey=key;
    if(!source){this.contracts.configureSource(undefined);return;}
    // As caixas de colisão dos baús da fazenda são coordenadas planas: no planeta elas virariam
    // paredes invisíveis no meio do nada. As do planeta são OBB radiais, em `props`.
    this.detachColliders();
    this.props.clear();
    const placed=this.placeOnSites(source);
    for(const entry of this.entries.slice(this.homeCount))entry.root?.dispose();
    this.entries.length=this.homeCount;
    this.entries.push(...placed);
    // Os seis interativos autorais NÃO podem ficar nas coordenadas planas: ali, no planeta, não há
    // chão nenhum — seriam fantasmas inalcançáveis. Eles são realocados preservando id, tipo,
    // custo e o estado de usado.
    this.relocateHome(source);
    // Os baús do mapa nascem com o preço da fase E do que já foi comprado nela.
    this.reprice();
    if(this.ready)this.buildRoots();
    this.rebuildProps();
    this.contracts.configureSource({
      districts:source.sites.map(site=>({id:site.id,name:site.name,prefix:`${site.id}-`,x:site.centre.x,y:site.centre.y,z:site.centre.z})),
      chests:()=>this.entries.filter(e=>e.siteId!==undefined&&e.kind!=='altar'),
      planarDistance:(a,b)=>this.surface.planarDistance(a,b),
    });
  }

  /**
   * Leva os seis interativos do sítio inicial para o mapa corrente.
   *
   * Eles são a base da corrida (duas caixas, dois baús, um altar e mais uma caixa) e não podem
   * simplesmente sumir nem ficar onde o jogador nunca chega. Cada um vai para o deck do PRIMEIRO
   * sítio, em anel, mantendo `id`, `kind`, `cost`, `used` e o item já sorteado.
   */
  private relocateHome(source:LootPlacementSource):void {
    const surface=source.surface?.()??this.world.surface;
    if(surface.kind!=='sphere'||source.sites.length===0)return;
    const home=source.spawn?source.sites.reduce((a,b)=>surface.planarDistance(a.centre,source.spawn!)<surface.planarDistance(b.centre,source.spawn!)?a:b):source.sites[0];if(!home)return;
    const rng=new RunRNG(`${String(source.seed??'')}-home`).stream('interactable');
    for(let index=0;index<this.homeCount;index++){
      const entry=this.entries[index]!;
      // Separação contra TUDO que já ocupa a ilha — os baús do mapa e os interativos de casa já
      // realocados. Comparar só com os anteriores da lista deixava um par a 2,5 m de distância.
      const taken=this.entries.filter((e,i)=>i!==index&&e.siteId!==undefined);
      const point=this.sampleDeck(surface,source.spawn?{...home,centre:source.spawn,radius:16}:home,rng,taken)
        ??surfaceRewardGround(surface,home.centre,2,6);
      if(!point)continue;
      entry.x=point.x;entry.y=point.y;entry.z=point.z;entry.up=surface.up(point);entry.siteId=home.id;
      // A malha já existente é reposicionada: trocar de mapa não recarrega asset nem perde a tampa
      // aberta de um baú que o jogador já comprou.
      if(entry.root){entry.root.position.set(point.x,point.y,point.z);entry.root.rotationQuaternion=chestRotation(entry.up);}
    }
  }

  /**
   * Corpos sólidos dos baús no mundo radial.
   *
   * Uma malha do Babylon não colide com nada, e a BVH do planeta é assada sobre o manifesto — ela
   * não contém nada criado em tempo de execução. Sem isto o baú seria desenhado e atravessado.
   */
  private rebuildProps():void {
    this.props.clear();
    for(const entry of this.entries){
      if(!entry.up)continue;
      // Meias-medidas do colisor, casadas com a MALHA de cada um. O altar cresceu quando o barril
      // virou obelisco (1,90 × 1,36 × 1,89 m): mantido o colisor antigo de 1,2 m, o jogador
      // atravessaria as bordas do modelo — corpo visível sem corpo sólido é o pior dos dois mundos.
      const half=entry.kind==='altar'?{x:.95,y:.68,z:.95}:{x:.53,y:.34,z:.43};
      const basis=this.surface.basis({x:entry.x,y:entry.y,z:entry.z},{x:0,y:0,z:1});
      this.props.add({
        id:`chest-body-${entry.id}`,
        centre:{x:entry.x+entry.up.x*half.y,y:entry.y+entry.up.y*half.y,z:entry.z+entry.up.z*half.y},
        right:basis.right,up:entry.up,forward:basis.forward,half,
      });
    }
  }

  /**
   * Sorteio determinístico nos decks reais.
   *
   * Cada sítio recebe `clamp(round(radius/18), 1, 4)` baús, então a variação de quantidade vem do
   * mapa e não de um número mágico. A posição sai de um anel tangente sorteado dentro de 75 % da
   * pegada caminhável, e só é aceita com apoio real e folga em volta — o mesmo critério da
   * recompensa de onda. Quando o mapa oferece âncoras autorais (celeiro, varanda), a primeira
   * tentativa de cada sítio é uma delas.
   */
  private placeOnSites(source:LootPlacementSource):Interactable[] {
    const surface=source.surface?.()??this.world.surface;
    const seed=source.seed??source.sites.map(s=>s.id).join('/');
    // Fluxo PRÓPRIO, a partir de uma semente própria: a colocação não pode consumir o RNG de
    // jogo, senão ligar o planeta mudaria o item que cada baú sorteia.
    const rng=new RunRNG(String(seed)).stream('interactable');
    const placed:Interactable[]=[];
    for(const site of source.sites){
      const anchors=(source.structures??[]).filter(s=>surface.planarDistance(s.position,site.centre)<=site.radius);
      const wanted=Math.max(1,Math.min(4,Math.round(site.radius/18)));
      for(let index=0;index<wanted;index++){
        // Um baú por sítio é altar quando a ilha comporta mais de dois — risco fica onde há espaço.
        const kind:Interactable['kind']=wanted>2&&index===wanted-1?'altar':index%2===0?'supply':'shop';
        const anchor=anchors[index];
        const point=anchor
          ?this.settle(surface,anchor.position)
          :this.sampleDeck(surface,site,rng,placed);
        if(!point)continue;
        placed.push({
          id:`${site.id}-${kind}-${index}`,name:nameOf(kind),kind,
          x:point.x,y:point.y,z:point.z,cost:BASE_COST[kind],used:false,
          up:surface.up(point),siteId:site.id,
        });
      }
    }
    return placed;
  }

  /** Apoio real sob uma âncora autoral; sem apoio o baú não nasce (melhor faltar que flutuar). */
  private settle(surface:SurfaceFrame,anchor:Vec3):Vec3|undefined {
    return surfaceRewardGround(surface,anchor,1,6);
  }

  /** Anel tangente sorteado no deck, com separação mínima entre baús do mesmo sítio. */
  private sampleDeck(surface:SurfaceFrame,site:WorldSite,rng:RandomStream,placed:readonly Interactable[]):Vec3|undefined {
    const reach=site.radius*.75;
    for(let attempt=0;attempt<80;attempt++){
      const angle=rng.range(0,Math.PI*2);
      // Raiz da uniforme: sem ela o sorteio empilha os baús no centro da ilha.
      const radius=reach*Math.sqrt(rng.next());
      const basis=surface.basis(site.centre,{x:Math.sin(angle),y:0,z:Math.cos(angle)});
      const probe=surface.walk(site.centre,{
        x:(basis.right.x*Math.sin(angle)+basis.forward.x*Math.cos(angle))*radius,
        y:(basis.right.y*Math.sin(angle)+basis.forward.y*Math.cos(angle))*radius,
        z:(basis.right.z*Math.sin(angle)+basis.forward.z*Math.cos(angle))*radius});
      const ground=surfaceRewardGround(surface,probe,1,6);
      if(!ground)continue;
      if(this.placement?.spawn&&surface.planarDistance(ground,this.placement.spawn)<3.5)continue;
      if(placed.some(e=>e.siteId===site.id&&surface.planarDistance(ground,{x:e.x,y:e.y,z:e.z})<6))continue;
      return ground;
    }
    return undefined;
  }

  private detachColliders():void {
    for(const box of this.extraColliders){const index=this.world.movingBoxes.indexOf(box);if(index>=0)this.world.movingBoxes.splice(index,1);}
    this.extraColliders.length=0;
  }

  /** Distância CAMINHANDO até um interativo, e a diferença de altura na vertical local. */
  private reach(entry:Interactable):{planar:number;height:number} {
    const radial=this.radial,p=this.player.position,q={x:entry.x,y:entry.y,z:entry.z};
    if(!radial)return {planar:Math.hypot(entry.x-p.x,entry.z-p.z),height:Math.abs(entry.y-p.y)};
    return {planar:radial.planarDistance(p,q),height:Math.abs(radial.heightGap(p,q))};
  }

  async load(scene:Scene):Promise<void>{try{
    const crate=await LoadAssetContainerAsync('/models/interactive-chest.glb',scene);if(this.disposed){crate.dispose();return;}this.container=crate;
    /**
     * O altar tem CORPO próprio.
     *
     * Antes ele instanciava `farm-barrels.glb`, que contém um único nó — um barril de madeira. O
     * interativo que cobra a oferta e sobe de preço aparecia como um barril igual aos de cenário,
     * ou como nada, e o jogador não tinha como saber o que estava pagando. O obelisco de runas é
     * a silhueta que diz "isto é um altar" à distância.
     */
    const altar=await LoadAssetContainerAsync('/models/altar-rune-prism.glb',scene);if(this.disposed){altar.dispose();return;}this.altarContainer=altar;
    this.offering=new StandardMaterial('offering-energy',scene);this.offering.emissiveColor=new Color3(.44,.08,.75);this.offering.disableLighting=true;
    this.buildRoots();this.ready=true;
  }catch(error){this.error=String(error);}}
  /**
   * Monta (ou remonta) a malha de cada baú. Separado do `load` porque a colocação por mapa chega
   * DEPOIS do carregamento do GLB: trocar o mapa não pode exigir recarregar o asset.
   */
  private buildRoots():void {
    const scene=this.scene,crate=this.container,altar=this.altarContainer;
    if(!crate||!altar)return;
    for(const material of [...crate.materials,...altar.materials]){
      const lit=material as typeof material & {maxSimultaneousLights?:number};
      if(lit.maxSimultaneousLights!==undefined){lit.unfreeze();lit.maxSimultaneousLights=4;}
    }
    for(const entry of this.entries){
      if(entry.root)continue;
      const root=new TransformNode(entry.id,scene);entry.openClips=[];entry.opening=0;
      root.position.set(entry.x,entry.y,entry.z);
      // Num mundo curvo o baú fica de pé na vertical da ILHA; no plano segue com a pose de sempre.
      if(entry.up)root.rotationQuaternion=chestRotation(entry.up);
      for(let i=0;i<1;i++){const instance=(entry.kind==='altar'?altar:crate).instantiateModelsToScene(n=>`${entry.id}-${i}-${n}`,false);for(const clip of instance.animationGroups){clip.stop();entry.openClips.push(clip);}for(const child of instance.rootNodes){child.parent=root;}}
      if(entry.kind==='altar'&&this.offering){const halo=CreateTorus('altar-offering',{diameter:1.45,thickness:.035,tessellation:36},scene);halo.parent=root;halo.position.y=1.55;halo.material=this.offering;}
      entry.root=root;for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.receiveShadows=true;}
    }
  }
  private lid(entry:Interactable,progress:number):void{for(const clip of entry.openClips??[])for(const track of clip.targetedAnimations){const value=track.animation.evaluate(clip.from+(clip.to-clip.from)*progress);if(value instanceof Quaternion)track.target.rotationQuaternion=value.clone();else if(value instanceof Vector3)track.target.position.copyFrom(value);}}
  update(dt:number,riftReady:boolean):void {this.rewardRetry=Math.max(0,this.rewardRetry-dt);for(const e of this.entries)if(e.used&&(e.opening??0)<1){e.opening=Math.min(1,(e.opening??0)+dt/ .8);this.lid(e,e.opening);if(e.opening>=.4&&e.loot&&!e.ejected){this.drops.eject(e.loot,{x:e.x,y:e.y,z:e.z},this.player.position);e.ejected=true;}}this.drops.update(dt);this.time+=dt;this.portal.setFloat('time',this.time);this.messageTime=Math.max(0,this.messageTime-dt);this.nearest=this.entries.filter(e=>{if(e.used)return false;const r=this.reach(e);return r.planar<3&&r.height<2;}).sort((a,b)=>this.reach(a).planar-this.reach(b).planar)[0];this.rift.setEnabled(riftReady);this.riftLight.intensity=riftReady?3:0;if(riftReady){this.rift.rotation.z=this.time*.16;this.rift.scaling.setAll(1+Math.sin(this.time*2)*.025);}}
  /**
   * A recompensa cai onde morreu o monstro que concluiu o evento; se aquele ponto não tiver piso
   * seguro (morte no ar, em beirada), escorrega para o anel seguro mais próximo. Sem abate válido
   * — evento concluído só por tempo — usa a âncora do objetivo e, por último, o campo mais próximo.
   * Nada disso exige eliminar todos os inimigos.
   */
  deliverWaveReward(rng:RandomStream,anchors:{position:Vec3|undefined;source:RewardSource}[]=[]):boolean {
    if(this.rewardRetry>0)return false;
    const radial=this.radial;
    // Mesma ordem de prioridade nos dois mundos; só a métrica do piso seguro muda.
    const placement=radial?radialPlacement(radial,anchors):resolveRewardPlacement(this.world,anchors);
    const fallback=radial
      ?waveRewardSite(this.world,this.player.position,{surface:radial,
        ...(this.placement?{fields:sitesAsFields(this.placement.sites)}:{})})
      :waveRewardSite(this.world,this.player.position);
    const site=placement?{name:placement.source==='kill'?'Onde a praga caiu':'Área do objetivo',position:placement.position}:fallback;
    if(!site){this.rewardRetry=1;return false;}
    const item=this.run.randomItem(rng);
    // Um metro "para a frente" do sítio: no plano é `+Z`; num mundo curvo é uma tangente de
    // verdade, porque `+Z` no equador aponta para dentro da casca.
    const toward=radial
      ?radial.walk(site.position,radial.basis(site.position,{x:0,y:0,z:1}).forward)
      :{x:site.position.x,y:site.position.y,z:site.position.z+1};
    this.drops.eject(item,site.position,toward).waveField=site.name;
    this.message='RECOMPENSA · '+site.name+' · recolha '+item.name+' no chão';this.messageTime=7;
    return true;
  }
  /** Fase nova (ou tentativa nova): tudo fechado e o preço progressivo de volta ao primeiro baú. */
  reset():void {this.rewardRetry=0;this.contracts.reset();this.drops.clear();this.nearest=undefined;this.messageTime=0;this.opened=0;for(const e of this.entries){e.used=false;e.opening=0;delete e.loot;e.ejected=false;e.uses=0;this.lid(e,0);}this.reprice();this.rift.setEnabled(false);}
  get atRift():boolean{return Math.hypot(this.player.position.x,this.player.position.z-33)<3&&this.player.position.y>3;}
  /**
   * Liga a COMPRA AUTORITATIVA (contrato §21.3).
   *
   * Com um canal ligado, `buy()` deixa de ser uma decisão e vira uma TENTATIVA: nenhum crédito é
   * debitado aqui, nenhum item é rolado aqui, e nem sequer se compara saldo com custo — o saldo que
   * esta tela conhece é espelho, e espelho não autoriza ação (§21.6). O servidor responde, e a
   * resposta chega por `adoptPurchase`.
   */
  attachAuthority(channel:PurchaseChannel|undefined):void {this.authority=channel;}
  private authority:PurchaseChannel|undefined;
  /** Sequência local só para identificar o pedido; não é autoridade nenhuma. */
  private requests=0;
  /** Pedidos enviados e ainda sem resposta. Diagnóstico e prova de "exatamente uma compra". */
  sentRequests=0;

  /**
   * O RESULTADO AUTORITATIVO DE UMA COMPRA, apresentado.
   *
   * Só apresentação: abre a tampa, ejeta o item que o SERVIDOR sorteou e escreve a mensagem. Nada
   * aqui recalcula preço, saldo ou sorteio — se recalculasse, seria a segunda economia.
   */
  adoptPurchase(result:{interactableId:string;ok:boolean;item?:ItemDefinition;empty?:boolean;reason?:string}):void {
    const entry=this.entries.find(e=>e.id===result.interactableId);
    if(!entry)return;
    if(!result.ok){
      this.message=result.reason==='credits'?'Créditos insuficientes':'Compra recusada';
      this.messageTime=2;return;
    }
    if(entry.kind==='altar'){
      if(result.item){this.drops.eject(result.item,{x:entry.x,y:entry.y,z:entry.z},this.player.position);this.message='O altar concedeu um item';}
      else this.message='O altar consumiu a oferta';
    } else {
      entry.used=true;entry.opening=0;entry.ejected=false;
      if(result.item)entry.loot=result.item;else delete entry.loot;
      this.message='Baú aberto · recolha o item quando cair';
    }
    entry.uses=(entry.uses??0)+1;
    this.messageTime=3;
  }

  buy(_option=0):boolean {
    const collected=this.drops.take(this.player.position);
    if(collected){this.run.addItem(collected.id);this.message=collected.name+' recolhido';this.messageTime=3;return true;}
    const entry=this.nearest;
    if(!entry||entry.used)return false;
    const range=this.reach(entry);if(range.planar>=3||range.height>=2)return false;
    // COM AUTORIDADE: só a tentativa sai daqui. Sem comparar saldo, sem debitar, sem rolar item.
    if(this.authority){this.authority.request(entry.id,`buy:${++this.requests}`);this.sentRequests++;return true;}
    if(this.run.credits<entry.cost){this.message='Créditos insuficientes';this.messageTime=2;return false;}
    this.run.credits-=entry.cost;
    // Cada compra encarece as seguintes: é o que transforma "abra todos" numa escolha.
    this.opened++;entry.uses=(entry.uses??0)+1;
    if(entry.kind==='altar'){if(this.rng.next()<.58){const item=this.run.randomItem(this.rng);this.drops.eject(item,{x:entry.x,y:entry.y,z:entry.z},this.player.position);this.message='O altar concedeu um item';}else this.message='O altar consumiu a oferta';}
    else{entry.used=true;entry.opening=0;entry.ejected=false;entry.loot=this.run.randomItem(this.rng);this.message='Baú aberto · recolha o item quando cair';}
    this.reprice();
    if(entry.kind!=='altar'){const contract=this.contracts.recordOpened(entry.id);if(contract){const reward=this.run.randomItem(this.rng);
      // Espelho do jogador através do baú: o bônus cai do lado oposto. Num mundo curvo o espelho
      // precisa da componente vertical também, senão ele mira para dentro da casca.
      const away=this.radial
        ?{x:2*entry.x-this.player.position.x,y:2*entry.y-this.player.position.y,z:2*entry.z-this.player.position.z}
        :{x:2*entry.x-this.player.position.x,y:entry.y,z:2*entry.z-this.player.position.z};
      this.drops.eject(reward,{x:entry.x,y:entry.y,z:entry.z},away);this.message=contract.name+' · contrato concluído! Recolha o item bônus no chão';}}
    this.events.emit('InteractableUsed',{entityId:1,interactableId:entry.id});this.messageTime=3;return true;
  }
  dispose():void {this.disposed=true;this.detachColliders();this.drops.dispose();for(const e of this.entries)e.root?.dispose();this.container?.dispose();this.altarContainer?.dispose();this.rift.dispose();this.riftLight.dispose();}
}

/** Pose de raiz do baú sobre uma vertical local qualquer. */
function chestRotation(up:Vec3):Quaternion {
  const seed=Math.abs(up.y)<.9?{x:0,y:1,z:0}:{x:0,y:0,z:1};
  const rightRaw=cross(seed,up),length=Math.hypot(rightRaw.x,rightRaw.y,rightRaw.z)||1;
  const right={x:rightRaw.x/length,y:rightRaw.y/length,z:rightRaw.z/length};
  const forward=cross(up,right);
  const q=quaternionFromBasis(cross(up,forward),up,forward);
  return new Quaternion(q.x,q.y,q.z,q.w);
}
const cross=(a:Vec3,b:Vec3):Vec3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});

/**
 * A mesma cascata de `resolveRewardPlacement`, medida no referencial local.
 *
 * `RewardAnchor` é de outro dono e continua intocado; o que existe aqui é a versão radial da MESMA
 * regra — primeiro candidato com piso seguro em volta vence, na ordem recebida.
 */
function radialPlacement(surface:SurfaceFrame,candidates:readonly {position:Vec3|undefined;source:RewardSource}[]):{position:Vec3;source:RewardSource}|undefined {
  for(const candidate of candidates){
    if(!candidate.position)continue;
    const ground=surfaceRewardGround(surface,candidate.position,4,14);
    if(ground)return {position:ground,source:candidate.source};
  }
  return undefined;
}





