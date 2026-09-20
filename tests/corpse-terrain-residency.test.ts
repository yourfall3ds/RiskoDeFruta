import {describe,it,expect} from 'vitest';
import {planCorpseTerrain,CORPSE_TERRAIN,type CorpsePatchState} from '../src/physics/CorpseTerrainResidency';
import type {Vec3} from '../src/core/contracts';

/**
 * Regressão do congelamento perto da morte do chefe.
 *
 * O chão físico local dos cadáveres é uma malha de Havok construída a partir de uma consulta na BVH
 * de 1,75 M de triângulos do planeta. A residência anterior era "célula de 8 m arredondada da
 * posição do corpo", sem histerese e sem orçamento, e QUALQUER mudança na máscara de destruição
 * (isto é, qualquer prop quebrando) derrubava todos os recortes de uma vez. Este arquivo trava as
 * três propriedades que faltavam.
 *
 * LIMITE HONESTO: isto mede a DECISÃO, não o milissegundo. O custo real de `addRagdollTerrain`
 * depende de Havok e de WebAssembly, que não rodam aqui — o que o teste prova é que a decisão
 * deixou de pedir reconstrução em laço.
 */

const at=(x:number,y=0,z=0):Vec3=>({x,y,z});
const patch=(centre:Vec3,stale=false):CorpsePatchState=>({centre,stale});

/** Simula N quadros aplicando o plano, e conta quantos recortes NASCERAM no total. */
function simulate(frames:readonly Vec3[][],options=CORPSE_TERRAIN):{builds:number;live:number;perFrame:number[]} {
  let patches:CorpsePatchState[]=[];
  let builds=0;const perFrame:number[]=[];
  for(const bodies of frames){
    const plan=planCorpseTerrain(bodies,patches,options);
    for(const index of [...plan.release].sort((a,b)=>b-a))patches.splice(index,1);
    for(const centre of plan.create)patches.push({centre,stale:false});
    builds+=plan.create.length;perFrame.push(plan.create.length);
    patches=patches.filter(Boolean);
  }
  return {builds,live:patches.length,perFrame};
}

describe('residência do chão físico dos cadáveres',()=>{
  it('um corpo parado na fronteira de célula deixa de reconstruir o recorte por quadro',()=>{
    // Exatamente o caso patológico: o corpo oscila milímetros em torno de x = 4 (metade de uma
    // célula de 8 m). A versão por célula arredondada trocava de chave a cada quadro.
    const frames=Array.from({length:600},(_,i)=>[at(4+(i%2?.004:-.004))]);
    const run=simulate(frames);
    expect(run.builds).toBe(1);
    expect(run.live).toBe(1);
  });

  it('só reconstrói quando o corpo sai da histerese, e nunca mais de um recorte por quadro',()=>{
    // O cadáver rola 30 m em linha reta.
    const frames=Array.from({length:300},(_,i)=>[at(i*.1)]);
    const run=simulate(frames);
    // 30 m / 9 m de histerese ⇒ poucas reconstruções, não uma por quadro.
    expect(run.builds).toBeGreaterThan(1);
    expect(run.builds).toBeLessThanOrEqual(5);
    expect(Math.max(...run.perFrame)).toBeLessThanOrEqual(CORPSE_TERRAIN.spawnBudget);
  });

  it('entre `keep` e `radius` nada é reconstruído: é isso que a histerese compra',()=>{
    const existing=[patch(at(0))];
    // Dentro de `keep`: servido.
    expect(planCorpseTerrain([at(CORPSE_TERRAIN.keep-.5)],existing).create).toHaveLength(0);
    // Além de `keep`: pede um novo. O antigo sai no MESMO quadro em que o substituto nasce — o
    // corpo ainda está dentro dos 16 m de geometria dele, então não há quadro sem chão.
    const plan=planCorpseTerrain([at(CORPSE_TERRAIN.keep+.5)],existing);
    expect(plan.create).toHaveLength(1);
    expect(plan.release).toEqual([0]);
  });

  it('destruição de cenário não derruba todos os recortes de uma vez',()=>{
    // Três cadáveres espalhados, cada um com o seu recorte; a máscara muda (props quebraram).
    const bodies=[at(0),at(40),at(80)];
    const stale=bodies.map(b=>patch(b,true));
    const plan=planCorpseTerrain(bodies,stale);
    // Só UM substituto nasce neste quadro…
    expect(plan.create).toHaveLength(CORPSE_TERRAIN.spawnBudget);
    // …e nenhum chão é solto antes do substituto existir: cadáver sem chão atravessa o mundo.
    expect(plan.release).toHaveLength(0);
  });

  it('recorte que não serve corpo nenhum sai, e o teto de recortes vivos é respeitado',()=>{
    const orphans=[patch(at(500)),patch(at(600))];
    expect(planCorpseTerrain([],orphans).release.sort()).toEqual([0,1]);

    // Um corpo a mais que o teto: o novo entra e o recorte mais distante de qualquer cadáver sai.
    const far=Array.from({length:CORPSE_TERRAIN.limit+1},(_,i)=>at(i*40));
    const full=far.slice(0,CORPSE_TERRAIN.limit).map(b=>patch(b));
    const plan=planCorpseTerrain(far,full);
    expect(plan.create).toHaveLength(1);
    expect(plan.release).toHaveLength(1);
  });

  it('corpos amontoados compartilham um recorte só',()=>{
    const bodies=[at(0),at(1),at(2),at(3)];
    const plan=planCorpseTerrain(bodies,[]);
    expect(plan.create).toHaveLength(1);
  });

  it('carga prolongada: 4 cadáveres circulando por 30 s ficam dentro do teto',()=>{
    const frames:Vec3[][]=[];
    for(let f=0;f<1800;f++){
      const t=f/60;
      frames.push([0,1,2,3].map(k=>at(Math.cos(t*.7+k)*12,0,Math.sin(t*.7+k)*12)));
    }
    const run=simulate(frames);
    expect(run.live).toBeLessThanOrEqual(CORPSE_TERRAIN.limit);
    expect(Math.max(...run.perFrame)).toBeLessThanOrEqual(CORPSE_TERRAIN.spawnBudget);
    // 30 s de movimento contínuo: dezenas de reconstruções, não milhares (era uma por quadro).
    expect(run.builds).toBeLessThan(frames.length/10);
  });
});
