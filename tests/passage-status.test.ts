import {it,expect} from 'vitest';
import {passageLabel} from '../src/world/streaming/RegionPassages';
it('labels a blocked passage with an honest retry countdown, then clears the failure state',()=>{
 expect(passageLabel()).toEqual(['PASSAGEM EM','ESTABILIZAÇÃO']);
 expect(passageLabel({id:'a',message:'offline',attempts:1,retryIn:1.2})).toEqual(['ROTA INDISPONÍVEL','NOVA TENTATIVA EM 2 s']);
 expect(passageLabel({id:'a',message:'offline',attempts:1,retryIn:null})).toEqual(['ROTA INDISPONÍVEL','AGUARDANDO CONEXÃO']);
 expect(passageLabel()).toEqual(['PASSAGEM EM','ESTABILIZAÇÃO']);
});
