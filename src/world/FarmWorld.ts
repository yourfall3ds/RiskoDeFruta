import {NearbyShadowCasters} from '../rendering/NearbyShadowCasters';
import {DistantRegions} from './streaming/DistantRegions';
import {SpatialRegionInterest,FARM_REGIONS} from './streaming/SpatialRegionInterest';
import {RegionPassages} from './streaming/RegionPassages';
import {RegionPresentation,WORLD_MATERIAL_TINT} from './streaming/RegionPresentation';
import type {Vec3} from '../core/contracts';
import {RegionResidency} from './streaming/RegionResidency';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import {DetailVisibility,type WorldDetail} from './DetailVisibility';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { applyStochasticGround } from './materials/GroundMaterials';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CollisionWorld,type BoxCollider,type GroundSurface } from '../physics/CollisionWorld';
import type { TrainingTarget } from './TrainingYard';
import {AlienWorld} from './AlienWorld';
import type {PlayerMotor} from '../player/PlayerMotor';
import { Waterfalls } from './Waterfalls';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { enableRagdollPhysics,ensureRagdollPhysics,addRagdollTerrain,activeRagdollPositions } from '../physics/RagdollWorld';
import { sculptRegion,isSculptedRegion,type SculptedRegion,type OutcropShape } from './terrain/WorldTerrain';
import { TerrainPresentation } from './terrain/TerrainPresentation';
import { FoliageWind,hasFoliageWind } from './materials/FoliageMaterials';

/**
 * Geometria da rocha escaneada usada pelos afloramentos, buscada uma única vez por sessão.
 * É o mesmo arquivo que o servidor lê do disco, então pedra visível e pedra pisável são idênticas.
 */
let outcropShape:Promise<OutcropShape|undefined>|undefined;
function loadOutcropShape():Promise<OutcropShape|undefined> {
  outcropShape??=fetch('/models/outcrop-rocks.json')
    .then(response=>response.ok?response.json() as Promise<OutcropShape>:undefined)
    .catch(()=>undefined);
  return outcropShape;
}

interface CityCollisionData {positions:number[];indices:number[];boxes:BoxCollider[];surfaces:GroundSurface[];solidPositions:number[];solidIndices:number[];walkableLinks:CollisionWorld['walkableLinks']}
interface CityResource {container:AssetContainer;data:CityCollisionData;relief:SculptedRegion|undefined;readonly hidden:number;update(dt:number,viewer:Vec3):void;activate():void;dispose():void}

/**
 * Peças que não projetam sombra. Reexportado de `NearbyShadowCasters`, que é quem aplica a regra:
 * a cópia divergente que existia aqui fazia o teste de orçamento cobrir um comportamento que o
 * runtime não tinha.
 */
export {SHADOW_EXEMPT} from '../rendering/NearbyShadowCasters';

/**
 * Alcance, em metros, dentro do qual um ragdoll ainda retém a região onde caiu.
 *
 * Fora disso o corpo continua existindo; ele só deixa de segurar a residência da região. O valor é
 * folgado o bastante para cobrir um combate inteiro em volta do jogador.
 */
export const RAGDOLL_HOLD_RANGE=70;

/** Authored Blender composition with local photogrammetry and PBR assets. */
export class FarmWorld {
  readonly targets:TrainingTarget[]=[];
  ready=false;
  error='';
  private readonly regions:RegionResidency<CityResource>;
  private readonly interest=new SpatialRegionInterest(FARM_REGIONS);
  private readonly requestedVisits=new Set<string>();
  private readonly passages:RegionPassages;
  private readonly distant:DistantRegions;
  private readonly heldRegions=new Map<string,()=>void>();
  get retainedRegions():string[]{return this.regions.retainedIds;}
  private baseCasters:NearbyShadowCasters|undefined;
  private disposed=false;private details:DetailVisibility|undefined;
  get hiddenDetails():number{return (this.details?.hidden??0)+this.regions.readyIds.reduce((n,id)=>n+(this.regions.get(id)?.hidden??0),0);}
  private waterfalls:Waterfalls|undefined;private alien:AlienWorld|undefined;
  /** Relevo esculpido do campo inicial: mesmos triângulos na colisão e na malha desenhada. */
  private relief:SculptedRegion|undefined;private terrain:TerrainPresentation|undefined;private wind:FoliageWind|undefined;
  /** Altura do relevo esculpido do campo, ou undefined fora dele. Exposto para QA e diagnóstico. */
  sculptedHeightAt(x:number,z:number):number|undefined{return this.relief?.terrain?.heightAt(x,z);}
  constructor(private readonly scene:Scene,readonly collision:CollisionWorld,private readonly shadows:ShadowGenerator,private readonly spatialStreaming=true){
    this.distant=new DistantRegions(scene);
    this.passages=new RegionPassages(scene,collision);this.passages.update(0,[]);
    this.regions=new RegionResidency(spatialStreaming?3:FARM_REGIONS.length,1,async (request,signal)=>{
      if(!FARM_REGIONS.some(region=>region.id===request.id))throw Error('Unknown world region: '+request.id);
      const response=await fetch(`/models/${request.id}-collision.json`,{signal});if(!response.ok)throw Error('Falha na colisão da cidade agrícola');
      const data=await response.json() as CityCollisionData,physics=new CollisionWorld();
      // Relevo e afloramentos entram na MALHA da região antes de qualquer índice ser construído,
      // então colisão, raios, ragdoll e a malha desenhada saem todos dos mesmos triângulos.
      const relief=isSculptedRegion(request.id)?sculptRegion(request.id,data,await loadOutcropShape()):undefined;
      signal.throwIfAborted();
      physics.boxes.push(...data.boxes);physics.surfaces.push(...data.surfaces);physics.walkableLinks.push(...data.walkableLinks);
      physics.setGeometry(data.positions,data.indices);physics.setRecoveryVolumes(data.solidPositions,data.solidIndices);await physics.prepareRaycastsAsync();
      signal.throwIfAborted();await ensureRagdollPhysics(scene);signal.throwIfAborted();
      const container=await LoadAssetContainerAsync(`/models/${request.id}.glb`,scene);let release:(()=>void)|undefined,releaseTerrain:(()=>void)|undefined,presentation:RegionPresentation|undefined,terrain:TerrainPresentation|undefined;
      return{container,data,relief,get hidden(){return presentation?.hidden??0;},update:(dt,viewer)=>presentation?.update(dt,viewer),activate:()=>{releaseTerrain=addRagdollTerrain(scene,request.id,data);release=collision.attachRegion(request.id,physics);container.addAllToScene();
       // Antes de `RegionPresentation`: é ela que congela as matrizes de mundo, e a vegetação ainda
       // precisa subir para a cota nova.
       if(relief)terrain=new TerrainPresentation(scene,relief,container.meshes);
       presentation=new RegionPresentation(scene,container.meshes,shadows,request.id);this.distant.update([...this.regions.readyIds,request.id]);},dispose:()=>{terrain?.dispose();presentation?.dispose();release?.();releaseTerrain?.();container.dispose();this.distant.update(this.regions.readyIds.filter(id=>id!==request.id));}};
    },{baseDelay:2,maxDelay:30});
  }
  async load():Promise<void> {
    try {
      await this.distant.load();if(this.disposed)return;
      const response=await fetch('/models/farm-collision.json');if(!response.ok)throw new Error('Falha no mapa de colisões');
      const data=await response.json() as {boxes:BoxCollider[];surfaces:GroundSurface[]};
      const imported=await ImportMeshAsync('/models/farm-world.glb',this.scene);
      const regionIds=this.spatialStreaming?['farm-city']:FARM_REGIONS.map(r=>r.id);this.regions.request(regionIds.map(id=>({id,cost:1})));await this.regions.settled();
      const loadedRegions=regionIds.map(id=>{const resource=this.regions.get(id);if(!resource)throw Error(this.regions.errors.find(e=>e.id===id)?.message??'Region loading cancelled: '+id);return resource;});
      const geology=await ImportMeshAsync('/models/solid-island-geology.glb',this.scene);imported.meshes.push(...geology.meshes);
      if(this.disposed){for(const mesh of imported.meshes)mesh.dispose();return;}
      for(const resource of loadedRegions)this.collision.walkableLinks.push(...resource.data.walkableLinks);this.collision.boxes.push(...data.boxes);this.collision.surfaces.push(...data.surfaces);
      const geometryResponse=await fetch('/models/world-collision-mesh.json');if(!geometryResponse.ok)throw new Error('Falha na colisão das peças do cenário');
      const geometry=await geometryResponse.json() as {positions:number[];indices:number[];boxes:BoxCollider[]};if(this.disposed)return;
      const solidResponse=await fetch('/models/solid-island-collision.json');if(!solidResponse.ok)throw Error('Falha no volume das ilhas');const solid=await solidResponse.json() as typeof geometry;const offset=geometry.positions.length/3;for(const value of solid.positions)geometry.positions.push(value);for(const index of solid.indices)geometry.indices.push(index+offset);geometry.boxes.push(...solid.boxes);
      this.collision.boxes.push(...geometry.boxes);
      // Relevo do campo inicial: acrescenta os triângulos esculpidos ANTES do índice de colisão.
      // `geometry.boxes` já traz as caixas do cenário e dos volumes sólidos, que são a fonte das
      // exclusões — a mesma lista que o servidor monta em `mergeCollision`.
      this.relief=sculptRegion('base',{positions:geometry.positions,indices:geometry.indices,boxes:[...data.boxes,...geometry.boxes]});
      this.collision.setGeometry(geometry.positions,geometry.indices);await this.collision.prepareRaycastsAsync();if(this.disposed)return;this.collision.setRecoveryVolumes(solid.positions,solid.indices);
      await enableRagdollPhysics(this.scene,geometry);if(this.disposed)return;
      const tint=WORLD_MATERIAL_TINT;
      for(const material of this.scene.materials)if(material instanceof PBRMaterial&&tint[material.name]){material.albedoColor=Color3.FromHexString(tint[material.name]!);material.roughness=.82;}
      const track=this.scene.materials.find(m=>m.name==='Sunlit farm track');if(track instanceof PBRMaterial){track.metallicTexture=new Texture('/textures/brown_mud_02/arm.jpg',this.scene);track.useRoughnessFromMetallicTextureAlpha=false;track.useRoughnessFromMetallicTextureGreen=true;track.useAmbientOcclusionFromMetallicTextureRed=true;track.roughness=.68;track.metallic=0;}
      applyStochasticGround(this.scene.materials);
      for(const material of this.scene.materials)if(material instanceof PBRMaterial&&material.albedoTexture)material.albedoTexture.anisotropicFilteringLevel=8;
      // Alpha-test, iluminação de dois lados e vento de raiz fixa, na mesma passagem.
      this.wind=new FoliageWind(this.scene.materials);
      // Vegetação sobe e trilha reconforma antes do congelamento das matrizes, logo abaixo.
      if(this.relief)this.terrain=new TerrainPresentation(this.scene,this.relief,imported.meshes);
      for(const mesh of imported.meshes){mesh.receiveShadows=true;mesh.isPickable=!/fern|grass|tree/i.test(mesh.name);mesh.computeWorldMatrix(true);
        // includeDescendants=false: sem isso o __root__ do glTF arrasta os 862 nós e fura o filtro.
        mesh.freezeWorldMatrix();}
      this.baseCasters=new NearbyShadowCasters(imported.meshes,this.shadows,24);
      const detailNodes:WorldDetail[]=[];
      for(const mesh of imported.meshes){if(!mesh.getTotalVertices()||!mesh.isVisible)continue;const radius=/fern|grass/i.test(mesh.name)?65:/coast_land/i.test(mesh.name)?135:/tree/i.test(mesh.name)?180:0;if(!radius)continue;const center=mesh.getBoundingInfo().boundingSphere.centerWorld.clone();detailNodes.push({center,radius,visible:true,setVisible:visible=>{mesh.isVisible=visible;}});}
      this.details=new DetailVisibility(detailNodes);
      const masters=imported.meshes.filter((m):m is Mesh=>m instanceof Mesh&&m.getTotalVertices()>0);
      const fern=masters.find(m=>/fern/i.test(m.name));
      if(fern){const response=await fetch('/models/foliage-lods.json');if(!response.ok)throw new Error('Falha nos detalhes de vegetação');const levels=await response.json() as {distance:number;positions:number[];normals:number[];uvs:number[];indices:number[]}[];if(this.disposed)return;for(const level of levels){const lod=new Mesh('fern-distance-detail',this.scene),data=new VertexData();data.positions=level.positions;data.normals=level.normals;data.uvs=level.uvs;data.indices=level.indices;data.applyToMesh(lod);lod.material=fern.material;lod.isPickable=false;lod.receiveShadows=true;fern.addLODLevel(level.distance,lod);}fern.addLODLevel(85,null);}
      for(const pattern of [/coast_land/i,/tree/i]){const variants=masters.filter(m=>pattern.test(m.name));for(const material of new Set(variants.map(m=>m.material))){const group=variants.filter(m=>m.material===material).sort((a,b)=>b.getTotalIndices()-a.getTotalIndices());const near=group[0],far=group.at(-1);if(near&&far&&near!==far&&far.getTotalIndices()<near.getTotalIndices()*.8){const lod=far.clone(`${near.name}-distance-detail`,null,true);lod.position.setAll(0);lod.rotationQuaternion=null;lod.rotation.setAll(0);lod.scaling.setAll(1);near.addLODLevel(pattern.test('tree')?30:38,lod);}}}
      for(const x of [-4,4]){const light=new PointLight('barn-lantern',new Vector3(x,8.8,27.9),this.scene);light.diffuse=new Color3(1,.48,.12);light.intensity=2.3;light.range=7;}
      const emblem=new StandardMaterial('farm-painted-emblem',this.scene);emblem.diffuseTexture=new Texture('/ui/farm-mark.svg',this.scene);emblem.diffuseTexture.hasAlpha=true;emblem.useAlphaFromDiffuseTexture=true;emblem.backFaceCulling=false;emblem.specularColor=Color3.Black();
      for(const [x,y,z,size] of [[0,13.5,28.84,2.7],[9,13,33.23,1.6],[-8,14,36.63,1.3]] as const){const mark=CreatePlane('farm-leaf-insignia',{size},this.scene);mark.position.set(x,y,z);mark.material=emblem;mark.isPickable=false;mark.freezeWorldMatrix();}
      // Materiais com vento NÃO entram no congelamento: material congelado não refaz o bind, e o
      // tempo do vento nunca chegaria à GPU — a vegetação travaria numa pose torta.
      const staticMaterials=new Set(imported.meshes.map(mesh=>mesh.material).filter(material=>!hasFoliageWind(material)));
      this.scene.onAfterRenderObservable.addOnce(()=>{for(const material of staticMaterials)material?.freeze();});
      this.waterfalls=new Waterfalls(this.scene);this.alien=new AlienWorld(this.scene,this.collision);await this.alien.load();this.ready=true;
    }catch(error){if(!this.disposed)this.error=error instanceof Error?error.message:'Falha no cenário';}
  }
  private requestNearby(position:Vec3):void {
    const desired=this.spatialStreaming?this.interest.requests(position):FARM_REGIONS.map(({id,cost})=>({id,cost}));for(const id of this.requestedVisits)if(!desired.some(r=>r.id===id))desired.unshift({id,cost:1});this.regions.request(desired);
  }
  async prepareVisit(id:string):Promise<boolean>{
    if(this.disposed||!FARM_REGIONS.some(r=>r.id===id))return false;
    this.regions.retry(id);this.requestedVisits.add(id);this.regions.request([{id,cost:1},...this.regions.readyIds.filter(ready=>ready!==id).map(id=>({id,cost:1}))]);
    try{await this.regions.settled();return !this.disposed&&this.regions.readyIds.includes(id);}finally{this.requestedVisits.delete(id);}
  }
  get regionStatus():string{return 'Prontas: '+this.regions.readyIds.join(', ')+' · Retidas: '+this.regions.retainedIds.join(', ')+' · Carregando: '+this.regions.loadingCount+this.regions.errors.map(e=>' · '+e.id+': falha '+e.attempts+' / nova tentativa '+Math.ceil(e.retryIn??0)+'s').join('');}
  /**
   * Resumo do relevo esculpido residente, para o QA localizar no jogo o que foi gerado.
   * Formato: `campo 1540 tri · highland-farms 16228 tri, 46 afloramentos, 36859 tri de pedra antiga removidos`.
   */
  get reliefStatus():string{
    const parts:string[]=[];
    const describe=(label:string,relief:SculptedRegion|undefined)=>{
      if(!relief)return;
      const pieces=[`${relief.terrain?.triangles??0} tri`];
      if(relief.placements.length)pieces.push(`${relief.placements.length} afloramentos`);
      if(relief.carvedTriangles)pieces.push(`${relief.carvedTriangles} tri de pedra antiga removidos`);
      parts.push(`${label} ${pieces.join(', ')}`);
    };
    describe('campo',this.relief);
    for(const id of this.regions.readyIds)describe(id,this.regions.get(id)?.relief);
    return parts.length?parts.join(' · '):'sem relevo esculpido residente';
  }
  fixedUpdate(dt:number,player:PlayerMotor):void {
    this.alien?.fixedUpdate(dt,player);
    const occupied=new Set(this.collision.regionIdsAt(player.position,.4));
    for(const actor of this.collision.playerBodies.values())if(actor.active())for(const id of this.collision.regionIdsAt(actor.position,actor.radius))occupied.add(id);
    // Só ragdoll PERTO do jogador retém região. Um corpo esquecido num distrito anterior prendia a
    // região dele em detalhe cheio por tempo indefinido e consumia o orçamento de residência antes
    // das regiões espaciais — o mecanismo por trás das "3 regiões retidas" vistas no QA do bosque.
    for(const position of activeRagdollPositions(this.scene)){
      if(Math.hypot(position.x-player.position.x,position.z-player.position.z)>RAGDOLL_HOLD_RANGE)continue;
      for(const id of this.collision.regionIdsAt(position,3))occupied.add(id);
    }
    for(const id of occupied)if(!this.heldRegions.has(id)&&this.regions.readyIds.includes(id))this.heldRegions.set(id,this.regions.retain(id));
    for(const [id,release] of this.heldRegions)if(!occupied.has(id)){release();this.heldRegions.delete(id);}
    if(this.ready){this.requestNearby(player.position);this.regions.update(dt);this.passages.update(dt,this.regions.readyIds,this.regions.errors);}
  }
  update(dt:number):void {this.wind?.update(dt);const camera=this.scene.activeCamera;if(camera){this.distant.updateView(dt,camera.globalPosition);this.details?.update(dt,camera.globalPosition);this.baseCasters?.update(dt,camera.globalPosition);for(const id of this.regions.readyIds)this.regions.get(id)?.update(dt,camera.globalPosition);}this.waterfalls?.update(dt);this.alien?.update(dt);}
  dispose():void {this.disposed=true;this.terrain?.dispose();this.terrain=undefined;this.wind?.dispose();this.wind=undefined;this.baseCasters?.dispose();this.details?.restore();this.passages.dispose();this.distant.dispose();this.regions.dispose();for(const release of this.heldRegions.values())release();this.heldRegions.clear();this.alien?.dispose();}
}

