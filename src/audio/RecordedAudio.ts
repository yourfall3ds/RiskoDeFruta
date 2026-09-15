import {SKILL_CUES} from '../combat/SkillTimeline';
/** Downloaded CC0 recordings only: no oscillators, generated noise or synthetic fallback. */

export class WeaponAudio {

 private context:AudioContext|undefined;private master:GainNode|undefined;

 private readonly buffers=new Map<string,AudioBuffer[]>();private readonly sequence=new Map<string,number>();private readonly cooldown=new Map<string,number>();

 private duckUntil=0;private loading=false;private disposed=false;private voices=0;private volume=.55;private active=true;

 music=false;enabled=true;

 private voiceReady:Promise<void>=Promise.resolve();private skillSource:AudioBufferSourceNode|undefined;

 constructor(){this.voiceBytes=Promise.all(["segura-minha-chibata-skill1.mp3","rajada-mortal-skill2.mp3","furia-magronica-skill3.mp3"].map(async f=>{const r=await fetch("/audio/skills/"+f);if(!r.ok)throw Error(f);return r.arrayBuffer();}));void this.voiceBytes.catch(()=>{});this.foleyBytes=fetch('/audio/foley-manifest.json').then(r=>{if(!r.ok)throw Error('Banco de áudio');return r.json() as Promise<Record<string,string[]>>;}).then(async manifest=>{const bytes=new Map<string,ArrayBuffer>();await Promise.all([...new Set(Object.values(manifest).flat())].map(async file=>{const response=await fetch(file);if(!response.ok)throw Error(file);bytes.set(file,await response.arrayBuffer());}));return{manifest,bytes};});void this.foleyBytes.catch(()=>{});}

 private readonly foleyBytes:Promise<{manifest:Record<string,string[]>;bytes:Map<string,ArrayBuffer>}>;
 private readonly voiceBytes:Promise<ArrayBuffer[]>;

 async voice(tier:1|2|3):Promise<{clock:()=>number;duration:number}>{await this.voiceReady;const ctx=this.context,clip=this.buffers.get("voice-skill"+tier)?.[0];if(!ctx||!clip)throw Error("Áudio da habilidade indisponível");this.skillSource?.stop();const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=clip;gain.gain.value=this.enabled?1:0;source.connect(gain);gain.connect(this.master!);const start=ctx.currentTime+.04,duration=Math.min(clip.duration,SKILL_CUES[tier].voiceEnd);gain.gain.setValueAtTime(this.enabled?1:0,start);gain.gain.setValueAtTime(this.enabled?1:0,start+duration-.06);gain.gain.linearRampToValueAtTime(0,start+duration);this.duckUntil=start+duration;this.skillSource=source;source.onended=()=>{source.disconnect();gain.disconnect();if(this.skillSource===source)this.skillSource=undefined;};source.start(start);source.stop(start+duration);return{clock:()=>Math.max(0,ctx.currentTime-start),duration};}

 cancelVoice():void{this.skillSource?.stop();this.skillSource=undefined;}

 unlock():void {

  if(this.disposed)return;this.context??=new AudioContext({latencyHint:'interactive'});void this.context.resume();

  if(!this.master){this.master=this.context.createGain();this.master.gain.value=this.volume;this.master.connect(this.context.destination);}

  if(this.loading)return;this.loading=true;const context=this.context;

  this.voiceReady=this.voiceBytes.then(async bytes=>{const clips=await Promise.all(bytes.map(b=>context.decodeAudioData(b.slice(0))));if(!this.disposed)clips.forEach((clip,i)=>this.buffers.set("voice-skill"+(i+1),[clip]));});void this.voiceReady.catch(error=>console.warn("Voz de habilidade",error));

  void this.foleyBytes.then(async({manifest,bytes})=>{

   const decoded=new Map<string,Promise<AudioBuffer>>();const decode=(file:string)=>{let p=decoded.get(file);if(!p){p=context.decodeAudioData(bytes.get(file)!.slice(0));decoded.set(file,p);}return p;};
   const results=await Promise.allSettled(Object.entries(manifest).filter(([key])=>!key.startsWith("voice-")).map(async([key,files])=>{const clips=await Promise.all(files.map(decode));if(!this.disposed)this.buffers.set(key,clips);}));

   for(const result of results)if(result.status==='rejected'&&!this.disposed)console.warn('Amostra de áudio indisponível',result.reason);

  }).catch(error=>{if(!this.disposed)console.warn('Banco de áudio',error);});

 }

 setVolume(value:number):void {this.volume=value;this.master?.gain.setTargetAtTime(this.active?value:0,this.context!.currentTime,.08);}

 setActive(active:boolean):void {this.active=active;this.setVolume(this.volume);if(this.context)void(active?this.context.resume():this.context.suspend());}

 update(_dt:number,_intensity=0):void {}

 private play(group:string,volume=1,rate=1,pan=0,gap=.05,delay=0):void {

  const context=this.context,clips=this.buffers.get(group==='player-hit'?'heavy':group==='player-pistol'?'pistol':group);if(!context||context.state!=='running'||!this.active||!this.enabled||!clips?.length||this.voices>=(group==='player-death'?48:group==='player-pistol'?40:group==='player-hit'?32:18))return;

  const last=this.cooldown.get(group)??-10;if(context.currentTime-last<gap)return;this.cooldown.set(group,context.currentTime);

  const index=this.sequence.get(group)??0;this.sequence.set(group,index+1);const source=context.createBufferSource(),gain=context.createGain(),stereo=context.createStereoPanner();

  source.buffer=clips[index%clips.length]!;source.playbackRate.value=rate;gain.gain.value=volume*(group!=='player-hit'&&context.currentTime<this.duckUntil?(group==='player-pistol'?.65:.35):1);stereo.pan.value=Math.max(-1,Math.min(1,pan));source.connect(gain);gain.connect(stereo);stereo.connect(this.master!);this.voices++;source.start(context.currentTime+delay);source.onended=()=>{this.voices--;source.disconnect();gain.disconnect();stereo.disconnect();};

 }

 shot(hit:boolean):void {this.play('player-pistol',.8,1,0,0);if(hit)this.impact();}

 casing(strength=1,_x=0):void {this.play('casing',.32*strength,1,0,.045);}
 reload():void{this.play('reload',.7,1.18,0,.1,0);}
 fatalImpact():void {this.play('player-death',1,.95,0,0,.08);this.play('heavy',1,.72,0,0);this.play('heavy',.42,.72,0,0,.16);this.play('heavy',.2,.72,0,0,.34);}
 playerHurt():void {if(this.context)this.duckUntil=this.context.currentTime+.25;this.play('player-hit',.95,.82,0,.12);}

 impact(heavy=false):void {this.play(heavy?'heavy':'impact',heavy?.5:.32,1,0,.08);}

 dodge():void {this.play('swish',.75,.8);}

 footstep(surface:'grass'|'wood'|'concrete'|'water',speed=1):void {this.play(surface,surface==='water'?.28:.65,Math.min(1.12,.92+speed*.025),0,.12);}

 splash():void {this.play('water',.4,.9);}

 charge(tier:1|2|3):void {this.play('charge',.2+.05*tier,.85+tier*.12,0,.12);}

 skill(id:string):void {if(id==='jump'||id==='wall_jump'||id==='air_jump')this.play('swish',.25,1.15);else{this.play('swish',.65,.7);this.play('heavy',.25,.75);}}

 enemy(event:'spawn'|'windup'|'attack'|'hit'|'death'|'dodge',kind:string,distance:number,pan=0):void {

  if(distance>32)return;const group=event==='windup'?'growl':event==='hit'?'hurt':event==='dodge'?'swish':event;

  const voiceGroup='enemy-'+kind+'-'+group,selected=this.buffers.has(voiceGroup)?voiceGroup:group;
  const loudness=(event==='hit'?.3:event==='windup'?.58:.46)/(1+distance*distance/144);
  this.play(selected,loudness,kind==='boss'?.9:1,pan,event==='hit'?.18:.45);
  if(event==='attack'){const impact=kind==='corn'?'pistol':kind==='tomato'?'swish':kind==='carrot'?'charge':'heavy';this.play(impact,loudness*.75,1,pan,.18);}

 }

 dispose():void {this.disposed=true;this.buffers.clear();void this.context?.close();}

}

