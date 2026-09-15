import {StaticRayIndex} from '../physics/StaticRayIndex';
self.onmessage=(event:MessageEvent<{positions:number[];indices:number[]}>)=>{try{const index=new StaticRayIndex(event.data.positions,event.data.indices);self.postMessage({snapshot:index.snapshot()});}catch(error){self.postMessage({error:String(error)});}};
