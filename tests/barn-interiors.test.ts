import {describe,it,expect} from 'vitest';
import {readFileSync,openSync,readSync,closeSync} from 'node:fs';
import {CollisionWorld,type BoxCollider} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/GameInput';
import {BARN_CHESTS,barnChestColliders} from '../src/world/ExplorationSites';
import {sculptRegion,type OutcropShape} from '../src/world/terrain/WorldTerrain';
import {applyInitialRockFix} from '../src/world/terrain/InitialRocks';
import {BARN_VIEW_RANGE} from '../src/world/BarnInteriors';

interface Barn {
  id:string;name:string;region:string;collision:string;mesh:string;
  centre:{x:number;y:number;z:number};
  interior:{minX:number;maxX:number;minZ:number;maxZ:number;ceiling:number};
  door:{minX:number;maxX:number;z:number};
  palette:Record<string,string>;
  props:number;triangles:number;
  chests:{id:string;x:number;z:number;kind:string}[];
  colliders:BoxCollider[];
}
const read=(name:string)=>JSON.parse(readFileSync(`public/models/${name}.json`,'utf8'));
const manifest=read('barn-interiors') as {aisleHalfWidth:number;barns:Barn[]};
const outcrops=read('outcrop-rocks') as OutcropShape;

function append(target:{positions:number[];indices:number[]},part:{positions:readonly number[];indices:readonly number[]}):void {
  const offset=target.positions.length/3;
  for(const value of part.positions)target.positions.push(value);
  for(const index of part.indices)target.indices.push(index+offset);
}

/** The base field merged the way `FarmWorld.load` merges it, relief included. */
function baseWorld():CollisionWorld {
  const authored=read('farm-collision'),geometry=read('world-collision-mesh'),solid=read('solid-island-collision');
  applyInitialRockFix(geometry,read('initial-rock-fix'),outcrops);
  const merged={positions:[...geometry.positions as number[]],indices:[...geometry.indices as number[]]};
  append(merged,solid);
  const relief=sculptRegion('base',{positions:merged.positions,indices:merged.indices,boxes:[...authored.boxes,...geometry.boxes]});
  if(relief.terrain)append(merged,relief.terrain.collisionGeometry());
  const world=new CollisionWorld();
  world.boxes.push(...authored.boxes,...geometry.boxes,...solid.boxes);
  world.surfaces.push(...authored.surfaces);
  world.setGeometry(merged.positions,merged.indices);world.prepareRaycasts();
  return world;
}

/** A streamed region, sculpted the way its loader sculpts it. */
function regionWorld(id:string):CollisionWorld {
  const region=read(id+'-collision');
  const merged={positions:[...region.positions as number[]],indices:[...region.indices as number[]]};
  const sculpted=sculptRegion(id,region,outcrops);
  if(sculpted.terrain)append(merged,sculpted.terrain.collisionGeometry());
  for(const group of sculpted.outcrops)append(merged,group.geometry);
  const world=new CollisionWorld();
  world.boxes.push(...region.boxes);world.surfaces.push(...(region.surfaces??[]));
  world.setGeometry(merged.positions,merged.indices);world.prepareRaycasts();
  return world;
}

const worlds=new Map<string,CollisionWorld>();
function worldFor(barn:Barn):CollisionWorld {
  let world=worlds.get(barn.region);
  if(!world){
    world=barn.region==='base'?baseWorld():regionWorld(barn.region);
    // The chest crates are solid for the player exactly as RunInteractables makes them solid.
    world.movingBoxes.push(...barnChestColliders());
    worlds.set(barn.region,world);
  }
  return world;
}

describe('barn interiors',()=>{
  it('dresses at least three barns as distinct rooms rather than recolours of one',()=>{
    expect(manifest.barns.length).toBeGreaterThanOrEqual(3);
    const palettes=new Set(manifest.barns.map(barn=>JSON.stringify(barn.palette)));
    expect(palettes.size).toBe(manifest.barns.length);
    // Colour alone is not variety: no two barns may ship the same prop count AND the same mesh.
    const shapes=new Set(manifest.barns.map(barn=>`${barn.props}:${barn.triangles}`));
    expect(shapes.size).toBe(manifest.barns.length);
    for(const barn of manifest.barns){
      expect(barn.props,barn.id).toBeGreaterThan(20);
      expect(barn.colliders.length,barn.id).toBeGreaterThan(10);
    }
  });

  it('ships one mesh per barn under the name the runtime looks up',()=>{
    const fd=openSync('public/models/barn-interiors.glb','r');
    try {
      const head=Buffer.alloc(20);readSync(fd,head,0,20,0);
      expect(head.readUInt32LE(0)).toBe(0x46546c67);
      const chunk=Buffer.alloc(head.readUInt32LE(12));readSync(fd,chunk,0,chunk.length,20);
      const gltf=JSON.parse(chunk.toString('utf8')) as {meshes:{name:string;primitives:unknown[]}[];materials:{name:string}[]};
      for(const barn of manifest.barns){
        const mesh=gltf.meshes.find(candidate=>candidate.name===barn.mesh);
        expect(mesh,barn.mesh).toBeDefined();
        // Batched by material: a dressed room must not cost dozens of draw calls.
        expect(mesh!.primitives.length,barn.mesh).toBeLessThanOrEqual(8);
        expect(gltf.materials.some(material=>material.name.endsWith('_'+barn.id)),barn.id).toBe(true);
      }
    } finally { closeSync(fd); }
  });

  it('puts every authored prop collider into the collision file the client, server and bake read',()=>{
    for(const barn of manifest.barns){
      const shipped=new Map((read(barn.collision).boxes as BoxCollider[]).map(box=>[box.id,box] as const));
      for(const box of barn.colliders){
        expect(shipped.get(box.id),box.id).toEqual(box);
        // A prop that pokes through the shell would be solid on the outside of the barn.
        expect(box.min.x,box.id).toBeGreaterThanOrEqual(barn.interior.minX-.3);
        expect(box.max.x,box.id).toBeLessThanOrEqual(barn.interior.maxX+.3);
        expect(box.min.z,box.id).toBeGreaterThanOrEqual(barn.interior.minZ-.3);
        expect(box.max.z,box.id).toBeLessThanOrEqual(barn.interior.maxZ+.3);
      }
    }
  });

  it('leaves the doorway and the corridor to the deepest chest free of solid props',()=>{
    for(const barn of manifest.barns){
      const deepest=Math.max(...barn.chests.map(chest=>chest.z));
      for(const box of barn.colliders){
        const crossesAisle=box.min.x<barn.centre.x+manifest.aisleHalfWidth&&box.max.x>barn.centre.x-manifest.aisleHalfWidth;
        expect(crossesAisle&&box.min.z<deepest+.9,box.id).toBe(false);
        // Nothing may sit in the door opening itself.
        expect(box.min.z<barn.door.z+.1&&box.max.x>barn.door.minX&&box.min.x<barn.door.maxX,box.id).toBe(false);
      }
    }
  });

  it('stands every chest on the real barn floor and never inside solid geometry',()=>{
    expect(BARN_CHESTS.length).toBe(manifest.barns.reduce((total,barn)=>total+barn.chests.length,0));
    for(const barn of manifest.barns){
      const world=worldFor(barn);
      for(const chest of barn.chests){
        const site=BARN_CHESTS.find(candidate=>candidate.z===chest.z&&candidate.x===chest.x)!;
        expect(site,chest.id).toBeDefined();
        const floor=world.groundAt(site.x,site.z,barn.centre.y+.45);
        expect(floor,chest.id).toBeCloseTo(site.y,2);
        // Against every STRUCTURAL box of the district — the barn walls included — plus the props
        // this barn authored. `insideSolid` cannot be used here: the crate is itself a collider, so
        // the chest is always "inside" its own volume.
        for(const box of [...world.boxes,...barn.colliders]){
          const overlaps=site.x+.53>box.min.x&&site.x-.53<box.max.x&&site.z+.43>box.min.z&&site.z-.43<box.max.z&&site.y+.68>box.min.y&&site.y<box.max.y;
          expect(overlaps,`${chest.id} vs ${box.id}`).toBe(false);
        }
      }
    }
  });

  it('walks a player capsule in through the door and up to each chest',()=>{
    for(const barn of manifest.barns){
      const world=worldFor(barn);
      for(const site of BARN_CHESTS.filter(chest=>barn.chests.some(entry=>entry.x===chest.x&&entry.z===chest.z))){
        const player=new PlayerMotor(world,new EventBus(),{x:barn.centre.x,y:barn.centre.y,z:barn.door.z-2.4});
        // Two legs, the way a player walks it: in through the opening, then over to the crate.
        for(const goal of [{x:barn.centre.x,z:barn.door.z+1.6},{x:site.x,z:site.z}]){
          for(let tick=0;tick<720;tick++){
            if(Math.hypot(player.position.x-goal.x,player.position.z-goal.z)<.6)break;
            player.fixedUpdate(1/60,{...EMPTY_INPUT,z:1},Math.atan2(goal.x-player.position.x,goal.z-player.position.z));
          }
        }
        const reach=Math.hypot(player.position.x-site.x,player.position.z-site.z);
        // RunInteractables opens a crate within 3 m horizontally and 2 m vertically.
        expect(reach,site.id).toBeLessThan(3);
        expect(Math.abs(player.position.y-site.y),site.id).toBeLessThan(2);
        expect(player.respawns,site.id).toBe(0);
      }
    }
  });

  it('keeps the interior view range inside the distance its district streams at',()=>{
    // 110 m is SpatialRegionInterest's load distance. A lit, dressed room may never appear before
    // the barn it stands in.
    expect(BARN_VIEW_RANGE).toBeLessThan(110);
    for(const barn of manifest.barns){
      const span=Math.max(barn.interior.maxX-barn.interior.minX,barn.interior.maxZ-barn.interior.minZ);
      expect(BARN_VIEW_RANGE,barn.id).toBeGreaterThan(span);
    }
  });
});
