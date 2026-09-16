import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {CreatePlane} from '@babylonjs/core/Meshes/Builders/planeBuilder';
import {CreateGround} from '@babylonjs/core/Meshes/Builders/groundBuilder';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {PointLight} from '@babylonjs/core/Lights/pointLight';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';
import {CollisionWorld} from '../physics/CollisionWorld';
import type {TotemProgress} from '../run/ExpeditionObjectives';
import type {Vec3} from '../core/contracts';
import {HarvestChaliceVisual,CHALICE_NODES} from '../vfx/HarvestChaliceVisual';

/** Linguagem de cor pedida pela direção: âmbar disponível, menta carregando, núcleo escuro concluído. */
export const TOTEM_COLORS={available:'#ffb23c',charging:'#5ff0c0',paused:'#d8894a',complete:'#2f4a46'} as const;
/**
 * Altura em que a energia flutua acima do selo.
 *
 * O marco NÃO tem corpo sólido: `arcane-skill-ritual.glb` é um selo de runas e filamentos, não um
 * pedestal. A versão anterior registrava uma caixa invisível de 0,62 × 1,15 m que não correspondia a
 * nada na imagem e deixava o jogador pisando no vazio. O selo agora é energia sobre o chão e não
 * registra colisor nenhum — quem atravessa o marco caminha pelo terreno real.
 */
export const TOTEM_ENERGY_HEIGHT=1.25;

interface TotemVisual {
  root:TransformNode;
  /** Só a energia gira; a base do marco fica imóvel. */
  energy:TransformNode;
  beam:Mesh;core:Mesh;boundary:Mesh;light:PointLight;
  beamMaterial:StandardMaterial;coreMaterial:StandardMaterial;boundaryMaterial:StandardMaterial;
}

/**
 * Apresentação dos marcos da expedição.
 *
 * - Selo: asset autoral real (`arcane-skill-ritual.glb`, runas no chão). É ENERGIA sobre o terreno,
 *   não um pedestal: **não registra colisão** e o jogador atravessa pisando no chão de verdade.
 *   Fica IMÓVEL; só a peça de energia flutuante gira.
 * - Feixe e núcleo: quads com as texturas originais do Codex (`expedition-beam.svg`). O SVG entra
 *   como `opacityTexture` e a cor vem de `emissiveColor` — ver `tinted()` para o porquê.
 * - Limite: grade de vértices presa ao relevo (`expedition-boundary.svg`), então acompanha
 *   degraus e ladeiras em vez de um disco plano que some sob o solo.
 */
export class ExpeditionSites {
  private container:AssetContainer|undefined;
  private readonly visuals:TotemVisual[]=[];
  private readonly chalices:HarvestChaliceVisual[]=[];
  private readonly releaseCollision:(()=>void)[]=[];
  private disposed=false;
  ready=false;error='';
  private clock=0;
  constructor(private readonly scene:Scene,private readonly world?:CollisionWorld){}

  async load(totems:readonly TotemProgress[]):Promise<void>{
    try{
      const container=await LoadAssetContainerAsync('/models/arcane-skill-ritual.glb',this.scene);
      if(this.disposed){container.dispose();return;}
      this.container=container;
      for(const totem of totems){
        this.visuals.push(this.build(totem));
        const chalice=new HarvestChaliceVisual(this.scene);
        chalice.place(totem.site.position);this.chalices.push(chalice);
        // Each cup owns its morph targets; cloned managers would fill all four cups at once.
        void chalice.load().then(ready=>{
          if(this.disposed)return;
          if(ready)this.attachChaliceCollision(chalice,totem.site.index);
          else this.error=chalice.error;
        }).catch(error=>{if(!this.disposed)this.error=String(error);});
      }
      this.ready=true;
    }catch(error){if(!this.disposed)this.error=String(error);}
  }

  private attachChaliceCollision(chalice:HarvestChaliceVisual,index:number):void {
    if(!this.world)return;
    const positions:number[]=[],indices:number[]=[];
    for(const mesh of chalice.root.getChildMeshes()){
      if(mesh.name===CHALICE_NODES.juice||mesh.name===CHALICE_NODES.droplet)continue;
      const vertices=mesh.getVerticesData(VertexBuffer.PositionKind),triangles=mesh.getIndices();
      if(!vertices||!triangles)continue;
      const matrix=mesh.computeWorldMatrix(true),offset=positions.length/3,flipped=matrix.determinant()<0;
      for(let i=0;i<vertices.length;i+=3){const p=Vector3.TransformCoordinates(new Vector3(vertices[i]!,vertices[i+1]!,vertices[i+2]!),matrix);positions.push(p.x,p.y,p.z);}
      for(let i=0;i<triangles.length;i+=3)indices.push(offset+triangles[i]!,offset+triangles[i+(flipped?2:1)]!,offset+triangles[i+(flipped?1:2)]!);
    }
    if(!indices.length)return;
    const collision=new CollisionWorld();collision.setGeometry(positions,indices);collision.prepareRaycasts();
    this.releaseCollision.push(this.world.attachRegion('harvest-chalice-'+index,collision));
  }

  harvest(index:number,from:Vec3,complete:boolean):void{
    this.chalices[index]?.splash(from);
    if(complete)this.chalices[index]?.pulse();
  }

  /**
   * Material de energia tingido pela COR, com a forma vinda só do alpha do SVG.
   *
   * `StandardMaterial` SOMA `emissiveTexture.rgb` a `emissiveColor`. Como os SVGs do Codex são
   * brancos, usá-los como `emissiveTexture` levava o resultado a branco puro — foi o feixe chapado
   * reprovado na revisão. Aqui o SVG entra apenas como `opacityTexture`; a cor do estado vem
   * inteira de `emissiveColor`, então âmbar/menta/apagado aparecem de verdade.
   */
  private tinted(name:string,texture:Texture,hex:string):StandardMaterial {
    const material=new StandardMaterial(name,this.scene);
    texture.hasAlpha=true;
    material.opacityTexture=texture;
    material.opacityTexture.getAlphaFromRGB=false;
    material.emissiveColor=Color3.FromHexString(hex);
    material.diffuseColor=Color3.Black();material.specularColor=Color3.Black();material.ambientColor=Color3.Black();
    material.disableLighting=true;material.backFaceCulling=false;material.disableDepthWrite=true;
    return material;
  }

  private build(totem:TotemProgress):TotemVisual{
    const scene=this.scene,index=totem.site.index,at=totem.site.position;
    const root=new TransformNode(`expedition-totem-${index}`,scene);
    root.position.set(at.x,at.y,at.z);

    const instance=this.container!.instantiateModelsToScene(name=>`totem-${index}-${name}`,false,{doNotInstantiate:true});
    for(const node of instance.rootNodes){node.parent=root;if(node instanceof TransformNode)node.scaling.setAll(.85);}
    for(const clip of instance.animationGroups)clip.stop();
    for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.receiveShadows=true;}

    const energy=new TransformNode(`totem-energy-${index}`,scene);energy.parent=root;energy.position.y=TOTEM_ENERGY_HEIGHT;

    const beamTexture=new Texture('/textures/expedition-beam.svg',scene);beamTexture.hasAlpha=true;
    const beamMaterial=this.tinted(`totem-beam-${index}`,beamTexture,TOTEM_COLORS.available);
    const beam=CreatePlane(`totem-beam-mesh-${index}`,{width:2.1,height:15},scene);
    beam.parent=energy;beam.position.y=7.2;beam.material=beamMaterial;beam.isPickable=false;
    beam.billboardMode=Mesh.BILLBOARDMODE_Y;beam.renderingGroupId=1;

    const coreTexture=new Texture('/textures/expedition-beam.svg',scene);
    const coreMaterial=this.tinted(`totem-core-${index}`,coreTexture,TOTEM_COLORS.available);
    const core=CreatePlane(`totem-core-mesh-${index}`,{width:.9,height:.9},scene);
    core.parent=energy;core.material=coreMaterial;core.isPickable=false;
    core.billboardMode=Mesh.BILLBOARDMODE_ALL;core.renderingGroupId=1;

    const boundaryTexture=new Texture('/textures/expedition-boundary.svg',scene);boundaryTexture.hasAlpha=true;
    const boundaryMaterial=this.tinted(`totem-boundary-${index}`,boundaryTexture,TOTEM_COLORS.available);
    const boundary=CreateGround(`totem-boundary-mesh-${index}`,{width:totem.site.radius*2,height:totem.site.radius*2,subdivisions:40,updatable:true},scene);
    boundary.material=boundaryMaterial;boundary.isPickable=false;boundary.renderingGroupId=1;
    boundary.position.set(at.x,0,at.z);
    // Cada vértice procura o próprio chão: o limite acompanha o relevo em vez de um disco plano.
    const vertices=boundary.getVerticesData(VertexBuffer.PositionKind);
    if(vertices){
      for(let i=0;i<vertices.length;i+=3){
        const y=this.world?.groundAt(at.x+vertices[i]!,at.z+vertices[i+2]!,at.y+4);
        vertices[i+1]=Number.isFinite(y)?(y as number)+.06:at.y+.06;
      }
      boundary.updateVerticesData(VertexBuffer.PositionKind,vertices);
      boundary.refreshBoundingInfo();
    }

    const light=new PointLight(`totem-light-${index}`,new Vector3(at.x,at.y+2.2,at.z),scene);
    light.diffuse=Color3.FromHexString(TOTEM_COLORS.available);light.range=14;light.intensity=1.4;
    return {root,energy,beam,core,boundary,light,beamMaterial,coreMaterial,boundaryMaterial};
  }

  update(dt:number,totems:readonly TotemProgress[],activeIndex:number,harvestProgress=0,discovered=false):void{
    if(!this.ready)return;
    this.clock+=dt;
    for(let i=0;i<this.visuals.length;i++){
      const visual=this.visuals[i]!,totem=totems[i];
      if(!totem)continue;
      const state=totem.state,color=Color3.FromHexString(TOTEM_COLORS[state]);
      const charging=state==='charging',complete=state==='complete';
      const progress=totem.charged/totem.site.juiceTarget*(1-Math.max(0,Math.min(1,harvestProgress)));
      this.chalices[i]?.setFill(progress);
      this.chalices[i]?.update(dt);
      visual.beamMaterial.emissiveColor=color;visual.coreMaterial.emissiveColor=color;
      visual.boundaryMaterial.emissiveColor=color;visual.light.diffuse=color;
      const pulse=.5+.5*Math.sin(this.clock*(charging?4.5:1.6));
      // Concluído mantém só luz residual; o feixe some para não competir com os marcos pendentes.
      visual.beamMaterial.alpha=complete?.06:(charging?.3+.26*pulse:.26+.14*pulse);
      visual.coreMaterial.alpha=0;
      visual.boundaryMaterial.alpha=complete?.08:(charging?.42+.3*progress:.3+.08*pulse);
      visual.light.intensity=complete?.5:charging?1.6+1.4*progress:1.2+.5*pulse;
      visual.beam.scaling.y=complete?.2:charging?.72+.5*progress:1;
      // Search is about finding the cup among the islands, not following a global pillar of light.
      // Once discovered, the beacon helps return to the event without revealing it at spawn.
      visual.beam.setEnabled(!complete&&(discovered||charging||state==='paused'));
      // O limite só aparece quando a área importa: durante a carga do próprio marco.
      visual.boundary.setEnabled(charging||i===activeIndex);
      // Apenas a energia gira e flutua; a base de runas permanece imóvel.
      visual.energy.rotation.y+=dt*(charging?1.35:.5);
      visual.energy.position.y=TOTEM_ENERGY_HEIGHT+Math.sin(this.clock*(charging?2.6:1.3))*.12;
      visual.core.scaling.setAll(complete?.5:.85+.25*pulse);
    }
  }
  positionOf(index:number):Vector3|undefined {return this.visuals[index]?.root.position;}
  dispose():void{
    this.disposed=true;
    for(const release of this.releaseCollision)release();this.releaseCollision.length=0;
    for(const chalice of this.chalices)chalice.dispose();this.chalices.length=0;
    for(const visual of this.visuals){
      visual.light.dispose();visual.beam.dispose();visual.core.dispose();visual.boundary.dispose();
      visual.beamMaterial.dispose();visual.coreMaterial.dispose();visual.boundaryMaterial.dispose();
      visual.energy.dispose();visual.root.dispose();
    }
    this.visuals.length=0;this.container?.dispose();this.container=undefined;this.ready=false;
  }
}
