/**
 * Estúdio de sons dos inimigos: ouvir e substituir o foley de cada espécie sem abrir o jogo.
 *
 * Só toca quando o usuário pede (nada automático ao abrir) e só usa o que o manifest resolve de
 * verdade, através de EnemyAudioCatalog/EnemyAudioOverrides — o mesmo par que o runtime consome.
 *
 * O visual é do Codex (src/ui/enemy-audio-lab.css); este módulo só garante estrutura, rótulos e
 * estados (data-muted / data-loading / aria-pressed) para o CSS pegar.
 */

import './enemy-audio-lab.css';
// O estúdio é uma PÁGINA separada: não passa por `main.ts`, então puxa a identidade visual por
// conta própria — senão seria a única tela do jogo fora do tema.
import './theme.css';
import {
  ENEMY_AUDIO_EVENT_SPECS, ENEMY_AUDIO_SPECIES, enemyAudioSpecies,
  type EnemyAudioEvent, type EnemyAudioKind,
} from '../audio/EnemyAudioCatalog';
import {
  EnemyAudioError, EnemyAudioOverrides, MAX_CLIP_BYTES,
  type EnemyAudioLookup, type EnemyAudioOverridesOptions,
} from '../audio/EnemyAudioOverrides';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const bytes = (size: number): string => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} kB`;
const percent = (gain: number): string => `${Math.round(gain * 100)}%`;
const variations = (count: number): string => `${count} ${count === 1 ? 'variação' : 'variações'}`;

interface PlayRequest { buffer: AudioBuffer; gain: number; rate: number; offset: number }

export class EnemyAudioLab {
  readonly overrides: EnemyAudioOverrides;
  private readonly controls = new AbortController();
  private readonly nav = el('nav', 'audio-species');
  private readonly main = el('main', 'audio-events');
  private readonly heading = el('div', 'audio-species-heading');
  private readonly statusLine = el('p', 'audio-lab-status');
  private readonly errorLine = el('p', 'audio-lab-error');
  private readonly importInput = el('input');
  private readonly defaults = new Map<string, Promise<AudioBuffer>>();
  private readonly playing = new Set<AudioBufferSourceNode>();
  private readonly rotation = new Map<string, number>();
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private generation = 0;
  private kind: EnemyAudioKind = ENEMY_AUDIO_SPECIES[0]!.kind;
  private disposed = false;

  constructor(private readonly root: HTMLElement, options: EnemyAudioOverridesOptions = {}) {
    this.overrides = new EnemyAudioOverrides(options);
    this.build();
    this.overrides.subscribe(keys => {
      if (this.disposed) return;
      this.renderSpecies();
      if (keys.some(key => key.startsWith(`${this.kind}:`))) this.renderEvents();
    });
    void this.boot();
  }

  static mount(root: HTMLElement, options: EnemyAudioOverridesOptions = {}): EnemyAudioLab {
    document.body.classList.add('audio-lab');
    return new EnemyAudioLab(root, options);
  }

  // ------------------------------------------------------------------ estrutura

  private build(): void {
    this.root.classList.add('audio-lab-shell');
    const header = el('header', 'audio-lab-header');
    header.append(
      el('p', 'audio-lab-kicker', 'MUTANT FARM · ÁUDIO DOS INIMIGOS'),
      el('h1', undefined, 'Estúdio de sons'),
      el('p', 'audio-lab-description', 'Ouça cada som que o jogo toca por espécie e evento, troque o que irrita por um arquivo seu e volte ao padrão quando quiser. Nada é enviado para a internet.'),
    );
    const toolbar = el('div', 'audio-lab-toolbar');
    toolbar.append(
      this.button('Parar tudo', 'stop-all', () => this.stopAll('Playback interrompido.')),
      this.button('Exportar pacote', 'export', () => void this.exportBundle()),
      this.button('Importar pacote', 'import', () => this.importInput.click()),
    );
    this.importInput.type = 'file';
    this.importInput.accept = 'application/json,.json';
    this.importInput.hidden = true;
    this.importInput.addEventListener('change', () => void this.importBundle(), { signal: this.controls.signal });
    const back = el('a', undefined, 'Voltar ao jogo');
    back.href = '/';
    toolbar.append(this.importInput, back);
    header.append(toolbar);

    this.statusLine.setAttribute('role', 'status');
    this.errorLine.setAttribute('role', 'alert');
    this.errorLine.hidden = true;

    this.nav.setAttribute('aria-label', 'Espécies de inimigo');
    const layout = el('div', 'audio-lab-layout');
    layout.append(this.nav, this.main);
    this.root.append(header, this.statusLine, this.errorLine, layout);

    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const modal = this.root.querySelector<HTMLDialogElement>('[data-audio-lab-modal]');
      if (modal) { this.closeModal(modal); return; }
      this.stopAll('Playback interrompido (Esc).');
    }, { signal: this.controls.signal });

    this.renderSpecies();
    this.main.append(this.heading, el('p', 'audio-event-status', 'Carregando os sons…'));
  }

  private button(label: string, action: string, run: () => void): HTMLButtonElement {
    const node = el('button', undefined, label);
    node.type = 'button';
    node.dataset.action = action;
    node.addEventListener('click', () => { this.ensureContext(); run(); }, { signal: this.controls.signal });
    return node;
  }

  private async boot(): Promise<void> {
    await this.overrides.ready;
    if (this.disposed) return;
    this.renderSpecies();
    this.renderEvents();
    const warning = this.overrides.manifestWarning;
    if (warning) this.fail(warning);
    this.say(`Pronto. ${this.overrides.storageNote}`);
  }

  private renderSpecies(): void {
    this.nav.replaceChildren(el('small', undefined, 'Espécies'), ...ENEMY_AUDIO_SPECIES.map(species => {
      const changed = ENEMY_AUDIO_EVENT_SPECS.filter(spec => {
        const lookup = this.overrides.lookup(species.kind, spec.event);
        return lookup.custom || lookup.muted || lookup.userGain !== 1;
      }).length;
      const node = el('button');
      node.type = 'button';
      node.dataset.kind = species.kind;
      node.setAttribute('aria-pressed', String(species.kind === this.kind));
      node.append(el('b', undefined, species.label), el('small', undefined, changed ? `${changed} ajuste${changed > 1 ? 's' : ''} seu${changed > 1 ? 's' : ''}` : species.note));
      node.addEventListener('click', () => {
        if (this.kind === species.kind) return;
        this.kind = species.kind;
        this.stopAll();
        this.renderSpecies();
        this.renderEvents();
      }, { signal: this.controls.signal });
      return node;
    }));
  }

  private renderEvents(): void {
    const species = enemyAudioSpecies(this.kind);
    this.heading.replaceChildren();
    const title = el('h2', undefined, species.label);
    const restore = this.button('Restaurar espécie', 'restore-species', () => void this.guard(async () => {
      await this.overrides.restoreSpecies(this.kind);
      this.say(`Todos os sons de ${species.label} voltaram ao padrão.`);
    }));
    restore.setAttribute('aria-label', `Restaurar todos os sons de ${species.label}`);
    this.heading.append(title, el('p', 'audio-event-status', species.note), restore);
    this.main.replaceChildren(this.heading, ...ENEMY_AUDIO_EVENT_SPECS.map(spec => this.card(spec.event)));
  }

  private card(event: EnemyAudioEvent): HTMLElement {
    const lookup = this.overrides.lookup(this.kind, event);
    const card = el('section', 'audio-event-card');
    card.dataset.event = event;
    card.dataset.muted = String(lookup.muted);
    card.dataset.loading = 'false';
    card.dataset.source = lookup.custom ? 'custom' : lookup.source;
    card.append(el('h3', undefined, lookup.label), el('p', 'audio-event-status', lookup.description), this.statusFor(lookup), this.variants(lookup), this.controlsFor(lookup));
    return card;
  }

  /** Linha de estado em português simples; o detalhe técnico fica só no title (e no DELIVERY). */
  private statusFor(lookup: EnemyAudioLookup): HTMLElement {
    const status = el('p', 'audio-event-status');
    const spec = ENEMY_AUDIO_EVENT_SPECS.find(candidate => candidate.event === lookup.event)!;
    const parts: string[] = [];
    if (lookup.custom && lookup.override) parts.push(`Som seu: ${lookup.override.name} · ${bytes(lookup.override.size)} · ${this.overrides.storageMode === 'indexeddb' ? 'salvo neste navegador' : 'só nesta aba'}`);
    else if (lookup.source === 'missing') parts.push('Sem som: não há arquivo para este evento');
    else parts.push(`${variations(lookup.files.length)} · som padrão${lookup.source === 'fallback' ? ', o mesmo usado por outras espécies' : ''}`);
    if (lookup.muted) parts.push('silenciado');
    else if (lookup.userGain !== 1) parts.push(`volume ${percent(lookup.userGain)}`);
    if (!spec.wired) parts.push('o jogo ainda não usa este som');
    status.textContent = parts.join(' · ');
    status.title = `${lookup.group} (${lookup.source}) · ganho ${(lookup.gain).toFixed(3)} · rate ${lookup.rate} · gap ${lookup.gap}s`;
    return status;
  }

  private variants(lookup: EnemyAudioLookup): HTMLElement {
    const list = el('div', 'audio-variants');
    if (lookup.custom && lookup.override) {
      list.append(this.variant(lookup.override.name, `Ouvir o som personalizado de ${lookup.label}`, () => void this.playCustom(lookup)));
    }
    for (const file of lookup.files) {
      list.append(this.variant(fileName(file), `Ouvir ${fileName(file)}`, () => void this.playFile(file, lookup.gain, lookup.rate)));
    }
    if (!list.childElementCount) list.append(el('p', 'audio-event-status', 'Nada para ouvir neste evento.'));
    return list;
  }

  private variant(name: string, label: string, run: () => void, layer?: string): HTMLElement {
    const row = el('div', 'audio-variant');
    if (layer) row.dataset.layer = layer;
    const play = el('button', undefined, '▶');
    play.type = 'button';
    play.setAttribute('aria-label', label);
    play.addEventListener('click', () => { this.ensureContext(); run(); }, { signal: this.controls.signal });
    const title = el('span', undefined, name);
    row.append(play, title);
    return row;
  }

  private controlsFor(lookup: EnemyAudioLookup): HTMLElement {
    const controls = el('div', 'audio-event-controls');

    const asGame = this.button('Ouvir como no jogo', 'play-game', () => void this.playAsGame(lookup));
    asGame.setAttribute('aria-label', `Ouvir ${lookup.label} como o jogo toca`);
    const sequence = this.button('Sequência', 'play-sequence', () => void this.playSequence(lookup));
    sequence.setAttribute('aria-label', `Ouvir todas as variações de ${lookup.label} em sequência`);
    const stop = this.button('Parar', 'stop', () => this.stopAll('Playback interrompido.'));

    const volumeLabel = el('label', 'audio-event-volume');
    volumeLabel.htmlFor = `volume-${lookup.kind}-${lookup.event}`;
    const volumeText = el('output', undefined, percent(lookup.userGain));
    const volume = el('input');
    volume.type = 'range';
    volume.id = volumeLabel.htmlFor;
    volume.min = '0';
    volume.max = '200';
    volume.step = '5';
    volume.value = String(Math.round(lookup.userGain * 100));
    volume.setAttribute('aria-label', `Volume de ${lookup.label} (${enemyAudioSpecies(lookup.kind).label})`);
    volume.addEventListener('input', () => { volumeText.textContent = `${volume.value}%`; }, { signal: this.controls.signal });
    volume.addEventListener('change', () => void this.guard(async () => {
      await this.overrides.setUserGain(lookup.kind, lookup.event, Number(volume.value) / 100);
      this.say(`${lookup.label}: volume em ${volume.value}%.`);
    }), { signal: this.controls.signal });
    volumeLabel.append(el('span', undefined, 'Volume'), volume, volumeText);

    const mute = el('button', undefined, lookup.muted ? 'Ativar som' : 'Silenciar');
    mute.type = 'button';
    mute.dataset.action = 'mute';
    mute.setAttribute('aria-pressed', String(lookup.muted));
    mute.setAttribute('aria-label', `${lookup.muted ? 'Ativar' : 'Silenciar'} ${lookup.label} de ${enemyAudioSpecies(lookup.kind).label}`);
    mute.addEventListener('click', () => void this.guard(async () => {
      await this.overrides.setMuted(lookup.kind, lookup.event, !lookup.muted);
      this.say(`${lookup.label}: ${lookup.muted ? 'som reativado' : 'silenciado'}.`);
    }), { signal: this.controls.signal });

    const replaceLabel = el('label', 'audio-event-replace');
    replaceLabel.append(el('span', undefined, 'Substituir'));
    const replace = el('input');
    replace.type = 'file';
    replace.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.webm';
    replace.setAttribute('aria-label', `Substituir o som de ${lookup.label} de ${enemyAudioSpecies(lookup.kind).label} (até ${MAX_CLIP_BYTES / 1024 / 1024} MB)`);
    replace.addEventListener('change', () => {
      const file = replace.files?.[0];
      replace.value = '';
      if (!file) return;
      this.ensureContext();
      void this.guard(async () => {
        await this.overrides.prepare(this.context!);
        await this.overrides.setOverrideFile(lookup.kind, lookup.event, file);
        this.say(`${lookup.label}: agora toca "${file.name}". ${this.overrides.storageNote}`);
      });
    }, { signal: this.controls.signal });
    replaceLabel.append(replace);

    const restore = el('button', undefined, 'Restaurar padrão');
    restore.type = 'button';
    restore.dataset.action = 'restore';
    restore.disabled = !lookup.custom && !lookup.muted && lookup.userGain === 1;
    restore.setAttribute('aria-label', `Restaurar o som padrão de ${lookup.label}`);
    restore.addEventListener('click', () => void this.guard(async () => {
      await this.overrides.restoreEvent(lookup.kind, lookup.event);
      this.say(`${lookup.label}: de volta ao som padrão.`);
    }), { signal: this.controls.signal });

    controls.append(asGame, sequence, stop, volumeLabel, mute, replaceLabel, restore);
    return controls;
  }

  // ------------------------------------------------------------------ playback

  /** Cria o contexto na primeira interação: nunca no carregamento da página. */
  private ensureContext(): AudioContext {
    if (this.context) { void this.context.resume().catch(() => {}); return this.context; }
    const context = new AudioContext({ latencyHint: 'interactive' });
    const master = context.createGain();
    master.gain.value = 1;
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    void context.resume().catch(() => {});
    void this.overrides.prepare(context).catch(error => this.fail(String(error)));
    return context;
  }

  private loadDefault(file: string, context: AudioContext): Promise<AudioBuffer> {
    let pending = this.defaults.get(file);
    if (!pending) {
      pending = (async () => {
        const response = await fetch(file);
        if (!response.ok) throw new EnemyAudioError(`Arquivo de som não encontrado: ${file}`);
        return context.decodeAudioData(await response.arrayBuffer());
      })();
      pending.catch(() => this.defaults.delete(file));
      this.defaults.set(file, pending);
    }
    return pending;
  }

  private async playFile(file: string, gain: number, rate: number): Promise<void> {
    const context = this.ensureContext();
    const generation = this.generation;
    await this.guard(async () => {
      const buffer = await this.loadDefault(file, context);
      // Uma parada (ou outro play) invalida este decode: ele não pode tocar atrasado.
      if (generation !== this.generation) return;
      this.schedule([{ buffer, gain, rate, offset: 0 }]);
      this.say(`Tocando ${fileName(file)}.`);
    });
  }

  private async playCustom(lookup: EnemyAudioLookup): Promise<void> {
    const context = this.ensureContext();
    await this.guard(async () => {
      await this.overrides.prepare(context);
      const buffer = this.overrides.getBuffer(context, lookup.kind, lookup.event);
      if (!buffer) throw new EnemyAudioError('O som personalizado ainda está sendo preparado. Tente de novo em um instante.');
      this.schedule([{ buffer, gain: lookup.gain, rate: lookup.rate, offset: 0 }]);
      this.say(`Tocando o som personalizado de ${lookup.label}.`);
    });
  }

  /**
   * Reproduz o que o jogo tocaria. No Atacar são duas peças independentes — a voz e o ruído —
   * e cada uma respeita o próprio volume, o próprio mudo e o próprio arquivo.
   */
  private async playAsGame(lookup: EnemyAudioLookup): Promise<void> {
    const context = this.ensureContext();
    const generation = this.generation;
    const pieces: EnemyAudioEvent[] = lookup.event === 'attack' ? ['attack', 'attack-layer'] : [lookup.event];
    await this.guard(async () => {
      await this.overrides.prepare(context);
      const requests: PlayRequest[] = [];
      const played: string[] = [];
      const silent: string[] = [];
      for (const piece of pieces) {
        const part = this.overrides.lookup(lookup.kind, piece);
        if (part.muted || part.gain <= 0) { silent.push(part.label.toLowerCase()); continue; }
        const custom = this.overrides.getBuffer(context, lookup.kind, piece);
        if (custom) requests.push({ buffer: custom, gain: part.gain, rate: part.rate, offset: 0 });
        else if (part.files.length) {
          const index = (this.rotation.get(part.key) ?? 0) % part.files.length;
          this.rotation.set(part.key, index + 1);
          requests.push({ buffer: await this.loadDefault(part.files[index]!, context), gain: part.gain, rate: part.rate, offset: 0 });
        } else { silent.push(part.label.toLowerCase()); continue; }
        played.push(part.label.toLowerCase());
      }
      if (generation !== this.generation) return;
      if (!requests.length) { this.say(`Nada toca aqui: ${silent.join(' e ')} sem som.`); return; }
      this.schedule(requests);
      this.say(`Como no jogo: ${played.join(' + ')}${silent.length ? ` (sem ${silent.join(' e ')})` : ''}.`);
    });
  }

  /** Todas as variações em fila, com um respiro entre elas. */
  private async playSequence(lookup: EnemyAudioLookup): Promise<void> {
    const context = this.ensureContext();
    const generation = this.generation;
    await this.guard(async () => {
      if (lookup.custom) await this.overrides.prepare(context);
      const custom = lookup.custom ? this.overrides.getBuffer(context, lookup.kind, lookup.event) : undefined;
      const queue: AudioBuffer[] = custom ? [custom] : [];
      for (const file of lookup.files) queue.push(await this.loadDefault(file, context));
      if (generation !== this.generation) return;
      if (!queue.length) throw new EnemyAudioError('Não há som para tocar neste evento.');
      let offset = 0;
      const requests = queue.map(buffer => {
        const request: PlayRequest = { buffer, gain: lookup.gain, rate: lookup.rate, offset };
        offset += buffer.duration / lookup.rate + 0.12;
        return request;
      });
      this.schedule(requests);
      this.say(`${lookup.label}: ${variations(queue.length)} em sequência. Use Parar para cortar.`);
    });
  }

  private schedule(requests: readonly PlayRequest[]): void {
    const context = this.context, master = this.master;
    if (!context || !master) return;
    const start = context.currentTime + 0.03;
    for (const request of requests) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = request.buffer;
      source.playbackRate.value = request.rate;
      gain.gain.value = Math.max(0, Math.min(4, request.gain));
      source.connect(gain);
      gain.connect(master);
      this.playing.add(source);
      source.onended = () => { this.playing.delete(source); source.disconnect(); gain.disconnect(); };
      source.start(start + request.offset);
    }
  }

  private stopAll(message?: string): void {
    this.generation++;
    for (const source of [...this.playing]) {
      this.playing.delete(source);
      try { source.stop(); } catch { /* já terminou */ }
      source.disconnect();
    }
    if (message) this.say(message);
  }

  // -------------------------------------------------------- exportar/importar

  private async exportBundle(): Promise<void> {
    await this.guard(async () => {
      await this.overrides.ready;
      const bundle = this.overrides.exportBundle();
      if (!bundle.entries.length) { this.say('Nada para exportar: você ainda não mudou nenhum som.'); return; }
      const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = el('a');
      link.href = url;
      link.download = 'sons-inimigos-mutant-farm.json';
      link.hidden = true;
      this.root.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.say(`Pacote com ${bundle.entries.length} ajuste(s) e os áudios embutidos salvo em sons-inimigos-mutant-farm.json (${bytes(blob.size)}).`);
    });
  }

  private async importBundle(): Promise<void> {
    const file = this.importInput.files?.[0];
    this.importInput.value = '';
    if (!file) return;
    this.ensureContext();
    await this.guard(async () => {
      await this.overrides.prepare(this.context!);
      const report = await this.overrides.importBundle(await file.text());
      this.renderSpecies();
      this.renderEvents();
      const skipped = report.skipped.length ? ` ${report.skipped.length} ignorada(s): ${report.skipped.map(item => `${item.key} (${item.reason})`).join('; ')}.` : '';
      this.say(`Pacote importado: ${report.applied.length} ajuste(s) aplicado(s).${skipped} Os sons que você já tinha e não estavam no pacote foram preservados.`);
      this.modal(`Pacote de ${file.name}`, [
        `${report.applied.length} ajuste(s) aplicado(s)${report.applied.length ? `: ${report.applied.join(', ')}` : '.'}`,
        ...report.skipped.map(item => `Ignorado ${item.key}: ${item.reason}`),
        'Os sons padrão do manifest e as suas escolhas fora do pacote continuam como estavam.',
      ]);
      if (report.skipped.length) this.fail(`Algumas entradas do pacote foram ignoradas:${skipped}`);
    });
  }

  /** Relatório em <dialog>: fecha no botão ou no Esc. */
  private modal(title: string, lines: readonly string[]): void {
    const dialog = el('dialog');
    dialog.dataset.audioLabModal = 'true';
    dialog.setAttribute('aria-label', title);
    const list = el('ul');
    for (const line of lines) list.append(el('li', undefined, line));
    const close = el('button', undefined, 'Fechar');
    close.type = 'button';
    close.addEventListener('click', () => this.closeModal(dialog), { signal: this.controls.signal });
    dialog.append(el('h2', undefined, title), list, close);
    this.root.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.open = true;
    dialog.addEventListener('close', () => dialog.remove(), { signal: this.controls.signal });
    close.focus();
  }

  private closeModal(dialog: HTMLDialogElement): void {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    dialog.remove();
  }

  // -------------------------------------------------------------------- estado

  private say(message: string): void {
    if (this.disposed) return;
    this.errorLine.hidden = true;
    this.statusLine.textContent = message;
  }

  private fail(message: string): void {
    if (this.disposed) return;
    this.errorLine.hidden = false;
    this.errorLine.textContent = message;
  }

  /** Executa uma ação marcando o painel como ocupado e transformando erro em aviso legível. */
  private async guard(run: () => Promise<void>): Promise<void> {
    this.main.dataset.loading = 'true';
    for (const card of this.main.querySelectorAll<HTMLElement>('.audio-event-card')) card.dataset.loading = 'true';
    try { await run(); }
    catch (error) {
      const message = error instanceof EnemyAudioError ? error.message : `Algo falhou: ${String(error)}`;
      this.fail(`${message} A configuração anterior continua valendo.`);
    }
    finally {
      if (!this.disposed) {
        this.main.dataset.loading = 'false';
        for (const card of this.main.querySelectorAll<HTMLElement>('.audio-event-card')) card.dataset.loading = 'false';
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    this.controls.abort();
    this.defaults.clear();
    this.overrides.dispose();
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.master = undefined;
    this.root.replaceChildren();
    document.body.classList.remove('audio-lab');
  }
}
