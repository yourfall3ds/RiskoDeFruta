import type {Vec3} from '../../core/contracts';
import type {RegionRequest} from './RegionResidency';
export interface SpatialRegion extends RegionRequest {minX:number;maxX:number;minZ:number;maxZ:number}
export const FARM_REGIONS:readonly SpatialRegion[]=[
 {id:'farm-city',cost:1,minX:52,maxX:190,minZ:-18,maxZ:97},
 {id:'solar-frontier',cost:1,minX:183,maxX:366,minZ:1,maxZ:357},
 {id:'rootwood',cost:1,minX:790,maxX:1270,minZ:260,maxZ:740},
 {id:'highland-farms',cost:1,minX:354,maxX:823,minZ:177,maxZ:620},
];
export function distanceToRegion(p:Vec3,r:SpatialRegion):number{return Math.hypot(Math.max(r.minX-p.x,0,p.x-r.maxX),Math.max(r.minZ-p.z,0,p.z-r.maxZ));}
/** Keep requested loads through the wider release radius, avoiding cancellation at every boundary step. */
export class SpatialRegionInterest {
 private readonly selected=new Set<string>();
 constructor(private readonly regions:readonly SpatialRegion[],private readonly loadDistance=110,private readonly releaseDistance=155){
  if(!Number.isFinite(loadDistance)||!Number.isFinite(releaseDistance)||loadDistance<0||releaseDistance<loadDistance)throw Error('Invalid region distances');
 }
 requests(position:Vec3):RegionRequest[]{
  const ranked=this.regions.map(region=>({region,distance:distanceToRegion(position,region)})).sort((a,b)=>a.distance-b.distance||a.region.id.localeCompare(b.region.id));
  const wanted:RegionRequest[]=[];
  for(const {region,distance} of ranked){if(distance<=(this.selected.has(region.id)?this.releaseDistance:this.loadDistance)){this.selected.add(region.id);wanted.push({id:region.id,cost:region.cost});}else this.selected.delete(region.id);}
  return wanted;
 }
}
