import fs from 'node:fs';
import {CollisionWorld} from '../src/physics/CollisionWorld';
const data=JSON.parse(fs.readFileSync('public/models/highland-farms-collision.json','utf8'));
const world=new CollisionWorld();world.setGeometry(data.positions,data.indices);world.boxes.push(...data.boxes);world.prepareRaycasts();
const positions=[['highland-arrival',420,280,'supply'],['highland-west-fields',465,250,'shop'],['highland-east-fields',548,270,'supply'],['windmill-arrival',650,310,'supply'],['windmill-square',720,330,'shop'],['windmill-overlook',782,325,'supply'],['valley-arrival',580,450,'supply'],['valley-square',610,515,'shop'],['valley-south',610,580,'supply']] as const;
const sites=positions.map(([id,x,z,kind])=>{const y=world.groundAt(x,z,100);if(!Number.isFinite(y)||world.insideSolid({x,y,z},.7))throw Error('Invalid reward location '+id);return{id,x,y,z,kind};});
fs.writeFileSync('src/world/HighlandSites.ts',"// Generated from the actual highland collision floor by scripts/place-highland-rewards.mts.\nexport const HIGHLAND_CHESTS="+JSON.stringify(sites,null,2)+" as const;\n");
console.log(sites);
