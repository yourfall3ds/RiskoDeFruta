import {appendGeometry,type TerrainGeometry} from './TerrainPatch';
import {buildOutcropGeometry,type OrientedVolume,type OutcropPlacement,type OutcropShape} from './RockOutcrops';

export interface InitialRockFix {
 source:{vertices:number;triangles:number;checksum:number};
 offenders:readonly{name:string;box:OrientedVolume;firstTriangle:number;triangles:number}[];
 /** Distant dressing that was never included in the original collision bake. */
 visualOnly?:readonly string[];
 replacements:readonly OutcropPlacement[];
}

/** Fingerprint of the exact baked source. A stale plan must never remove unrelated geometry. */
export function collisionFingerprint(positions:readonly number[],indices:readonly number[]):number {
 let hash=2166136261;
 for(const value of positions)hash=Math.imul(hash^Math.round(value*1e5),16777619);
 for(const value of indices)hash=Math.imul(hash^value,16777619);
 return hash>>>0;
}

export interface InitialRockResult {
 hidden:readonly string[];
 geometry:TerrainGeometry|undefined;
 removedTriangles:number;
 removedInstances:number;
 placements:readonly OutcropPlacement[];
}

/**
 * Uses named triangle ranges from the original Blender collision bake, never spatial guesses.
 * Call on the original world collision BEFORE merging island solids or sculpted terrain.
 * The same replacement triangles are rendered and used by physics and navigation.
 */
export function applyInitialRockFix(
 data:{positions:number[];indices:number[]},fix:InitialRockFix|undefined,shape:OutcropShape|undefined,
):InitialRockResult {
 const empty:InitialRockResult={hidden:[],geometry:undefined,removedTriangles:0,removedInstances:0,placements:[]};
 if(!fix||!shape)return empty;
 if(data.positions.length!==fix.source.vertices*3||data.indices.length!==fix.source.triangles*3||
    collisionFingerprint(data.positions,data.indices)!==fix.source.checksum)
  throw new Error('Initial rock plan is stale; run scripts/plan-initial-rocks.mjs');
 const ranges=[...fix.offenders].sort((a,b)=>a.firstTriangle-b.firstTriangle);
 let end=0;
 for(const range of ranges){
  if(!Number.isInteger(range.firstTriangle)||!Number.isInteger(range.triangles)||range.firstTriangle<end||
     range.triangles<1||range.firstTriangle+range.triangles>fix.source.triangles)
   throw new Error('Invalid initial rock collision range: '+range.name);
  end=range.firstTriangle+range.triangles;
 }
 const indices:number[]=[];
 let cursor=0,removedTriangles=0;
 for(const range of ranges){
  for(;cursor<range.firstTriangle*3;cursor++)indices.push(data.indices[cursor]!);
  cursor=(range.firstTriangle+range.triangles)*3;
  removedTriangles+=range.triangles;
 }
 for(;cursor<data.indices.length;cursor++)indices.push(data.indices[cursor]!);
 data.indices=indices;
 const geometry=fix.replacements.length?buildOutcropGeometry(shape,fix.replacements,{naturalSize:shape.sourceExtent}):undefined;
 if(geometry)appendGeometry(data,geometry);
 return{hidden:[...ranges.map(range=>range.name),...fix.visualOnly??[]],geometry,removedTriangles,removedInstances:ranges.length,placements:fix.replacements};
}
