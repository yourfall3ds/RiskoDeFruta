import {describe,it,expect} from 'vitest';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {RicochetFan} from '../src/combat/RicochetFan';

const fan=()=>new RicochetFan(()=>undefined,()=>{},()=>{});

describe('mira viva das habilidades',()=>{
  it('cada disparo sai na direção informada NAQUELE momento',()=>{
    const f=fan();
    const ahead=f.launch(new Vector3(0,1,0),new Vector3(0,0,1),2,5);
    const behind=f.launch(new Vector3(0,1,0),new Vector3(0,0,-1),2,5);
    expect(ahead.z).toBeGreaterThan(.9);
    expect(behind.z).toBeLessThan(-.9);
  });
  it('gira 180° no meio da sequência sem herdar a direção inicial',()=>{
    const f=fan();const directions:Vector3[]=[];
    for(let i=0;i<6;i++){
      // Metade da sequência sai antes do giro, metade depois.
      const forward=i<3?new Vector3(0,0,1):new Vector3(0,0,-1);
      directions.push(f.launch(new Vector3(0,1,0),forward,i,6));
    }
    expect(directions.slice(0,3).every(d=>d.z>0)).toBe(true);
    expect(directions.slice(3).every(d=>d.z<0)).toBe(true);
  });
  it('gira 90° e os novos tiros acompanham em horizontal',()=>{
    const f=fan();
    const north=f.launch(new Vector3(0,1,0),new Vector3(0,0,1),2,5);
    const east=f.launch(new Vector3(0,1,0),new Vector3(1,0,0),2,5);
    expect(Math.abs(north.x)).toBeLessThan(.2);
    expect(east.x).toBeGreaterThan(.9);
  });
  it('a mira vertical também é respeitada',()=>{
    const f=fan();
    const up=f.launch(new Vector3(0,1,0),new Vector3(0,.7,.7).normalize(),2,5);
    const down=f.launch(new Vector3(0,1,0),new Vector3(0,-.7,.7).normalize(),2,5);
    expect(up.y).toBeGreaterThan(.3);
    expect(down.y).toBeLessThan(-.3);
  });
  it('documenta por que interpolar não servia: lerp normalizado degenera em vetores opostos',()=>{
    // Este era o bug: com forward oposto, o lerp com t<0,5 devolve um vetor quase igual ao antigo
    // e, depois de normalizar, a sequência inteira continuava saindo para o lado inicial.
    const current=new Vector3(0,0,1),wanted=new Vector3(0,0,-1);
    for(let i=0;i<600;i++){
      Vector3.LerpToRef(current,wanted,.05,current);
      if(current.lengthSquared()>1e-8)current.normalize();
    }
    expect(current.z).toBeGreaterThan(.9); // nunca virou
    // A correção adotada copia a mira atual, então a inversão é imediata.
    const copied=wanted.clone();
    expect(copied.z).toBe(-1);
  });
  it('balas já lançadas mantêm a própria trajetória quando a mira muda',()=>{
    const f=fan();
    f.launch(new Vector3(0,1,0),new Vector3(0,0,1),2,5);
    const before=f.bullets[0]!.direction.clone();
    f.launch(new Vector3(0,1,0),new Vector3(0,0,-1),2,5);
    expect(f.bullets[0]!.direction.z).toBeCloseTo(before.z,6);
    expect(f.bullets).toHaveLength(2);
  });
});
