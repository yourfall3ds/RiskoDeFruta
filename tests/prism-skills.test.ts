import {describe,it,expect} from 'vitest';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {TrainingTarget} from '../src/world/TrainingYard';
import type {CombatContact,CombatEffects,CombatHitSpec,CombatServices,CombatSweep} from '../src/combat/CombatServices';
import {PrismWeapon,type PrismCommand,type PrismRigPort} from '../src/combat/PrismWeapon';
import {PRISM_GRENADE,PRISM_MODES} from '../src/combat/PrismTuning';
import {
  INCENDIARY_TAG,PRISM_SKILLS,PRISM_SKILL_BLAST_CAP,PrismSkillRunner,
  allPrismSkills,fanAngles,prismSkill,prismSkillBlastRadius,prismSkillDamage,
} from '../src/combat/PrismSkills';
import {weaponReadout} from '../src/ui/WeaponReadout';
import {awardsMP} from '../src/combat/MPCharge';
import {weakPointEligible} from '../src/combat/WeakPoints';
import type {DamageContext} from '../src/core/contracts';

const frame=1/60;

// ---------------------------------------------------------------------------- duplos
//
// Os mesmos de `prism-weapon.test.ts`: a porta `CombatServices` com a física reduzida ao que o
// teste precisa provar. Duplicados de propósito — um utilitário compartilhado entre suítes esconde
// qual mundo cada teste está afirmando.

function actor(id:number,at:Vector3,radius=.6):TrainingTarget&{at:Vector3;radius:number;damage:DamageContext[]} {
  const damage:DamageContext[]=[];
  const mesh={isPickable:true,isEnabled:()=>true,getBoundingInfo:()=>({boundingBox:{centerWorld:at}})};
  return {id,at,radius,hits:0,damage,mesh:mesh as never,onHit:(context:DamageContext)=>{damage.push(context);}} as never;
}

const NO_EFFECTS:CombatEffects={mark(){},muzzle(){},impact(){},tracer(){},piercer(){},burst(){}};

class FakeCombat implements CombatServices {
  readonly targets:ReturnType<typeof actor>[]=[];
  readonly hits:{target:TrainingTarget;spec:CombatHitSpec}[]=[];
  readonly scenery:{point:Vector3;damage:number}[]=[];
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

class FakeRig implements PrismRigPort {
  ready=true;enabled=false;mode:0|1|2=0;
  muzzle:Vector3|undefined=new Vector3(0,1.4,0);
  fired=0;reloadCalls:number[]=[];resets=0;
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

function fixture(options:{wallZ?:number;mode?:0|1|2}={}) {
  const services=new FakeCombat();
  if(options.wallZ!==undefined)services.wallZ=options.wallZ;
  const rig=new FakeRig();
  const camera={forward:new Vector3(0,0,1),camera:{position:new Vector3(0,1.5,-1),upVector:Vector3.Up()},
    impulses:[] as number[],impulse(strength:number){this.impulses.push(strength);}};
  const weapon=new PrismWeapon({services,rig,camera,rng:{range:()=>0},body:()=>new Vector3(0,0,0)});
  weapon.setEquipped(true);
  if(options.mode!==undefined){weapon.arsenal.setMode(options.mode);rig.setMode(options.mode);}
  return {services,rig,camera,weapon};
}

function tick(weapon:PrismWeapon,steps:number,command:Partial<PrismCommand>={}):void {
  for(let i=0;i<steps;i++){
    weapon.fixedUpdate(frame,{...COMMAND,...command});
    weapon.updatePresentation(frame);
  }
}

// ---------------------------------------------------------------------------- a tabela

describe('habilidades do soldado · a tabela',()=>{
  it('são SEIS, uma por (forma, nível), todas diferentes',()=>{
    const skills=allPrismSkills();
    expect(skills).toHaveLength(6);
    expect(new Set(skills.map(s=>s.id)).size).toBe(6);
    expect(new Set(skills.map(s=>s.name)).size).toBe(6);
    for(const mode of [0,1,2] as const)for(const tier of [2,3] as const){
      const plan=prismSkill(mode,tier);
      expect(plan.mode).toBe(mode);
      expect(plan.tier).toBe(tier);
      expect(plan.ammoRequired).toBeGreaterThanOrEqual(plan.ammoCost);
    }
  });
  it('cada forma tem uma MECÂNICA própria, não três coreografias iguais',()=>{
    expect(PRISM_SKILLS[0][2].kind).toBe('burst');
    expect(PRISM_SKILLS[0][3].kind).toBe('overdrive');
    expect(PRISM_SKILLS[1][2].kind).toBe('burst');
    expect(PRISM_SKILLS[1][3].kind).toBe('volley');
    expect(PRISM_SKILLS[2][2].kind).toBe('fan');
    expect(PRISM_SKILLS[2][3].kind).toBe('fan');
    // Perfuração é contrato do sniper e de mais ninguém.
    expect(PRISM_SKILLS[1][2].pierce&&PRISM_SKILLS[1][3].pierce).toBe(true);
    expect(PRISM_SKILLS[0][2].pierce||PRISM_SKILLS[2][3].pierce).toBe(false);
  });
  it('nenhuma habilidade cabe no carregador de outra forma nem estoura os limites',()=>{
    for(const plan of allPrismSkills()){
      // Munição exigida sai do carregador DA FORMA: pedir mais do que ele cabe seria uma
      // habilidade que nunca sairia.
      expect(plan.ammoRequired).toBeLessThanOrEqual(PRISM_MODES[plan.mode].capacity);
      expect(plan.blastRadiusScale).toBeLessThanOrEqual(PRISM_SKILL_BLAST_CAP);
      // Leque não pode nascer já estourando o teto de cápsulas vivas.
      if(plan.kind==='fan')expect(plan.shots).toBeLessThanOrEqual(PRISM_GRENADE.maxLive);
    }
    expect(prismSkillBlastRadius(PRISM_SKILLS[2][3])).toBeCloseTo(PRISM_GRENADE.blastRadius*PRISM_SKILL_BLAST_CAP,6);
    // O dano sai do dano da FORMA: balancear a arma balanceia a habilidade junto.
    expect(prismSkillDamage(PRISM_SKILLS[1][2])).toBeCloseTo(PRISM_MODES[1].damage*PRISM_SKILLS[1][2].damageScale,6);
  });
  it('o leque é simétrico e um tiro só sai reto',()=>{
    expect(fanAngles(1,26)).toEqual([0]);
    expect(fanAngles(3,16)).toEqual([-8,0,8]);
    const five=fanAngles(5,26);
    expect(five[0]).toBeCloseTo(-13,6);
    expect(five[4]).toBeCloseTo(13,6);
    expect(five[0]!+five[4]!).toBeCloseTo(0,6);
    expect(fanAngles(0,26)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------- o relógio

describe('habilidades do soldado · o relógio',()=>{
  it('uma rajada emite exatamente o número de tiros, no ritmo pedido, e depois acaba',()=>{
    const runner=new PrismSkillRunner();
    const plan=PRISM_SKILLS[0][2];
    const at:number[]=[];let clock=0;
    runner.start(plan);
    for(let i=0;i<120&&runner.active;i++){clock+=frame;runner.update(frame,()=>at.push(clock));}
    expect(at).toHaveLength(plan.shots);
    expect(runner.active).toBe(false);
    // O último sai perto de `(shots-1) × interval`, nunca todos no mesmo quadro.
    expect(at.at(-1)!-at[0]!).toBeGreaterThan(plan.interval*(plan.shots-2));
  });
  it('um leque de intervalo zero sai inteiro no mesmo passo',()=>{
    const runner=new PrismSkillRunner();
    let emitted=0;
    runner.start(PRISM_SKILLS[2][2]);
    runner.update(frame,()=>emitted++);
    expect(emitted).toBe(PRISM_SKILLS[2][2].shots);
    expect(runner.active).toBe(false);
  });
  it('a sobrecarga não emite nada, dura o que promete e informa o tempo restante',()=>{
    const runner=new PrismSkillRunner();
    const plan=PRISM_SKILLS[0][3];
    let emitted=0;
    runner.start(plan);
    expect(runner.emitting).toBe(false);
    expect(runner.overdrive).toBe(plan);
    let steps=0;
    for(;steps<Math.round(plan.seconds*60)-2;steps++)runner.update(frame,()=>emitted++);
    expect(runner.active).toBe(true);
    expect(runner.remaining).toBeGreaterThan(0);
    expect(runner.remaining).toBeLessThan(.1);
    while(runner.active&&steps<Math.round(plan.seconds*60)+6){runner.update(frame,()=>emitted++);steps++;}
    expect(runner.active).toBe(false);
    // Fechou dentro de um punhado de quadros da duração prometida, e sem emitir nada.
    expect(Math.abs(steps-plan.seconds*60)).toBeLessThanOrEqual(3);
    expect(emitted).toBe(0);
  });
});

// ---------------------------------------------------------------------------- assalto

describe('assalto · II rajada controlada',()=>{
  it('cobra a munição na hora, mira PERFEITO e entrega os seis acertos',()=>{
    const {weapon,services}=fixture({wallZ:20});
    const victim=actor(11,new Vector3(0,1.4,6));
    services.targets.push(victim);
    const plan=PRISM_SKILLS[0][2];
    const before=weapon.magazine.ammo;
    expect(weapon.releaseSkill(2)).toBe(true);
    // A munição sai de UMA vez, na soltura do `Q`.
    expect(weapon.magazine.ammo).toBe(before-plan.ammoCost);
    tick(weapon,60);
    expect(services.hits).toHaveLength(plan.shots);
    // As emissões não cobram de novo: a conta foi fechada em `releaseSkill`.
    expect(weapon.magazine.ammo).toBe(before-plan.ammoCost);
    for(const hit of services.hits){
      expect(hit.target.id).toBe(11);
      expect(hit.spec.damage).toBeCloseTo(PRISM_MODES[0].damage*plan.damageScale,6);
      expect(hit.spec.attackId).toBe(plan.id);
    }
    expect(weapon.skillActive).toBe(false);
  });
  it('é tiro de verdade: disputa ponto fraco, mas NÃO realimenta a barra de MP',()=>{
    const {weapon,services}=fixture();
    const victim=actor(11,new Vector3(0,1.4,6));
    services.targets.push(victim);
    weapon.releaseSkill(2);
    tick(weapon,60);
    const context=victim.damage[0]!;
    expect(context.damageTags).toContain('bullet');
    expect(context.damageTags).toContain('skill');
    expect(weakPointEligible(context.attackerId,context.procChainDepth,context.damageTags)).toBe(true);
    expect(awardsMP({...context,finalDamage:context.baseDamage})).toBe(false);
  });
  it('o gatilho comum fica travado durante a rajada e a recarga automática espera',()=>{
    const {weapon,services}=fixture({wallZ:12});
    const plan=PRISM_SKILLS[0][2];
    weapon.magazine.ammo=plan.ammoCost;
    expect(weapon.releaseSkill(2)).toBe(true);
    expect(weapon.magazine.ammo).toBe(0);
    // Gatilho preso o tempo todo: mesmo assim só saem as emissões da habilidade.
    tick(weapon,30,{fire:true});
    expect(weapon.shots).toBe(plan.shots);
    expect(services.scenery).toHaveLength(plan.shots);
    // Só depois de a rajada acabar o carregador vazio pede a recarga.
    expect(weapon.magazine.reloading).toBe(true);
  });
});

describe('assalto · III sobrecarga',()=>{
  it('não gasta munição ao abrir, mas exige a arma carregada',()=>{
    const {weapon}=fixture();
    const plan=PRISM_SKILLS[0][3];
    weapon.magazine.ammo=plan.ammoRequired-1;
    expect(weapon.releaseSkill(3)).toBe(false);
    expect(weapon.magazine.ammo).toBe(plan.ammoRequired-1);
    weapon.magazine.ammo=plan.ammoRequired;
    expect(weapon.releaseSkill(3)).toBe(true);
    expect(weapon.magazine.ammo).toBe(plan.ammoRequired);
    expect(weapon.skillLabel).toBe(plan.name);
  });
  it('dispara MUITO mais rápido e com mais dano enquanto a janela dura, e depois volta ao normal',()=>{
    const plan=PRISM_SKILLS[0][3];
    const plain=fixture({wallZ:12});
    tick(plain.weapon,60,{fire:true});
    const baseline=plain.weapon.shots;

    const {weapon,services}=fixture({wallZ:12});
    const victim=actor(11,new Vector3(0,1.4,6));
    services.targets.push(victim);
    expect(weapon.releaseSkill(3)).toBe(true);
    tick(weapon,60,{fire:true});
    const boosted=weapon.shots;
    expect(boosted).toBeGreaterThan(baseline*1.8);
    // O tiro da janela é tiro de HABILIDADE: escala por `stats.mp` e não devolve MP.
    const context=victim.damage[0]!;
    expect(context.baseDamage).toBeCloseTo(PRISM_MODES[0].damage*plan.damageScale,6);
    expect(context.damageTags).toContain('skill');
    expect(awardsMP({...context,finalDamage:context.baseDamage})).toBe(false);

    // Passada a janela, a arma volta a ser a de sempre — cadência e dano.
    weapon.magazine.ammo=PRISM_MODES[0].capacity;
    tick(weapon,Math.ceil(plan.seconds*60)+4);
    expect(weapon.skillActive).toBe(false);
    victim.damage.length=0;
    const after=weapon.shots;
    tick(weapon,60,{fire:true});
    expect(weapon.shots-after).toBeLessThanOrEqual(baseline+1);
    expect(victim.damage[0]!.baseDamage).toBe(PRISM_MODES[0].damage);
    expect(victim.damage[0]!.damageTags).not.toContain('skill');
  });
});

// ---------------------------------------------------------------------------- lança de íons

describe('lança de íons · II perfurante pesada',()=>{
  it('um tiro só, muito mais forte, que atravessa a fila inteira',()=>{
    const {weapon,services}=fixture({wallZ:20,mode:1});
    services.targets.push(actor(11,new Vector3(0,1.4,6)),actor(12,new Vector3(0,1.4,10)),actor(13,new Vector3(0,1.4,14)));
    const plan=PRISM_SKILLS[1][2];
    const before=weapon.magazine.ammo;
    expect(weapon.releaseSkill(2)).toBe(true);
    expect(weapon.magazine.ammo).toBe(before-plan.ammoCost);
    tick(weapon,4);
    expect(services.hits.map(hit=>hit.target.id)).toEqual([11,12,13]);
    const damage=PRISM_MODES[1].damage*plan.damageScale;
    expect(damage).toBeGreaterThan(PRISM_MODES[1].damage*2);
    for(const hit of services.hits)expect(hit.spec.damage).toBeCloseTo(damage,6);
    // Um único disparo: a habilidade não é "o tiro normal repetido".
    expect(weapon.shots).toBe(1);
  });
  it('sem munição para a habilidade, nada é cobrado e a arma continua inteira',()=>{
    const {weapon}=fixture({mode:1});
    weapon.magazine.ammo=1;
    expect(weapon.releaseSkill(2)).toBe(false);
    expect(weapon.magazine.ammo).toBe(1);
    expect(weapon.skillActive).toBe(false);
  });
});

describe('lança de íons · III salva de íons',()=>{
  it('reparte os feixes por alvos DIFERENTES',()=>{
    const {weapon,services}=fixture({wallZ:60,mode:1});
    const plan=PRISM_SKILLS[1][3];
    const victims=[
      actor(11,new Vector3(-3,1.4,10)),
      actor(12,new Vector3(3,1.4,12)),
      actor(13,new Vector3(-6,1.4,16)),
      actor(14,new Vector3(6,1.4,18)),
    ];
    services.targets.push(...victims);
    expect(weapon.releaseSkill(3)).toBe(true);
    tick(weapon,90);
    expect(weapon.shots).toBe(plan.shots);
    for(const victim of victims)expect(victim.damage.length).toBeGreaterThan(0);
    for(const victim of victims)
      expect(victim.damage[0]!.baseDamage).toBeCloseTo(PRISM_MODES[1].damage*plan.damageScale,6);
  });
  it('com menos alvos que feixes, os que sobram vão PARA A FRENTE em vez de repetir alvo',()=>{
    const {weapon,services}=fixture({wallZ:40,mode:1});
    const plan=PRISM_SKILLS[1][3];
    const near=actor(11,new Vector3(-3,1.4,10));
    const far=actor(12,new Vector3(3,1.4,12));
    services.targets.push(near,far);
    expect(weapon.releaseSkill(3)).toBe(true);
    tick(weapon,90);
    expect(weapon.shots).toBe(plan.shots);
    // Cada alvo visível é atendido UMA vez — nada de dois feixes no mesmo bicho.
    expect(near.damage).toHaveLength(1);
    expect(far.damage).toHaveLength(1);
    // Todo feixe é perfurante, então os quatro chegam à parede. O que distingue o recuo é ONDE:
    // os dois mirados saem desviados (seguiram o corpo), os dois restantes vão retos na mira.
    expect(services.scenery).toHaveLength(plan.shots);
    const straight=services.scenery.filter(mark=>Math.abs(mark.point.x)<.01);
    expect(straight).toHaveLength(plan.shots-2);
    expect(services.scenery.filter(mark=>Math.abs(mark.point.x)>1)).toHaveLength(2);
    for(const mark of services.scenery)expect(mark.point.z).toBeCloseTo(40,2);
  });
  it('sem alvo nenhum, a salva inteira vai para a frente',()=>{
    const {weapon,services}=fixture({wallZ:40,mode:1});
    expect(weapon.releaseSkill(3)).toBe(true);
    tick(weapon,90);
    expect(services.scenery).toHaveLength(PRISM_SKILLS[1][3].shots);
  });
});

// ---------------------------------------------------------------------------- lança-granadas

describe('lança-granadas · II leque de cápsulas',()=>{
  it('lança três cápsulas ABERTAS, e não três na mesma linha',()=>{
    const {weapon}=fixture({mode:2});
    const plan=PRISM_SKILLS[2][2];
    const before=weapon.magazine.ammo;
    expect(weapon.releaseSkill(2)).toBe(true);
    expect(weapon.magazine.ammo).toBe(before-plan.ammoCost);
    weapon.fixedUpdate(frame,COMMAND);
    expect(weapon.grenades.count).toBe(plan.shots);
    tick(weapon,20);
    const spread=weapon.grenades.live.map(g=>g.position.x);
    expect(Math.max(...spread)-Math.min(...spread)).toBeGreaterThan(1);
    // Simétrico em torno da mira: a soma dos extremos se cancela.
    expect(Math.max(...spread)+Math.min(...spread)).toBeCloseTo(0,4);
  });
  it('cada cápsula do leque explode de verdade, com os números normais da granada',()=>{
    const {weapon,services}=fixture({wallZ:9,mode:2});
    const plan=PRISM_SKILLS[2][2];
    weapon.releaseSkill(2);
    tick(weapon,120);
    expect(weapon.grenades.count).toBe(0);
    expect(weapon.blasts).toBe(plan.shots);
    expect(services.scenery).toHaveLength(plan.shots);
    expect(services.scenery[0]!.damage).toBeCloseTo(PRISM_GRENADE.sceneryDamage,6);
  });
});

describe('lança-granadas · III salva incendiária',()=>{
  /** Um alvo na mira e outro longe o bastante para só o raio AUMENTADO alcançar. */
  function volley(mode:'skill'|'plain') {
    const made=fixture({wallZ:30,mode:2});
    const near=actor(11,new Vector3(0,1.4,6));
    const far=actor(12,new Vector3(0,1.4,11.5));
    made.services.targets.push(near,far);
    if(mode==='skill')made.weapon.releaseSkill(3);
    else tick(made.weapon,1,{fire:true});
    tick(made.weapon,240);
    return {...made,near,far};
  }
  it('gasta o carregador inteiro e joga as cinco cápsulas',()=>{
    const {weapon}=fixture({mode:2});
    const plan=PRISM_SKILLS[2][3];
    expect(plan.ammoCost).toBe(PRISM_MODES[2].capacity);
    expect(weapon.releaseSkill(3)).toBe(true);
    expect(weapon.magazine.ammo).toBe(0);
    tick(weapon,20);
    expect(weapon.grenades.count+weapon.blasts).toBe(plan.shots);
  });
  it('a explosão é MAIOR — e continua sendo limitada',()=>{
    const wide=volley('skill');
    const plain=volley('plain');
    // O alvo distante está fora do raio comum e dentro do raio aumentado.
    expect(plain.far.damage).toHaveLength(0);
    expect(wide.far.damage.length).toBeGreaterThan(0);
    // "Maior" é o RAIO, não "sem limite": o dano ainda cai com a distância.
    const blast=wide.far.damage.find(context=>context.attackId.endsWith('_blast'))!;
    expect(blast).toBeDefined();
    expect(blast.baseDamage).toBeLessThan(PRISM_GRENADE.blastDamage*PRISM_SKILLS[2][3].blastDamageScale);
    expect(blast.baseDamage).toBeGreaterThan(0);
  });
  it('acende o alvo: o dano sai etiquetado para o receptor aplicar a queimadura',()=>{
    const {near}=volley('skill');
    expect(near.damage.length).toBeGreaterThan(0);
    for(const context of near.damage)expect(context.damageTags).toContain(INCENDIARY_TAG);
    const direct=near.damage.find(context=>context.attackId===PRISM_SKILLS[2][3].id)!;
    expect(direct).toBeDefined();
    expect(direct.damageTags).toContain('bullet');
    // O estilhaço continua sem direito a ponto fraco nem a MP, incendiário ou não.
    const blast=near.damage.find(context=>context.attackId.endsWith('_blast'))!;
    expect(weakPointEligible(blast.attackerId,blast.procChainDepth,blast.damageTags)).toBe(false);
    expect(awardsMP({...blast,finalDamage:blast.baseDamage})).toBe(false);
  });
  it('a cápsula COMUM não incendeia nada',()=>{
    const {near}=volley('plain');
    expect(near.damage.length).toBeGreaterThan(0);
    for(const context of near.damage)expect(context.damageTags).not.toContain(INCENDIARY_TAG);
  });
});

// ---------------------------------------------------------------------------- recusas

describe('habilidades do soldado · quando NÃO saem',()=>{
  it('recusa durante recarga, transformação, com a arma guardada e com outra habilidade no ar',()=>{
    const reloading=fixture().weapon;
    reloading.magazine.ammo=10;reloading.requestReload();
    expect(reloading.releaseSkill(2)).toBe(false);

    const transforming=fixture().weapon;
    transforming.requestMode();
    expect(transforming.releaseSkill(2)).toBe(false);

    const holstered=fixture().weapon;
    holstered.holstered=true;
    expect(holstered.releaseSkill(2)).toBe(false);

    const busy=fixture().weapon;
    expect(busy.releaseSkill(2)).toBe(true);
    expect(busy.releaseSkill(3)).toBe(false);
    expect(busy.releaseSkill(2)).toBe(false);
  });
  it('recusar não cobra munição nenhuma — quem paga o MP é a cena, que o devolve',()=>{
    const {weapon}=fixture({mode:2});
    weapon.magazine.ammo=2;
    expect(weapon.releaseSkill(3)).toBe(false);
    expect(weapon.magazine.ammo).toBe(2);
    expect(weapon.skillReleases).toBe(0);
  });
  it('guardar a arma no meio de uma rajada corta as emissões restantes',()=>{
    const {weapon,services}=fixture({wallZ:12});
    expect(weapon.releaseSkill(2)).toBe(true);
    tick(weapon,2);
    const partial=weapon.shots;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(PRISM_SKILLS[0][2].shots);
    weapon.suppressed=true;
    tick(weapon,60);
    expect(weapon.skillActive).toBe(false);
    expect(weapon.shots).toBe(partial);
    expect(services.scenery).toHaveLength(partial);
  });
  it('a morte e o reinício limpam a habilidade e o contador da tentativa',()=>{
    const {weapon}=fixture();
    weapon.releaseSkill(2);
    expect(weapon.skillActive).toBe(true);
    weapon.cancel();
    expect(weapon.skillActive).toBe(false);
    weapon.releaseSkill(2);
    weapon.resetAttempt();
    expect(weapon.skillReleases).toBe(0);
    expect(weapon.skillActive).toBe(false);
    expect(weapon.magazine.ammo).toBe(PRISM_MODES[0].capacity);
  });
});

// ---------------------------------------------------------------------------- HUD

describe('painel · o `Q` do soldado muda com a FORMA',()=>{
  const base={playerClass:'soldier' as const,holstered:false,prismReady:true,prismEquipped:true,
    prismMode:0 as const,prismAmmo:36,prismCapacity:36,prismReloading:false,prismProgress:0,
    prismBusy:false,pistolAmmo:50,pistolCapacity:50,pistolReloading:false,pistolProgress:0};
  it('os níveis II e III nomeiam a habilidade da forma montada',()=>{
    for(const mode of [0,1,2] as const){
      const view=weaponReadout({...base,prismMode:mode});
      expect(view.charge[2]).toBe(prismSkill(mode,2).name);
      expect(view.charge[3]).toBe(prismSkill(mode,3).name);
      expect(view.hint).toContain(prismSkill(mode,2).hint);
      expect(view.hint).toContain(prismSkill(mode,3).hint);
    }
    // Três formas, três pares de rótulos diferentes — nunca o mesmo texto reaproveitado.
    const labels=([0,1,2] as const).map(mode=>weaponReadout({...base,prismMode:mode}).charge.join('|'));
    expect(new Set(labels).size).toBe(3);
  });
  it('o nível I do soldado é grátis e o do pistoleiro não',()=>{
    expect(weaponReadout(base).freeFirstTier).toBe(true);
    expect(weaponReadout(base).charge[1]).toContain('GRÁTIS');
    const gun=weaponReadout({...base,playerClass:'gunslinger',prismEquipped:false});
    expect(gun.freeFirstTier).toBe(false);
    expect(gun.charge[1]).toBe('LEQUE RICOCHETEANTE');
  });
  it('soldado SEM rig joga nas pistolas — e o painel promete as habilidades de pistola',()=>{
    // Degradação real: `prism-triform.glb` não subiu. A cena roteia o `Q` pelas pistolas, e o
    // painel tem de dizer a mesma coisa que a tecla faz.
    const fallback=weaponReadout({...base,prismReady:false,prismEquipped:false});
    expect(fallback.label).toBe('PISTOLAS DUPLAS');
    expect(fallback.freeFirstTier).toBe(false);
    expect(fallback.charge[1]).toBe('LEQUE RICOCHETEANTE');
    expect(fallback.hint).not.toContain('TRANSFORMAR');
  });
  it('uma habilidade no ar manda no painel',()=>{
    const view=weaponReadout({...base,activeSkill:'SOBRECARGA DE DISPARO'});
    expect(view.active).toBe('SOBRECARGA DE DISPARO');
    expect(view.hint).toContain('SOBRECARGA DE DISPARO');
  });
});
