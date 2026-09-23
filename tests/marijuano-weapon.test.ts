import {describe,it,expect} from 'vitest';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {TrainingTarget} from '../src/world/TrainingYard';
import type {CombatContact,CombatEffects,CombatHitSpec,CombatServices,CombatSweep} from '../src/combat/CombatServices';
import {MarijuanoWeapon,type SmgCommand,type SmgRigPort} from '../src/combat/MarijuanoWeapon';
import {MARIJUANO_SKILLS,MARIJUANO_SMG,marijuanoSkill} from '../src/combat/SmgTuning';
import {weaponReadout} from '../src/ui/WeaponReadout';
import {aimKindFor} from '../src/combat/AimState';
import {awardsMP} from '../src/combat/MPCharge';
import {weakPointEligible} from '../src/combat/WeakPoints';
import type {DamageContext} from '../src/core/contracts';

const frame=1/60;

// ---------------------------------------------------------------------------- duplos

/** Corpo esférico atingível. Só o que `CombatServices` realmente lê. */
function actor(id:number,at:Vector3,radius=.6):TrainingTarget&{at:Vector3;radius:number;damage:DamageContext[]} {
  const damage:DamageContext[]=[];
  const mesh={isPickable:true,isEnabled:()=>true,getBoundingInfo:()=>({boundingBox:{centerWorld:at}})};
  return {id,at,radius,hits:0,damage,mesh:mesh as never,onHit:(context:DamageContext)=>{damage.push(context);}} as never;
}

const NO_EFFECTS:CombatEffects={mark(){},muzzle(){},impact(){},tracer(){},piercer(){},burst(){}};

/** Mundo de teste: uma parede perpendicular a `+Z` e corpos esféricos. */
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
class FakeRig implements SmgRigPort {
  ready=true;
  enabled=false;
  firing=false;
  muzzle:Vector3|undefined=new Vector3(0,1.4,0);
  fired=0;
  reloadCalls:number[]=[];
  resets=0;
  update():void {}
  fire():void {this.fired++;}
  reload(progress:number):void {this.reloadCalls.push(progress);}
  reset():void {this.resets++;}
}

/** Buds desenhados, contados. A arma não pode depender deles para dar dano. */
class FakeBuds {
  ready=true;
  spawns:{from:Vector3;to:Vector3;speed:number;scale:number|undefined}[]=[];
  clears=0;
  spawn(from:Vector3,to:Vector3,speed:number,scale?:number):void {this.spawns.push({from:from.clone(),to:to.clone(),speed,scale});}
  update():void {}
  clear():void {this.clears++;this.spawns.length=0;}
}

const COMMAND:SmgCommand={fire:false,reload:false,canAct:true};

function fixture(options:{wallZ?:number;spreadEdge?:boolean}={}) {
  const services=new FakeCombat();
  if(options.wallZ!==undefined)services.wallZ=options.wallZ;
  const rig=new FakeRig();
  const buds=new FakeBuds();
  const audio={shots:[] as boolean[],reloads:0,
    shot(hit:boolean){this.shots.push(hit);},reload(){this.reloads++;}};
  const camera={forward:new Vector3(0,0,1),camera:{position:new Vector3(0,1.5,-1),upVector:Vector3.Up()},
    impulses:[] as number[],impulse(strength:number){this.impulses.push(strength);}};
  const weapon=new MarijuanoWeapon({
    services,rig,camera,visuals:buds,audio,
    rng:{range:(_min:number,max:number)=>options.spreadEdge?max:0},
    body:()=>new Vector3(0,0,0),
  });
  weapon.setEquipped(true);
  return {services,rig,buds,audio,camera,weapon};
}

function tick(weapon:MarijuanoWeapon,steps:number,command:Partial<SmgCommand>={}):void {
  for(let i=0;i<steps;i++){
    weapon.fixedUpdate(frame,{...COMMAND,...command});
    weapon.updatePresentation(frame);
  }
}

// ---------------------------------------------------------------------------- disparo

describe('MARIJUANO · o bud sai e acerta',()=>{
  it('segurar o gatilho dispara em automático, cobra munição e acerta o corpo da frente',()=>{
    const {weapon,services,rig,buds}=fixture();
    const alvo=actor(1,new Vector3(0,1.4,12));
    services.targets.push(alvo);
    // Um segundo de gatilho preso: a cadência da tabela é o teto do que pode sair.
    tick(weapon,60,{fire:true});
    expect(weapon.shots).toBeGreaterThan(0);
    expect(weapon.shots).toBeLessThanOrEqual(Math.ceil(MARIJUANO_SMG.rate)+1);
    expect(rig.fired).toBe(weapon.shots);
    expect(weapon.magazine.ammo).toBe(MARIJUANO_SMG.capacity-weapon.shots);
    expect(services.hits).toHaveLength(weapon.shots);
    expect(services.hits[0]!.spec.sourceId).toBe(MARIJUANO_SMG.id);
    expect(services.hits[0]!.spec.damage).toBe(MARIJUANO_SMG.damage);
    // O bud desenhado sai do CANO e para no ponto real do acerto — não no alcance máximo.
    expect(buds.spawns).toHaveLength(weapon.shots);
    expect(buds.spawns[0]!.from.z).toBeCloseTo(0,5);
    expect(buds.spawns[0]!.to.z).toBeLessThan(12);
    // O projétil desenhado é o BUD autoral, com a velocidade e a engorda de leitura da tabela —
    // o pedido é que a arma atire cannabis e que dê para VER.
    expect(buds.spawns[0]!.speed).toBe(MARIJUANO_SMG.budSpeed);
    expect(buds.spawns[0]!.scale).toBe(MARIJUANO_SMG.budScale);
    expect(MARIJUANO_SMG.budScale).toBeGreaterThan(1);
  });

  it('o bud comum alimenta o MP e vale ponto fraco; o da habilidade NÃO alimenta',()=>{
    const {weapon,services}=fixture();
    // Vítima com id != 1: o id 1 é o JOGADOR, e `awardsMP` recusa dano no próprio.
    const alvo=actor(2,new Vector3(0,1.4,10));
    services.targets.push(alvo);
    tick(weapon,6,{fire:true});
    const comum=alvo.damage.at(-1)!;
    expect(comum.damageTags).toContain('bullet');
    expect(awardsMP(comum)).toBe(true);
    expect(weakPointEligible(comum.attackerId,comum.procChainDepth,comum.damageTags)).toBe(true);

    expect(weapon.releaseSkill(1)).toBe(true);
    tick(weapon,4);
    const habilidade=alvo.damage.at(-1)!;
    expect(habilidade.damageTags).toContain('skill');
    // `skill` desliga o MP (a habilidade não se paga sozinha) mas MANTÉM o ponto fraco.
    expect(awardsMP(habilidade)).toBe(false);
    expect(weakPointEligible(habilidade.attackerId,habilidade.procChainDepth,habilidade.damageTags)).toBe(true);
  });

  it('nunca perfura: o primeiro corpo para o bud e o de trás não leva nada',()=>{
    const {weapon,services}=fixture();
    const perto=actor(1,new Vector3(0,1.4,8)),longe=actor(2,new Vector3(0,1.4,16));
    services.targets.push(perto,longe);
    tick(weapon,12,{fire:true});
    expect(services.hits.length).toBeGreaterThan(0);
    expect(services.hits.every(hit=>hit.target===perto)).toBe(true);
  });

  it('cenário só leva dano quando nenhum corpo ficou na frente',()=>{
    const {weapon,services}=fixture({wallZ:20});
    tick(weapon,6,{fire:true});
    expect(services.scenery.length).toBeGreaterThan(0);
    services.scenery.length=0;
    services.targets.push(actor(1,new Vector3(0,1.4,10)));
    tick(weapon,6,{fire:true});
    expect(services.scenery).toHaveLength(0);
  });

  it('carregador vazio recarrega sozinho e o clipe só enche quando a animação termina',()=>{
    const {weapon,rig}=fixture();
    weapon.magazine.ammo=1;
    tick(weapon,4,{fire:true});
    expect(weapon.reloading).toBe(true);
    expect(weapon.magazine.ammo).toBe(0);
    tick(weapon,Math.ceil(MARIJUANO_SMG.reloadSeconds*60)-6,{fire:true});
    expect(weapon.magazine.ammo).toBe(0);
    tick(weapon,12,{fire:true});
    expect(weapon.magazine.ammo).toBeGreaterThan(0);
    // O rig recebeu a progressão da recarga e a restauração da pose ao fim, uma única vez.
    expect(rig.reloadCalls.some(value=>value>0&&value<1)).toBe(true);
    expect(rig.reloadCalls.filter(value=>value===-1)).toHaveLength(1);
  });

  it('guardar a arma cancela a recarga SEM devolver munição — nada de recarga instantânea',()=>{
    const {weapon}=fixture();
    weapon.magazine.ammo=3;
    expect(weapon.requestReload()).toBe(true);
    weapon.setEquipped(false);
    weapon.setEquipped(true);
    expect(weapon.magazine.ammo).toBe(3);
    expect(weapon.reloading).toBe(false);
  });

  it('mirar APERTA o leque em vez de aproximar: a tabela é a fonte, não o backend',()=>{
    expect(MARIJUANO_SMG.aimedSpreadDegrees).toBeLessThan(MARIJUANO_SMG.spreadDegrees);
    expect(MARIJUANO_SMG.aimedSpreadDegrees).toBeGreaterThan(0);
    expect(aimKindFor({prismReady:true,prismEquipped:false,prismMode:0,smgEquipped:true})).toBe('smg');
    // A submetralhadora manda mesmo com a PRISM pronta: a classe é uma só por tentativa.
    expect(aimKindFor({prismReady:true,prismEquipped:true,prismMode:1,smgEquipped:true})).toBe('smg');
  });
});

// ---------------------------------------------------------------------------- habilidades

describe('MARIJUANO · as três do Q',()=>{
  it('a rajada cobra munição na soltura e cospe as emissões prometidas',()=>{
    const {weapon,services,rig}=fixture();
    services.targets.push(actor(1,new Vector3(0,1.4,10)));
    const plan=marijuanoSkill(1);
    expect(weapon.releaseSkill(1)).toBe(true);
    expect(weapon.magazine.ammo).toBe(MARIJUANO_SMG.capacity-plan.ammoCost);
    expect(weapon.skillActive).toBe(true);
    expect(weapon.skillLabel).toBe(plan.name);
    tick(weapon,Math.ceil(plan.emissions*plan.interval*60)+4);
    expect(rig.fired).toBe(plan.emissions);
    // Nenhum bud extra foi cobrado: a munição sai TODA na soltura.
    expect(weapon.magazine.ammo).toBe(MARIJUANO_SMG.capacity-plan.ammoCost);
    expect(weapon.skillActive).toBe(false);
    expect(services.hits).toHaveLength(plan.emissions);
    expect(services.hits[0]!.spec.attackId).toBe(plan.id);
    expect(services.hits[0]!.spec.damage).toBeCloseTo(MARIJUANO_SMG.damage*plan.damageScale,6);
    expect(services.hits[0]!.spec.tags).toContain('skill');
  });

  it('a chuva de buds abre em leque: as emissões não caem todas no mesmo rumo',()=>{
    const {weapon,buds}=fixture();
    const plan=marijuanoSkill(2);
    expect(weapon.releaseSkill(2)).toBe(true);
    tick(weapon,Math.ceil(plan.emissions*plan.interval*60)+4);
    expect(buds.spawns).toHaveLength(plan.emissions);
    const xs=buds.spawns.map(shot=>shot.to.x);
    expect(Math.max(...xs)-Math.min(...xs)).toBeGreaterThan(1);
    // Simétrico em torno da mira: o leque abre para os dois lados, não só para um.
    expect(Math.max(...xs)).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeLessThan(0);
  });

  it('o bafo do cânhamo não emite tiro próprio: ele REESCREVE o gatilho por seis segundos',()=>{
    const {weapon,services}=fixture();
    services.targets.push(actor(1,new Vector3(0,1.4,10)));
    const plan=marijuanoSkill(3);
    const antes=weapon.magazine.ammo;
    expect(weapon.releaseSkill(3)).toBe(true);
    // Não cobrou nada na soltura — ela cobra em tempo real.
    expect(weapon.magazine.ammo).toBe(antes);
    expect(weapon.overdriveRemaining).toBeCloseTo(plan.seconds,5);
    tick(weapon,30,{fire:true});
    const comJanela=weapon.shots;
    expect(services.hits.every(hit=>hit.spec.attackId===plan.id)).toBe(true);
    expect(services.hits[0]!.spec.damage).toBeCloseTo(MARIJUANO_SMG.damage*plan.damageScale,6);
    // Meio segundo de janela rende mais tiros do que meio segundo de cadência normal.
    const normal=fixture();
    normal.services.targets.push(actor(1,new Vector3(0,1.4,10)));
    tick(normal.weapon,30,{fire:true});
    expect(comJanela).toBeGreaterThan(normal.weapon.shots);
    // Passada a janela, a arma volta a ser ela mesma.
    tick(weapon,Math.ceil(plan.seconds*60));
    expect(weapon.overdriveRemaining).toBe(0);
    expect(weapon.skillActive).toBe(false);
  });

  it('recusa honesta: sem munição, recarregando ou com outra no ar a habilidade não sai',()=>{
    const {weapon}=fixture();
    weapon.magazine.ammo=MARIJUANO_SKILLS[1].ammoRequired-1;
    expect(weapon.releaseSkill(1)).toBe(false);
    weapon.magazine.refill();
    expect(weapon.requestReload()).toBe(false);   // carregador cheio
    weapon.magazine.ammo=10;
    expect(weapon.requestReload()).toBe(true);
    expect(weapon.releaseSkill(1)).toBe(false);   // recarregando
    weapon.magazine.cancel();
    weapon.magazine.ammo=MARIJUANO_SMG.capacity;
    expect(weapon.releaseSkill(1)).toBe(true);
    expect(weapon.releaseSkill(2)).toBe(false);   // já tem uma no ar
    // Arma fora das mãos: a habilidade no ar morre junto com o cano.
    weapon.setEquipped(false);
    weapon.fixedUpdate(frame,COMMAND);
    expect(weapon.skillActive).toBe(false);
  });

  it('recarregar no meio de uma rajada é recusado; dentro da sobrecarga é permitido',()=>{
    const {weapon}=fixture();
    weapon.magazine.ammo=MARIJUANO_SMG.capacity;
    expect(weapon.releaseSkill(1)).toBe(true);
    weapon.fixedUpdate(frame,COMMAND);
    expect(weapon.requestReload()).toBe(false);
    weapon.cancel();
    weapon.magazine.refill();
    expect(weapon.releaseSkill(3)).toBe(true);
    weapon.magazine.ammo=20;
    // A sobrecarga come o carregador enquanto dura: proibir a recarga mataria a arma no meio dela.
    expect(weapon.requestReload()).toBe(true);
  });
});

// ---------------------------------------------------------------------------- painel

describe('MARIJUANO · o painel não mente',()=>{
  const base={
    playerClass:'marijuano' as const,holstered:false,
    prismReady:false,prismEquipped:false,prismMode:0 as const,prismAmmo:0,prismCapacity:0,
    prismReloading:false,prismProgress:0,prismBusy:false,
    pistolAmmo:12,pistolCapacity:12,pistolReloading:false,pistolProgress:0,
    smgReady:true,smgEquipped:true,smgAmmo:41,smgCapacity:45,smgReloading:false,smgProgress:0,
  };
  it('anuncia a arma, o carregador e as três do Q',()=>{
    const view=weaponReadout(base);
    expect(view.label).toBe(MARIJUANO_SMG.name);
    expect(view.ammo).toBe('41 / 45');
    expect(view.hint).toContain('R · RECARREGAR');
    expect(view.charge.slice(1)).toEqual([
      MARIJUANO_SKILLS[1].name,MARIJUANO_SKILLS[2].name,MARIJUANO_SKILLS[3].name,
    ]);
    // O nível I dela CUSTA MP: só o soldado transforma de graça.
    expect(view.freeFirstTier).toBe(false);
  });
  it('recarregando, o painel diz a porcentagem e não promete o R',()=>{
    const view=weaponReadout({...base,smgReloading:true,smgProgress:.4});
    expect(view.hint).toBe('RECARREGANDO · 40%');
  });
  it('com uma habilidade no ar, o painel mostra ela e não os atalhos',()=>{
    const view=weaponReadout({...base,activeSkill:MARIJUANO_SKILLS[3].name});
    expect(view.hint).toContain(MARIJUANO_SKILLS[3].name);
    expect(view.hint).not.toContain('R · RECARREGAR');
  });
  it('sem o rig o Marijuano cai nas pistolas, e o painel diz PISTOLAS',()=>{
    const view=weaponReadout({...base,smgReady:false,smgEquipped:false});
    expect(view.label).toBe('PISTOLAS DUPLAS');
    expect(view.ammo).toBe('12 / 12');
  });
});
