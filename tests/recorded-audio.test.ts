import {it,expect,vi} from 'vitest';
import {WeaponAudio} from '../src/audio/RecordedAudio';
it('plays a recording for every player shot even immediately after corn fires',async()=>{
 const starts:number[]=[];let decoded=0;
 const parameter=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},setTargetAtTime(){}});
 const node=()=>({connect(){},disconnect(){},gain:parameter(),pan:parameter()});
 class Context {state='running';currentTime=2;destination={};resume(){return Promise.resolve();}close(){return Promise.resolve();}createGain(){return node();}createStereoPanner(){return node();}decodeAudioData(){decoded++;return Promise.resolve({duration:.25});}createBufferSource(){return{...node(),buffer:null,playbackRate:parameter(),start(t:number){starts.push(t);},stop(){},onended:null};}}
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({pistol:['/pistol.wav']}),arrayBuffer:async()=>new ArrayBuffer(8)})));
 const audio=new WeaponAudio();try{audio.unlock();await vi.waitFor(()=>expect(decoded).toBe(4));audio.enemy('attack','corn',2);audio.shot(false);audio.shot(false);expect(starts).toEqual([2,2,2]);}finally{audio.dispose();vi.unstubAllGlobals();}
});
