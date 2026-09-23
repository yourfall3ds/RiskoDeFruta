import {chestCatalog,chestPrice,type ChestSpec} from '../src/run/ChestCatalog';
import type {ItemDefinition} from '../src/run/RunProgression';
import type {RandomStream} from '../src/core/RunRNG';
import type {Vec3} from '../src/core/contracts';

/**
 * A COMPRA DE BAÚ, RESOLVIDA NO SERVIDOR (contrato §21.3).
 *
 * O cliente manda `ChestPurchaseRequest { interactableId, requestId }` e mais nada — nem custo, nem
 * item, nem saldo. Aqui se valida jogador, baú, distância, estado e custo; debita-se a carteira
 * autoritativa; marca-se o baú consumido; e só então a recompensa é rolada, no domínio `interactable`
 * (o MESMO que o cliente sempre usou, para single-player não mudar um bit).
 *
 * `if (credits < cost)` acontece AQUI e em lugar nenhum mais. O mesmo teste no cliente seria a
 * correção proibida do §21.1: o espelho virando pré-condição de protocolo.
 */

/** Alcance da compra, em metros — os mesmos 3 m planos e 2 m de altura do prompt do cliente. */
export const PURCHASE_RANGE=3,PURCHASE_HEIGHT=2;

export type PurchaseRejection='unknown-chest'|'used'|'range'|'credits'|'replay';
export interface PurchaseResult {
  ok:boolean;interactableId:string;requestId:string;entityId:number;
  /** Custo cobrado (aceita) ou custo vigente (recusa): a tela pode dizer quanto faltou. */
  cost:number;
  credits:number;
  item?:ItemDefinition;
  /** Compra de altar que saiu vazia — o risco do altar, não uma recusa. */
  empty?:boolean;
  reason?:PurchaseRejection;
}

interface ChestRow extends ChestSpec {used:boolean;uses:number}

export class ChestEconomy {
  private readonly rows=new Map<string,ChestRow>();
  /** Compras já feitas NESTE estágio; é o expoente do preço progressivo. */
  opened=0;
  /** Compras resolvidas desde o início da corrida. O cliente exibe; nenhuma regra lê. */
  purchases=0;
  /** `requestId` já resolvidos: o mesmo pedido chegando duas vezes não debita duas vezes. */
  private readonly resolved=new Set<string>();

  /** `catalog` vazio é mapa sem baús (o laboratório): todo pedido vira `unknown-chest`, como deve. */
  constructor(catalog:readonly ChestSpec[]=chestCatalog()){for(const spec of catalog)this.rows.set(spec.id,{...spec,used:false,uses:0});}

  get(id:string):Readonly<ChestRow>|undefined {return this.rows.get(id);}
  /** Ids já consumidos, para a sala replicar o que cada tela deve mostrar aberto. */
  usedIds():string[] {return [...this.rows.values()].filter(r=>r.used).map(r=>r.id);}
  price(id:string,stage:number):number {
    const row=this.rows.get(id);
    return row?chestPrice(row.kind,stage,this.opened,row.uses):0;
  }

  /**
   * Resolve UMA tentativa de compra. A ordem é a do §21.3 e ela importa: nada é debitado antes de a
   * distância valer, e a recompensa só é rolada depois do débito — senão um pedido recusado por
   * saldo já teria deslocado o fluxo de RNG de quem paga.
   */
  purchase(input:{
    requestId:string;entityId:number;interactableId:string;position:Vec3;stage:number;
    credits:number;rng:RandomStream;randomItem:(rng:RandomStream)=>ItemDefinition;
    debit:(amount:number)=>void;grant:(item:ItemDefinition)=>void;
  }):PurchaseResult {
    const {requestId,entityId,interactableId}=input;
    const base={interactableId,requestId,entityId,credits:input.credits};
    // Pedido repetido (retransmissão, clique duplo, reaplicação): responde de novo, cobra uma vez.
    if(this.resolved.has(requestId))return {...base,ok:false,cost:0,reason:'replay'};
    const row=this.rows.get(interactableId);
    if(!row)return {...base,ok:false,cost:0,reason:'unknown-chest'};
    const cost=chestPrice(row.kind,input.stage,this.opened,row.uses);
    // Altar continua comprável depois de usado; os demais, não.
    if(row.used&&row.kind!=='altar')return {...base,ok:false,cost,reason:'used'};
    const planar=Math.hypot(row.x-input.position.x,row.z-input.position.z);
    if(planar>=PURCHASE_RANGE||Math.abs(row.y-input.position.y)>=PURCHASE_HEIGHT)
      return {...base,ok:false,cost,reason:'range'};
    // A ÚNICA comparação de saldo do fluxo inteiro.
    if(input.credits<cost)return {...base,ok:false,cost,reason:'credits'};
    this.resolved.add(requestId);
    input.debit(cost);
    this.opened++;this.purchases++;row.uses++;
    if(row.kind!=='altar')row.used=true;
    // Altar: 58 % de conceder, exatamente como a regra sempre foi — agora rolada pelo servidor.
    if(row.kind==='altar'&&input.rng.next()>=.58)
      return {...base,ok:true,cost,credits:input.credits-cost,empty:true};
    const item=input.randomItem(input.rng);
    input.grant(item);
    return {...base,ok:true,cost,credits:input.credits-cost,item};
  }

  /** Estágio novo: tudo fechado e o preço progressivo de volta ao primeiro baú. */
  reset():void {
    this.opened=0;this.resolved.clear();
    for(const row of this.rows.values()){row.used=false;row.uses=0;}
  }
}
