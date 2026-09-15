import { PISTOL_TUNING as t } from '../player/PlayerTuning';
export class PistolCadence {
  private cooldown=0;
  private next: 0 | 1=0;
  shots=0;
  rateMultiplier=1;
  reset():void {this.cooldown=0;this.next=0;this.shots=0;this.rateMultiplier=1;}
  update(dt: number,firing: boolean,shoot: (side: 0 | 1) => void): void {
    if(!firing){this.cooldown=Math.max(0,this.cooldown-dt);return;}
    if(this.cooldown<=1e-9){
      shoot(this.next);this.next=this.next===0?1:0;this.shots++;
      this.cooldown+=1/(t.rate*this.rateMultiplier);
    }
    // Preserve fractions, with the first shot at the start of the simulation tick.
    this.cooldown-=dt;
  }
}
