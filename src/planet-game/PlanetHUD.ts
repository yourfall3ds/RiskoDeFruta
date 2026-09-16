/**
 * HUD da expedição no planeta.
 *
 * Só o que o jogador precisa ler enquanto joga: vida, munição, especial, créditos, objetivo e a
 * tela de derrota. Números de diagnóstico ficam no painel de verificação (F2) e **não** aparecem
 * aqui. É autocontido em vez de reusar o `PlayerHUD` porque aquele remove o menu de arranque,
 * escreve classes no `body` e assume sistemas que esta cena ainda não tem.
 */
export interface PlanetHUDState {
  /** Etapas ainda carregando, em ordem de exibição. */
  readonly pending: readonly string[];
  readonly error: string;
  /** Linha do objetivo corrente. */
  readonly objective: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly ammo: number;
  readonly magazine: number;
  readonly reloading: boolean;
  /** 0..100. */
  readonly mp: number;
  /** Tier carregado no momento (0 = nenhum). */
  readonly mpTier: 0 | 1 | 2 | 3;
  readonly credits: number;
  readonly level: number;
  readonly stage: number;
  /** Suco do cálice, quando a horda final está em curso. */
  readonly juice?: {value: number; target: number} | undefined;
  /** Aviso curto e temporário (baú aberto, item pego). */
  readonly notice?: string | undefined;
  /** Mira sobre um alvo. */
  readonly onTarget?: boolean;
  /** Texto da derrota; presente reabre o portão com o botão de repetir. */
  readonly defeat?: string | undefined;
  /** Quantos hostis estão em campo — leitura de jogo, não de diagnóstico. */
  readonly threats?: number;
}

const STYLE_ID = 'planet-hud-style';
const CSS = `
#planet-hud{position:fixed;inset:0;pointer-events:none;font:500 13px/1.45 system-ui,sans-serif;color:#eaf2ff;z-index:40}
#planet-hud [hidden]{display:none!important}
#planet-hud .planet-objective{position:absolute;left:50%;top:18px;transform:translateX(-50%);padding:8px 16px;
  border-radius:999px;background:rgba(8,14,24,.66);backdrop-filter:blur(6px);font-weight:600;text-align:center;max-width:70vw}
#planet-hud .planet-juice{position:absolute;left:50%;top:56px;transform:translateX(-50%);width:260px;
  padding:6px 10px;border-radius:8px;background:rgba(8,14,24,.66);display:grid;gap:4px;justify-items:center}
#planet-hud .planet-juice div{width:100%;height:6px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden}
#planet-hud .planet-juice i{display:block;height:100%;background:linear-gradient(90deg,#8ce06a,#e8f36a);width:0}
#planet-hud .planet-vitals{position:absolute;left:20px;bottom:20px;display:grid;gap:6px;width:270px}
#planet-hud .planet-vitals .bar{height:12px;border-radius:6px;background:rgba(8,14,24,.66);overflow:hidden}
#planet-hud .planet-vitals .bar i{display:block;height:100%;width:100%;transition:width .12s linear}
#planet-hud .planet-vitals .hp i{background:linear-gradient(90deg,#ff5f6d,#ffc371)}
#planet-hud .planet-vitals .mp i{background:linear-gradient(90deg,#4f8cff,#9ed0ff)}
#planet-hud .planet-vitals b{font-variant-numeric:tabular-nums}
#planet-hud .planet-vitals .line{display:flex;justify-content:space-between;align-items:baseline;
  text-shadow:0 1px 3px rgba(0,0,0,.7)}
#planet-hud .planet-ammo{position:absolute;right:20px;bottom:20px;text-align:right;
  text-shadow:0 1px 3px rgba(0,0,0,.7)}
#planet-hud .planet-ammo strong{display:block;font:700 30px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
#planet-hud .planet-ammo small{opacity:.75}
#planet-hud .planet-purse{position:absolute;right:20px;top:18px;padding:6px 12px;border-radius:999px;
  background:rgba(8,14,24,.66);font-variant-numeric:tabular-nums}
#planet-hud .planet-notice{position:absolute;left:50%;bottom:110px;transform:translateX(-50%);padding:7px 14px;
  border-radius:8px;background:rgba(8,14,24,.76);opacity:0;transition:opacity .2s}
#planet-hud .planet-notice.show{opacity:1}
#planet-hud .planet-cross{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px}
#planet-hud .planet-cross i{position:absolute;background:rgba(255,255,255,.82);box-shadow:0 0 2px rgba(0,0,0,.8)}
#planet-hud .planet-cross i:nth-child(1){left:8px;top:0;width:2px;height:6px}
#planet-hud .planet-cross i:nth-child(2){left:8px;bottom:0;width:2px;height:6px}
#planet-hud .planet-cross i:nth-child(3){top:8px;left:0;height:2px;width:6px}
#planet-hud .planet-cross i:nth-child(4){top:8px;right:0;height:2px;width:6px}
#planet-hud .planet-cross.on i{background:#ff7a7a}
#planet-hud .planet-gate{position:absolute;inset:0;display:grid;place-items:center;background:rgba(5,9,16,.86);pointer-events:auto}
#planet-hud .planet-gate>div{max-width:540px;padding:28px 32px;border-radius:14px;background:rgba(12,20,34,.92);
  box-shadow:0 20px 60px rgba(0,0,0,.5);display:grid;gap:14px}
#planet-hud .planet-gate h1{margin:0;font:700 26px/1.2 system-ui,sans-serif}
#planet-hud .planet-gate .eyebrow{font:600 11px/1 ui-monospace,monospace;letter-spacing:.18em;color:#8fb6ff;text-transform:uppercase}
#planet-hud .planet-gate p{margin:0;color:#b9c9e2}
#planet-hud .planet-gate ul{margin:0;padding-left:18px;color:#93a8c6;display:grid;gap:3px}
#planet-hud .planet-gate button{justify-self:start;padding:11px 22px;border:0;border-radius:8px;cursor:pointer;
  background:#3f7dff;color:#fff;font:600 14px/1 system-ui,sans-serif}
#planet-hud .planet-gate button[disabled]{background:#26344d;color:#7e8ba3;cursor:progress}
#planet-hud .planet-gate .planet-error{padding:10px 12px;border-radius:8px;background:rgba(120,32,40,.45);
  color:#ffd9dd;white-space:pre-line}
#planet-hud .planet-badge{position:absolute;left:20px;top:18px;padding:6px 11px;border-radius:999px;
  background:rgba(255,176,32,.16);color:#ffcf7a;font:600 11px/1 ui-monospace,monospace;letter-spacing:.1em}
`;

export class PlanetHUD {
  readonly element = document.createElement('div');
  private readonly gate: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly errorBox: HTMLElement;
  private readonly objectiveBox: HTMLElement;
  private readonly juiceBox: HTMLElement;
  private readonly juiceFill: HTMLElement;
  private readonly juiceLabel: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpLabel: HTMLElement;
  private readonly mpFill: HTMLElement;
  private readonly mpLabel: HTMLElement;
  private readonly ammoBox: HTMLElement;
  private readonly purse: HTMLElement;
  private readonly noticeBox: HTMLElement;
  private readonly crosshair: HTMLElement;
  private lastKey = '';
  private noticeClock = 0;
  private entered = false;
  private disposed = false;

  constructor(private readonly onStart: () => void) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID; style.textContent = CSS;
      document.head.append(style);
    }
    this.element.id = 'planet-hud';
    this.element.innerHTML = `
      <div class="planet-badge">EM DESENVOLVIMENTO</div>
      <div class="planet-objective" role="status" aria-live="polite"></div>
      <div class="planet-juice" hidden><small></small><div><i></i></div></div>
      <div class="planet-cross" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="planet-purse"><span class="planet-purse-text">0 créditos</span></div>
      <div class="planet-vitals">
        <div class="line"><span>VIDA</span><b class="planet-hp-text">0 / 0</b></div>
        <div class="bar hp"><i></i></div>
        <div class="line"><span>ESPECIAL</span><b class="planet-mp-text">0</b></div>
        <div class="bar mp"><i></i></div>
      </div>
      <div class="planet-ammo"><strong class="planet-ammo-text">0</strong><small>MUNIÇÃO</small></div>
      <div class="planet-notice"></div>
      <div class="planet-gate">
        <div>
          <span class="eyebrow">Risco de Fruta</span>
          <h1>Expedição</h1>
          <p>Explore o planeta, encontre o cálice e sobreviva à horda final.</p>
          <ul>
            <li><b>W A S D</b> andar · <b>MOUSE</b> mirar · <b>CLIQUE</b> atirar</li>
            <li><b>ESPAÇO</b> saltar · <b>SHIFT</b> correr · <b>R</b> recarregar</li>
            <li><b>BOTÃO DIREITO</b> carrega o especial · <b>E</b> baús e cálice</li>
          </ul>
          <div class="planet-error" hidden></div>
          <button type="button" disabled>Carregando…</button>
        </div>
      </div>`;
    this.gate = this.element.querySelector('.planet-gate')!;
    this.button = this.element.querySelector('.planet-gate button')!;
    this.errorBox = this.element.querySelector('.planet-error')!;
    this.objectiveBox = this.element.querySelector('.planet-objective')!;
    this.juiceBox = this.element.querySelector('.planet-juice')!;
    this.juiceFill = this.element.querySelector('.planet-juice i')!;
    this.juiceLabel = this.element.querySelector('.planet-juice small')!;
    this.hpFill = this.element.querySelector('.bar.hp i')!;
    this.hpLabel = this.element.querySelector('.planet-hp-text')!;
    this.mpFill = this.element.querySelector('.bar.mp i')!;
    this.mpLabel = this.element.querySelector('.planet-mp-text')!;
    this.ammoBox = this.element.querySelector('.planet-ammo-text')!;
    this.purse = this.element.querySelector('.planet-purse-text')!;
    this.noticeBox = this.element.querySelector('.planet-notice')!;
    this.crosshair = this.element.querySelector('.planet-cross')!;
    this.button.addEventListener('click', () => {
      if (this.button.disabled) return;
      this.entered = true;
      this.gate.hidden = true;
      this.onStart();
    });
    document.getElementById('boot-menu')?.remove();
    document.body.append(this.element);
  }

  get started(): boolean {return this.entered;}
  reopen(): void {this.entered = false; this.gate.hidden = false;}

  /**
   * Escreve no DOM só quando algo mudou.
   *
   * A barra de vida e a munição mudam num ritmo diferente do texto do objetivo, então a chave de
   * comparação cobre os dois — sem isso o HUD reescreveria nós a 60 Hz sem necessidade.
   */
  update(state: PlanetHUDState, dt = 0): void {
    if (this.disposed) return;
    this.noticeClock = state.notice ? 2.6 : Math.max(0, this.noticeClock - dt);
    this.crosshair.classList.toggle('on', state.onTarget === true);
    const defeat = state.defeat ?? '';
    const key = [
      state.pending.join('|'), state.error, state.objective, defeat,
      Math.round(state.health), state.maxHealth, state.ammo, state.reloading ? 'R' : '',
      Math.round(state.mp), state.mpTier, Math.floor(state.credits), state.level, state.stage,
      state.juice ? `${Math.round(state.juice.value)}/${state.juice.target}` : '',
      state.notice ?? '', this.noticeClock > 0 ? '1' : '0', state.threats ?? 0,
    ].join('¦');
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.objectiveBox.textContent = state.objective;
    this.objectiveBox.hidden = state.objective === '';
    const juice = state.juice;
    this.juiceBox.hidden = !juice;
    if (juice) {
      this.juiceLabel.textContent = `CÁLICE ${Math.round(juice.value)} / ${juice.target}`;
      this.juiceFill.style.width = `${Math.round(Math.min(1, juice.value / Math.max(1, juice.target)) * 100)}%`;
    }
    const hp = Math.max(0, Math.round(state.health));
    this.hpLabel.textContent = `${hp} / ${Math.round(state.maxHealth)}`;
    this.hpFill.style.width = `${Math.round(Math.max(0, Math.min(1, state.health / Math.max(1, state.maxHealth))) * 100)}%`;
    this.mpLabel.textContent = state.mpTier > 0 ? `${Math.round(state.mp)} · nível ${state.mpTier}` : `${Math.round(state.mp)}`;
    this.mpFill.style.width = `${Math.round(Math.max(0, Math.min(1, state.mp / 100)) * 100)}%`;
    this.ammoBox.textContent = state.reloading ? '···' : `${state.ammo}`;
    this.purse.textContent = `${Math.floor(state.credits)} créditos · nível ${state.level} · ilha ${state.stage}`;
    this.noticeBox.textContent = state.notice ?? this.noticeBox.textContent;
    this.noticeBox.classList.toggle('show', this.noticeClock > 0);

    const notice = state.error || defeat;
    this.errorBox.hidden = !notice;
    if (notice) this.errorBox.textContent = notice;
    const blocked = state.error !== '' || state.pending.length > 0;
    this.button.disabled = blocked;
    this.button.textContent = state.error
      ? 'Indisponível'
      : state.pending.length > 0
        ? `Carregando ${state.pending[0]}…`
        : defeat ? 'Tentar de novo' : 'Começar a expedição';
    if ((state.error || defeat) && this.entered) this.reopen();
    else if (!state.error && !defeat && this.entered) this.gate.hidden = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.element.remove();
  }
}
