import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ThirdPersonCamera} from '../src/camera/ThirdPersonCamera';
import {SlowMotion,SLOW_MOTION_SECONDS,SLOW_MOTION_COOLDOWN,SLOW_MOTION_SCALE} from '../src/camera/SlowMotion';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {EventBus} from '../src/core/EventBus';
import {EMPTY_INPUT} from '../src/input/InputFrame';
import {RunRNG} from '../src/core/RunRNG';
import {chooseSpawnAround,validSpawnGround,SPAWN_RING_MIN,SPAWN_RING_MAX} from '../src/ai/SpawnPlanner';
import {MonsterDirector} from '../src/run/MonsterDirector';
import {CAMERA_TUNING,PLAYER_TUNING} from '../src/player/PlayerTuning';

const tick=(p:PlayerMotor,steps:number,input:Partial<typeof EMPTY_INPUT>={},yaw=0)=>{for(let i=0;i<steps;i++)p.fixedUpdate(1/60,{...EMPTY_INPUT,...input},yaw);};

describe('câmera: amortecimento, antecipação e FOV de corrida',()=>{
  function fixture(){
    const engine=new NullEngine(),scene=new Scene(engine),world=new CollisionWorld();
    world.surfaces.push({id:'floor',x:0,z:0,width:400,depth:400,height:0});
    return {camera:new ThirdPersonCamera(scene,world),engine};
  }
  it('mantém a mira: o alvo continua à frente do yaw mesmo com antecipação lateral',()=>{
    const {camera}=fixture();
    for(let i=0;i<180;i++)camera.update({x:0,y:0,z:0},0,0,1/60,{x:8,y:0,z:0});
    const forward=camera.forward;
    expect(forward.x).toBeCloseTo(0,5);
    expect(forward.z).toBeCloseTo(1,5);
  });
  it('a antecipação desloca o pivô a favor do movimento e volta ao parar',()=>{
    const {camera}=fixture();
    for(let i=0;i<240;i++)camera.update({x:0,y:0,z:0},0,0,1/60,{x:0,y:0,z:8});
    const lead=camera.pivot.z;
    expect(lead).toBeGreaterThan(.2);
    expect(lead).toBeLessThanOrEqual(CAMERA_TUNING.lookAheadMeters+1e-6);
    for(let i=0;i<240;i++)camera.update({x:0,y:0,z:0},0,0,1/60,{x:0,y:0,z:0});
    expect(camera.pivot.z).toBeCloseTo(0,2);
  });
  it('abre e fecha o FOV da corrida suavemente, sem salto de um quadro',()=>{
    const {camera}=fixture();
    camera.update({x:0,y:0,z:0},0,0,1/60); // primeiro quadro apenas posiciona a câmera
    const base=camera.camera.fov;
    camera.setSprint(true);camera.update({x:0,y:0,z:0},0,0,1/60);
    expect(camera.camera.fov-base).toBeLessThan(CAMERA_TUNING.sprintFovDegrees*Math.PI/180*.3);
    for(let i=0;i<180;i++)camera.update({x:0,y:0,z:0},0,0,1/60);
    expect(camera.camera.fov).toBeCloseTo(base+CAMERA_TUNING.sprintFovDegrees*Math.PI/180,3);
    camera.setSprint(false);
    for(let i=0;i<180;i++)camera.update({x:0,y:0,z:0},0,0,1/60);
    expect(camera.camera.fov).toBeCloseTo(base,3);
  });
  it('não depende da taxa de quadros para chegar ao mesmo FOV',()=>{
    const a=fixture().camera,b=fixture().camera;
    a.update({x:0,y:0,z:0},0,0,1/60);b.update({x:0,y:0,z:0},0,0,1/20);
    a.setSprint(true);b.setSprint(true);
    for(let i=0;i<120;i++)a.update({x:0,y:0,z:0},0,0,1/60);
    for(let i=0;i<40;i++)b.update({x:0,y:0,z:0},0,0,1/20);
    expect(a.camera.fov).toBeCloseTo(b.camera.fov,3);
  });
});

describe('lentidão de finalização',()=>{
  it('só dispara em morte forte, é curta e respeita o intervalo',()=>{
    const slow=new SlowMotion();
    expect(slow.request(false)).toBe(false);
    expect(slow.request(true)).toBe(true);
    expect(slow.scale).toBeLessThan(1);
    expect(slow.scale).toBeGreaterThanOrEqual(SLOW_MOTION_SCALE);
    expect(slow.request(true)).toBe(false); // não empilha
    for(let i=0;i<SLOW_MOTION_SECONDS*60+2;i++)slow.update(1/60);
    expect(slow.active).toBe(false);
    expect(slow.scale).toBe(1);
    expect(slow.request(true)).toBe(false); // ainda em intervalo
    for(let i=0;i<SLOW_MOTION_COOLDOWN*60;i++)slow.update(1/60);
    expect(slow.request(true)).toBe(true);
    expect(slow.triggers).toBe(2);
  });
  it('avança com tempo real, então a janela não se prolonga sozinha',()=>{
    const slow=new SlowMotion();slow.request(true);
    let simulated=0;
    for(let i=0;i<SLOW_MOTION_SECONDS*60;i++){simulated+=1/60*slow.scale;slow.update(1/60);}
    expect(slow.remaining).toBeLessThan(.02);
    expect(simulated).toBeLessThan(SLOW_MOTION_SECONDS); // a apresentação andou menos que o relógio
  });
});

describe('diretor perto do jogador',()=>{
  function terrain(){
    const world=new CollisionWorld();
    world.surfaces.push({id:'field',x:0,z:0,width:200,depth:200,height:0});
    return world;
  }
  it('recusa vazio, interior sólido e laje estreita',()=>{
    const world=terrain();
    expect(validSpawnGround(world,10,10,0)).toBe(true);
    expect(validSpawnGround(world,10,10,Number.NaN)).toBe(false);
    const narrow=new CollisionWorld();
    narrow.surfaces.push({id:'catwalk',x:0,z:0,width:3,depth:120,height:0});
    expect(validSpawnGround(narrow,0,0,0)).toBe(false);
  });
  it('gera no anel pedido, nunca no corpo do jogador',()=>{
    const world=terrain(),rng=new RunRNG('ring').stream('spawn'),player={x:0,y:0,z:0};
    for(let i=0;i<200;i++){
      const p=chooseSpawnAround(player,rng,world,()=>true,()=>false);
      expect(p).toBeDefined();
      const d=Math.hypot(p!.x,p!.z);
      expect(d).toBeGreaterThanOrEqual(SPAWN_RING_MIN-1e-6);
      expect(d).toBeLessThanOrEqual(SPAWN_RING_MAX+1e-6);
    }
  });
  it('a expedição repõe continuamente e a pressão acelera, sem esperar a população zerar',()=>{
    const count=(pressure:number)=>{
      const d=new MonsterDirector(new RunRNG('pressure').stream('director'),1,50,'expedition');
      d.pressure=pressure;let spawned=0;
      // Two survivors stay alive while newly spawned enemies are defeated.
      // This remains below the gentle opening cap and must never require a full wipe.
      for(let i=0;i<1200;i++)d.update(.1,0,2,()=>{spawned++;return true;},24);
      return spawned;
    };
    const calm=count(0),tense=count(1);
    expect(calm).toBeGreaterThan(0); // população 2 > 0 e mesmo assim continua nascendo
    expect(tense).toBeGreaterThan(calm);
  });
  it('respeita o orçamento real de performance',()=>{
    const d=new MonsterDirector(new RunRNG('budget').stream('director'),1,50,'expedition');
    d.pressure=1;let population=12;
    for(let i=0;i<2000;i++)d.update(.1,0,population,()=>{population++;return true;},12);
    expect(population).toBe(12);
  });
  it('aposentar inimigo distante devolve orçamento sem virar abate',()=>{
    const d=new MonsterDirector(new RunRNG('retire').stream('director'),1,50,'expedition');
    const before=d.credits;d.retireLivingEnemy();
    expect(d.credits).toBeGreaterThan(before);
    expect(d.completedWaves).toBe(0);
  });
});

describe('declive acima da inclinação máxima',()=>{
  it('escorrega ladeira abaixo em vez de ficar suspenso',()=>{
    const world=new CollisionWorld();
    // Rampa de 60°, acima do limite de 50°, descendo no sentido -Z.
    const slope=Math.tan(60*Math.PI/180);
    world.surfaces.push({id:'ramp',x:0,z:0,width:60,depth:60,height:0,slopeZ:slope});
    const player=new PlayerMotor(world,new EventBus(),{x:0,y:0,z:0});
    const start=player.position.y;
    tick(player,120);
    // O contato com a face íngreme aconteceu e produziu descida — nada de ficar pendurado.
    expect(player.slides).toBeGreaterThan(0);
    expect(player.grounded).toBe(false);
    expect(player.velocity.z).toBeLessThan(-1); // desce a rampa
    expect(player.position.y).toBeLessThan(start-1);
    // Continua rente à rampa, não em queda livre longe dela.
    const surface=world.surfaceAt(player.position.x,player.position.z,player.position.y+3);
    expect(surface).toBeDefined();
    expect(Math.abs(player.position.y-surface!.height)).toBeLessThan(1.5);
    expect(player.position.y).toBeGreaterThan(PLAYER_TUNING.voidHeight); // não caiu pelo vazio
  });
  it('em piso caminhável não escorrega',()=>{
    const world=new CollisionWorld();
    world.surfaces.push({id:'gentle',x:0,z:0,width:60,depth:60,height:0,slopeZ:Math.tan(20*Math.PI/180)});
    const player=new PlayerMotor(world,new EventBus(),{x:0,y:0,z:0});
    tick(player,120);
    expect(player.sliding).toBe(false);
    expect(player.grounded).toBe(true);
  });
});

describe('dash por duplo toque',()=>{
  function fixture(){
    const world=new CollisionWorld();world.surfaces.push({id:'floor',x:0,z:0,width:400,depth:400,height:0});
    return new PlayerMotor(world,new EventBus(),{x:0,y:0,z:0});
  }
  it('um toque não dispara; dois toques dentro da janela disparam',()=>{
    const p=fixture();
    tick(p,1,{z:1});tick(p,4,{});
    expect(p.dashes).toBe(0);
    tick(p,1,{z:1});
    expect(p.dashes).toBe(1);
  });
  it('toques separados demais não contam como duplo',()=>{
    const p=fixture();
    tick(p,1,{z:1});tick(p,Math.ceil(PLAYER_TUNING.dashDoubleTapSeconds*60)+3,{});
    tick(p,1,{z:1});
    expect(p.dashes).toBe(0);
  });
  it('percorre a distância pedida e depois respeita o cooldown',()=>{
    const p=fixture();
    tick(p,1,{z:1});tick(p,3,{});tick(p,1,{z:1});
    const start=p.position.z;
    tick(p,Math.ceil(PLAYER_TUNING.dashSeconds*60)+1,{});
    expect(p.position.z-start).toBeGreaterThan(PLAYER_TUNING.dashDistance*.8);
    tick(p,1,{z:1});tick(p,3,{});tick(p,1,{z:1});
    expect(p.dashes).toBe(1);
  });
  it('não atravessa parede sólida',()=>{
    const world=new CollisionWorld();
    world.surfaces.push({id:'floor',x:0,z:0,width:400,depth:400,height:0});
    world.boxes.push({id:'wall',min:{x:-10,y:0,z:3},max:{x:10,y:4,z:3.6}});
    const p=new PlayerMotor(world,new EventBus(),{x:0,y:0,z:0});
    tick(p,1,{z:1});tick(p,3,{});tick(p,1,{z:1});
    tick(p,Math.ceil(PLAYER_TUNING.dashSeconds*60)+30,{});
    expect(p.position.z).toBeLessThan(3);
  });
  it('funciona no ar com uma carga e só recarrega ao tocar o chão',()=>{
    const p=fixture();
    tick(p,1,{jump:true});tick(p,6,{});
    expect(p.grounded).toBe(false);
    tick(p,1,{x:1});tick(p,3,{});tick(p,1,{x:1});
    expect(p.dashes).toBe(1);
    tick(p,Math.ceil(PLAYER_TUNING.dashCooldownSeconds*60)+2,{});
    expect(p.grounded).toBe(true);
    tick(p,1,{x:1});tick(p,3,{});tick(p,1,{x:1});
    expect(p.dashes).toBe(2);
  });
});
