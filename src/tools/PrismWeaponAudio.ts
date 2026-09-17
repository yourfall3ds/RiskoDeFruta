export const TRANSFORM_SOUNDS=['alien-pulse','alien-organic','alien-crystal','alien-portal','tech-servo'] as const;
export type TransformSound=typeof TRANSFORM_SOUNDS[number];
export type PrismSound='assault'|'sniper'|'grenade'|'impact-small'|'impact-ion'|'explosion'|'unlock'|'servo'|'lock'|'eject'|'insert'|'tech-unlock'|'tech-lock'|TransformSound;
export class PrismWeaponAudio{
 private context=new AudioContext();
 private gain=this.context.createGain();
 private buffers=new Map<PrismSound,AudioBuffer>();
 private voices=new Set<AudioBufferSourceNode>();
 constructor(){this.gain.gain.value=.45;this.gain.connect(this.context.destination);}
 async load(){
  const names:PrismSound[]=['assault','sniper','grenade','impact-small','impact-ion','explosion','unlock','servo','lock','eject','insert','tech-unlock','tech-lock',...TRANSFORM_SOUNDS];
  await Promise.all(names.map(async name=>{const r=await fetch(`/audio/prism/${name}.wav`);if(!r.ok)throw new Error(`Áudio ausente: ${name}`);this.buffers.set(name,await this.context.decodeAudioData(await r.arrayBuffer()));}));
 }
 async resume(){await this.context.resume();}
 volume(value:number){this.gain.gain.value=Math.max(0,Math.min(1,value));}
 play(name:PrismSound,rate=1){
  const buffer=this.buffers.get(name);if(!buffer||this.context.state!=='running')return;
  if(this.voices.size>=12){const oldest=this.voices.values().next().value;oldest?.stop();if(oldest)this.voices.delete(oldest);}
  const source=this.context.createBufferSource();source.buffer=buffer;source.playbackRate.value=Math.max(.65,Math.min(1.2,rate));source.connect(this.gain);
  this.voices.add(source);source.onended=()=>{this.voices.delete(source);source.disconnect();};source.start();
 }
 stop(){for(const source of this.voices)source.stop();this.voices.clear();}
}
