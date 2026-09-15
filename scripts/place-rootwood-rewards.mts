import fs from 'node:fs';
import {TriangleGround} from '../src/physics/TriangleGround.ts';
const d=JSON.parse(fs.readFileSync('art/rootwood-staging/rootwood-collision.json','utf8')),ground=new TriangleGround(d.navPositions,d.navIndices);
const sites=[['root-grove-entry',885,358],['root-grove-square',936,364],['root-grove-east',985,368],['root-mill-entry',1100,413],['root-mill-square',1146,424],['root-mill-south',1140,468],['root-seed-entry',1010,593],['root-seed-square',1033,630],['root-seed-south',1033,690]].map(([id,x,z],i)=>{const y=ground.height(x,z,100,50);if(!Number.isFinite(y))throw Error('No floor for '+id);return{id,x,y,z,kind:i%3===1?'shop':'supply'};});
fs.writeFileSync('src/world/RootwoodSites.ts','// Heights sampled from the authored collision surface.\nexport const ROOTWOOD_CHESTS='+JSON.stringify(sites,null,2)+' as const;\n');console.log(sites);
