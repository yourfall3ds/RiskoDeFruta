import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {Geometry} from '@babylonjs/core/Meshes/geometry';
import type {Material} from '@babylonjs/core/Materials/material';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Scene} from '@babylonjs/core/scene';

/** Papel do pedaço dentro da quebra. */
export type FragmentRole='shell'|'pulp'|'seed';
/**
 * Conjunto de cacos de um corpo. Cada família é recortada de um inimigo real em
 * `scripts/build-fruit-fragments.py`: melancia/chefe, tomate, berinjela, milho e cenoura.
 */
export type FruitFamily='melon'|'berry'|'bulb'|'cob'|'root';

/** Modelo autoral com os cacos; construído a partir dos corpos originais, que não são tocados. */
export const FRAGMENT_MODEL='/models/fruit-fragments.glb';
/** Teto por pedaço cobrado no teste do modelo — caco é caco, não corpo inteiro. */
export const FRAGMENT_TRIANGLE_BUDGET=320;
/** Moldes por papel/espécie, para uma mesma quebra não repetir a mesma silhueta. */
export const SHAPE_VARIANTS=3;
export const FRAGMENT_ROLES:readonly FragmentRole[]=['shell','pulp','seed'];
export const FRAGMENT_FAMILIES:readonly FruitFamily[]=['melon','berry','bulb','cob','root'];
/** Nome do objeto dentro do GLB; é o mesmo que o script de build escreve. */
export const fragmentKey=(family:FruitFamily,role:FragmentRole,variant:number):string=>`frag-${family}-${role}-${variant}`;

/** Uma parte do caco: pele e face cortada são materiais diferentes, logo primitivas diferentes. */
export interface FragmentPart {geometry:Geometry;material:Material|null;}
export interface FragmentTemplate {
  key:string;
  parts:readonly FragmentPart[];
  /** Meia-extensão em metros, já no espaço do Babylon. O contato com o piso sai daqui. */
  half:Vector3;
  triangles:number;
}
export type FragmentLoader=(url:string,scene:Scene)=>Promise<AssetContainer>;

const defaultLoader:FragmentLoader=(url,scene)=>LoadAssetContainerAsync(url,scene);

/**
 * Carrega os cacos recortados dos corpos reais e guarda cada peça como molde compartilhado.
 *
 * O carregamento começa no construtor, antes da primeira quebra. Nada é construído por primitiva
 * em tempo de execução: geometria, UV, textura e material saem do GLB. As peças chegam presas ao
 * nó de conversão de eixo do glTF; aqui cada uma é assada na própria malha para poder ser
 * reaproveitada em qualquer pedaço do pool sem carregar transformação de origem.
 */
export class FragmentLibrary {
  private readonly templates=new Map<string,FragmentTemplate>();
  private container:AssetContainer|undefined;
  private disposed=false;
  /** Resolve `true` quando os moldes reais entraram; `false` se falhou ou morreu antes. */
  readonly ready:Promise<boolean>;
  /** Mensagem da falha de carga, quando houver. */
  error='';
  constructor(private readonly scene:Scene,loader:FragmentLoader=defaultLoader,url:string=FRAGMENT_MODEL){
    this.ready=this.load(loader,url);
  }

  get loaded():boolean {return this.templates.size>0;}
  get count():number {return this.templates.size;}
  get triangles():number {let total=0;for(const template of this.templates.values())total+=template.triangles;return total;}

  private async load(loader:FragmentLoader,url:string):Promise<boolean> {
    try{
      const container=await loader(url,this.scene);
      // Morreu enquanto baixava: descarta o container em vez de deixar malha viva na cena.
      if(this.disposed||this.scene.isDisposed){container.dispose();return false;}
      this.container=container;
      this.adopt(container);
      return this.templates.size>0;
    }catch(error){
      if(!this.disposed)this.error=String(error);
      return false;
    }
  }

  private adopt(container:AssetContainer):void {
    const groups=new Map<string,Mesh[]>();
    for(const node of container.meshes){
      const mesh=node as Mesh;
      if(typeof mesh.getTotalVertices!=='function'||mesh.getTotalVertices()===0)continue;
      // `frag-melon-shell-0` traz a pele e `frag-melon-shell-0--corte` a face cortada: peças
      // separadas no arquivo porque cada uma tem material próprio, mas um caco só aqui.
      const base=(mesh.name.split('_primitive')[0]??'').split('--')[0]??'';
      if(!base.startsWith('frag-'))continue;
      const list=groups.get(base);
      if(list)list.push(mesh);else groups.set(base,[mesh]);
    }
    for(const [key,meshes] of groups){
      // A pele vem primeiro: é ela que o pedaço usa como malha principal.
      meshes.sort((a,b)=>a.name.length-b.name.length||a.name.localeCompare(b.name));
      const parts:FragmentPart[]=[];
      const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);
      let triangles=0;
      for(const mesh of meshes){
        const world=mesh.computeWorldMatrix(true).clone();
        mesh.parent=null;
        mesh.bakeTransformIntoVertices(world);
        mesh.position.setAll(0);mesh.rotationQuaternion=null;mesh.rotation.setAll(0);mesh.scaling.setAll(1);
        mesh.refreshBoundingInfo();
        mesh.setEnabled(false);mesh.isPickable=false;
        const geometry=mesh.geometry;
        if(!geometry)continue;
        parts.push({geometry,material:mesh.material});
        const box=mesh.getBoundingInfo().boundingBox;
        min.minimizeInPlace(box.minimum);max.maximizeInPlace(box.maximum);
        triangles+=mesh.getTotalIndices()/3;
      }
      if(!parts.length)continue;
      this.templates.set(key,{key,parts,half:max.subtract(min).scale(.5),triangles});
    }
  }

  /** Molde exato; sem ele o pedaço não nasce, em vez de nascer com a geometria da espécie anterior. */
  get(family:FruitFamily,role:FragmentRole,variant:number):FragmentTemplate|undefined {
    const wanted=this.templates.get(fragmentKey(family,role,variant));
    if(wanted)return wanted;
    for(let i=0;i<SHAPE_VARIANTS;i++){
      const fallback=this.templates.get(fragmentKey(family,role,i));
      if(fallback)return fallback;
    }
    return undefined;
  }

  dispose():void {
    this.disposed=true;
    this.container?.dispose();
    this.container=undefined;
    this.templates.clear();
  }
}
