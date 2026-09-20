import {describe,it,expect} from 'vitest';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Vec3} from '../src/core/contracts';
import type {TrainingTarget} from '../src/world/TrainingYard';
import type {CombatContact,CombatEffects,CombatHitSpec,CombatServices,CombatSweep} from '../src/combat/CombatServices';
import {PrismGrenades,type GrenadeContact,type GrenadeWorld} from '../src/combat/PrismGrenades';
import {
  TRAJECTORY_MAX_POINTS,TRAJECTORY_MAX_STEPS,TRAJECTORY_REFRESH_HZ,TRAJECTORY_STEP,
  TrajectoryRefreshGate,predictGrenadeFlight,
} from '../src/combat/GrenadeTrajectory';
import {PrismWeapon,type PrismCommand,type PrismRigPort} from '../src/combat/PrismWeapon';
import {PRISM_GRENADE} from '../src/combat/PrismTuning';

const frame=TRAJECTORY_STEP;

// ---------------------------------------------------------------------------- mundos de teste

/** Chão plano em `y = groundY`, com parede opcional em `z = wallZ`. Vertical constante `+Y`. */
function flatWorld(options:{groundY?:number;wallZ?:number}={}):GrenadeWorld {
  const groundY=options.groundY??0;
  return {
    up:()=>({x:0,y:1,z:0}),
    segment:(from,to,radius)=>{
      let best:GrenadeContact|undefined,bestTime=Number.POSITIVE_INFINITY;
      const floor=hitPlane(from.y,to.y,groundY+radius);
      if(floor!==undefined&&floor<bestTime){bestTime=floor;best={point:lerp(from,to,floor),normal:{x:0,y:1,z:0}};}
      if(options.wallZ!==undefined){
        const wall=hitPlane(from.z,to.z,options.wallZ-radius);
        if(wall!==undefined&&wall<bestTime){bestTime=wall;best={point:lerp(from,to,wall),normal:{x:0,y:0,z:-1}};}
      }
      return best;
    },
  };
}

/** Casca esférica: a vertical é a RADIAL, como no planeta de verdade. */
function radialWorld(centre:Vec3,shell:number):GrenadeWorld {
  return {
    up:point=>{
      const d={x:point.x-centre.x,y:point.y-centre.y,z:point.z-centre.z};
      const length=Math.hypot(d.x,d.y,d.z)||1;
      return {x:d.x/length,y:d.y/length,z:d.z/length};
    },
    segment:(from,to,radius)=>{
      // |P(t) − centro| = casca + raio da sonda, resolvido no segmento.
      const o={x:from.x-centre.x,y:from.y-centre.y,z:from.z-centre.z};
      const d={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z};
      const target=shell+radius;
      const a=d.x*d.x+d.y*d.y+d.z*d.z;
      if(a<1e-12)return undefined;
      const b=2*(o.x*d.x+o.y*d.y+o.z*d.z);
      const c=o.x*o.x+o.y*o.y+o.z*o.z-target*target;
      const disc=b*b-4*a*c;
      if(disc<0)return undefined;
      const root=Math.sqrt(disc);
      for(const t of [(-b-root)/(2*a),(-b+root)/(2*a)]){
        if(t<0||t>1)continue;
        const point=lerp(from,to,t);
        const n={x:point.x-centre.x,y:point.y-centre.y,z:point.z-centre.z};
        const length=Math.hypot(n.x,n.y,n.z)||1;
        return {point,normal:{x:n.x/length,y:n.y/length,z:n.z/length}};
      }
      return undefined;
    },
  };
}

function hitPlane(a:number,b:number,plane:number):number|undefined {
  const delta=b-a;
  if(Math.abs(delta)<1e-12)return undefined;
  const t=(plane-a)/delta;
  return t>=0&&t<=1?t:undefined;
}
const lerp=(from:Vec3,to:Vec3,t:number):Vec3=>
  ({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:from.z+(to.z-from.z)*t});

/** Roda a cápsula VIVA passo a passo e devolve o caminho dela mais o desfecho. */
function livePath(world:GrenadeWorld,origin:Vec3,direction:Vec3,steps=TRAJECTORY_MAX_STEPS) {
  const detonations:{at:Vec3;normal:Vec3;contact:GrenadeContact|undefined}[]=[];
  const grenades=new PrismGrenades(world,(_g,at,normal,contact)=>{
    detonations.push({at:{...at},normal:{...normal},contact});
  });
  grenades.launch(origin,direction);
  const path:Vec3[]=[{...origin}];
  for(let i=0;i<steps&&grenades.count>0;i++){
    grenades.update(frame);
    const live=grenades.live[0];
    if(live)path.push({...live.position});
  }
  return {path,detonation:detonations[0]};
}

const near=(a:Vec3,b:Vec3,digits=9):void=>{
  expect(a.x).toBeCloseTo(b.x,digits);
  expect(a.y).toBeCloseTo(b.y,digits);
  expect(a.z).toBeCloseTo(b.z,digits);
};

// ---------------------------------------------------------------------------- paridade

describe('trajetória prevista · é a MESMA física da cápsula',()=>{
  it('ponto a ponto, o arco previsto é o voo real (mundo plano)',()=>{
    const world=flatWorld({groundY:0});
    const origin={x:0,y:1.6,z:0},direction={x:0,y:.25,z:1};
    // Teto de pontos alto o bastante para NÃO decimar: aqui o que se compara é a integração.
    const prediction=predictGrenadeFlight(world,origin,direction,{maxPoints:4096});
    const live=livePath(world,origin,direction);
    expect(prediction.impact).toBeDefined();
    expect(live.detonation).toBeDefined();
    // O último ponto previsto é o contato; o voo real tem um ponto a menos (ele some ao detonar).
    expect(prediction.points).toHaveLength(live.path.length+1);
    for(let i=0;i<live.path.length;i++)near(prediction.points[i]!,live.path[i]!);
    near(prediction.impact!.point,live.detonation!.at);
    near(prediction.impact!.normal,live.detonation!.normal);
  });

  it('num planeta a queda é pela RADIAL, e o previsto continua sendo o voo real',()=>{
    const centre={x:0,y:-200,z:0},shell=200;
    const world=radialWorld(centre,shell);
    const origin={x:0,y:1.6,z:0},direction={x:0,y:.2,z:1};
    const prediction=predictGrenadeFlight(world,origin,direction,{maxPoints:4096});
    const live=livePath(world,origin,direction);
    expect(prediction.impact).toBeDefined();
    for(let i=0;i<live.path.length;i++)near(prediction.points[i]!,live.path[i]!);
    near(prediction.impact!.point,live.detonation!.at);
    // A normal do contato aponta para FORA do planeta — é ela que deita o marcador na casca.
    const radial=world.up(prediction.impact!.point);
    expect(prediction.impact!.normal.x*radial.x+prediction.impact!.normal.y*radial.y+prediction.impact!.normal.z*radial.z)
      .toBeGreaterThan(.99);
    // E o arco cai mesmo: a altitude no fim é menor que no começo.
    const altitude=(p:Vec3):number=>Math.hypot(p.x-centre.x,p.y-centre.y,p.z-centre.z);
    expect(altitude(prediction.impact!.point)).toBeLessThan(altitude(origin));
  });

  it('a parede detém o arco no mesmo ponto em que detém a cápsula',()=>{
    const world=flatWorld({groundY:-40,wallZ:9});
    const origin={x:0,y:1.6,z:0},direction={x:0,y:0,z:1};
    const prediction=predictGrenadeFlight(world,origin,direction,{maxPoints:4096});
    const live=livePath(world,origin,direction);
    expect(prediction.impact).toBeDefined();
    near(prediction.impact!.point,live.detonation!.at);
    expect(prediction.impact!.point.z).toBeLessThanOrEqual(9.0001);
    expect(prediction.impact!.normal.z).toBeCloseTo(-1,6);
  });
});

// ---------------------------------------------------------------------------- estopim no ar

describe('trajetória prevista · sem chão, sem marcador',()=>{
  it('estopim estourado no ar NÃO devolve ponto de queda',()=>{
    const sky:GrenadeWorld={up:()=>({x:0,y:1,z:0}),segment:()=>undefined};
    const prediction=predictGrenadeFlight(sky,{x:0,y:0,z:0},{x:0,y:1,z:0});
    expect(prediction.airburst).toBe(true);
    expect(prediction.impact).toBeUndefined();
    expect(prediction.truncated).toBe(false);
    expect(prediction.points.length).toBeGreaterThan(2);
    // E a cápsula real faz exatamente o mesmo: detona sem contato.
    const live=livePath(sky,{x:0,y:0,z:0},{x:0,y:1,z:0});
    expect(live.detonation?.contact).toBeUndefined();
    // O estopim previsto dura exatamente o que o estopim real dura.
    expect(prediction.steps).toBe(live.path.length);
    expect(prediction.steps*frame).toBeGreaterThanOrEqual(PRISM_GRENADE.fuseSeconds);
  });

  it('o arco truncado também não marca chão nenhum',()=>{
    const sky:GrenadeWorld={up:()=>({x:0,y:1,z:0}),segment:()=>undefined};
    const prediction=predictGrenadeFlight(sky,{x:0,y:0,z:0},{x:0,y:1,z:0},{maxSteps:12});
    expect(prediction.truncated).toBe(true);
    expect(prediction.airburst).toBe(false);
    expect(prediction.impact).toBeUndefined();
    expect(prediction.steps).toBe(12);
  });
});

// ---------------------------------------------------------------------------- custo limitado

describe('trajetória prevista · custo limitado',()=>{
  it('o desenho cabe no teto de pontos e termina onde o voo termina',()=>{
    const sky:GrenadeWorld={up:()=>({x:0,y:1,z:0}),segment:()=>undefined};
    const prediction=predictGrenadeFlight(sky,{x:0,y:0,z:0},{x:0,y:1,z:.2});
    expect(prediction.points.length).toBeLessThanOrEqual(TRAJECTORY_MAX_POINTS);
    expect(prediction.steps).toBeLessThanOrEqual(TRAJECTORY_MAX_STEPS);
    // A ponta desenhada é a posição final de verdade, não uma amostra intermediária da decimação.
    const full=predictGrenadeFlight(sky,{x:0,y:0,z:0},{x:0,y:1,z:.2},{maxPoints:4096});
    near(prediction.points[prediction.points.length-1]!,full.points[full.points.length-1]!);
  });

  it('a varredura do mundo é consultada no máximo uma vez por passo',()=>{
    let queries=0;
    const counted:GrenadeWorld={up:()=>({x:0,y:1,z:0}),segment:()=>{queries++;return undefined;}};
    const prediction=predictGrenadeFlight(counted,{x:0,y:0,z:0},{x:0,y:1,z:0});
    expect(queries).toBe(prediction.steps);
  });

  it('o porteiro cobra dez atualizações por segundo e ignora mira parada',()=>{
    const gate=new TrajectoryRefreshGate();
    const at={x:0,y:0,z:0},look={x:0,y:0,z:1};
    // A primeira consulta sempre passa: não existe arco desenhado ainda.
    expect(gate.due(frame,at,look)).toBe(true);
    let allowed=0;
    for(let i=0;i<60;i++)if(gate.due(frame,{x:0,y:0,z:0},{x:0,y:0,z:1}))allowed++;
    // Um segundo inteiro com tudo parado: só o mínimo para cobrir cenário e inimigos que se mexem
    // sozinhos — longe dos 60 recálculos que custaria sem porteiro.
    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThanOrEqual(3);
    // Andando, o relógio volta a valer — e continua limitado a ~10 Hz.
    let moving=0;
    for(let i=0;i<60;i++)if(gate.due(frame,{x:i*.5,y:0,z:0},look))moving++;
    expect(moving).toBeLessThanOrEqual(TRAJECTORY_REFRESH_HZ);
    expect(moving).toBeGreaterThan(0);
  });

  it('girar a mira também libera o recálculo',()=>{
    const gate=new TrajectoryRefreshGate();
    const at={x:0,y:0,z:0};
    gate.due(frame,at,{x:0,y:0,z:1});
    for(let i=0;i<12;i++)gate.due(frame,at,{x:0,y:0,z:1});
    expect(gate.due(0,at,{x:1,y:0,z:0})).toBe(true);
  });
});

// ---------------------------------------------------------------------------- prévia da arma

/** Doublé do combate, reduzido ao que a prévia e o disparo da granada consultam. */
class SkyCombat implements CombatServices {
  readonly hits:{target:TrainingTarget;spec:CombatHitSpec}[]=[];
  readonly scenery:{point:Vector3;damage:number}[]=[];
  readonly effects:CombatEffects&{calls:number}={calls:0,
    mark(){this.calls++;},muzzle(){this.calls++;},impact(){this.calls++;},
    tracer(){this.calls++;},piercer(){this.calls++;},burst(){this.calls++;}};
  /** Chão a `y = 0`; sem ele a prévia nunca acharia ponto de queda. */
  groundY=0;
  sweeps=0;
  get combatTargets():readonly TrainingTarget[] {return [];}
  traceWorld(origin:Vector3,direction:Vector3,range:number):CombatContact|undefined {
    if(Math.abs(direction.y)<1e-9)return undefined;
    const distance=(this.groundY-origin.y)/direction.y;
    if(!(distance>0&&distance<=range))return undefined;
    return {point:origin.add(direction.scale(distance)),normal:new Vector3(0,1,0),distance,target:undefined,triangle:1};
  }
  sweep(origin:Vector3,direction:Vector3,range:number,padding=0):CombatSweep {
    this.sweeps++;void padding;
    return {world:this.traceWorld(origin,direction,range),actors:[]};
  }
  applyHit(target:TrainingTarget,spec:CombatHitSpec):void {this.hits.push({target,spec});}
  damageScenery(point:Vector3,_n:Vector3,_d:Vector3,damage:number):boolean {this.scenery.push({point,damage});return true;}
}

class StubRig implements PrismRigPort {
  ready=true;enabled=false;mode:0|1|2=2;busy=false;fired=0;
  muzzle:Vector3|undefined=new Vector3(0,1.6,0);
  update():void {}
  setMode(mode:0|1|2):void {this.mode=mode;}
  transform():boolean {return false;}
  fire():void {this.fired++;}
  reload():void {}
  reset():void {}
}

function grenadeFixture() {
  const services=new SkyCombat();
  const rig=new StubRig();
  const camera={forward:new Vector3(0,.18,1).normalize(),camera:{position:new Vector3(0,1.8,-1.4)},
    impulses:0,impulse(){this.impulses++;}};
  let rolls=0;
  const weapon=new PrismWeapon({services,rig,camera,rng:{range:():number=>{rolls++;return 0;}},
    body:()=>new Vector3(0,0,0)});
  weapon.setEquipped(true);
  weapon.arsenal.setMode(2);
  return {services,rig,camera,weapon,rolls:():number=>rolls};
}

const COMMAND:PrismCommand={fire:false,reload:false,cycle:false,canAct:true};

describe('prévia da granada na arma',()=>{
  it('não custa munição, tiro, dano, efeito, sorteio nem tranco de câmera',()=>{
    const {services,rig,camera,weapon,rolls}=grenadeFixture();
    const ammo=weapon.magazine.ammo;
    for(let i=0;i<50;i++)expect(weapon.previewGrenade()).toBeDefined();
    expect(weapon.magazine.ammo).toBe(ammo);
    expect(weapon.shots).toBe(0);
    expect(weapon.blasts).toBe(0);
    expect(weapon.grenades.count).toBe(0);
    expect(services.hits).toHaveLength(0);
    expect(services.scenery).toHaveLength(0);
    expect(services.effects.calls).toBe(0);
    expect(rig.fired).toBe(0);
    expect(camera.impulses).toBe(0);
    // Nenhum número sorteado: a prévia não pode deslocar a corrida inteira que bebe da mesma fonte.
    expect(rolls()).toBe(0);
  });

  it('só o lança-granadas tem arco a mostrar',()=>{
    const {weapon,rig}=grenadeFixture();
    for(const mode of [0,1] as const){
      weapon.arsenal.setMode(mode);rig.setMode(mode);
      expect(weapon.previewGrenade()).toBeUndefined();
    }
    weapon.arsenal.setMode(2);rig.setMode(2);
    expect(weapon.previewGrenade()).toBeDefined();
  });

  it('o ponto previsto é onde a cápsula REALMENTE explode',()=>{
    const {services,weapon,rig}=grenadeFixture();
    const prediction=weapon.previewGrenade();
    expect(prediction?.impact).toBeDefined();
    // Dispara de verdade e roda o voo inteiro: o buraco cai no ponto que o marcador prometia.
    weapon.fixedUpdate(frame,{...COMMAND,fire:true});
    expect(weapon.shots).toBe(1);
    for(let i=0;i<TRAJECTORY_MAX_STEPS&&weapon.grenades.count>0;i++)weapon.fixedUpdate(frame,COMMAND);
    expect(weapon.blasts).toBe(1);
    const crater=services.scenery.at(-1)!;
    expect(crater.point.x).toBeCloseTo(prediction!.impact!.point.x,6);
    expect(crater.point.y).toBeCloseTo(prediction!.impact!.point.y,6);
    expect(crater.point.z).toBeCloseTo(prediction!.impact!.point.z,6);
    expect(crater.damage).toBe(PRISM_GRENADE.sceneryDamage);
    void rig;
  });

  it('a prévia sai do MESMO cano e da mesma mira do disparo',()=>{
    const {weapon,rig}=grenadeFixture();
    rig.muzzle=new Vector3(3,1.6,0);
    const moved=weapon.previewGrenade()!;
    expect(moved.points[0]!.x).toBeCloseTo(3,6);
    rig.muzzle=undefined;
    // Sem boca publicada a arma usa a âncora do peito — e a prévia usa a MESMA.
    const anchored=weapon.previewGrenade()!;
    expect(anchored.points[0]!.x).not.toBeCloseTo(3,3);
  });
});
