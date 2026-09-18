/**
 * Gatilho da PRISM: cadência por modo, automático ou semiautomático.
 *
 * Segue a mesma convenção do `PistolCadence` — o resto do tempo do quadro fica guardado no
 * `cooldown`, então a cadência não é arredondada para o passo fixo e o primeiro disparo sai no
 * começo do tique. A diferença é que aqui a taxa vem do MODO (o gatilho não a conhece) e que o
 * semiautomático exige uma NOVA pressão: segurar o botão não repete no sniper nem na granada.
 *
 * `shoot` devolve `false` quando o disparo não aconteceu (sem munição, recarregando, rig ocupado);
 * nesse caso nem o contador nem o tempo de recarga do gatilho avançam — segurar o gatilho com o
 * carregador vazio não come a cadência do próximo tiro.
 */
export class PrismTrigger {
  private cooldown = 0;
  private held = false;
  shots = 0;
  /** `stats.attackSpeed` da progressão, igual ao da pistola. */
  rateMultiplier = 1;
  reset(): void {this.cooldown=0;this.held=false;this.shots=0;}
  /** Solta o gatilho sem zerar a cadência — usado quando a arma é guardada ou a cena pausa. */
  release(): void {this.held=false;}
  update(dt: number, pressed: boolean, rate: number, automatic: boolean, shoot: () => boolean): void {
    const edge=pressed&&!this.held;
    this.held=pressed;
    if(!pressed){this.cooldown=Math.max(0,this.cooldown-dt);return;}
    if((automatic||edge)&&this.cooldown<=1e-9&&shoot()){
      this.shots++;
      this.cooldown+=1/Math.max(.01,rate*Math.max(.05,this.rateMultiplier));
    }
    // Piso em −1 s: sem ele, segurar o gatilho no semiautomático afundaria o relógio sem limite.
    this.cooldown=Math.max(-1,this.cooldown-dt);
  }
}
