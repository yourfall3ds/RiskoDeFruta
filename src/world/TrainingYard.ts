import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import {applyStochasticGround} from './materials/GroundMaterials';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CollisionWorld } from '../physics/CollisionWorld';
import { RunRNG } from '../core/RunRNG';
import type { DamageContext } from '../core/contracts';

export interface TrainingTarget { id: number; mesh: Mesh; meshes?:readonly Mesh[]; ring?: Mesh; hits: number; onHit?: (context:DamageContext)=>void }
export class TrainingYard {
  readonly collision=new CollisionWorld();
  readonly targets: TrainingTarget[]=[];
  constructor(private readonly scene: Scene,private readonly shadows: ShadowGenerator,rng: RunRNG) {
    const concrete=this.material('concrete','#918b78',.93,.02);
    const metal=this.material('painted-steel','#35474e',.5,.6);
    const wood=this.material('weathered-timber','#58412a',.92,0);
    const trim=this.material('safety-brass','#d9a556',.45,.55);
    const earth=this.material('soil','#ffffff',1,0);
    const grass=this.material('vegetation','#666d38',1,0);
    const random=rng.stream('scene');
    const soilMap=(name:string,gammaSpace:boolean)=>{const texture=new Texture(`/textures/brown_mud_leaves_01/${name}.jpg`,scene);texture.uScale=12;texture.vScale=12;texture.gammaSpace=gammaSpace;texture.anisotropicFilteringLevel=8;return texture;};
    earth.albedoTexture=soilMap('Diffuse',true);earth.bumpTexture=soilMap('nor_gl',false);applyStochasticGround([earth]);
    earth.metallicTexture=soilMap('arm',false);earth.metallic=1;
    earth.useAmbientOcclusionFromMetallicTextureRed=true;earth.useRoughnessFromMetallicTextureGreen=true;
    earth.useRoughnessFromMetallicTextureAlpha=false;earth.useMetallnessFromMetallicTextureBlue=true;
    this.box('main-island',new Vector3(0,-1.6,0),new Vector3(64,3.2,64),earth,true);
    this.box('satellite',new Vector3(0,-1.4,41),new Vector3(14,2.8,9),earth,true);
    // Clearly readable lanes for the M1 movement acceptance course.
    // The soil remains visible in the combat lane; collision props are technical fixtures.
    for(let i=0;i<6;i++)this.box(`step-${i}`,new Vector3(-14,.2+i*.2,4+i*1.8),new Vector3(5,.4+i*.4,1.8),concrete,true);
    this.ramp(-22,15,5,12,0,4,concrete);
    this.box('cover-wall',new Vector3(11,1.5,3),new Vector3(1,3,9),metal,true);
    this.box('camera-wall',new Vector3(-8,2,-10),new Vector3(10,4,1),concrete,true);
    this.box('overhang',new Vector3(15,3.4,-10),new Vector3(8,.7,5),metal,true);
    for(const x of [11.5,18.5])this.box('overhang-column',new Vector3(x,1.5,-10),new Vector3(.6,3,5),concrete,true);
    for(let i=0;i<4;i++)this.target(i+10,new Vector3((i-1.5)*4,1.65,18+i%2*6),metal,trim);
    for(let z=-26;z<30;z+=3)for(const x of [-28,28]){
      this.box('fence-post',new Vector3(x,.65,z),new Vector3(.18,1.3,.18),wood,false);
      for(const y of [.45,.95])this.box('fence-rail',new Vector3(x,y,z+1.5),new Vector3(.12,.11,3),wood,false);
    }
    for(let i=0;i<65;i++) {
      const angle=random.range(0,Math.PI*2);const distance=random.range(23,30);
      const mesh=CreateSphere('edge-rock',{segments:3,diameter:1},scene);mesh.position.set(Math.cos(angle)*distance,-.1,Math.sin(angle)*distance);
      mesh.scaling.set(random.range(.4,1.8),random.range(.4,1),random.range(.5,1.6));mesh.rotation.y=angle;mesh.material=concrete;mesh.isPickable=false;mesh.receiveShadows=true;mesh.freezeWorldMatrix();
    }
    const blade=CreateBox('grass-blade',{width:.025,height:.4,depth:.13},scene);blade.material=grass;blade.isPickable=false;
    for(let i=0;i<700;i++){
      const x=random.range(-30,30),z=random.range(-30,30);if(Math.abs(x)<24&&z>-15&&z<26)continue;
      const instance=blade.createInstance(`grass-${i}`);instance.position.set(x,.1,z);instance.rotation.y=random.range(0,6.28);instance.scaling.y=random.range(.6,1.8);instance.isPickable=false;instance.freezeWorldMatrix();
    }
    blade.setEnabled(false);
    this.sign('SETOR 07  /  TESTE DE CAMPO',new Vector3(0,3.8,28),9);
    this.sign('MOBILIDADE',new Vector3(-17,2,0),4);
    this.sign('FENDA  /  4,5 m',new Vector3(7,2,29),4);
    // Floating-island silhouettes return only when textured environment assets are ready.
  }
  private material(name: string,color: string,roughness: number,metallic: number): PBRMaterial {const m=new PBRMaterial(name,this.scene);m.albedoColor=Color3.FromHexString(color);m.roughness=roughness;m.metallic=metallic;return m;}
  private box(name: string,position: Vector3,size: Vector3,material: PBRMaterial,solid: boolean): Mesh {
    const mesh=CreateBox(name,{width:size.x,height:size.y,depth:size.z},this.scene);mesh.position.copyFrom(position);mesh.material=material;mesh.receiveShadows=true;mesh.isPickable=solid;mesh.freezeWorldMatrix();
    if(solid){this.collision.boxes.push({id:name,min:{x:position.x-size.x/2,y:position.y-size.y/2,z:position.z-size.z/2},max:{x:position.x+size.x/2,y:position.y+size.y/2,z:position.z+size.z/2}});if(size.y<10)this.shadows.addShadowCaster(mesh);}
    return mesh;
  }
  private ramp(x: number,z: number,width: number,depth: number,low: number,high: number,material: PBRMaterial): void {
    const mesh=new Mesh('movement-ramp',this.scene);const data=new VertexData();
    data.positions=[x-width/2,low,z-depth/2,x+width/2,low,z-depth/2,x+width/2,high,z+depth/2,x-width/2,high,z+depth/2];
    data.indices=[0,2,1,0,3,2];data.normals=[];VertexData.ComputeNormals(data.positions,data.indices,data.normals);data.uvs=[0,0,1,0,1,1,0,1];data.applyToMesh(mesh);mesh.material=material;mesh.receiveShadows=true;
    this.collision.surfaces.push({id:'ramp',x,z,width,depth,height:(low+high)/2,slopeZ:(high-low)/depth});
  }
  private target(id: number,pos: Vector3,metal: PBRMaterial,trim: PBRMaterial): void {
    this.box(`target-stand-${id}`,new Vector3(pos.x,.65,pos.z),new Vector3(.15,1.3,.2),metal,false);
    const ring=CreateCylinder(`target-ring-${id}`,{diameter:1.3,height:.1,tessellation:48},this.scene);ring.rotation.x=Math.PI/2;ring.position.copyFrom(pos);ring.material=trim;ring.isPickable=false;
    const mesh=CreateCylinder(`target-${id}`,{diameter:.85,height:.14,tessellation:48},this.scene);mesh.rotation.x=Math.PI/2;mesh.position.copyFrom(pos);mesh.position.z-=.035;mesh.material=metal;mesh.metadata={targetId:id};mesh.receiveShadows=true;
    this.targets.push({id,mesh,ring,hits:0});
  }
  private sign(text: string,position: Vector3,width: number): void {
    const texture=new DynamicTexture(text,{width:1024,height:128},this.scene,false);texture.drawText(text,null,80,'bold 45px sans-serif','#ead9b6','#26393a',true);
    const m=new StandardMaterial(text,this.scene);m.diffuseTexture=texture;m.emissiveColor=new Color3(.18,.18,.18);m.specularColor=Color3.Black();
    const panel=CreateBox(text,{width,height:width/8,depth:.12},this.scene);panel.position.copyFrom(position);panel.material=m;panel.isPickable=false;
  }
}
