import {readGlb,values} from './glb-tools.mjs';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector.js';
for(const species of ['tomato','watermelon']){
 const g=readGlb(`public/models/original-${species}.glb`),j=g.json,parents=new Map();j.nodes.forEach((n,i)=>n.children?.forEach(c=>parents.set(c,i)));
 const world=i=>{const n=j.nodes[i],m=Matrix.Compose(Vector3.FromArray(n.scale??[1,1,1]),Quaternion.FromArray(n.rotation??[0,0,0,1]),Vector3.FromArray(n.translation??[0,0,0]));return parents.has(i)?m.multiply(world(parents.get(i))):m;};
 console.log(species);for(const i of j.skins[0].joints){const n=j.nodes[i];console.log(n.name,'parent',j.nodes[parents.get(i)]?.name,'xyz',world(i).getTranslation().asArray().map(n=>n.toFixed(3)).join(','));}
}
