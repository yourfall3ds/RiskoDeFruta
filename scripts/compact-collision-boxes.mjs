import {readFileSync,writeFileSync} from 'node:fs';
const path='public/models/world-collision-mesh.json',data=JSON.parse(readFileSync(path,'utf8')),groups=new Map(),keep=[];
for(const box of data.boxes){if(!box.id.startsWith('Harvest farm-barrels')){keep.push(box);continue;}const id=box.id.split(':')[0];if(!groups.has(id))groups.set(id,[]);groups.get(id).push(box);}
for(const [id,boxes] of groups){const min={},max={};for(const axis of ['x','y','z']){min[axis]=Math.min(...boxes.map(b=>b.min[axis]));max[axis]=Math.max(...boxes.map(b=>b.max[axis]));}if(Math.max(max.x-min.x,max.z-min.z)<4)keep.push({id:id+':solid',min,max});else keep.push(...boxes);}
console.log('collider components',data.boxes.length,'→',keep.length);data.boxes=keep;writeFileSync(path,JSON.stringify(data));
