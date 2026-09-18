import {describe,it,expect} from 'vitest';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {TrainingTarget} from '../src/world/TrainingYard';
import type {CombatContact,CombatEffects,CombatHitSpec,CombatServices,CombatSweep} from '../src/combat/CombatServices';
import {PrismWeapon,type PrismCommand,type PrismRigPort} from '../src/combat/PrismWeapon';
import {PrismArsenal} from '../src/combat/PrismArsenal';
import {PrismTrigger} from '../src/combat/PrismTrigger';
import {blastFalloff} from '../src/combat/PrismGrenades';
import {PRISM_GRENADE,PRISM_MODES} from '../src/combat/PrismTuning';
import {weaponReadout} from '../src/ui/WeaponReadout';
import {awardsMP} from '../src/combat/MPCharge';
import {weakPointEligible} from '../src/combat/WeakPoints';
import type {DamageContext} from '../src/core/contracts';

const frame=1/60;

// ---------------------------------------------------------------------------- duplos

/** Corpo esférico atingível. Só o que `CombatServices` e a explosão realmente leem. */
function actor(id:number,at:Vector3,radius=.6):TrainingTarget&{at:Vector3;radius:number;damage:DamageContext[]} {
  const damage:DamageContext[]=[];
  const mesh={isPickable:true,isEnabled:()=>true,getBoundingInfo:()=>({boundingBox:{centerWorld:at}})};
  return {id,at,radius,hits:0,damage,mesh:mesh as never,onHit:(context:DamageContext)=>{damage.push(context);}} as never;
}

const NO_EFFECTS:CombatEffects={mark(){},muzzle(){},impact(){},tracer(){},piercer(){},burst(){}};

/**
 * Mundo de teste: uma parede perpendicular a `+Z` e corpos esféricos.
 * A mesma porta que `DualPistols` publica, com a física reduzida ao que o teste precisa provar.
 */
class FakeCombat implements CombatServices {
  readonly targets:ReturnType<typeof actor>[]=[];
  readonly hits:{target:TrainingTarget;spec:CombatHitSpec}[]=[];
  readonly scenery:{point:Vector3;damage:number}[]=[];
  /** `undefined` = céu aberto. */
  wallZ:number|undefined;
  effects=NO_EFFECTS;
  get combatTargets():readonly TrainingTarget[] {return this.targets;}
  traceWorld(origin:Vector3,direction:Vector3,range:number):CombatContact|undefined {
    if(this.wallZ===undefined||Math.abs(direction.z)<1e-6)return undefined;
    const distance=(this.wallZ-origin.z)/direction.z;
    if(!(distance>0&&distance<=range))return undefined;
    return {point:origin.add(direction.scale(distance)),normal:new Vector3(0,0,-Math.sign(direction.z)),
      distance,target:undefined,triangle:7};
  }
  sweep(origin:Vector3,direction:Vector3,range:number,padding=0):CombatSweep {
    const world=this.traceWorld(origin,direction,range);
    const limit=world?world.distance:range;
    const actors:CombatContact[]=[];
    for(const target of this.targets){
      if(!target.mesh.isPickable||!target.mesh.isEnabled())continue;
      const distance=raySphere(origin,direction,target.at,target.radius+padding);
      if(distance===undefined||distance>=limit)continue;
      const point=origin.add(direction.scale(distance));
      actors.push({point,normal:point.subtract(target.at).normalize(),distance,target,triangle:undefined});
    }
    actors.sort((a,b)=>a.distance-b.distance);
    return {world,actors};
  }
  applyHit(target:TrainingTarget,spec:CombatHitSpec):void {
    this.hits.push({target,spec});
    target.onHit?.({attackerId:1,victimId:target.id,sourceId:spec.sourceId,attackId:spec.attackId,
      baseDamage:spec.damage,finalDamage:spec.damage,crit:false,procCoefficient:spec.procCoefficient,
      procChainDepth:0,damageTags:spec.tags,hitPosition:{x:spec.point.x,y:spec.point.y,z:spec.point.z},
      hitNormal:{x:-spec.ray.x,y:-spec.ray.y,z:-spec.ray.z},
      forceDirection:{x:spec.force.x,y:spec.force.y,z:spec.force.z},
      hitDirection:{x:spec.ray.x,y:spec.ray.y,z:spec.ray.z},forceMagnitude:spec.forceMagnitude});
  }
  damageScenery(point:Vector3,_normal:Vector3,_direction:Vector3,damage:number):boolean {
    this.scenery.push({point,damage});return true;
  }
}

function raySphere(origin:Vector3,direction:Vector3,centre:Vector3,radius:number):number|undefined {
  const offset=origin.subtract(centre);
  const b=2*Vector3.Dot(direction,offset);
  const c=offset.lengthSquared()-radius*radius;
  const disc=b*b-4*c;
  if(disc<0)return undefined;
  const root=Math.sqrt(disc);
  const near=(-b-root)/2,far=(-b+root)/2;
  if(near>=0)return near;
  return far>=0?far:undefined;
}

/** Rig de teste: honra o contrato publicado, sem GLB, sem áudio e sem cena. */
class FakeRig implements PrismRigPort {
  ready=true;
  enabled=false;
  mode:0|1|2=0;
  muzzle:Vector3|undefined=new Vector3(0,1.4,0);
  fired=0;
  reloadCalls:number[]=[];
  resets=0;
  private remaining=0;
  get busy():boolean {return this.remaining>0;}
  update(dt:number):void {
    if(this.remaining<=0)return;
    this.remaining-=dt;
    if(this.remaining<=0){this.remaining=0;this.mode=((this.mode+1)%3) as 0|1|2;}
  }
  setMode(mode:0|1|2):void {this.mode=mode;this.remaining=0;}
  transform():boolean {if(!this.ready||this.busy)return false;this.remaining=2;return true;}
  fire():void {this.fired++;}
  reload(progress:number):void {this.reloadCalls.push(progress);}
  reset():void {this.resets++;this.mode=0;this.remaining=0;}
}

const COMMAND:PrismCommand={fire:false,reload:false,cycle:false,canAct:true};

function fixture(options:{wallZ?:number}={}) {
  const services=new FakeCombat();
  if(options.wallZ!==undefined)services.wallZ=options.wallZ;
  const rig=new FakeRig();
  const camera={forward:new Vector3(0,0,1),camera:{position:new Vector3(0,1.5,-1)},impulses:[] as number[],
    impulse(strength:number){this.impulses.push(strength);}};
  const weapon=new PrismWeapon({services,rig,camera,rng:{range:()=>0},body:()=>new Vector3(0,0,0)});
  weapon.setEquipped(true);
  return {services,rig,camera,weapon};
}

/** Roda passo fixo E apresentação — é o par que faz a transformação do rig andar. */
function tick(weapon:PrismWeapon,rig:FakeRig,steps:number,command:Partial<PrismCommand>={}):void {
  for(let i=0;i<steps;i++){
    weapon.fixedUpdate(frame,{...COMMAND,...command});
    weapon.updatePresentation(frame);
    void rig;
  }
}

// ---------------------------------------------------------------------------- munição e formas

describe('PRISM · munição por forma',()=>{
  it('guarda o saldo de cada forma e nunca recarrega ao trocar',()=>{
    const arsenal=new PrismArsenal();
    arsenal.magazineOf(0).ammo=4;
    arsenal.setMode(1);
    arsenal.magazineOf(1).ammo=2;
    expect(arsenal.magazine.ammo).toBe(2);
    arsenal.setMode(0);
    expect(arsenal.magazine.ammo).toBe(4);
    expect(arsenal.magazineOf(1).ammo).toBe(2);
  });
  it('perde a recarga em curso ao mudar de forma, sem devolver munição',()=>{
    const arsenal=new PrismArsenal();
    arsenal.magazine.ammo=1;
    expect(arsenal.magazine.request()).toBe(true);
    arsenal.setMode(1);
    expect(arsenal.magazineOf(0).reloading).toBe(false);
    expect(arsenal.magazineOf(0).ammo).toBe(1);
  });
  it('trocar de arma no meio da recarga não enche o carregador',()=>{
    const {weapon,rig}=fixture();
    weapon.magazine.ammo=3;
    expect(weapon.requestReload()).toBe(true);
    tick(weapon,rig,30);
    expect(weapon.magazine.progress).toBeGreaterThan(0);
    weapon.setEquipped(false);
    tick(weapon,rig,600);
    weapon.setEquipped(true);
    expect(weapon.magazine.ammo).toBe(3);
    expect(weapon.magazine.reloading).toBe(false);
  });
  it('recarrega até a capacidade da forma em vigor e só dela',()=>{
    const {weapon,rig}=fixture();
    weapon.magazine.ammo=0;
    weapon.arsenal.magazineOf(1).ammo=1;
    weapon.requestReload();
    tick(weapon,rig,Math.ceil(PRISM_MODES[0].reloadSeconds*60)+4);
    expect(weapon.magazine.ammo).toBe(PRISM_MODES[0].capacity);
    expect(weapon.arsenal.magazineOf(1).ammo).toBe(1);
  });
});

describe('PRISM · ciclo de formas',()=>{
  it('vai assault → sniper → granada → assault, e só depois que o rig termina',()=>{
    const {weapon,rig}=fixture();
    expect(weapon.mode).toBe(0);
    expect(weapon.requestMode()).toBe(true);
    expect(weapon.busy).toBe(true);
    tick(weapon,rig,30);
    // No meio do clipe a forma ainda é a antiga: quem manda no momento é o rig.
    expect(weapon.mode).toBe(0);
    tick(weapon,rig,120);
    expect(weapon.busy).toBe(false);
    expect(weapon.mode).toBe(1);
    weapon.requestMode();tick(weapon,rig,150);
    expect(weapon.mode).toBe(2);
    weapon.requestMode();tick(weapon,rig,150);
    expect(weapon.mode).toBe(0);
  });
  it('trava disparo, recarga e nova troca enquanto a transformação toca',()=>{
    const {weapon,rig}=fixture();
    weapon.requestMode();
    const before=weapon.magazine.ammo;
    tick(weapon,rig,20,{fire:true});
    expect(weapon.shots).toBe(0);
    expect(weapon.magazine.ammo).toBe(before);
    expect(weapon.requestReload()).toBe(false);
    expect(weapon.requestMode()).toBe(false);
    expect(rig.fired).toBe(0);
  });
  it('guardar a arma no meio do clipe cancela a troca em vez de travar a arma',()=>{
    for(const block of ['holstered','suppressed'] as const){
      const {weapon,rig}=fixture();
      expect(weapon.requestMode()).toBe(true);
      tick(weapon,rig,20);
      weapon[block]=true;
      weapon.fixedUpdate(frame,COMMAND);
      expect(weapon.busy).toBe(false);
      weapon[block]=false;
      // A forma NÃO avançou: a transformação interrompida não vale meia troca.
      expect(weapon.mode).toBe(0);
      tick(weapon,rig,10,{fire:true});
      expect(weapon.shots).toBeGreaterThan(0);
    }
  });
  it('recusa a troca durante a recarga e com a arma fora das mãos',()=>{
    const {weapon}=fixture();
    weapon.magazine.ammo=1;weapon.requestReload();
    expect(weapon.requestMode()).toBe(false);
    weapon.magazine.cancel();
    weapon.holstered=true;
    expect(weapon.requestMode()).toBe(false);
    weapon.holstered=false;
    expect(weapon.requestMode()).toBe(true);
  });
});

// ---------------------------------------------------------------------------- gatilho

describe('PRISM · cadência',()=>{
  it('o assault é automático e respeita a cadência e o attackSpeed',()=>{
    const trigger=new PrismTrigger();
    let shots=0;
    // Um segundo de gatilho preso: a cadência do modo, com o tiro de abertura no primeiro tique.
    for(let i=0;i<60;i++)trigger.update(frame,true,PRISM_MODES[0].rate,true,()=>{shots++;return true;});
    expect(shots).toBeGreaterThanOrEqual(Math.floor(PRISM_MODES[0].rate));
    expect(shots).toBeLessThanOrEqual(Math.ceil(PRISM_MODES[0].rate)+1);
    const fast=new PrismTrigger();fast.rateMultiplier=2;let quick=0;
    for(let i=0;i<60;i++)fast.update(frame,true,PRISM_MODES[0].rate,true,()=>{quick++;return true;});
    expect(quick).toBeGreaterThan(shots*1.8);
  });
  it('o sniper e a granada exigem uma nova pressão a cada tiro',()=>{
    const trigger=new PrismTrigger();
    let shots=0;
    for(let i=0;i<600;i++)trigger.update(frame,true,PRISM_MODES[1].rate,false,()=>{shots++;return true;});
    expect(shots).toBe(1);
    trigger.update(frame,false,PRISM_MODES[1].rate,false,()=>{shots++;return true;});
    trigger.update(frame,true,PRISM_MODES[1].rate,false,()=>{shots++;return true;});
    expect(shots).toBe(2);
  });
  it('um disparo recusado não cobra cadência nem conta como tiro',()=>{
    const trigger=new PrismTrigger();
    for(let i=0;i<10;i++)trigger.update(frame,true,PRISM_MODES[0].rate,true,()=>false);
    expect(trigger.shots).toBe(0);
    let fired=false;
    trigger.update(frame,true,PRISM_MODES[0].rate,true,()=>{fired=true;return true;});
    expect(fired).toBe(true);
  });
});

// ---------------------------------------------------------------------------- tiro instantâneo

describe('PRISM · assault e sniper',()=>{
  it('o assault consome munição, acerta só o corpo da frente e não fura a parede',()=>{
    const {weapon,rig,services}=fixture({wallZ:20});
    services.targets.push(actor(11,new Vector3(0,1.4,6)),actor(12,new Vector3(0,1.4,10)));
    const before=weapon.magazine.ammo;
    tick(weapon,rig,1,{fire:true});
    expect(weapon.shots).toBe(1);
    expect(weapon.magazine.ammo).toBe(before-1);
    expect(services.hits).toHaveLength(1);
    expect(services.hits[0]!.target.id).toBe(11);
    expect(services.hits[0]!.spec.damage).toBe(PRISM_MODES[0].damage);
    // Com um inimigo na frente, o cenário atrás dele fica intacto.
    expect(services.scenery).toHaveLength(0);
  });
  it('o sniper atravessa a fila inteira até a parede e machuca o cenário no fim',()=>{
    const {weapon,rig,services}=fixture({wallZ:20});
    services.targets.push(actor(11,new Vector3(0,1.4,6)),actor(12,new Vector3(0,1.4,10)),actor(13,new Vector3(0,1.4,14)));
    weapon.arsenal.setMode(1);rig.setMode(1);
    tick(weapon,rig,1,{fire:true});
    expect(services.hits.map(hit=>hit.target.id)).toEqual([11,12,13]);
    expect(services.hits[0]!.spec.damage).toBe(PRISM_MODES[1].damage);
    expect(services.scenery).toHaveLength(1);
    expect(services.scenery[0]!.point.z).toBeCloseTo(20,2);
  });
  it('sem inimigo, o tiro entrega o dano ao cenário e para na parede',()=>{
    const {weapon,rig,services}=fixture({wallZ:12});
    tick(weapon,rig,1,{fire:true});
    expect(services.scenery).toHaveLength(1);
    expect(services.scenery[0]!.damage).toBe(PRISM_MODES[0].damage);
    expect(services.hits).toHaveLength(0);
  });
  it('o acerto direto entra como `bullet`: alimenta MP e disputa ponto fraco',()=>{
    const {weapon,rig,services}=fixture();
    const victim=actor(11,new Vector3(0,1.4,6));
    services.targets.push(victim);
    tick(weapon,rig,1,{fire:true});
    const context=victim.damage[0]!;
    expect(context.damageTags).toContain('bullet');
    expect(context.hitDirection).toBeDefined();
    expect(weakPointEligible(context.attackerId,context.procChainDepth,context.damageTags)).toBe(true);
    expect(awardsMP({...context,finalDamage:9})).toBe(true);
  });
  it('carregador vazio para de disparar e recarrega sozinho',()=>{
    const {weapon,rig,services}=fixture({wallZ:12});
    weapon.magazine.ammo=2;
    // Meio segundo de gatilho preso: dá para três tiros de cadência, mas só existem duas balas.
    tick(weapon,rig,30,{fire:true});
    expect(weapon.shots).toBe(2);
    expect(services.scenery).toHaveLength(2);
    expect(weapon.magazine.ammo).toBe(0);
    expect(weapon.magazine.reloading).toBe(true);
    // A recarga automática fecha sozinha e o carregador volta cheio — sem tiro no meio dela.
    tick(weapon,rig,Math.ceil(PRISM_MODES[0].reloadSeconds*60)+2);
    expect(weapon.shots).toBe(2);
    expect(weapon.magazine.ammo).toBe(PRISM_MODES[0].capacity);
  });
  it('guardada, suprimida ou fora das mãos, a PRISM não dispara nada',()=>{
    for(const block of ['holstered','suppressed','unequipped'] as const){
      const {weapon,rig,services}=fixture({wallZ:12});
      if(block==='holstered')weapon.holstered=true;
      if(block==='suppressed')weapon.suppressed=true;
      if(block==='unequipped')weapon.setEquipped(false);
      tick(weapon,rig,60,{fire:true});
      expect(weapon.shots).toBe(0);
      expect(services.scenery).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------- granada

describe('PRISM · lança-granadas',()=>{
  function grenadeFixture(wallZ?:number) {
    const made=fixture(wallZ===undefined?{}:{wallZ});
    made.weapon.arsenal.setMode(2);made.rig.setMode(2);
    return made;
  }
  it('lança uma cápsula em arco que cai e explode no chão, não no ponto de mira',()=>{
    const {weapon,rig,services}=grenadeFixture();
    tick(weapon,rig,1,{fire:true});
    expect(weapon.grenades.count).toBe(1);
    const first=weapon.grenades.live[0]!.position.y;
    tick(weapon,rig,12);
    const rising=weapon.grenades.live[0]!;
    expect(rising.position.z).toBeGreaterThan(2);
    // Sem empuxo: a vertical só cai, porque o tiro saiu na horizontal.
    expect(rising.position.y).toBeLessThan(first);
    expect(services.hits).toHaveLength(0);
  });
  it('não atravessa cenário: a cápsula detona na parede',()=>{
    const {weapon,rig,services}=grenadeFixture(9);
    tick(weapon,rig,1,{fire:true});
    tick(weapon,rig,120);
    expect(weapon.grenades.count).toBe(0);
    expect(weapon.blasts).toBe(1);
    expect(services.scenery).toHaveLength(1);
    expect(services.scenery[0]!.point.z).toBeLessThanOrEqual(9.001);
  });
  it('explode sozinha no fim do estopim, sem cápsula presa no ar',()=>{
    const {weapon,rig}=grenadeFixture();
    tick(weapon,rig,1,{fire:true});
    tick(weapon,rig,Math.ceil(PRISM_GRENADE.fuseSeconds*60)+4);
    expect(weapon.grenades.count).toBe(0);
    expect(weapon.blasts).toBe(1);
  });
  it('a área é limitada: fora do raio ninguém leva dano',()=>{
    expect(blastFalloff(0)).toBeCloseTo(1,6);
    expect(blastFalloff(PRISM_GRENADE.blastRadius*.5)).toBeLessThan(1);
    expect(blastFalloff(PRISM_GRENADE.blastRadius)).toBe(0);
    expect(blastFalloff(PRISM_GRENADE.blastRadius+.01)).toBe(0);
    const {weapon,rig,services}=grenadeFixture(9);
    // Os dois estão FORA da trajetória (a cápsula vai reta para a parede) e do mesmo lado dela:
    // o que os separa é só a distância até o ponto da explosão.
    const near=actor(11,new Vector3(1.2,1.4,8));
    const far=actor(12,new Vector3(1.2,1.4,3));
    services.targets.push(near,far);
    tick(weapon,rig,1,{fire:true});
    tick(weapon,rig,120);
    expect(weapon.blasts).toBe(1);
    expect(near.damage.length).toBeGreaterThan(0);
    expect(near.damage[0]!.baseDamage).toBeLessThan(PRISM_GRENADE.blastDamage);
    expect(far.damage).toHaveLength(0);
  });
  it('não machuca quem está atrás da parede em que explodiu',()=>{
    const {weapon,rig,services}=grenadeFixture(9);
    const sheltered=actor(11,new Vector3(0,1.4,11));
    services.targets.push(sheltered);
    // O alvo está a 2 m do ponto de detonação — dentro do raio — mas do outro lado da parede.
    expect(blastFalloff(2)).toBeGreaterThan(0);
    tick(weapon,rig,1,{fire:true});
    tick(weapon,rig,120);
    expect(weapon.blasts).toBe(1);
    expect(sheltered.damage).toHaveLength(0);
  });
  it('o estilhaço não vira crítico por aproximação nem realimenta a barra de MP',()=>{
    const {weapon,rig,services}=grenadeFixture(9);
    const victim=actor(11,new Vector3(1.4,1.4,8));
    services.targets.push(victim);
    tick(weapon,rig,1,{fire:true});
    tick(weapon,rig,120);
    const blast=victim.damage.find(context=>context.attackId==='blast')!;
    expect(blast).toBeDefined();
    expect(weakPointEligible(blast.attackerId,blast.procChainDepth,blast.damageTags)).toBe(false);
    expect(awardsMP({...blast,finalDamage:blast.baseDamage})).toBe(false);
  });
  it('o teto de cápsulas vivas detona a mais antiga em vez de vazar nós',()=>{
    const {weapon}=grenadeFixture();
    for(let i=0;i<PRISM_GRENADE.maxLive+3;i++)weapon.grenades.launch({x:0,y:2,z:0},{x:0,y:0,z:1});
    expect(weapon.grenades.count).toBe(PRISM_GRENADE.maxLive);
    // Munição gasta sempre vira explosão: o teto detona a mais antiga, nunca some com ela.
    expect(weapon.blasts).toBe(3);
  });
});

// ---------------------------------------------------------------------------- ciclo de vida

describe('PRISM · estados da cena',()=>{
  it('a morte apaga o que está no ar e o reinício devolve a forma 0 com tudo cheio',()=>{
    const {weapon,rig}=fixture();
    weapon.arsenal.setMode(2);rig.setMode(2);
    weapon.magazine.ammo=3;
    tick(weapon,rig,1,{fire:true});
    expect(weapon.grenades.count).toBe(1);
    weapon.cancel();
    expect(weapon.grenades.count).toBe(0);
    weapon.resetAttempt();
    expect(weapon.mode).toBe(0);
    expect(weapon.arsenal.magazineOf(2).ammo).toBe(PRISM_MODES[2].capacity);
    expect(weapon.shots).toBe(0);
    expect(rig.resets).toBe(1);
    expect(weapon.equipped).toBe(true);
  });
  it('sem rig carregado a PRISM não é equipável e o jogo fica nas pistolas',()=>{
    const services=new FakeCombat();
    const rig=new FakeRig();rig.ready=false;
    const camera={forward:new Vector3(0,0,1),camera:{position:Vector3.Zero()},impulse(){}};
    const weapon=new PrismWeapon({services,rig,camera,rng:{range:()=>0},body:()=>Vector3.Zero()});
    expect(weapon.setEquipped(true)).toBe(false);
    expect(weapon.equipped).toBe(false);
    expect(weapon.live).toBe(false);
  });
  it('o rig só fica visível com a arma viva e recebe a recarga uma vez por ciclo',()=>{
    const {weapon,rig}=fixture();
    weapon.updatePresentation(frame);
    expect(rig.enabled).toBe(true);
    weapon.magazine.ammo=1;weapon.requestReload();
    tick(weapon,rig,10);
    expect(rig.reloadCalls.some(value=>value>0)).toBe(true);
    tick(weapon,rig,Math.ceil(PRISM_MODES[0].reloadSeconds*60)+6);
    expect(rig.reloadCalls.filter(value=>value<0)).toHaveLength(1);
    weapon.suppressed=true;
    weapon.updatePresentation(frame);
    expect(rig.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------- HUD

describe('HUD da arma',()=>{
  const base={holstered:false,prismReady:true,prismEquipped:true,prismMode:0 as const,prismAmmo:12,
    prismCapacity:36,prismReloading:false,prismProgress:0,prismBusy:false,
    pistolAmmo:50,pistolCapacity:50,pistolReloading:false,pistolProgress:0};
  it('nomeia a forma em vigor e a munição dela',()=>{
    expect(weaponReadout(base).label).toBe(PRISM_MODES[0].name);
    expect(weaponReadout(base).ammo).toBe('12 / 36');
    expect(weaponReadout({...base,prismMode:2,prismAmmo:5,prismCapacity:5}).label).toBe(PRISM_MODES[2].name);
  });
  it('anuncia os controles certos e nunca promete tecla travada',()=>{
    const idle=weaponReadout(base).hint;
    expect(idle).toContain('T · FORMA');
    expect(idle).toContain('B · PISTOLAS');
    expect(weaponReadout({...base,prismBusy:true}).hint).toBe('TRANSFORMANDO · AGUARDE');
    expect(weaponReadout({...base,prismReloading:true,prismProgress:.5}).hint).toBe('RECARREGANDO · 50%');
  });
  it('volta às pistolas e ao combo sem esconder a tecla de troca',()=>{
    const pistols=weaponReadout({...base,prismEquipped:false});
    expect(pistols.label).toBe('PISTOLAS DUPLAS');
    expect(pistols.ammo).toBe('50 / 50');
    expect(pistols.hint).toContain('B · PRISM');
    expect(weaponReadout({...base,prismEquipped:false,prismReady:false}).hint).not.toContain('B ·');
    expect(weaponReadout({...base,holstered:true}).ammo).toBe('COMBO');
  });
});
