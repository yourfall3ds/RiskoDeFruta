import {PLAYER_CLASSES,PLAYER_CLASS_ORDER,type PlayerClassId} from '../run/PlayerClass';

/**
 * A ESCOLHA DE PERSONAGEM, no formato de tela de seleção de jogo.
 *
 * ## Por que foi reescrita
 *
 * A versão anterior eram dois cartões de TEXTO lado a lado: nome, papel e um parágrafo de resumo
 * dentro de cada um. Isso é ficha de catálogo, não seleção de personagem — e num jogo o que
 * identifica a classe é a CARA dela, não a descrição.
 *
 * O formato aqui é o consagrado (Risk of Rain 2 é a referência que o dono do jogo pediu):
 *
 * ```
 *   [busto][busto][ ? ][ ? ]      grade de retratos; vagas futuras aparecem trancadas
 *   PISTOLEIRO                    nome da escolhida, grande
 *   ARMA  [ícone] pistolas        a arma, com a imagem dela
 *   HABILIDADES                   lista com ícone, nome e o que faz
 * ```
 *
 * ## As imagens são RENDERIZADAS DOS MODELOS DO JOGO
 *
 * `public/ui/select/*.png` sai de `render-portraits.py`, que abre os MESMOS `.glb` que o jogo
 * carrega (`gunslinger.glb`, `pistol.glb`, `weapons/prism-triform.glb`) e fotografa com fundo
 * transparente. Nenhuma arte desenhada à parte: se o modelo mudar, a miniatura é regerada do
 * modelo novo e não fica mentindo sobre o que o jogador vai ver em campo.
 *
 * Os dois personagens compartilham o corpo porque o jogo tem UM modelo de jogador — o que muda
 * entre as classes é a arma. Por isso a arma aparece como emblema no canto do retrato: é o
 * diferenciador verdadeiro, e não um retrato falsamente diferente.
 *
 * ## Vagas futuras
 *
 * `LOCKED_SLOTS` desenha as vagas trancadas. Acrescentar um personagem de verdade é só adicionar
 * a classe em `PLAYER_CLASSES`: a grade cresce sozinha e uma vaga trancada a menos aparece.
 *
 * Acessível: continua um `radiogroup` com `aria-checked`, navegável por Tab e por setas.
 */

/** Ficha de apresentação de cada classe. O texto sai do catálogo; aqui mora só o que é da TELA. */
interface ClassArt {
  readonly bust: string;
  readonly weaponIcon: string;
  readonly weaponName: string;
  readonly skills: readonly {readonly name: string; readonly text: string; readonly icon: string}[];
}

const ART: Readonly<Record<PlayerClassId, ClassArt>> = {
  gunslinger: {
    bust: '/ui/select/bust-gunslinger.png',
    weaponIcon: '/ui/select/weapon-pistols.png',
    weaponName: 'PISTOLAS DUPLAS',
    skills: [
      {name: 'LEQUE RICOCHETEANTE', text: 'MP I · salva que quica entre alvos.', icon: '/ui/select/skill-fan.png'},
      {name: 'BARRAGEM COM MORTAL', text: 'MP II · mortal para trás disparando sem parar.', icon: '/ui/select/skill-barrage.png'},
      {name: 'TEMPESTADE DA COLHEITA', text: 'MP III · mira sozinha e satura a área.', icon: '/ui/select/skill-storm.png'},
      {name: 'COMBATE DESARMADO', text: 'V · golpes de perto, sem gastar munição.', icon: '/ui/select/skill-fist.png'},
    ],
  },
  soldier: {
    bust: '/ui/select/bust-soldier.png',
    weaponIcon: '/ui/select/weapon-prism.png',
    weaponName: 'PRISM TRIFORME',
    skills: [
      {name: 'TRÊS FORMAS', text: 'T · assalto, lança de íons e lança-granadas, cada uma com carregador próprio.', icon: '/ui/select/skill-triform.png'},
      {name: 'TRANSFORMAR', text: 'Q nível I · troca de forma de graça.', icon: '/ui/select/skill-transform.png'},
      {name: 'MP II e III', text: 'Habilidades DIFERENTES em cada forma, com munição e MP próprios.', icon: '/ui/select/skill-orbs.png'},
      {name: 'MIRA APURADA', text: 'Botão direito · luneta na forma de precisão.', icon: '/ui/select/skill-scope.png'},
    ],
  },
};

/** Vagas ainda não preenchidas. Existem para a grade já mostrar que o elenco vai crescer. */
const LOCKED_SLOTS = 4;

export class ClassSelect {
  readonly element = document.createElement('section');
  private readonly slots = new Map<PlayerClassId, HTMLButtonElement>();
  private readonly detail = document.createElement('div');
  private readonly notice: HTMLElement;
  private current: PlayerClassId;
  private locked = false;

  constructor(initial: PlayerClassId, private readonly onChoose: (id: PlayerClassId) => void) {
    this.current = initial;
    this.element.className = 'class-select';
    this.element.setAttribute('role', 'radiogroup');
    this.element.setAttribute('aria-label', 'Personagem da expedição');

    const grid = document.createElement('div');
    grid.className = 'class-grid';
    for (const id of PLAYER_CLASS_ORDER) {
      const definition = PLAYER_CLASSES[id];
      const art = ART[id];
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'class-slot';
      slot.dataset['classId'] = id;
      slot.setAttribute('role', 'radio');
      slot.title = definition.name;
      slot.setAttribute('aria-label', definition.name);
      const bust = document.createElement('img');
      bust.className = 'class-slot-bust';
      bust.src = art.bust;
      bust.alt = '';
      bust.decoding = 'async';
      const badge = document.createElement('img');
      badge.className = 'class-slot-badge';
      badge.src = art.weaponIcon;
      badge.alt = '';
      badge.decoding = 'async';
      slot.append(bust, badge);
      slot.onclick = () => this.pick(id);
      this.slots.set(id, slot);
      grid.append(slot);
    }
    // Vagas trancadas: mesmo formato, silhueta e interrogação. Não são botões — não há o que
    // escolher nelas, e um botão desabilitado ainda entraria na navegação por Tab.
    for (let i = 0; i < LOCKED_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'class-slot class-slot-locked';
      slot.setAttribute('aria-hidden', 'true');
      slot.textContent = '?';
      grid.append(slot);
    }
    this.element.append(grid);

    this.detail.className = 'class-detail';
    this.element.append(this.detail);

    this.notice = document.createElement('small');
    this.notice.className = 'class-select-notice';
    this.element.append(this.notice);

    // Setas navegam entre os personagens, como em qualquer seleção de console.
    this.element.addEventListener('keydown', event => {
      if (this.locked) return;
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const order = PLAYER_CLASS_ORDER;
      const next = order[(order.indexOf(this.current) + step + order.length) % order.length]!;
      this.pick(next);
      this.slots.get(next)?.focus();
    });

    this.sync();
  }

  /** A classe marcada agora. */
  get value(): PlayerClassId {return this.current;}

  /** Marca uma classe sem avisar ninguém — usado quando a cena é a dona da verdade. */
  show(id: PlayerClassId): void {this.current = id; this.sync();}

  /**
   * Tranca ou destranca a escolha.
   *
   * Travado, o painel continua LEGÍVEL (o jogador ainda vê com o que está jogando) e diz por que
   * não dá para mudar. Esconder o bloco seria pior: sumiria a informação junto com o controle.
   */
  setLocked(locked: boolean): void {this.locked = locked; this.sync();}

  private pick(id: PlayerClassId): void {
    if (this.locked || id === this.current) return;
    this.current = id;
    this.sync();
    this.onChoose(id);
  }

  /** Reescreve a ficha da classe marcada. */
  private renderDetail(): void {
    const definition = PLAYER_CLASSES[this.current];
    const art = ART[this.current];
    this.detail.replaceChildren();

    const name = document.createElement('h3');
    name.className = 'class-detail-name';
    name.textContent = definition.name;

    const role = document.createElement('p');
    role.className = 'class-detail-role';
    role.textContent = definition.role;

    const weapon = document.createElement('div');
    weapon.className = 'class-weapon';
    const weaponIcon = document.createElement('img');
    weaponIcon.src = art.weaponIcon;
    weaponIcon.alt = '';
    weaponIcon.decoding = 'async';
    const weaponName = document.createElement('b');
    weaponName.textContent = art.weaponName;
    weapon.append(weaponIcon, weaponName);

    const heading = document.createElement('small');
    heading.className = 'class-skills-heading';
    heading.textContent = 'HABILIDADES';

    const list = document.createElement('ul');
    list.className = 'class-skills';
    for (const skill of art.skills) {
      const item = document.createElement('li');
      const icon = document.createElement('img');
      icon.className = 'class-skill-icon';
      icon.src = skill.icon;
      icon.alt = '';
      icon.decoding = 'async';
      const body = document.createElement('div');
      const label = document.createElement('b');
      label.textContent = skill.name;
      const text = document.createElement('span');
      text.textContent = skill.text;
      body.append(label, text);
      item.append(icon, body);
      list.append(item);
    }

    this.detail.append(name, role, weapon, heading, list);
  }

  private sync(): void {
    for (const [id, slot] of this.slots) {
      const chosen = id === this.current;
      slot.classList.toggle('chosen', chosen);
      slot.setAttribute('aria-checked', String(chosen));
      slot.disabled = this.locked;
      slot.setAttribute('aria-disabled', String(this.locked));
      // Só a escolhida fica na ordem de tabulação: é o padrão de um radiogroup.
      slot.tabIndex = chosen ? 0 : -1;
    }
    this.element.classList.toggle('locked', this.locked);
    this.renderDetail();
    this.notice.textContent = this.locked
      ? `Personagem travado durante a expedição · ${PLAYER_CLASSES[this.current].name} · volte ao menu para trocar`
      : 'Sem troca de arma em campo: a escolha vale a expedição inteira.';
  }

  dispose(): void {this.element.remove();}
}
