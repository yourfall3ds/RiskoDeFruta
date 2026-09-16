import type { RandomStream } from '../core/RunRNG';
export type EnemyKind='eggplant'|'corn'|'watermelon'|'tomato'|'carrot'|'boss';
export const ENEMIES:Record<EnemyKind,{name:string;model:string;hp:number;speed:number;range:number;cost:number;radius:number;scale:number}>={
  eggplant:{name:'Berinjela predadora',model:'original-eggplant',hp:75,speed:3.5,range:9,cost:3,radius:.8,scale:1.2},
  corn:{name:'Milho artilheiro',model:'original-corn',hp:100,speed:2.6,range:17,cost:6,radius:.8,scale:1.3},
  watermelon:{name:'Melancia esmagadora',model:'original-watermelon',hp:240,speed:2.6,range:10,cost:12,radius:1.45,scale:1.35},
  tomato:{name:'Tomate de praga voador',model:'original-tomato',hp:115,speed:3.3,range:15,cost:8,radius:1.1,scale:1.25},
  carrot:{name:'Cenoura de raízes',model:'original-carrot',hp:90,speed:3,range:13,cost:6,radius:.7,scale:1.25},
  boss:{name:'PRAGA ALFA',model:'original-watermelon',hp:3600,speed:1.5,range:18,cost:0,radius:2.3,scale:2.5},
};
export type HordeState=0|1|2|3|4|5;
const COMPOSITIONS:readonly (readonly EnemyKind[])[]=[['eggplant','corn'],['eggplant','carrot'],['watermelon','eggplant'],['tomato','corn'],['eggplant','eggplant']];
export type DirectorMode='classic'|'horde'|'expedition';
export class MonsterDirector {
  time=0;credits=3;state:HordeState=0;stopped=false;private due=7;private bossRequested=false;
  wave=1;completedWaves=0;rewardsPending=0;intermission=5;spawned=0;private bossDefeated=false;
  /**
   * Pressão externa 0..1 vinda do evento em curso (marco ativo, chefe). Soma-se ao tempo
   * para acelerar a reposição sem ultrapassar o orçamento real de performance.
   */
  pressure=0;
  readonly mode:DirectorMode;
  constructor(private readonly rng:RandomStream,readonly stage=1,readonly cap=50,mode:DirectorMode|boolean='classic'){
    this.mode=mode===true?'horde':mode===false?'classic':mode;
  }
  get hordeMode():boolean{return this.mode==='horde';}
  /** Na expedição o objetivo é o totem; o diretor nunca espera a população zerar. */
  get objectiveMode():boolean{return this.mode==='expedition';}
  /**
   * Reposição contínua durante toda a expedição. Não há janela de silêncio nem espera pela
   * população zerar: a pressão sobe com o tempo e com o evento, limitada pelo orçamento real.
   */
  private updateExpedition(dt:number,population:number,spawn:(kind:EnemyKind)=>boolean,budget:number):void {
    this.time+=dt;
    const pressure=Math.max(0,Math.min(1,this.pressure));
    const score=this.time/55+pressure*1.5;
    this.state=(score<1?0:score<1.8?1:score<2.6?2:score<3.4?3:4) as HordeState;
    this.credits=Math.min(120,this.credits+dt*(1+this.state*1.05+this.stage*.2+pressure*1.8));
    this.due-=dt;
    const ceiling=Math.min(this.cap,budget);
    if(this.due>0||population>=ceiling)return;
    this.due=this.rng.range(1.5,2.9)/(1+this.state*.22+pressure*.5);
    const group=COMPOSITIONS[Math.floor(this.rng.next()*(this.state===0?2:COMPOSITIONS.length))]!;
    for(const kind of group){
      const cost=ENEMIES[kind].cost;
      if(this.credits<cost||population>=ceiling)break;
      if(spawn(kind)){this.credits-=cost;population++;break;}
      this.due=.4;break;
    }
  }
  get waveQuota():number{return 7+this.wave*3;}
  get healthMultiplier():number{return this.hordeMode?Math.pow(1.16,this.wave-1):1;}
  get damageMultiplier():number{return this.hordeMode?1+.12*(this.wave-1):1;}
  private updateHorde(dt:number,population:number,spawn:(kind:EnemyKind)=>boolean,budget:number):void{
    this.time+=dt;this.state=this.wave%5===0?4:Math.min(3,Math.floor((this.wave-1)/2)) as HordeState;
    if(this.intermission>0){this.intermission=Math.max(0,this.intermission-dt);return;}
    const ceiling=Math.min(this.cap,budget),bossWave=this.wave%5===0;
    if(this.spawned>=this.waveQuota&&population===0&&(!bossWave||this.bossDefeated)){
      this.completedWaves++;this.rewardsPending++;this.wave++;this.intermission=8;this.spawned=0;this.bossRequested=false;this.bossDefeated=false;this.due=.8;return;
    }
    this.due-=dt;if(this.due>0||population>=ceiling)return;
    if(bossWave&&!this.bossRequested){if(spawn('boss')){this.bossRequested=true;this.due=1.5;}return;}
    if(this.spawned>=this.waveQuota)return;
    const pool:EnemyKind[]=this.wave<2?['eggplant','corn']:this.wave<3?['eggplant','corn','carrot']:['eggplant','corn','carrot','tomato','watermelon'];
    if(spawn(this.rng.pick(pool))){this.spawned++;this.due=Math.max(.45,1.5-this.wave*.055);}else this.due=.35;
  }
  update(dt:number,kills:number,population:number,spawn:(kind:EnemyKind)=>boolean,budget=this.cap):void {
    if(this.stopped)return;
    if(this.hordeMode){this.updateHorde(dt,population,spawn,budget);return;}
    if(this.objectiveMode){this.updateExpedition(dt,population,spawn,budget);return;}
    this.time+=dt;
    const score=this.time+Math.min(kills*2.2,this.time*.65);
    this.state=(score<45?0:score<100?1:score<160?2:score<225?3:4);
    if(this.state===4){if(!this.bossRequested&&spawn('boss'))this.bossRequested=true;return;}
    this.credits=Math.min(90,this.credits+dt*(.8+this.state*1.1+this.stage*.2));this.due-=dt;
    const ceiling=Math.min(this.cap,budget);if(this.due>0||population>=ceiling)return;
    const wave=this.time%36;if(wave>27)return;
    this.due=this.rng.range(2.1,3.5)/(1+this.state*.2);
    const group=COMPOSITIONS[this.state===0?Math.floor(this.rng.next()*2):Math.floor(this.rng.next()*COMPOSITIONS.length)]!;
    for(const kind of group){const cost=ENEMIES[kind].cost;if(this.credits<cost||population>=ceiling)break;if(spawn(kind)){this.credits-=cost;population++;break;}}
  }
  /** Aposentar um inimigo distante devolve orçamento; nunca conta como abate nem paga recompensa. */
  retireLivingEnemy():void {if(this.hordeMode)this.spawned=Math.max(0,this.spawned-1);else if(this.objectiveMode)this.credits=Math.min(120,this.credits+1);}
  bossKilled():void {if(this.hordeMode){this.bossDefeated=true;return;}if(this.objectiveMode){this.state=5;return;}this.stopped=true;this.state=5;}
}
