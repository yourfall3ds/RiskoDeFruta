import {describe,it,expect,afterEach} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {ThirdPersonCamera} from '../src/camera/ThirdPersonCamera';
import {RadialCamera} from '../src/camera/RadialCamera';
import {ScopeOcclusion} from '../src/camera/ScopeOcclusion';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlanetFrame} from '../src/planet/PlanetFrame';
import {AIM_MODES,AimState,aimKindFor} from '../src/combat/AimState';
import {CAMERA_TUNING} from '../src/player/PlayerTuning';
import {weaponReadout} from '../src/ui/WeaponReadout';
import {installInputDom,type InputDom} from './support/fake-input-dom';

// ---------------------------------------------------------------------------- entrada

let dom:InputDom|undefined;
afterEach(()=>{dom?.restore();dom=undefined;});

/** `GameInput` é importado DEPOIS dos globais existirem: ele lê `document` no construtor. */
async function input(lock=true) {
  dom=installInputDom();
  if(lock)dom.lock();else dom.focus();
  const {GameInput}=await import('../src/input/GameInput');
  return {harness:dom,game:new GameInput(dom.canvas as never,()=>{})};
}

describe('mira apurada · o que cada botão faz agora',()=>{
  it('`Q` segurado carrega o especial e o botão direito NÃO carrega mais nada',async()=>{
    const {harness,game}=await input();
    harness.key('KeyQ',true);
    const held=game.read();
    expect(held.charging).toBe(true);
    expect(held.aim).toBe(false);
    // Segurar continua carregando quadro após quadro: a carga de MP é por tempo, não por borda.
    expect(game.read().charging).toBe(true);
    harness.key('KeyQ',false);
    expect(game.read().charging).toBe(false);

    harness.pointer(2,true);
    const aiming=game.read();
    expect(aiming.aim).toBe(true);
    expect(aiming.charging).toBe(false);
    harness.pointer(2,false);
    expect(game.read().aim).toBe(false);
  });

  it('o botão esquerdo continua sendo o disparo, com ou sem mira',async()=>{
    const {harness,game}=await input();
    harness.pointer(2,true);
    harness.pointer(0,true);
    const frame=game.read();
    expect(frame.fire).toBe(true);
    expect(frame.aim).toBe(true);
  });

  it('a roda entra como entalhes e é CONSUMIDA na leitura',async()=>{
    const {harness,game}=await input();
    harness.wheel(-120);harness.wheel(-3);
    expect(game.read().zoomDelta).toBe(2);
    // Lida uma vez, some: dois passos fixos no mesmo quadro não podem ampliar duas vezes.
    expect(game.read().zoomDelta).toBe(0);
    harness.wheel(120);
    expect(game.read().zoomDelta).toBe(-1);
  });

  it('sem foco nem ponteiro travado nada é mirado, carregado ou rolado',async()=>{
    dom=installInputDom();
    const {GameInput}=await import('../src/input/GameInput');
    const game=new GameInput(dom.canvas as never,()=>{});
    // Sem `focus()` nem `lock()`: a janela não é dona da entrada.
    dom.key('KeyQ',true);dom.wheel(-120);
    const frame=game.read();
    expect(frame.charging).toBe(false);
    expect(frame.aim).toBe(false);
    expect(frame.zoomDelta).toBe(0);
  });

  it('perder o foco solta a mira, a carga e a roda acumulada',async()=>{
    const {harness,game}=await input();
    harness.key('KeyQ',true);harness.pointer(2,true);harness.wheel(-120);
    harness.blur();
    const frame=game.read();
    expect(frame.charging).toBe(false);
    expect(frame.aim).toBe(false);
    expect(frame.zoomDelta).toBe(0);
  });

  it('os campos novos são OPCIONAIS e ficam FORA do pacote de rede',async()=>{
    const {toFrame,writeInput,BUTTON}=await import('../src/net/NetInput');
    // Um quadro vindo do servidor não traz mira nem roda — e continua sendo um quadro válido.
    const arrived=toFrame({x:0,z:1,buttons:0,yaw:0,pitch:0,seq:1,interactOption:0} as never);
    expect(arrived.aim).toBeUndefined();
    expect(arrived.zoomDelta).toBeUndefined();
    expect(arrived.charging).toBe(false);
    // E mirar localmente não muda um único bit do que é enviado; `Q` continua sendo `CHARGE`.
    const packet={x:0,z:0,yaw:0,pitch:0,buttons:0,interactOption:0,seq:0} as never as import('../src/net/NetInput').NetInput;
    writeInput(packet,{x:0,z:0,jump:false,dodge:false,fire:false,charging:false,aim:true,zoomDelta:4},0,0,1);
    expect(packet.buttons).toBe(0);
    writeInput(packet,{x:0,z:0,jump:false,dodge:false,fire:false,charging:true},0,0,2);
    expect(packet.buttons).toBe(BUTTON.CHARGE);
  });
});

// ---------------------------------------------------------------------------- regra da mira

describe('mira apurada · a regra por arma',()=>{
  const allow=(over:Partial<Parameters<AimState['update']>[0]>={}) =>
    ({hold:true,kind:'pistols' as const,allowed:true,...over});

  it('cada arma tem a sua mira: luneta só no sniper, arco só na granada',()=>{
    expect(aimKindFor({prismReady:false,prismEquipped:true,prismMode:1})).toBe('pistols');
    expect(aimKindFor({prismReady:true,prismEquipped:false,prismMode:1})).toBe('pistols');
    expect(aimKindFor({prismReady:true,prismEquipped:true,prismMode:0})).toBe('assault');
    expect(aimKindFor({prismReady:true,prismEquipped:true,prismMode:1})).toBe('sniper');
    expect(aimKindFor({prismReady:true,prismEquipped:true,prismMode:2})).toBe('grenade');
    expect(AIM_MODES.sniper.scope).toBe(true);
    expect(AIM_MODES.assault.scope).toBe(false);
    expect(AIM_MODES.pistols.scope).toBe(false);
    expect(AIM_MODES.grenade.trajectory).toBe(true);
    // Pistola e assalto aproximam POUCO; o assalto um pouco mais, e nenhum dos dois chega a luneta.
    expect(AIM_MODES.pistols.zoom).toBeGreaterThan(1);
    expect(AIM_MODES.assault.zoom).toBeGreaterThan(AIM_MODES.pistols.zoom);
    expect(AIM_MODES.assault.zoom).toBeLessThan(AIM_MODES.sniper.zoom);
  });

  it('a granada não aproxima nada: só desenha a trajetória',()=>{
    const aim=new AimState();
    const view=aim.update(allow({kind:'grenade'}));
    expect(view.active).toBe(true);
    expect(view.zoom).toBe(1);
    expect(aim.showsTrajectory).toBe(true);
    expect(aim.scoped).toBe(false);
    expect(aim.sensitivityScale).toBe(1);
  });

  it('a roda ajusta a luneta e respeita os limites',()=>{
    const aim=new AimState();
    aim.update(allow({kind:'sniper'}));
    const base=aim.zoom;
    expect(base).toBe(AIM_MODES.sniper.zoom);
    expect(aim.update(allow({kind:'sniper',wheel:2})).zoom).toBeGreaterThan(base);
    for(let i=0;i<40;i++)aim.update(allow({kind:'sniper',wheel:1}));
    expect(aim.zoom).toBe(AIM_MODES.sniper.maxZoom);
    for(let i=0;i<80;i++)aim.update(allow({kind:'sniper',wheel:-1}));
    expect(aim.zoom).toBe(AIM_MODES.sniper.minZoom);
    // Mais aproximação, menos sensibilidade — o gesto varre o mesmo ângulo de tela.
    expect(aim.sensitivityScale).toBeCloseTo(1/AIM_MODES.sniper.minZoom,6);
  });

  it('a roda SÓ é consumida mirando com o sniper',()=>{
    for(const kind of ['pistols','assault','grenade'] as const){
      const aim=new AimState();
      aim.update(allow({kind,wheel:4}));
      expect(aim.zoom).toBe(AIM_MODES[kind].zoom);
    }
    // Rolar fora da mira não guarda nada: mirar depois abre na aproximação padrão.
    const aim=new AimState();
    aim.update({hold:false,kind:'sniper',allowed:true,wheel:5});
    expect(aim.update(allow({kind:'sniper'})).zoom).toBe(AIM_MODES.sniper.zoom);
    // E rolar com a granada na mão não deixa herança para o sniper.
    const carried=new AimState();
    carried.update(allow({kind:'grenade',wheel:5}));
    carried.update(allow({kind:'sniper'}));
    expect(carried.zoom).toBe(AIM_MODES.sniper.zoom);
  });

  it('soltar a mira zera a aproximação e a próxima mirada começa no padrão',()=>{
    const aim=new AimState();
    aim.update(allow({kind:'sniper'}));
    aim.update(allow({kind:'sniper',wheel:3}));
    expect(aim.zoom).toBeGreaterThan(AIM_MODES.sniper.zoom);
    const released=aim.update({hold:false,kind:'sniper',allowed:true});
    expect(released.active).toBe(false);
    expect(released.zoom).toBe(1);
    expect(aim.update(allow({kind:'sniper'})).zoom).toBe(AIM_MODES.sniper.zoom);
  });

  it('proibir mirar cancela na hora, mesmo com o botão preso',()=>{
    const aim=new AimState();
    aim.update(allow({kind:'sniper',wheel:3}));
    expect(aim.active).toBe(true);
    const blocked=aim.update(allow({kind:'sniper',allowed:false}));
    expect(blocked.active).toBe(false);
    expect(blocked.zoom).toBe(1);
    expect(aim.scoped).toBe(false);
    // Voltando a ser permitido, a mira reabre no padrão — nunca no zoom de antes do bloqueio.
    expect(aim.update(allow({kind:'sniper'})).zoom).toBe(AIM_MODES.sniper.zoom);
  });

  it('trocar de forma mirando reinicia a aproximação da luneta',()=>{
    const aim=new AimState();
    aim.update(allow({kind:'sniper',wheel:4}));
    const zoomed=aim.zoom;
    expect(zoomed).toBeGreaterThan(AIM_MODES.sniper.zoom);
    aim.update(allow({kind:'assault'}));
    expect(aim.zoom).toBe(AIM_MODES.assault.zoom);
    aim.update(allow({kind:'sniper'}));
    expect(aim.zoom).toBe(AIM_MODES.sniper.zoom);
  });
});

// ---------------------------------------------------------------------------- câmeras

/** Converge o FOV suavizado: a mira é interpolada, não um corte seco. */
const settle=(step:()=>void,frames=180):void=>{for(let i=0;i<frames;i++)step();};

/**
 * A aproximação é ÓPTICA: o que é dividido é a TANGENTE da meia abertura, não o ângulo. Dividir o
 * ângulo daria uma ampliação diferente da anunciada e o `3×` da luneta não seria três vezes.
 */
const zoomed=(base:number,zoom:number):number=>2*Math.atan(Math.tan(base/2)/zoom);

describe('mira apurada · as duas câmeras',()=>{
  it('a câmera plana fecha o FOV sobre o base e NUNCA acumula',()=>{
    const engine=new NullEngine();const scene=new Scene(engine);
    try{
      const rig=new ThirdPersonCamera(scene,new CollisionWorld());
      const step=():void=>rig.update({x:0,y:0,z:0},0,.02,1/60);
      settle(step,10);
      const base=rig.camera.fov;
      expect(base).toBeCloseTo(CAMERA_TUNING.fov,6);
      rig.setAimZoom(3);
      settle(step);
      expect(rig.camera.fov).toBeCloseTo(zoomed(CAMERA_TUNING.fov,3),4);
      // Repetir o MESMO alvo dezenas de vezes não fecha mais um pouco a cada chamada.
      for(let i=0;i<50;i++){rig.setAimZoom(3);step();}
      expect(rig.camera.fov).toBeCloseTo(zoomed(CAMERA_TUNING.fov,3),4);
      rig.setAimZoom(1);
      settle(step);
      expect(rig.camera.fov).toBeCloseTo(base,6);
    }finally{scene.dispose();engine.dispose();}
  });

  it('a câmera radial fecha o FOV pela mesma regra e volta ao base',()=>{
    const engine=new NullEngine();const scene=new Scene(engine);
    try{
      const frame=new PlanetFrame();
      const at=frame.fromDirection({x:0,y:1,z:0});
      const rig=new RadialCamera(scene,frame,at);
      const step=():void=>rig.update(at,0,0,1/60);
      settle(step,10);
      const base=rig.camera.fov;
      rig.setAimZoom(4);
      settle(step);
      expect(rig.camera.fov).toBeCloseTo(zoomed(CAMERA_TUNING.fov,4),4);
      rig.setAimZoom(1);
      settle(step);
      expect(rig.camera.fov).toBeCloseTo(base,6);
    }finally{scene.dispose();engine.dispose();}
  });

  it('a abertura de corrida continua somando sobre o base, com ou sem mira',()=>{
    const engine=new NullEngine();const scene=new Scene(engine);
    try{
      const rig=new ThirdPersonCamera(scene,new CollisionWorld());
      const step=():void=>rig.update({x:0,y:0,z:0},0,.02,1/60);
      rig.setSprint(true);
      settle(step);
      const sprint=rig.camera.fov;
      expect(sprint).toBeGreaterThan(CAMERA_TUNING.fov);
      rig.setAimZoom(2);
      settle(step);
      expect(rig.camera.fov).toBeCloseTo(zoomed(sprint,2),4);
    }finally{scene.dispose();engine.dispose();}
  });

  it('aproximação inválida ou menor que 1 nunca ABRE a lente',()=>{
    const engine=new NullEngine();const scene=new Scene(engine);
    try{
      const rig=new ThirdPersonCamera(scene,new CollisionWorld());
      const step=():void=>rig.update({x:0,y:0,z:0},0,.02,1/60);
      settle(step,10);
      for(const bad of [0,-3,Number.NaN,Number.POSITIVE_INFINITY]){
        rig.setAimZoom(bad);settle(step);
        expect(rig.camera.fov).toBeCloseTo(CAMERA_TUNING.fov,6);
      }
    }finally{scene.dispose();engine.dispose();}
  });

  it('o retículo e o raio da arma partilham o CENTRO da câmera, nas duas',()=>{
    const engine=new NullEngine();const scene=new Scene(engine);
    try{
      const flat=new ThirdPersonCamera(scene,new CollisionWorld());
      flat.shake=0;
      flat.setAimZoom(3);
      settle(()=>flat.update({x:0,y:0,z:0},.4,.12,1/60));
      flat.camera.getViewMatrix(true);
      const drawn=flat.camera.getDirection(Vector3.Forward()).normalize();
      // `camera.forward` é o vetor que a PRISM e as pistolas usam para escolher o ponto visado.
      expect(Vector3.Dot(drawn,flat.forward)).toBeGreaterThan(.99999);

      const frame=new PlanetFrame();
      const at=frame.fromDirection({x:0,y:0,z:1});
      const radial=new RadialCamera(scene,frame,at);
      radial.shake=0;
      radial.setAimZoom(5);
      settle(()=>radial.update(at,0,0,1/60));
      radial.camera.getViewMatrix(true);
      const radialDrawn=radial.camera.getDirection(Vector3.Forward()).normalize();
      expect(Vector3.Dot(radialDrawn,radial.forward)).toBeGreaterThan(.99999);
    }finally{scene.dispose();engine.dispose();}
  });
});

// ---------------------------------------------------------------------------- lente da luneta

describe('mira apurada · lente da luneta',()=>{
  /** Malha mínima: só a esfera envolvente e o estado de visibilidade são lidos. */
  function mesh(at:Vector3,radius=.4,visible=true) {
    return {
      isVisible:visible,
      isDisposed:()=>false,
      getBoundingInfo:()=>({boundingSphere:{centerWorld:at,radiusWorld:radius}}),
    } as never as import('@babylonjs/core/Meshes/abstractMesh').AbstractMesh;
  }

  it('esconde só o que está colado na lente e devolve a visibilidade exata',()=>{
    const near=mesh(new Vector3(0,0,.4));
    const far=mesh(new Vector3(0,0,12));
    const alreadyHidden=mesh(new Vector3(0,0,.3),.4,false);
    const occlusion=new ScopeOcclusion(()=>[near,far,alreadyHidden]);
    occlusion.apply(true,Vector3.Zero());
    expect(near.isVisible).toBe(false);
    expect(far.isVisible).toBe(true);
    expect(occlusion.count).toBe(1);
    occlusion.apply(false,Vector3.Zero());
    expect(near.isVisible).toBe(true);
    // Quem já estava invisível por outro motivo NÃO reaparece por cortesia da luneta.
    expect(alreadyHidden.isVisible).toBe(false);
    expect(occlusion.count).toBe(0);
  });

  it('o que sai da frente da lente volta sozinho, sem sair da mira',()=>{
    const blocker=mesh(new Vector3(0,0,.4));
    const occlusion=new ScopeOcclusion(()=>[blocker]);
    occlusion.apply(true,Vector3.Zero());
    expect(blocker.isVisible).toBe(false);
    occlusion.apply(true,new Vector3(0,0,-30));
    expect(blocker.isVisible).toBe(true);
    expect(occlusion.count).toBe(0);
  });

  it('descartar restaura tudo',()=>{
    const blocker=mesh(new Vector3(0,0,.2));
    const occlusion=new ScopeOcclusion(()=>[blocker]);
    occlusion.apply(true,Vector3.Zero());
    occlusion.dispose();
    expect(blocker.isVisible).toBe(true);
  });
});

// ---------------------------------------------------------------------------- painel de arma

describe('mira apurada · o painel anuncia a tecla certa',()=>{
  const base={playerClass:'soldier' as const,holstered:false,prismReady:true,prismEquipped:true,
    prismMode:1 as const,prismAmmo:6,
    prismCapacity:6,prismReloading:false,prismProgress:0,prismBusy:false,
    pistolAmmo:50,pistolCapacity:50,pistolReloading:false,pistolProgress:0};

  it('diz o que o botão direito faz com a arma que está na mão',()=>{
    expect(weaponReadout(base).hint).toContain('DIREITO · LUNETA');
    expect(weaponReadout({...base,prismMode:0}).hint).toContain('DIREITO · ALÇA');
    expect(weaponReadout({...base,prismMode:2}).hint).toContain('DIREITO · TRAJETÓRIA');
    expect(weaponReadout({...base,prismEquipped:false}).hint).toContain('DIREITO · MIRA');
  });

  it('a roda só é anunciada com a luneta REALMENTE aberta',()=>{
    expect(weaponReadout(base).hint).not.toContain('RODA');
    expect(weaponReadout({...base,aiming:true}).hint).toContain('RODA · ZOOM');
    // Mirar com o assalto ou a granada não revela roda nenhuma: ali ela não faz nada.
    expect(weaponReadout({...base,prismMode:0,aiming:true}).hint).not.toContain('RODA');
    expect(weaponReadout({...base,prismMode:2,aiming:true}).hint).not.toContain('RODA');
  });

  it('o especial saiu do botão direito e virou `Q` em todo o painel',()=>{
    for(const state of [base,{...base,prismEquipped:false},{...base,holstered:true}]){
      // Com a PRISM nas mãos o painel anuncia as habilidades DA FORMA; fora dela, o `Q` genérico.
      expect(weaponReadout(state).hint).toContain(state.prismEquipped&&!state.holstered?'Q II ':'Q · ESPECIAL');
    }
    expect(weaponReadout(base).hint).not.toContain('DIREITO · CARREGAR');
  });

  it('não promete mira durante recarga ou transformação',()=>{
    expect(weaponReadout({...base,prismBusy:true}).hint).toBe('TRANSFORMANDO · AGUARDE');
    expect(weaponReadout({...base,prismReloading:true,prismProgress:.5}).hint).toBe('RECARREGANDO · 50%');
  });
});
