export type SkillTier=1|2|3;
export const SKILL_CUES={1:{name:'SEGURA MINHA CHIBATA',release:1.22,voiceEnd:3.90},2:{name:'RAJADA MORTAL',release:1.22,voiceEnd:3.86},3:{name:'FÚRIA MAGRÔNICA',release:1.2,voiceEnd:4.40}} as const;
/** Audio-clock driven: pausing the AudioContext pauses preparation without drifting. */
export class SkillTimeline {
 tier:SkillTier=1;duration=0;elapsed=0;active=false;released=false;
 start(tier:SkillTier,duration:number=SKILL_CUES[tier].voiceEnd):boolean{if(this.active)return false;this.tier=tier;this.duration=Math.min(SKILL_CUES[tier].voiceEnd,Math.max(SKILL_CUES[tier].release+.22,duration));this.elapsed=0;this.released=false;this.active=true;return true;}
 get actionProgress():number{return Math.max(0,Math.min(1,(this.elapsed-SKILL_CUES[this.tier].release)/(this.duration-SKILL_CUES[this.tier].release)));}
 get closeVisible():boolean{return this.active&&this.elapsed<SKILL_CUES[this.tier].release+.22;}
 get preparing():boolean{return this.active&&!this.released;}
 get progress():number{return Math.min(1,this.elapsed/SKILL_CUES[this.tier].release);}
 update(elapsed:number,release:(tier:SkillTier)=>void):void{if(!this.active)return;this.elapsed=Math.max(this.elapsed,elapsed);if(!this.released&&this.elapsed>=SKILL_CUES[this.tier].release){this.released=true;release(this.tier);}if(this.elapsed>=this.duration)this.active=false;}
 cancel():void{this.active=false;this.released=false;}
}
