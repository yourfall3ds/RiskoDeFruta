import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {SurfaceFrame} from '../physics/SurfaceFrame';
import {RadialProps} from '../physics/RadialProps';
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
import {HarvestChaliceVisual,CHALICE_NODES,type ChaliceVisualOptions} from '../vfx/HarvestChaliceVisual';

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

/**
 * Tentativas de carga do sítio antes de declarar falha.
 *
 * Uma leitura de rede perdida não pode custar a expedição, e cada tentativa recomeça com objetos
 * NOVOS: `HarvestChaliceVisual.load` memoriza a própria promessa, então repetir na mesma instância
 * devolveria para sempre a primeira falha.
 */
export const SITE_LOAD_ATTEMPTS=3;

/** Estado da carga do sítio, para a interface e para o F1 dizerem a verdade. */
export type SiteLoadStatus='idle'|'loading'|'ready'|'failed';

/** Altura autoral do quad do feixe e o centro que o deixa saindo do chão. */
export const BEAM_HEIGHT=15,BEAM_CENTRE=7.2;
/**
 * Altura do FAROL antes da descoberta.
 *
 * Curto de propósito: cinco metros é o bastante para o copo se anunciar dentro da ilha (e para o
 * jogador que olha de uma ponte vizinha), e pouco o bastante para não ser um pilar visível do outro
 * lado do planeta. Ele respeita a profundidade da cena — ver `update`.
 */
export const BEACON_HEIGHT=5;

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
  /**
   * `ready` só é verdade com o SELO e TODOS os cálices na cena.
   *
   * Antes, `load` marcava pronto assim que o selo de runas chegava e largava
   * `void chalice.load()` no ar: um GLB de cálice que falhasse deixava o sítio com runas no chão,
   * uma luz de alcance 14 e NENHUM copo — que é exatamente o "cálice inexistente" relatado. Agora a
   * promessa de `load` só resolve com o sítio inteiro montado, e quem chama pode esperar por ela.
   */
  status:SiteLoadStatus='idle';
  /** Quantas tentativas de carga foram gastas; diagnóstico de QA no F1. */
  attempts=0;
  /** Versão da carga: uma carga antiga que resolva depois de `dispose`/recarga não escreve nada. */
  private loadVersion=0;
  private visible=true;
  private clock=0;
  constructor(
    private readonly scene:Scene,
    private readonly world?:CollisionWorld,
    /**
     * Referencial do mapa. Ausente ⇒ mundo plano, tudo como sempre foi.
     * Presente e esférico ⇒ o cálice fica DE PÉ na ilha e o limite acompanha o convés curvo.
     */
    private readonly surface?:SurfaceFrame,
    /** Injeção de asset para teste offline; o jogo usa o padrão (`/models/harvest-chalice.glb`). */
    private readonly chaliceOptions?:ChaliceVisualOptions,
    /** Injeção do selo de runas para teste offline. */
    private readonly sealSource:string|ArrayBufferView='/models/arcane-skill-ritual.glb',
    private readonly sealExtension?:string,
  ){}

  /** Aviso de QA quando algo do sítio não pôde ser montado neste mapa. */
  notice='';

  /**
   * Corpos sólidos dos cálices no mapa curvo. A cena anexa isto ao referencial
   * (`CollisionWorld.attachRadialProps`); no mundo plano fica vazio e quem responde continua
   * sendo a região anexada de sempre.
   */
  readonly props=new RadialProps();

  /** Centro de cada cálice, em MUNDO, para montar o corpo orientado. */
  private readonly chaliceAnchors:Vec3[]=[];

  /**
   * Monta o sítio inteiro e só então promete `true`.
   *
   * Contrato: `false` significa "não há sítio" — sem copo, sem corpo sólido, `ready === false` e
   * `error` preenchido. Quem chama NÃO pode liberar o estágio nesse caso. Uma carga abandonada
   * (dispose, ou um `load` mais novo) também devolve `false` sem escrever em nada.
   */
  async load(totems:readonly TotemProgress[]):Promise<boolean>{
    if(this.disposed)return false;
    const version=++this.loadVersion;
    this.status='loading';this.error='';this.notice='';this.ready=false;this.attempts=0;
    for(let attempt=1;attempt<=SITE_LOAD_ATTEMPTS;attempt++){
      this.attempts=attempt;
      let failure='';
      try{
        const built=await this.attemptLoad(totems,version);
        if(this.disposed||version!==this.loadVersion)return false;
        if(built){this.ready=true;this.status='ready';this.error='';this.applyVisibility();return true;}
        failure=this.error||'sítio da expedição não montou';
      }catch(error){
        if(this.disposed||version!==this.loadVersion)return false;
        failure=error instanceof Error?error.message:String(error);
      }
      this.error=`${failure} (tentativa ${attempt}/${SITE_LOAD_ATTEMPTS})`;
      // Estado parcial fora antes de repetir: nada de selo órfão nem meio copo em cena.
      this.teardownBuilt();
      if(this.disposed||version!==this.loadVersion)return false;
    }
    this.ready=false;this.status='failed';
    return false;
  }

  /** Uma tentativa completa: selo, cálices e corpos sólidos. Lança para a política de repetição. */
  private async attemptLoad(totems:readonly TotemProgress[],version:number):Promise<boolean>{
    const container=await LoadAssetContainerAsync(this.sealSource,this.scene,
      this.sealExtension?{pluginExtension:this.sealExtension}:undefined);
    if(this.disposed||version!==this.loadVersion){container.dispose();return false;}
    this.container=container;
    const pending:Promise<boolean>[]=[];
    for(const totem of totems){
      this.visuals.push(this.build(totem));
      // Each cup owns its morph targets; cloned managers would fill all four cups at once.
      const chalice=new HarvestChaliceVisual(this.scene,this.chaliceOptions);
      chalice.place(totem.site.position);
      if(this.surface)this.surface.orient(chalice.root,totem.site.position,this.surface.basis(totem.site.position,{x:0,y:0,z:1}).forward);
      this.chalices.push(chalice);
      pending.push(chalice.load());
    }
    const loaded=await Promise.all(pending);
    if(this.disposed||version!==this.loadVersion)return false;
    for(let i=0;i<loaded.length;i++){
      if(loaded[i])continue;
      throw Error(`cálice ${totems[i]?.site.name??i} não carregou: ${this.chalices[i]?.error||'modelo indisponível'}`);
    }
    // `error` de um cálice PRONTO é aviso (ex.: líquido sem morph targets), não falha do sítio.
    const warnings=this.chalices.map(chalice=>chalice.error).filter(Boolean);
    if(warnings.length)this.notice=warnings.join(' · ');
    for(let i=0;i<this.chalices.length;i++){
      const totem=totems[i];
      if(totem)this.attachChaliceCollision(this.chalices[i]!,totem.site.index);
    }
    return true;
  }

  /** Desmonta o que esta tentativa criou, mantendo a instância viva para a próxima. */
  private teardownBuilt():void{
    for(const release of this.releaseCollision)release();
    this.releaseCollision.length=0;
    for(const chalice of this.chalices)chalice.dispose();
    this.chalices.length=0;
    for(const visual of this.visuals)disposeVisual(visual);
    this.visuals.length=0;
    this.chaliceAnchors.length=0;
    this.container?.dispose();this.container=undefined;
  }

  /**
   * Esconde o sítio inteiro.
   *
   * A cena carrega o sítio do PRÓXIMO estágio antes de aplicar o plano; sem isto o copo apareceria
   * na ilha de destino durante a viagem, e o do estágio anterior continuaria em cena ao mesmo tempo.
   */
  setVisible(visible:boolean):void{
    if(this.visible===visible)return;
    this.visible=visible;this.applyVisibility();
  }
  private applyVisibility():void{
    for(const visual of this.visuals){visual.root.setEnabled(this.visible);visual.boundary.setEnabled(false);visual.light.setEnabled(this.visible);}
    for(const chalice of this.chalices)chalice.setVisible(this.visible);
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
    // Num mapa esférico `attachRegion` seria anexado e NUNCA consultado: quem responde ali é o
    // `SurfaceFrame`, que lê a malha do planeta. O corpo do cálice entra pelo registro de props
    // radiais, que é a porta que o referencial consulta de verdade.
    if(this.surface&&this.surface.kind!=='flat'){
      this.attachChaliceProp(positions,index);
      return;
    }
    const collision=new CollisionWorld();collision.setGeometry(positions,indices);collision.prepareRaycasts();
    this.releaseCollision.push(this.world.attachRegion('harvest-chalice-'+index,collision));
  }

  /**
   * Corpo sólido do cálice num mapa curvo: uma caixa ORIENTADA pela radial da ilha.
   *
   * A malha do cálice tem algumas centenas de triângulos e o `RadialProps` é uma lista com rejeição
   * por esfera envolvente — medir a pegada real e registrar UMA caixa é mais barato e mais estável
   * que uma BVH nova por sítio, e é a mesma decisão que o baú já tomou. As meias-extensões saem dos
   * vértices reais projetados na base local, então o corpo acompanha o asset em vez de um palpite.
   */
  private attachChaliceProp(positions:readonly number[],index:number):void {
    const surface=this.surface,at=this.chaliceAnchors[index];
    if(!surface||!at)return;
    const b=surface.basis(at,{x:0,y:0,z:1});
    let right=0,up=0,forward=0;
    for(let i=0;i<positions.length;i+=3){
      const dx=positions[i]!-at.x,dy=positions[i+1]!-at.y,dz=positions[i+2]!-at.z;
      right=Math.max(right,Math.abs(dx*b.right.x+dy*b.right.y+dz*b.right.z));
      up=Math.max(up,Math.abs(dx*b.up.x+dy*b.up.y+dz*b.up.z));
      forward=Math.max(forward,Math.abs(dx*b.forward.x+dy*b.forward.y+dz*b.forward.z));
    }
    if(!(right>0&&up>0&&forward>0))return;
    const id='harvest-chalice-'+index;
    this.props.add({id,centre:at,right:b.right,up:b.up,forward:b.forward,half:{x:right,y:up,z:forward}});
    this.releaseCollision.push(()=>{this.props.remove(id);});
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
    this.chaliceAnchors[index]={x:at.x,y:at.y,z:at.z};
    const root=new TransformNode(`expedition-totem-${index}`,scene);
    root.position.set(at.x,at.y,at.z);
    // Uma única orientação na RAIZ põe cálice, energia, feixe e núcleo de pé em qualquer ilha —
    // todos são filhos dela, então nenhum `position.y` local abaixo precisou mudar.
    if(this.surface)this.surface.orient(root,at,this.surface.basis(at,{x:0,y:0,z:1}).forward);

    const instance=this.container!.instantiateModelsToScene(name=>`totem-${index}-${name}`,false,{doNotInstantiate:true});
    for(const node of instance.rootNodes){node.parent=root;if(node instanceof TransformNode)node.scaling.setAll(.85);}
    for(const clip of instance.animationGroups)clip.stop();
    for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.receiveShadows=true;}

    const energy=new TransformNode(`totem-energy-${index}`,scene);energy.parent=root;energy.position.y=TOTEM_ENERGY_HEIGHT;

    const beamTexture=new Texture('/textures/expedition-beam.svg',scene);beamTexture.hasAlpha=true;
    const beamMaterial=this.tinted(`totem-beam-${index}`,beamTexture,TOTEM_COLORS.available);
    const beam=CreatePlane(`totem-beam-mesh-${index}`,{width:2.1,height:BEAM_HEIGHT},scene);
    beam.parent=energy;beam.position.y=BEAM_CENTRE;beam.material=beamMaterial;beam.isPickable=false;
    // `BILLBOARDMODE_Y` gira em torno do `Y` do MUNDO: num mapa esférico o feixe deita junto com a
    // ilha. `ALL` encara a câmera em qualquer vertical, que é o que o feixe sempre quis dizer.
    beam.billboardMode=this.surface&&this.surface.kind!=='flat'?Mesh.BILLBOARDMODE_ALL:Mesh.BILLBOARDMODE_Y;
    beam.renderingGroupId=1;

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
    if(vertices&&this.surface){
      // No mapa curvo o disco é montado no plano TANGENTE e cada vértice desce pela radial. O
      // `CreateGround` continua sendo a malha de origem; só as posições finais são reescritas,
      // agora em espaço de MUNDO (por isso a raiz do limite volta para a origem).
      boundary.position.setAll(0);
      boundary.rotationQuaternion=null;boundary.rotation.setAll(0);
      const b=this.surface.basis(at,{x:0,y:0,z:1});
      for(let i=0;i<vertices.length;i+=3){
        const side=vertices[i]!,ahead=vertices[i+2]!;
        const probe=this.surface.walk(at,{
          x:b.right.x*side+b.forward.x*ahead,
          y:b.right.y*side+b.forward.y*ahead,
          z:b.right.z*side+b.forward.z*ahead,
        });
        const support=this.surface.support(probe,4,Infinity);
        const ground=support?support.point:probe;
        const up=this.surface.up(ground);
        vertices[i]=ground.x+up.x*.06;vertices[i+1]=ground.y+up.y*.06;vertices[i+2]=ground.z+up.z*.06;
      }
      boundary.updateVerticesData(VertexBuffer.PositionKind,vertices);
      boundary.refreshBoundingInfo();
    } else if(vertices){
      for(let i=0;i<vertices.length;i+=3){
        const y=this.world?.groundAt(at.x+vertices[i]!,at.z+vertices[i+2]!,at.y+4);
        vertices[i+1]=Number.isFinite(y)?(y as number)+.06:at.y+.06;
      }
      boundary.updateVerticesData(VertexBuffer.PositionKind,vertices);
      boundary.refreshBoundingInfo();
    }

    const light=new PointLight(`totem-light-${index}`,new Vector3(at.x,at.y+2.2,at.z),scene);
    light.diffuse=Color3.FromHexString(TOTEM_COLORS.available);light.range=14;light.intensity=1.4;
    // Quem manda em feixe e limite é `update`, e ele só roda com o sítio PRONTO e visível. Sem estes
    // dois desligamentos um quad de 15 m piscaria entre a montagem e o primeiro quadro.
    beam.setEnabled(false);boundary.setEnabled(false);
    if(!this.visible){root.setEnabled(false);light.setEnabled(false);}
    return {root,energy,beam,core,boundary,light,beamMaterial,coreMaterial,boundaryMaterial};
  }

  update(dt:number,totems:readonly TotemProgress[],activeIndex:number,harvestProgress=0,discovered=false):void{
    if(!this.ready||!this.visible)return;
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
      // Search is about finding the cup among the islands, not following a global pillar of light.
      // Antes da descoberta o feixe vira um FAROL de 5 m, e — o que importa mais — volta ao grupo de
      // renderização 0: o Babylon limpa a profundidade antes do grupo 1, então ali o feixe desenharia
      // ATRAVÉS das ilhas e entregaria o destino de qualquer ponto do planeta. No grupo 0 ele é um
      // objeto como qualquer outro: o relevo o esconde, e quem chega perto o vê.
      const found=discovered||charging||complete||state==='paused';
      const group=found?1:0;
      if(visual.beam.renderingGroupId!==group)visual.beam.renderingGroupId=group;
      visual.beam.position.y=found?BEAM_CENTRE:BEACON_HEIGHT/2;
      visual.beamMaterial.alpha=complete?.06:found?(charging?.3+.26*pulse:.26+.14*pulse):.2+.12*pulse;
      visual.coreMaterial.alpha=0;
      visual.boundaryMaterial.alpha=complete?.08:(charging?.42+.3*progress:.3+.08*pulse);
      visual.light.intensity=complete?.5:charging?1.6+1.4*progress:1.2+.5*pulse;
      visual.beam.scaling.y=complete?.2:found?(charging?.72+.5*progress:1):BEACON_HEIGHT/BEAM_HEIGHT;
      // Concluído é a única vez que o feixe sai de cena: o copo cheio já é o destino anunciado.
      visual.beam.setEnabled(!complete);
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
    this.disposed=true;this.loadVersion++;
    this.teardownBuilt();
    this.ready=false;this.status='idle';
  }
}

function disposeVisual(visual:TotemVisual):void{
  visual.light.dispose();visual.beam.dispose();visual.core.dispose();visual.boundary.dispose();
  visual.beamMaterial.dispose();visual.coreMaterial.dispose();visual.boundaryMaterial.dispose();
  visual.energy.dispose();visual.root.dispose();
}
