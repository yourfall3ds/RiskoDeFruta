import {describe,it,expect} from 'vitest';
import {
  DEFAULT_PLAYER_CLASS,PLAYER_CLASSES,PLAYER_CLASS_KEY,PLAYER_CLASS_ORDER,
  PlayerClassChoice,isPlayerClass,normalizePlayerClass,playerClassFromHref,
  type PlayerClassStore,
} from '../src/run/PlayerClass';

/** `localStorage` de mentira: o mínimo que a escolha usa, e nada mais. */
function memoryStore(seed?:string):PlayerClassStore&{map:Map<string,string>} {
  const map=new Map<string,string>();
  if(seed!==undefined)map.set(PLAYER_CLASS_KEY,seed);
  return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>{map.set(key,value);}};
}

describe('classe · o padrão e o saneamento',()=>{
  it('quem nunca escolheu entra de Pistoleiro',()=>{
    expect(DEFAULT_PLAYER_CLASS).toBe('gunslinger');
    expect(new PlayerClassChoice(memoryStore()).id).toBe('gunslinger');
  });
  it('armazenamento corrompido não derruba nem escolhe por engano',()=>{
    expect(new PlayerClassChoice(memoryStore('mago')).id).toBe('gunslinger');
    expect(normalizePlayerClass(undefined)).toBe('gunslinger');
    expect(normalizePlayerClass('soldier')).toBe('soldier');
    expect(isPlayerClass('soldier')).toBe(true);
    expect(isPlayerClass('SOLDIER')).toBe(false);
  });
  it('um armazenamento que estoura (modo privado) não impede jogar',()=>{
    const hostile:PlayerClassStore={
      getItem(){throw Error('bloqueado');},
      setItem(){throw Error('bloqueado');},
    };
    const choice=new PlayerClassChoice(hostile);
    expect(choice.id).toBe('gunslinger');
    expect(choice.choose('soldier')).toBe(true);
    expect(choice.id).toBe('soldier');
  });
  it('sem armazenamento nenhum a escolha ainda funciona na sessão',()=>{
    const choice=new PlayerClassChoice(undefined);
    expect(choice.choose('soldier')).toBe(true);
    expect(choice.id).toBe('soldier');
  });
});

describe('classe · persistência entre estágios, repetições e sessões',()=>{
  it('escolher grava na hora e a sessão seguinte abre na mesma classe',()=>{
    const store=memoryStore();
    const first=new PlayerClassChoice(store);
    expect(first.choose('soldier')).toBe(true);
    expect(store.map.get(PLAYER_CLASS_KEY)).toBe('soldier');
    // Recarregar a página é construir de novo a partir do MESMO armazenamento.
    expect(new PlayerClassChoice(store).id).toBe('soldier');
  });
  it('escolher a classe que já vale não é uma mudança',()=>{
    const choice=new PlayerClassChoice(memoryStore('soldier'));
    expect(choice.id).toBe('soldier');
    expect(choice.choose('soldier')).toBe(false);
  });
  it('`?class=` manda na abertura e fica gravado',()=>{
    const store=memoryStore('gunslinger');
    const choice=new PlayerClassChoice(store,'https://jogo.local/?world=planet&class=soldier');
    expect(choice.id).toBe('soldier');
    expect(store.map.get(PLAYER_CLASS_KEY)).toBe('soldier');
    expect(playerClassFromHref('https://jogo.local/?class=mago')).toBeUndefined();
    expect(playerClassFromHref('nem url')).toBeUndefined();
  });
});

describe('classe · o que cada uma promete',()=>{
  it('são duas, com o padrão primeiro e identidades distintas',()=>{
    expect(PLAYER_CLASS_ORDER).toEqual(['gunslinger','soldier']);
    expect(PLAYER_CLASS_ORDER[0]).toBe(DEFAULT_PLAYER_CLASS);
    expect(PLAYER_CLASSES.gunslinger.weapon).toBe('pistols');
    expect(PLAYER_CLASSES.soldier.weapon).toBe('prism');
    expect(PLAYER_CLASSES.gunslinger.name).not.toBe(PLAYER_CLASSES.soldier.name);
  });
  it('só o soldado transforma de graça no nível I',()=>{
    expect(PLAYER_CLASSES.soldier.freeFirstTier).toBe(true);
    expect(PLAYER_CLASSES.gunslinger.freeFirstTier).toBe(false);
    expect(PLAYER_CLASSES.soldier.charge[0]).toContain('GRÁTIS');
  });
  it('nenhuma classe promete uma tecla de troca de arma',()=>{
    for(const definition of Object.values(PLAYER_CLASSES)){
      expect(definition.summary).not.toMatch(/\btrocar? de arma\b/i);
      expect(definition.charge).toHaveLength(3);
    }
  });
});
