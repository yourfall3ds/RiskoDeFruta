/**
 * Ligação entre o detector de contato e o áudio: quem cala o passo, quem o deixa soar e o que
 * acontece quando o corpo é teleportado. O detector em si tem os seus testes; aqui o assunto é a
 * `FootingPresentation`, que é quem escolhe a superfície e chama o som.
 */
import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {FootingPresentation} from '../src/world/FootingPresentation';
import {PlayerMotor} from '../src/player/PlayerMotor';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
import type {WeaponAudio} from '../src/audio/RecordedAudio';

const DT=1/60;
/** Passada sintética com a forma do rig: sobe acima do rearme, desce até o platô de apoio. */
function feet(phase:number):{right:number;left:number}{
  const arc=(p:number):number=>.037+.12*Math.max(0,Math.sin(p*Math.PI*2));
  return {right:arc(phase),left:arc(phase+.5)};
}

function stage(){
  const engine=new NullEngine(),scene=new Scene(engine);
  const world=new CollisionWorld(),player=new PlayerMotor(world,new EventBus<GameEvents>(),{x:0,y:0,z:0});
  const heard:{surface:string;speed:number}[]=[];
  const audio={footstep:(surface:string,speed:number)=>{heard.push({surface,speed});}} as unknown as WeaponAudio;
  const footing=new FootingPresentation(scene,player,world,audio);
  let phase=.25;
  const run=(seconds:number,speed:number):void=>{
    for(let frame=0;frame<Math.round(seconds/DT);frame++){
      phase+=DT/.8;
      player.velocity.x=0;player.velocity.z=speed;player.grounded=true;
      player.position.z+=speed*DT;
      footing.footHeights=()=>feet(phase);
      footing.update(DT);
    }
  };
  return {footing,player,heard,run,close:()=>{footing.dispose();scene.dispose();engine.dispose();}};
}

describe('passos na apresentação do chão',()=>{
  it('andando toca passo; o som escolhido continua sendo o da superfície',()=>{
    const {heard,run,close}=stage();
    try{
      run(2.4,6);
      expect(heard.length).toBe(6);                  // dois apoios por passada de 0,8 s
      for(const step of heard)expect(step.surface).toBe('grass');
      for(const step of heard)expect(step.speed).toBe(6);
    } finally {close();}
  });

  it('o gancho de silêncio cala o passo sem perder o pé: ao voltar não há rajada',()=>{
    const {footing,heard,run,close}=stage();
    try{
      let quiet=true;
      footing.suppressSteps=()=>quiet;
      run(2.4,6);
      expect(heard,'passo durante combate/intro').toHaveLength(0);
      // Volta a valer no meio da MESMA passada: a cadência continua, sem estouro de retomada.
      quiet=false;
      run(1.6,6);
      expect(heard.length).toBe(4);
    } finally {close();}
  });

  it('a esquiva cala o passo',()=>{
    const {footing,player,heard,run,close}=stage();
    try{
      player.dodgeRemaining=.3;
      run(.3,6);
      expect(heard).toHaveLength(0);
      player.dodgeRemaining=0;
      run(1.6,6);
      expect(heard.length).toBeGreaterThan(0);
      void footing;
    } finally {close();}
  });

  it('teleporte não vira passo: o estado do pé é re-semeado',()=>{
    const {player,heard,run,close}=stage();
    try{
      run(1.6,6);
      const before=heard.length;
      // Respawn/troca de região: o corpo pula metros num quadro.
      player.position.x+=40;player.position.z+=40;
      run(.05,6);
      expect(heard.length,'passo no quadro do teleporte').toBe(before);
    } finally {close();}
  });

  it('sem ossos disponíveis o gatilho antigo por distância continua valendo — e também é calado',()=>{
    const {footing,player,heard,close}=stage();
    try{
      footing.footHeights=()=>undefined;
      footing.suppressSteps=()=>true;
      for(let frame=0;frame<180;frame++){
        player.velocity.z=6;player.grounded=true;player.position.z+=6*DT;footing.update(DT);
      }
      expect(heard,'distância percorrida com o passo calado').toHaveLength(0);
      footing.suppressSteps=undefined;
      for(let frame=0;frame<180;frame++){
        player.velocity.z=6;player.grounded=true;player.position.z+=6*DT;footing.update(DT);
      }
      expect(heard.length,'gatilho por distância ainda funciona como reserva').toBeGreaterThan(0);
    } finally {close();}
  });
});
