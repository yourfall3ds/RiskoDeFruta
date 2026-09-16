import {ROOTWOOD_CHESTS} from './RootwoodSites';
export {ROOTWOOD_CHESTS} from './RootwoodSites';
import {HIGHLAND_CHESTS} from './HighlandSites';
export {HIGHLAND_CHESTS} from './HighlandSites';
import {BARN_CHESTS} from './BarnSites';
export {BARN_CHESTS} from './BarnSites';
import type {BoxCollider} from '../physics/CollisionWorld';
export const CITY_CHESTS=[
 {id:'seeds-courtyard',x:97,y:2,z:-8,kind:'supply'},
 {id:'seeds-west-market',x:83,y:2,z:13,kind:'shop'},
 {id:'seeds-east-market',x:117,y:2,z:10,kind:'supply'},
 {id:'solar-arrival',x:102,y:12,z:57,kind:'supply'},
 {id:'solar-west-market',x:88,y:12,z:76,kind:'shop'},
 {id:'solar-east-market',x:122,y:12,z:77,kind:'supply'},
 {id:'harvest-arrival',x:157,y:7,z:30,kind:'supply'},
 {id:'harvest-west-market',x:143,y:7,z:46,kind:'shop'},
 {id:'harvest-east-market',x:177,y:7,z:47,kind:'supply'},
] as const;

/** Shared by runtime, server and navigation bake. Opening a lid does not remove the crate. */
export function cityChestColliders():BoxCollider[]{return CITY_CHESTS.map(site=>({id:'city-chest-'+site.id,min:{x:site.x-.53,y:site.y,z:site.z-.43},max:{x:site.x+.53,y:site.y+.68,z:site.z+.43}}));}

export const FRONTIER_CHESTS=[
 {id:'orchard-arrival',x:239,y:9,z:26,kind:'supply'},
 {id:'orchard-elevator',x:246,y:9,z:59,kind:'shop'},
 {id:'orchard-east-grove',x:276,y:9,z:24,kind:'supply'},
 {id:'port-square',x:285,y:15,z:129,kind:'supply'},
 {id:'port-market',x:307,y:15,z:127,kind:'shop'},
 {id:'port-overlook',x:278,y:15,z:174,kind:'supply'},
 {id:'glasshouse-arrival',x:285,y:15,z:230,kind:'supply'},
 {id:'glasshouse-west-hall',x:254,y:15,z:285,kind:'shop'},
 {id:'glasshouse-east-hall',x:316,y:15,z:285,kind:'shop'},
 {id:'glasshouse-north-plaza',x:285,y:15,z:324,kind:'supply'},
 {id:'glasshouse-west-overlook',x:222,y:15,z:280,kind:'supply'},
] as const;
export function frontierChestColliders():BoxCollider[]{return FRONTIER_CHESTS.map(site=>({id:'frontier-chest-'+site.id,min:{x:site.x-.53,y:site.y,z:site.z-.43},max:{x:site.x+.53,y:site.y+.68,z:site.z+.43}}));}

export function highlandChestColliders():BoxCollider[]{return HIGHLAND_CHESTS.map(site=>({id:'highland-chest-'+site.id,min:{x:site.x-.53,y:site.y,z:site.z-.43},max:{x:site.x+.53,y:site.y+.68,z:site.z+.43}}));}

export function rootwoodChestColliders():BoxCollider[]{return ROOTWOOD_CHESTS.map(site=>({id:'rootwood-chest-'+site.id,min:{x:site.x-.53,y:site.y,z:site.z-.43},max:{x:site.x+.53,y:site.y+.68,z:site.z+.43}}));}

/**
 * Loot inside the five walk-in barns, on the floor `scripts/place-barn-chests.mts` sampled from the
 * shipped collision. These are the reward for going through a door the player used to walk past.
 */
export function barnChestColliders():BoxCollider[]{return BARN_CHESTS.map(site=>({id:'barn-chest-'+site.id,min:{x:site.x-.53,y:site.y,z:site.z-.43},max:{x:site.x+.53,y:site.y+.68,z:site.z+.43}}));}
