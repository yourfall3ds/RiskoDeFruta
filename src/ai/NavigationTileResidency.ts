import {Raw,UnsignedCharArray,statusSucceed,type NavMesh} from '@recast-navigation/core';
import type {Vec3} from '../core/contracts';
interface TileRecord {ref:number;index:number;bytes:Uint8Array;minX:number;maxX:number;minZ:number;maxZ:number;resident:boolean;allocation?:UnsignedCharArray|undefined}
/** Keeps a CPU copy of tile bytes. Restored WASM allocations belong to this owner, not Detour. */
export class NavigationTileResidency {
  private readonly tiles:TileRecord[]=[];private disposed=false;
  constructor(private readonly mesh:NavMesh){
    for(let index=0;index<mesh.getMaxTiles();index++){
      const tile=mesh.getTile(index),h=tile.header();if(!h)continue;
      const bytes=new Uint8Array(tile.dataSize());for(let i=0;i<bytes.length;i++)bytes[i]=tile.data(i);
      this.tiles.push({ref:mesh.getTileRef(tile),index,bytes,minX:h.bmin(0),maxX:h.bmax(0),minZ:h.bmin(2),maxZ:h.bmax(2),resident:true});
    }
  }
  private distance(tile:TileRecord,p:Vec3):number{return Math.hypot(Math.max(tile.minX-p.x,0,p.x-tile.maxX),Math.max(tile.minZ-p.z,0,p.z-tile.maxZ));}
  private restore(tile:TileRecord):void{
    if(tile.resident||this.disposed)return;
    const allocation=new UnsignedCharArray();allocation.copy(tile.bytes);
    // lastRef restores the original salt/index so existing corridor references remain meaningful.
    const result=this.mesh.addTile(allocation,0,tile.ref);
    if(!statusSucceed(result.status)){allocation.destroy();throw Error('Cannot restore navigation tile '+tile.index);}
    tile.ref=result.tileRef;tile.allocation=allocation;tile.resident=true;
  }
  ensureNear(points:readonly Vec3[],radius=110):void{for(const tile of this.tiles)if(points.some(p=>this.distance(tile,p)<=radius))this.restore(tile);}
  restoreAll():void{for(const tile of this.tiles)this.restore(tile);}
  prune(points:readonly Vec3[],protectedIndices:ReadonlySet<number>,radius=155):void{
    if(this.disposed)return;
    for(const tile of this.tiles){
      if(!tile.resident||protectedIndices.has(tile.index)||points.some(p=>this.distance(tile,p)<=radius))continue;
      const removed=this.mesh.removeTile(tile.ref);Raw.destroy(removed.raw);
      tile.allocation?.destroy();tile.allocation=undefined;tile.resident=false;
    }
  }
  get stats():{resident:number;total:number;residentBytes:number;cachedBytes:number}{
    return {resident:this.tiles.filter(t=>t.resident).length,total:this.tiles.length,residentBytes:this.tiles.reduce((n,t)=>n+(t.resident?t.bytes.length:0),0),cachedBytes:this.tiles.reduce((n,t)=>n+t.bytes.length,0)};
  }
  /** Must run after crowd/query destruction and before navmesh destruction. */
  dispose():void{
    if(this.disposed)return;
    for(const tile of this.tiles)if(tile.allocation){const removed=this.mesh.removeTile(tile.ref);Raw.destroy(removed.raw);tile.allocation.destroy();tile.allocation=undefined;}
    this.tiles.length=0;this.disposed=true;
  }
}
