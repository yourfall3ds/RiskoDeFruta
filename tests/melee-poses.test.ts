import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {MELEE_POSES,meleePose,meleePoseWeights} from '../src/animation/MeleePoses';
import {MELEE_TUNING} from '../src/player/PlayerTuning';
import {UnarmedCombat} from '../src/combat/UnarmedCombat';

/** Ossos que existem de verdade no rig exportado. */
const rigBones=new Set<string>((()=>{
  const bytes=readFileSync('public/models/gunslinger.glb');
  const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12))) as {nodes:{name:string}[]};
  return gltf.nodes.map(node=>node.name);
})());

describe('poses autorais de corpo a corpo',()=>{
  it('toda etapa do combo tem pose própria',()=>{
    for(const step of MELEE_TUNING.steps)expect(MELEE_POSES[step.id],step.id).toBeDefined();
  });
  it('todos os ossos citados existem no rig real',()=>{
    for(const [id,poses] of Object.entries(MELEE_POSES))
      for(const pose of poses)expect(rigBones.has(pose.bone),`${id}: ${pose.bone}`).toBe(true);
  });
  it('pés, quadril e ombros participam de cada golpe, não só o braço',()=>{
    for(const [id,poses] of Object.entries(MELEE_POSES)){
      const bones=poses.map(pose=>pose.bone).join(' ');
      expect(/Hips/.test(bones),`${id} sem quadril`).toBe(true);
      expect(/Spine/.test(bones),`${id} sem tronco`).toBe(true);
      expect(/Leg|Foot|ToeBase/.test(bones),`${id} sem pernas`).toBe(true);
    }
  });
  it('os chutes movem a perna mais do que o braço',()=>{
    const peak=(id:string,pattern:RegExp)=>Math.max(...MELEE_POSES[id]!.filter(p=>pattern.test(p.bone)).map(p=>Math.abs(p.impact)),0);
    for(const kick of ['front-kick','spin-kick'])
      expect(peak(kick,/UpLeg|Leg$|Foot/),kick).toBeGreaterThan(peak(kick,/ForeArm|Hand/));
    // E os socos, o contrário.
    for(const punch of ['right-cross','left-hook','uppercut'])
      expect(peak(punch,/Arm|Hand/),punch).toBeGreaterThan(peak(punch,/UpLeg|Leg$/));
  });
  it('direita e esquerda são lados opostos de verdade',()=>{
    const side=(id:string,prefix:string)=>MELEE_POSES[id]!.filter(p=>p.bone.startsWith(prefix)).length;
    expect(side('right-cross','Right')).toBeGreaterThan(side('right-cross','Left'));
    expect(side('left-hook','Left')).toBeGreaterThan(side('left-hook','Right'));
  });
  it('antecipação carrega no sentido oposto do impacto',()=>{
    const arm=MELEE_POSES['right-cross']!.find(p=>p.bone==='RightArm'&&p.axis===1)!;
    expect(Math.sign(arm.windup)).toBe(-Math.sign(arm.impact));
  });

  it('o peso sobe na antecipação, domina no impacto e decai na recuperação',()=>{
    expect(meleePoseWeights('windup',0).windup).toBeCloseTo(0,5);
    expect(meleePoseWeights('windup',1).windup).toBeCloseTo(1,5);
    expect(meleePoseWeights('windup',1).impact).toBe(0);
    expect(meleePoseWeights('active',1).impact).toBeGreaterThan(meleePoseWeights('active',0).impact);
    expect(meleePoseWeights('recover',1).impact).toBeLessThan(meleePoseWeights('recover',0).impact);
    expect(meleePoseWeights('idle',.5)).toEqual({windup:0,impact:0});
  });
  it('parado não devolve nenhuma curva',()=>{
    const pose=meleePose('right-cross','idle',.5);
    expect(pose.bends).toHaveLength(0);
    expect(pose.root).toEqual({yaw:0,pitch:0,roll:0});
  });
  it('etapa desconhecida não inventa pose',()=>{
    expect(meleePose('cambalhota','active',.5).bends).toHaveLength(0);
  });
  it('o giro tem o maior deslocamento de raiz',()=>{
    const spin=Math.abs(meleePose('spin-kick','active',1).root.yaw);
    const cross=Math.abs(meleePose('right-cross','active',1).root.yaw);
    expect(spin).toBeGreaterThan(cross*3);
  });
  it('os ângulos são limitados: nada de junta girando meia volta',()=>{
    for(const step of MELEE_TUNING.steps)
      for(const phase of ['windup','active','recover'] as const)
        for(const progress of [0,.25,.5,.75,1])
          for(const bend of meleePose(step.id,phase,progress).bends)
            expect(Math.abs(bend.angle),`${step.id}/${phase}/${bend.bone}`).toBeLessThanOrEqual(Math.PI/2);
  });

  it('a cadência encurta a pose junto com o golpe, sem distorcer as fases',()=>{
    const sampleAt=(rate:number)=>{
      const melee=new UnarmedCombat();melee.toggle();melee.rateMultiplier=rate;melee.strike();
      const phases:string[]=[];let seconds=0;
      while(melee.busy&&seconds<10){
        melee.update(1/60);seconds+=1/60;
        if(phases.at(-1)!==melee.phase)phases.push(melee.phase);
        // A pose sempre existe enquanto o golpe roda.
        if(melee.phase!=='idle')expect(meleePose(melee.step.id,melee.phase,melee.phaseProgress).bends.length).toBeGreaterThan(0);
      }
      return {phases,seconds};
    };
    const slow=sampleAt(1),fast=sampleAt(2);
    expect(slow.phases).toEqual(fast.phases); // mesma sequência de fases
    expect(fast.seconds).toBeLessThan(slow.seconds*.6); // só mais curta
  });
  it('o progresso da fase percorre 0..1 dentro de cada fase',()=>{
    const melee=new UnarmedCombat();melee.toggle();melee.strike();
    const seen=new Map<string,number[]>();
    while(melee.busy){
      const list=seen.get(melee.phase)??[];list.push(melee.phaseProgress);seen.set(melee.phase,list);
      melee.update(1/60);
    }
    for(const [phase,values] of seen){
      expect(values[0],phase).toBeLessThan(.35);
      expect(Math.max(...values),phase).toBeGreaterThan(.6);
    }
  });
});
