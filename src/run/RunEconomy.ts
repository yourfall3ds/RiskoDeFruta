/**
 * ECONOMIA REPLICADA — O LADO DE APRESENTAÇÃO (contrato §21.2).
 *
 * `credits`, `xp`, `level` e `stage` são UM agregado e o dono deles é o servidor. Este arquivo é a
 * outra metade: o que a tela EXIBE. Ele copia números e não decide nada — não tem subtração, não tem
 * comparação com custo, não tem "se der, compra".
 *
 * A correção proibida do §21.1 seria adotar o saldo dentro do `RunProgression` do cliente e depois
 * continuar decidindo com ele. Por isso o espelho é um objeto SEPARADO: quem quiser usá-lo como
 * pré-condição tem de escrever a violação à mão, e ela fica visível.
 */
export interface EconomyRow {
  credits:number;xp:number;level:number;stage:number;totalKills:number;
  /** Quantas compras a sala já resolveu. Diagnóstico e prova de "exatamente uma compra". */
  purchases:number;
}

export class EconomyMirror {
  /** `false` enquanto nenhuma linha autoritativa chegou. Silêncio não é saldo zero. */
  adopted=false;
  credits=0;xp=0;level=1;stage=1;totalKills=0;purchases=0;
  /** Quantas linhas foram adotadas. Um teste usa isto para provar que a convergência aconteceu. */
  adoptions=0;

  adopt(row:EconomyRow|undefined):void {
    if(!row)return;
    this.adopted=true;this.adoptions++;
    this.credits=row.credits;this.xp=row.xp;this.level=row.level;
    this.stage=row.stage;this.totalKills=row.totalKills;this.purchases=row.purchases;
  }

  reset():void {this.adopted=false;this.adoptions=0;this.credits=0;this.xp=0;this.level=1;this.stage=1;this.totalKills=0;this.purchases=0;}
}

/**
 * O canal por onde a TENTATIVA de compra sai do cliente.
 *
 * `request` não devolve sucesso porque sucesso não é decisão daqui: o cliente manda um pedido
 * possivelmente obsoleto (§20.22, na versão econômica do §21.6) e a resposta chega replicada.
 */
export interface PurchaseChannel {
  request(interactableId:string,requestId:string):void;
}
