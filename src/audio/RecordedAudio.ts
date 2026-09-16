import {SKILL_CUES} from '../combat/SkillTimeline';
import {EnemyAudioOverrides} from './EnemyAudioOverrides';
import {
 ENEMY_AUDIO_BOSS_RATE,enemyAudioEventSpec,enemyAudioGroup,enemyAudioLoudness,isEnemyAudioEvent,isEnemyAudioKind,
 type EnemyAudioEvent,type EnemyAudioKind,
} from './EnemyAudioCatalog';
/** Recorded assets from the licensed library and the user's supplied combat project. */

export interface WeaponAudioOptions {
 /** `null` desliga as substituições do estúdio (testes/servidor). Padrão: painel do usuário. */
 enemyOverrides?:EnemyAudioOverrides|null;
}

export class WeaponAudio {

 private context:AudioContext|undefined;private master:GainNode|undefined;

 private readonly buffers=new Map<string,AudioBuffer[]>();private readonly sequence=new Map<string,number>();private readonly cooldown=new Map<string,number>();

 private duckUntil=0;private loading=false;private disposed=false;private voices=0;private volume=.55;private active=true;

 music=false;enabled=true;

 private voiceReady:Promise<void>=Promise.resolve();private skillSource:AudioBufferSourceNode|undefined;

 /**
  * Substituições escolhidas no estúdio (`/audio-lab.html`). O cache é atualizado sozinho pelo
  * BroadcastChannel da própria classe, então aqui nunca há polling nem espera dentro do loop.
  */
 readonly enemyOverrides:EnemyAudioOverrides|undefined;
 private readonly ownsOverrides:boolean;

 constructor(options:WeaponAudioOptions={}){
  this.ownsOverrides=options.enemyOverrides===undefined;
  this.enemyOverrides=options.enemyOverrides===null?undefined:options.enemyOverrides??new EnemyAudioOverrides();
  this.voiceBytes=Promise.all(["segura-minha-chibata-skill1.mp3","rajada-mortal-skill2.mp3","furia-magronica-skill3.mp3"].map(async f=>{const r=await fetch("/audio/skills/"+f);if(!r.ok)throw Error(f);return r.arrayBuffer();}));void this.voiceBytes.catch(()=>{});this.foleyBytes=fetch('/audio/foley-manifest.json').then(r=>{if(!r.ok)throw Error('Banco de áudio');return r.json() as Promise<Record<string,string[]>>;}).then(async manifest=>{const bytes=new Map<string,ArrayBuffer>();await Promise.all([...new Set(Object.values(manifest).flat())].map(async file=>{const response=await fetch(file);if(!response.ok)throw Error(file);bytes.set(file,await response.arrayBuffer());}));return{manifest,bytes};});void this.foleyBytes.catch(()=>{});}

 private readonly foleyBytes:Promise<{manifest:Record<string,string[]>;bytes:Map<string,ArrayBuffer>}>;
 private readonly voiceBytes:Promise<ArrayBuffer[]>;

 async voice(tier:1|2|3):Promise<{clock:()=>number;duration:number}>{await this.voiceReady;const ctx=this.context,clip=this.buffers.get("voice-skill"+tier)?.[0];if(!ctx||!clip)throw Error("Áudio da habilidade indisponível");this.skillSource?.stop();const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=clip;gain.gain.value=this.enabled?1:0;source.connect(gain);gain.connect(this.master!);const start=ctx.currentTime+.04,duration=Math.min(clip.duration,SKILL_CUES[tier].voiceEnd);gain.gain.setValueAtTime(this.enabled?1:0,start);gain.gain.setValueAtTime(this.enabled?1:0,start+duration-.06);gain.gain.linearRampToValueAtTime(0,start+duration);this.duckUntil=start+duration;this.skillSource=source;source.onended=()=>{source.disconnect();gain.disconnect();if(this.skillSource===source)this.skillSource=undefined;};source.start(start);source.stop(start+duration);return{clock:()=>Math.max(0,ctx.currentTime-start),duration};}

 cancelVoice():void{this.skillSource?.stop();this.skillSource=undefined;}

 unlock():void {

  if(this.disposed)return;this.context??=new AudioContext({latencyHint:'interactive'});void this.context.resume();

  if(!this.master){this.master=this.context.createGain();this.master.gain.value=this.volume;this.master.connect(this.context.destination);}

  // Liga o contexto às escolhas do usuário e decodifica os arquivos já salvos.
  void this.enemyOverrides?.prepare(this.context).catch(error=>console.warn('Sons substituídos do inimigo',error));

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

 private play(group:string,volume=1,rate=1,pan=0,gap=.05,delay=0,maxSeconds=Infinity):void {

  const context=this.context,clips=this.buffers.get(group==='player-pistol'?'pistol':group);if(!context||context.state!=='running'||!this.active||!this.enabled||!clips?.length||this.voices>=(group==='player-death'?48:group==='player-pistol'?40:group==='player-hit'?32:18))return;

  const last=this.cooldown.get(group)??-10;if(context.currentTime-last<gap)return;this.cooldown.set(group,context.currentTime);

  const index=this.sequence.get(group)??0;this.sequence.set(group,index+1);const source=context.createBufferSource(),gain=context.createGain(),stereo=context.createStereoPanner();

  source.buffer=clips[index%clips.length]!;source.playbackRate.value=rate;gain.gain.value=volume*(group!=='player-hit'&&context.currentTime<this.duckUntil?(group==='player-pistol'?.65:.35):1);stereo.pan.value=Math.max(-1,Math.min(1,pan));source.connect(gain);gain.connect(stereo);stereo.connect(this.master!);this.voices++;source.start(context.currentTime+delay);source.onended=()=>{this.voices--;source.disconnect();gain.disconnect();stereo.disconnect();};
  if(Number.isFinite(maxSeconds)&&source.buffer.duration/rate>maxSeconds){const end=context.currentTime+delay+maxSeconds;gain.gain.setValueAtTime(gain.gain.value,end-.15);gain.gain.linearRampToValueAtTime(0,end);source.stop(end);}

 }

 shot(hit:boolean):void {this.play('player-pistol',.8,1,0,0);if(hit)this.impact();}

 casing(strength=1,_x=0):void {this.play('casing',.32*strength,1,0,.045);}
 reload():void{this.play('reload',.7,1.18,0,.1,0);}
 fatalImpact():void {this.play('player-death',1,.95,0,0,.08);this.play('heavy',1,.72,0,0);this.play('heavy',.42,.72,0,0,.16);this.play('heavy',.2,.72,0,0,.34);}
 /**
  * Dano recebido. O PRIMEIRO acerto direto depois de um respiro sempre é audível: ele ignora o
  * intervalo anti-metralhadora. Dano periódico (fogo) tem cadência própria e mais baixa, para não
  * mascarar o golpe seguinte nem virar ruído contínuo.
  */
 playerHurt(source:'melee'|'projectile'|'laser'|'fire'|'dot'|'environment'='melee'):void {
  const context=this.context;if(context)this.duckUntil=context.currentTime+.25;
  const periodic=source==='dot'||source==='fire';
  if(periodic){this.play('player-hit',.42,.95,0,.55);this.play('impact',.2,1.25,0,.55);return;}
  // Sem respiro recente o som sai imediatamente; o gap só evita repetição em rajada contínua.
  const quiet=!context||context.currentTime-(this.cooldown.get('player-hit')??-10)>.5;
  const gap=quiet?0:.1;
  const rate=source==='laser'?1.15:source==='projectile'?1.05:source==='environment'?.7:.82;
  this.play('player-hit',.95,rate,0,gap);
  if(source==='laser')this.play('charge',.34,1.3,0,gap);
  else if(source==='projectile')this.play('impact',.4,1.1,0,gap);
  else if(source==='environment')this.play('body-ground',.35,1,0,gap);
 }

 /**
  * Impacto do acerto de uma habilidade. Cada uma tem timbre próprio: o som do disparo não
  * substitui o do impacto, e errar continua silencioso quanto a impacto.
  */
 skillImpact(id:string):void {
  if(id==='ricochet_fan'){this.play('impact',.34,1.22,0,.05);this.play('charge',.14,1.35,0,.12);return;}
  if(id==='backflip_barrage'){this.play('impact',.4,.95,0,.05);this.play('heavy',.22,1.05,0,.12);return;}
  if(id==='harvest_storm'){this.play('heavy',.34,1.12,0,.06);this.play('charge',.18,1.5,0,.14);return;}
  if(id.startsWith('unarmed_')){
   const group=id.endsWith('spin-kick')?'melee-heavy-kick':id.endsWith('uppercut')?'melee-heavy-punch':id.includes('kick')?'melee-kick':'melee-punch';
   this.play(group,.5,1,0,.08);return;
  }
  this.impact();
 }

 impact(heavy=false):void {this.play(heavy?'heavy':'impact',heavy?.5:.32,1,0,.08);}
 /** Air displacement at the active frame; an impact is played separately only after contact. */
 meleeSwing():void {this.play('melee-swing',.22,1,0,.08);}
 /** Only real lethal heavy-melee launches; short fade prevents a long flight loop over combat. */
 meleeLaunch(distance:number):void {if(distance<24)this.play('melee-launch',.32*Math.max(0,1-distance/24),1,0,.65,0,1.1);}
 bodyGround(strength=1):void {this.play('body-ground',.4*Math.min(1,strength),1,0,.12);}

 /**
  * Entrada pela nave. Usa só gravações já licenciadas do manifest — nenhum arquivo novo, nenhum
  * ruído sintético — e nenhum caminho de substituição do estúdio do usuário é tocado aqui.
  */
 arrivalWind(strength:number):void {const power=Math.max(0,Math.min(1,strength));this.play('swish',.22+power*.34,.58,0,.3);}
 /** Corpo se apoiando e levantando depois do impacto. */
 arrivalRise():void {this.play('grass',.5,.82,0,.05);this.play('heavy',.18,1.2,0,.05,.1);}

 dodge():void {this.play('swish',.75,.8);}

 footstep(surface:'grass'|'wood'|'concrete'|'water',speed=1):void {this.play(surface,surface==='water'?.28:.65,Math.min(1.12,.92+speed*.025),0,.12);}

 splash():void {this.play('water',.4,.9);}

 charge(tier:1|2|3):void {this.play('charge',.2+.05*tier,.85+tier*.12,0,.12);}

 skill(id:string):void {if(id==='jump'||id==='wall_jump'||id==='air_jump')this.play('swish',.25,1.15);else{this.play('swish',.65,.7);this.play('heavy',.25,.75);}}

 /**
  * Som de inimigo, já respeitando o estúdio do usuário.
  *
  * Os padrões (grupo, ganho, gap, playbackRate) vêm do catálogo compartilhado
  * `EnemyAudioCatalog` — não existe uma segunda tabela aqui que possa divergir do painel.
  * Enquanto `overrides.ready` ainda carrega, o cache está vazio e tudo soa no padrão;
  * nada bloqueia o loop de áudio esperando IndexedDB.
  *
  * `attack` toca DOIS eventos independentes: a voz (`attack`) e o ruído (`attack-layer`).
  * Cada um pode ser silenciado, ter volume próprio ou arquivo próprio sem afetar o outro —
  * e silenciar o ruído do milho não silencia a pistola do jogador, que usa outro caminho.
  */
 enemy(event:EnemyAudioEvent|'spawn'|'windup'|'attack'|'hit'|'death'|'dodge',kind:string,distance:number,pan=0):void {

  if(!(distance<=32)||!isEnemyAudioKind(kind)||!isEnemyAudioEvent(event))return;
  this.enemyEvent(event,kind,distance,pan);
  if(event==='attack')this.enemyEvent('attack-layer',kind,distance,pan);

 }

 private enemyEvent(event:EnemyAudioEvent,kind:EnemyAudioKind,distance:number,pan:number):void {

  const overrides=this.enemyOverrides;
  // `gainFor` já devolve 0 para silenciado, volume zerado ou fora de alcance.
  const loudness=overrides?overrides.gainFor(kind,event,distance):enemyAudioLoudness(event,distance);
  if(!(loudness>0))return;
  const spec=enemyAudioEventSpec(event),rate=kind==='boss'&&event!=='attack-layer'?ENEMY_AUDIO_BOSS_RATE:1;

  const custom=overrides&&this.context?overrides.getBuffer(this.context,kind,event):undefined;
  // Arquivo do usuário tem prioridade absoluta e cadência própria, para não herdar o
  // intervalo de um grupo compartilhado (o `pistol` do milho e o do jogador, por exemplo).
  if(custom){this.playBuffer('override:'+kind+':'+event,custom,loudness,rate,pan,spec.gap);return;}

  const generic=enemyAudioGroup(kind,event),speciesGroup='enemy-'+kind+'-'+generic;
  this.play(this.buffers.has(speciesGroup)?speciesGroup:generic,loudness,rate,pan,spec.gap);

 }

 /** Mesma mixagem do `play`, com um buffer avulso e cadência isolada por chave. */
 private playBuffer(key:string,buffer:AudioBuffer,volume:number,rate:number,pan:number,gap:number):void {

  const context=this.context;
  if(!context||context.state!=='running'||!this.active||!this.enabled||this.voices>=18)return;
  const last=this.cooldown.get(key)??-10;if(context.currentTime-last<gap)return;this.cooldown.set(key,context.currentTime);

  const source=context.createBufferSource(),gain=context.createGain(),stereo=context.createStereoPanner();
  source.buffer=buffer;source.playbackRate.value=rate;
  gain.gain.value=volume*(context.currentTime<this.duckUntil?.35:1);
  stereo.pan.value=Math.max(-1,Math.min(1,pan));
  source.connect(gain);gain.connect(stereo);stereo.connect(this.master!);this.voices++;
  source.start(context.currentTime);
  source.onended=()=>{this.voices--;source.disconnect();gain.disconnect();stereo.disconnect();};

 }

 /**
  * Ambiente de chuva em laço, com volume proporcional à intensidade.
  *
  * Toca o grupo `rain` do manifest de foley. **Esse grupo ainda não existe**: nenhuma gravação de
  * chuva foi baixada e licenciada para este projeto, e a regra do arquivo proíbe ruído sintético.
  * Enquanto o grupo faltar, nada toca — de propósito. Não reaproveito `water`, que são respingos de
  * passo e soariam errados como chuva. Basta acrescentar `"rain": [...]` ao manifest para ligar.
  */
 ambientRain(intensity:number):void {
  const context=this.context,clips=this.buffers.get('rain');
  const wanted=Math.max(0,Math.min(1,intensity));
  if(!context||!clips?.length){this.rainGain=undefined;return;}
  if(!this.rainSource){
   if(wanted<=0)return;
   const source=context.createBufferSource(),gain=context.createGain();
   source.buffer=clips[0]!;source.loop=true;gain.gain.value=0;
   source.connect(gain);gain.connect(this.master!);source.start();
   this.rainSource=source;this.rainGain=gain;
  }
  this.rainGain?.gain.setTargetAtTime(wanted*.32,context.currentTime,1.2);
 }
 private rainSource:AudioBufferSourceNode|undefined;private rainGain:GainNode|undefined;

 dispose():void {this.disposed=true;this.rainSource?.stop();this.rainSource=undefined;this.rainGain=undefined;this.buffers.clear();if(this.ownsOverrides)this.enemyOverrides?.dispose();void this.context?.close();}

}

