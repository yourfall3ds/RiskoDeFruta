import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {AssetContainer} from '@babylonjs/core/assetContainer';
import {PointLight} from '@babylonjs/core/Lights/pointLight';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {Vec3} from '../core/contracts';
import {DetailVisibility,type WorldDetail} from './DetailVisibility';

/** One dressed barn: what the manifest says about it and the mesh that draws it. */
export interface BarnInterior {
  id:string;name:string;region:string;
  centre:Vec3;
  interior:{minX:number;maxX:number;minZ:number;maxZ:number;ceiling:number};
  door:{minX:number;maxX:number;z:number};
  palette:Record<string,string>;
  lantern:{x:number;y:number;z:number;color:string};
  chests:{id:string;x:number;z:number;kind:string}[];
  colliders:{id:string;min:Vec3;max:Vec3}[];
  mesh:string;
}

/**
 * Metres from the barn centre within which its interior is drawn and lit.
 *
 * Comfortably outside the room (the largest is 16 m across) and comfortably INSIDE the 110 m at
 * which `SpatialRegionInterest` loads the district the barn belongs to, so a lit interior never
 * floats in a district that has not streamed in yet.
 */
export const BARN_VIEW_RANGE=46;

/**
 * Interiors of the five walk-in barns.
 *
 * The dressing ships as its own additive GLB rather than inside the region files, because the barn
 * shells were baked by scripts whose scan sources no longer exist in the clone. That split is the
 * reason this class exists: it owns the drawing, the distance culling and the one lantern per barn,
 * while the collision for the very same props already lives in the region collision JSONs that the
 * client, the server and the navmesh bake all read.
 *
 * Nothing here touches `FarmWorld`'s loading contract: it is constructed, loaded, updated and
 * disposed alongside the world.
 */
export class BarnInteriors {
  readonly barns:BarnInterior[]=[];
  ready=false;error='';
  private container:AssetContainer|undefined;
  private readonly lights:PointLight[]=[];
  private details:DetailVisibility|undefined;
  private disposed=false;
  constructor(private readonly scene:Scene){}

  /** How many barn interiors are currently culled. Mirrors `FarmWorld.hiddenDetails` for QA. */
  get hidden():number{return this.details?.hidden??0;}

  async load():Promise<void>{
    try {
      const response=await fetch('/models/barn-interiors.json');
      if(!response.ok)throw Error('Falha no manifesto dos celeiros');
      const manifest=await response.json() as {barns:BarnInterior[]};
      if(this.disposed)return;
      this.barns.push(...manifest.barns);
      const container=await LoadAssetContainerAsync('/models/barn-interiors.glb',this.scene);
      if(this.disposed){container.dispose();return;}
      this.container=container;container.addAllToScene();
      const details:WorldDetail[]=[];
      for(const barn of this.barns){
        const mesh=container.meshes.find(candidate=>candidate.name===barn.mesh);
        if(!mesh)throw Error('Celeiro sem malha: '+barn.mesh);
        mesh.receiveShadows=true;mesh.isPickable=false;
        mesh.computeWorldMatrix(true);mesh.freezeWorldMatrix();
        // The lantern is scoped to its own barn. A scene-wide point light would push every material
        // in the world up a light slot for a lamp the player only ever sees from inside one room.
        const light=new PointLight('barn-lantern-'+barn.id,new Vector3(barn.lantern.x,barn.lantern.y,barn.lantern.z),this.scene);
        light.diffuse=Color3.FromHexString(barn.lantern.color);
        light.intensity=2.6;light.range=Math.max(barn.interior.maxX-barn.interior.minX,barn.interior.maxZ-barn.interior.minZ);
        light.includedOnlyMeshes=[mesh];
        this.lights.push(light);
        details.push({center:{x:barn.centre.x,y:barn.centre.y+2,z:barn.centre.z},radius:BARN_VIEW_RANGE,visible:true,
          setVisible:visible=>{mesh.isVisible=visible;light.setEnabled(visible);}});
      }
      this.details=new DetailVisibility(details);
      this.ready=true;
    } catch(error){if(!this.disposed)this.error=error instanceof Error?error.message:'Falha nos celeiros';}
  }

  update(dt:number,viewer:Vec3):void{if(!this.disposed)this.details?.update(dt,viewer);}

  dispose():void{
    this.disposed=true;
    this.details?.restore();this.details=undefined;
    for(const light of this.lights)light.dispose();
    this.lights.length=0;
    this.container?.dispose();this.container=undefined;
    this.barns.length=0;
  }
}
