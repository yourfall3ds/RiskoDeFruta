import {describe,it,expect,afterEach} from 'vitest';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {Viewport} from '@babylonjs/core/Maths/math.viewport';
import type {Camera} from '@babylonjs/core/Cameras/camera';
import type {EnemySwarm,DamageLabel} from '../src/game/EnemySwarm';
import type {RunInteractables} from '../src/run/RunInteractables';
import {RunProgression} from '../src/run/RunProgression';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents,Vec3} from '../src/core/contracts';
import {RunHUD} from '../src/ui/CombatHUD';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import type {EnemySurface} from '../src/enemies/EnemySpace';
import {installCountingDom,uninstallCountingDom,type FakeElement} from './support/counting-dom';

const WIDTH=1920,HEIGHT=1080,R=180;
const frame=new PlanetFrame({centre:{x:0,y:0,z:0},surfaceRadius:R,voidRadius:168,ceilingRadius:320,islandRadius:72});

/**
 * Só o que o HUD consome de `SurfaceFrame`. Em jogo isto vem de `EnemySwarm.surface`; aqui é a
 * mesma matemática radial do núcleo (`PlanetFrame`), sem precisar da BVH do planeta.
 */
const surface:EnemySurface={
  up:p=>frame.up(p),
  support:()=>undefined,
  slide:()=>{},
  sweep:()=>undefined,
  planarDistance:(a,b)=>frame.arcDistance(a,b),
  heightGap:(a,b)=>{const u=frame.up(b);return (a.x-b.x)*u.x+(a.y-b.y)*u.y+(a.z-b.z)*u.z;},
  basis:(p,hint)=>frame.basisAt(p,hint),
};

const SIX=[
  {name:'+Y',d:{x:0,y:1,z:0}},{name:'-Y',d:{x:0,y:-1,z:0}},
  {name:'+X',d:{x:1,y:0,z:0}},{name:'-X',d:{x:-1,y:0,z:0}},
  {name:'+Z',d:{x:0,y:0,z:1}},{name:'-Z',d:{x:0,y:0,z:-1}},
] as const;
const onDeck=(d:Vec3,altitude=0):Vec3=>frame.fromDirection(d,altitude);
/** Ponto do convés a `arc` metros de `from`, na direção tangente `angle`. */
function walk(from:Vec3,arc:number,angle=0):Vec3 {
  const basis=frame.basisAt(from,{x:0,y:0,z:1});
  const s=Math.sin(angle)*arc,c=Math.cos(angle)*arc;
  return frame.geodesicStep(from,{
    x:basis.right.x*s+basis.forward.x*c,y:basis.right.y*s+basis.forward.y*c,z:basis.right.z*s+basis.forward.z*c,
  }).position;
}

/** Câmera atrás do jogador, com `up` RADIAL — é o que `PlanetCameraRig` monta em jogo. */
class RadialCamera {
  readonly position=new Vector3();
  readonly viewport=new Viewport(0,0,1,1);
  private readonly transform=Matrix.Identity();
  private readonly engine={getRenderWidth:():number=>WIDTH,getRenderHeight:():number=>HEIGHT};
  private target=new Vector3();private up=new Vector3(0,1,0);
  /** Enquadra o jogador olhando para `look`, recuada 7 m e elevada 3 m na vertical local. */
  place(player:Vec3,look:Vec3):void {
    const u=frame.up(player),basis=frame.basisAt(player,{x:look.x-player.x,y:look.y-player.y,z:look.z-player.z});
    this.position.set(
      player.x-basis.forward.x*7+u.x*3,player.y-basis.forward.y*7+u.y*3,player.z-basis.forward.z*7+u.z*3,
    );
    this.target.set(player.x+u.x*1.2,player.y+u.y*1.2,player.z+u.z*1.2);
    this.up.set(u.x,u.y,u.z);
  }
  getForwardRay():{direction:Vector3}{return{direction:this.target.subtract(this.position).normalize()};}
  getTransformationMatrix():Matrix {
    const view=Matrix.LookAtLH(this.position,this.target,this.up);
    view.multiplyToRef(Matrix.PerspectiveFovLH(.9,WIDTH/HEIGHT,.1,600),this.transform);
    return this.transform;
  }
  getEngine(){return this.engine;}
}

type SwarmActor=EnemySwarm['actors'][number];
/**
 * Ator com o que o HUD lê. A caixa é a AABB de MUNDO de um corpo de 1,8 m deitado ao longo da
 * vertical local — que é o ponto: fora do polo norte o topo dela em `y` não é a cabeça.
 */
function actorAt(p:Vec3,damaged=false):SwarmActor {
  const up=frame.up(p),head={x:p.x+up.x*1.8,y:p.y+up.y*1.8,z:p.z+up.z*1.8};
  const lo={x:Math.min(p.x,head.x)-.4,y:Math.min(p.y,head.y)-.4,z:Math.min(p.z,head.z)-.4};
  const hi={x:Math.max(p.x,head.x)+.4,y:Math.max(p.y,head.y)+.4,z:Math.max(p.z,head.z)+.4};
  const vectorsWorld=[
    new Vector3(lo.x,lo.y,lo.z),new Vector3(hi.x,lo.y,lo.z),new Vector3(hi.x,hi.y,lo.z),new Vector3(lo.x,hi.y,lo.z),
    new Vector3(lo.x,lo.y,hi.z),new Vector3(hi.x,lo.y,hi.z),new Vector3(hi.x,hi.y,hi.z),new Vector3(lo.x,hi.y,hi.z),
  ];
  return {
    active:true,kind:'tomato',variant:'normal',
    root:{position:new Vector3(p.x,p.y,p.z)},
    body:{getBoundingInfo:()=>({boundingBox:{maximumWorld:{y:hi.y},vectorsWorld}})},
    health:{current:damaged?24:60,maximum:60,dead:false},
    healthTrail:damaged?30:60,hit:damaged?.08:0,
  } as unknown as SwarmActor;
}

function harness(radial:boolean){
  const dom=installCountingDom();
  const run=new RunProgression(new EventBus<GameEvents>());
  const camera=new RadialCamera();
  const director={state:1,hordeMode:false,wave:1,intermission:0,time:0,waveQuota:12,spawned:0,completedWaves:0};
  const swarm={
    director,count:0,populationCap:24,kills:0,boss:undefined as unknown,bossHP:0,bossMaxHP:100,
    bossDeadTime:-1,labels:[] as DamageLabel[],actors:[] as SwarmActor[],
    // É exatamente por aqui que o HUD descobre o referencial — sem fiação da integração.
    surface:radial?surface:undefined,
  };
  const interact={entries:[],districtContract:undefined as unknown,waveRewardGuide:undefined as unknown,
    nearest:undefined as unknown,nearestLoot:undefined as unknown,atRift:false,message:'',messageTime:0};
  const hud=new RunHUD();
  let clock=0;
  const tick=()=>{clock+=.105;run.time=clock;
    hud.update(run,swarm as unknown as EnemySwarm,interact as unknown as RunInteractables,camera as unknown as Camera);};
  return{dom,run,camera,swarm,hud,tick};
}
afterEach(()=>uninstallCountingDom());

const bars=(dom:{querySelectorAll(s:string):FakeElement[]}):FakeElement[]=>
  dom.querySelectorAll('.enemy-health-bars')[0]?.children.filter(c=>c.style.display!=='none')??[];

describe('barras de vida no planeta',()=>{
  it.each(SIX.map(p=>[p.name,p.d] as const))('%s: a praga próxima e ferida mostra barra, a distante não',(_name,d)=>{
    const t=harness(true);
    const player=onDeck(d);
    const close=walk(player,6,.4),far=walk(player,60,.4);
    t.swarm.actors.push(actorAt(close,true),actorAt(far,true));
    t.camera.place(player,close);
    t.tick();
    const live=bars(t.dom);
    expect(live,'uma barra, só para a praga próxima').toHaveLength(1);
    // A barra é ancorada ACIMA DA CABEÇA na vertical local — não no topo da caixa em `+Y`.
    const up=frame.up(close);
    const height=1.8+.4*(Math.abs(up.x)+Math.abs(up.y)+Math.abs(up.z))+.22;
    const head=new Vector3(close.x+up.x*height,close.y+up.y*height,close.z+up.z*height);
    const screen=Vector3.Project(head,Matrix.Identity(),t.camera.getTransformationMatrix(),
      t.camera.viewport.toGlobal(WIDTH,HEIGHT));
    const left=Number(live[0]!.style.left.replace('%','')),top=Number(live[0]!.style.top.replace('%',''));
    expect(left).toBeCloseTo(screen.x/WIDTH*100,0);
    expect(top).toBeCloseTo(screen.y/HEIGHT*100,0);
    // Estado de dano preservado, do jeito original.
    expect(live[0]!.className).toContain('damaged');
    expect(live[0]!.children[0]!.children[1]!.style.width).toBe('40%');
  });

  it('a praga ANTÍPODA, com o mesmo (x,z) do jogador, não rouba barra',()=>{
    const player=onDeck({x:0,y:1,z:0});
    const close=walk(player,5,0);
    // Mesmo (x,z) do jogador, outro hemisfério: o recorte planar `dx²+dz²` a deixaria passar.
    const antipode={x:player.x,y:-player.y,z:player.z};
    expect(Math.hypot(antipode.x-player.x,antipode.z-player.z)).toBeLessThan(1e-9);
    expect(frame.arcDistance(antipode,player)).toBeCloseTo(Math.PI*R,3);

    const radial=harness(true);
    radial.swarm.actors.push(actorAt(close,true),actorAt(antipode,true));
    radial.camera.place(player,close);
    radial.tick();
    expect(bars(radial.dom),'só a praga desta ilha').toHaveLength(1);
    uninstallCountingDom();


  });

  it('a barra desenha SÓ a barra; nome e vida ficam no rótulo acessível',()=>{
    const t=harness(true);
    const player=onDeck({x:.4,y:-.7,z:.59});
    const close=walk(player,7,1.1);
    t.swarm.actors.push(actorAt(close,true));
    t.camera.place(player,close);
    t.tick();
    const [bar]=bars(t.dom);
    expect(bar).toBeDefined();
    // Nada de texto por cima da cena: nem nome de espécie, nem numeral de vida.
    expect(bar!.textContent??'').toBe('');
    expect(bar!.getAttribute('role')).toBe('img');
    // A acessibilidade mantém tudo.
    const label=bar!.getAttribute('aria-label')??'';
    expect(label).toContain('24 de 60 de vida');
    expect(label.length).toBeGreaterThan(10);
  });

  it.each(SIX.map(p=>[p.name,p.d] as const))('%s: o número de dano sobe pela vertical local',(_name,d)=>{
    const t=harness(true);
    const player=onDeck(d),spot=walk(player,5,.2);
    const up=frame.up(spot);
    t.swarm.labels.push({position:{x:spot.x+up.x*1.8,y:spot.y+up.y*1.8,z:spot.z+up.z*1.8},amount:24,crit:false,time:.5});
    t.camera.place(player,spot);
    t.tick();
    const labels=t.dom.querySelectorAll('.damage-labels')[0]?.children.filter(c=>c.style.display!=='none')??[];
    expect(labels).toHaveLength(1);
    expect(labels[0]!.textContent).toBe('24');
    const rise=1.8+(1-.5)*.8;
    const at=new Vector3(spot.x+up.x*rise,spot.y+up.y*rise,spot.z+up.z*rise);
    const screen=Vector3.Project(at,Matrix.Identity(),t.camera.getTransformationMatrix(),
      t.camera.viewport.toGlobal(WIDTH,HEIGHT));
    expect(Number(labels[0]!.style.left.replace('%',''))).toBeCloseTo(screen.x/WIDTH*100,0);
    expect(Number(labels[0]!.style.top.replace('%',''))).toBeCloseTo(screen.y/HEIGHT*100,0);
  });
});

describe('a fazenda continua exatamente como era',()=>{
  it('sem superfície, âncora e recorte são as expressões planas de sempre',()=>{
    const t=harness(false);
    const close={x:2,y:0,z:6},far={x:2,y:0,z:60};
    t.swarm.actors.push(actorAt(close,true),actorAt(far,true));
    t.camera.position.set(0,1.6,-6);
    // Câmera plana olhando para +Z, `up` em +Y — o enquadramento original.
    (t.camera as unknown as {target:Vector3}).target=new Vector3(0,1.6,10);
    (t.camera as unknown as {up:Vector3}).up=new Vector3(0,1,0);
    t.tick();
    const live=bars(t.dom);
    expect(live).toHaveLength(1);
    // Âncora plana LITERAL: `(root.x, maximumWorld.y + .22, root.z)`.
    const box=t.swarm.actors[0]!.body.getBoundingInfo().boundingBox as unknown as {maximumWorld:{y:number}};
    const anchor=new Vector3(close.x,box.maximumWorld.y+.22,close.z);
    const screen=Vector3.Project(anchor,Matrix.Identity(),t.camera.getTransformationMatrix(),
      t.camera.viewport.toGlobal(WIDTH,HEIGHT));
    expect(Number(live[0]!.style.left.replace('%',''))).toBeCloseTo(screen.x/WIDTH*100,1);
    expect(Number(live[0]!.style.top.replace('%',''))).toBeCloseTo(screen.y/HEIGHT*100,1);
  });
});
