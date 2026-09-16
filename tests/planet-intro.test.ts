import {describe, expect, it} from 'vitest';
import type {Vec3} from '../src/core/contracts';
import {PLANET, PlanetFrame, cross, distance, dot, length, normalize, scale, sub} from '../src/planet/PlanetFrame';
import {ISLAND_SLOTS} from '../src/planet/PlanetLayout';
import {PlanetArrival, ARRIVAL_TIMELINE, type IntroCue, type IntroPhase} from '../src/planet-game/PlanetArrival';
import {DESCENT_START_HEIGHT} from '../src/player/MeteorArrival';
import {INTRO_RUN_DISTANCE, INTRO_RUN_STEPS} from '../src/player/IntroSequence';

/**
 * A entrada no planeta é a entrada do jogo plano vista por uma base radial: plataforma aberta da
 * nave → corrida → salto pela borda → mergulho de cabeça → impacto → levantar → controle liberado.
 *
 * O que estes testes protegem é o que quebrou na prévia: o corpo tem de SAIR do ponto de nascimento
 * e ser desenhado no deck e na queda, a vertical da câmera tem de ser a radial LOCAL, os sinais de
 * áudio têm de sair na mesma ordem nos seis polos e nenhuma praga pode ser liberada antes de o
 * corpo levantar.
 */

const frame = new PlanetFrame(PLANET);
const STEP = 1 / 60;
const HEADING: Vec3 = {x: 0, y: 1, z: 0};

/** Tangente de marcha estável em qualquer polo, incluindo os dois onde `+Y` é a própria vertical. */
function headingAt(up: Vec3): Vec3 {
  const hint = Math.abs(dot(up, HEADING)) > 0.9 ? {x: 0, y: 0, z: 1} : HEADING;
  return normalize(sub(hint, scale(up, dot(hint, up))));
}

interface Sample {phase: IntroPhase; altitude: number; arc: number; cameraAltitude: number; cameraArc: number}

/** Roda a chegada inteira num polo e devolve a trilha de sinais e a geometria quadro a quadro. */
function run(direction: Vec3, options: {frames?: number; play?: boolean} = {}) {
  const anchor = frame.fromDirection(direction);
  const arrival = new PlanetArrival(frame);
  arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
  const cues: IntroCue[] = [];
  const samples: Sample[] = [];
  const phases: IntroPhase[] = [arrival.phase];
  let heldControl = 0, heldSpawns = 0, risenAt = -1, doneAt = -1;
  // Um segundo de espera no deck antes do Jogar: é o menu vivo da expedição.
  for (let i = 0; i < 60; i++) arrival.update(STEP, cue => cues.push(cue));
  if (options.play !== false) arrival.play();
  const total = options.frames ?? 900;
  for (let i = 0; i < total; i++) {
    const body = arrival.body, shot = arrival.shot;
    if (body && shot) {
      samples.push({
        phase: body.phase,
        altitude: frame.altitude(body.world),
        arc: frame.arcDistance(body.world, anchor),
        cameraAltitude: frame.altitude(shot.position),
        cameraArc: frame.arcDistance(shot.position, anchor),
      });
    }
    if (arrival.holdsControl) heldControl += STEP;
    if (arrival.holdsSpawns) heldSpawns += STEP;
    arrival.update(STEP, cue => {
      cues.push(cue);
      if (cue === 'rise') risenAt = i;
    });
    if (phases[phases.length - 1] !== arrival.phase) phases.push(arrival.phase);
    if (doneAt < 0 && arrival.phase === 'done') doneAt = i;
  }
  return {arrival, anchor, cues, samples, phases, heldControl, heldSpawns, risenAt, doneAt};
}

describe('PlanetArrival — a entrada da nave, não um passeio de câmera', () => {
  it('encena espera, corrida, salto, mergulho, recuperação e libera o controle', () => {
    const {phases, arrival, heldControl} = run({x: 0, y: 0, z: 1});
    expect(phases).toEqual(['standby', 'run', 'leap', 'dive', 'recover', 'done']);
    expect(arrival.holdsControl).toBe(false);
    expect(arrival.visible).toBe(false);
    expect(arrival.consumed).toBe(true);
    expect(arrival.shot).toBeUndefined();
    expect(arrival.body).toBeUndefined();
    // O controle fica retido da arrancada até o corpo terminar de levantar.
    const expected = ARRIVAL_TIMELINE.runSeconds + ARRIVAL_TIMELINE.leapSeconds
      + ARRIVAL_TIMELINE.diveSeconds + ARRIVAL_TIMELINE.recoverSeconds;
    expect(heldControl).toBeGreaterThan(expected - 0.1);
    expect(heldControl).toBeLessThan(expected + 0.1);
  });

  it('o Jogar é idempotente e a espera não anda sozinha para a corrida', () => {
    const anchor = frame.fromDirection({x: 0, y: 0, z: 1});
    const arrival = new PlanetArrival(frame);
    arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
    for (let i = 0; i < 600; i++) arrival.update(STEP);
    expect(arrival.standby).toBe(true);
    expect(arrival.holdsControl).toBe(false);
    arrival.play();
    arrival.play();
    arrival.play();
    expect(arrival.phase).toBe('run');
    arrival.update(STEP);
    arrival.play();
    expect(arrival.phase).toBe('run');
  });

  it('sem o GLB da nave a entrada cai direto no mergulho, sem correr no vazio', () => {
    const anchor = frame.fromDirection({x: 1, y: 0, z: 0});
    const arrival = new PlanetArrival(frame);
    arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
    arrival.play(false);
    expect(arrival.phase).toBe('dive');
    expect(arrival.body?.local.stride).toBeUndefined();
  });
});

describe('PlanetArrival — o corpo sai do nascimento e é mostrado no deck e na queda', () => {
  it('a espera acontece na plataforma, a centenas de metros e atrás da borda', () => {
    const anchor = frame.fromDirection({x: 0, y: 0, z: 1});
    const arrival = new PlanetArrival(frame);
    const heading = headingAt(frame.up(anchor));
    arrival.start(anchor, {heading});
    const body = arrival.body!;
    expect(body.phase).toBe('standby');
    // Nada de corpo colado no nascimento: ele está no deck da nave.
    expect(distance(body.world, anchor)).toBeGreaterThan(DESCENT_START_HEIGHT * 0.9);
    expect(body.altitude).toBeGreaterThan(DESCENT_START_HEIGHT * 0.9);
    expect(body.local.stride?.clip).toBe('Idle');
    // Atrás da borda aberta, no eixo de corrida do deck.
    const edge = arrival.deckEdgeWorld;
    const back = dot(sub(body.world, edge), heading);
    expect(back).toBeLessThan(0);
    expect(Math.abs(back)).toBeCloseTo(INTRO_RUN_DISTANCE, 6);
  });

  it('a corrida avança ao longo da tangente e o salto passa da borda', () => {
    const anchor = frame.fromDirection({x: -1, y: 0, z: 0});
    const arrival = new PlanetArrival(frame);
    const heading = headingAt(frame.up(anchor));
    arrival.start(anchor, {heading});
    arrival.play();
    const edge = arrival.deckEdgeWorld;
    let previous = dot(sub(arrival.body!.world, edge), heading);
    let ranForward = 0;
    while (arrival.phase === 'run' || arrival.phase === 'leap') {
      arrival.update(STEP);
      const body = arrival.body!;
      const along = dot(sub(body.world, edge), heading);
      expect(along).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = along;
      ranForward++;
      expect(ranForward).toBeLessThan(600);
    }
    // Terminou o salto à frente da borda, já no topo da trajetória de queda.
    expect(previous).toBeGreaterThan(0);
  });

  it('o mergulho é de cabeça, desce sem voltar atrás e termina exatamente no pouso', () => {
    const {samples, anchor, arrival} = run({x: 0, y: 1, z: 0});
    const dive = samples.filter(s => s.phase === 'dive');
    expect(dive.length).toBeGreaterThan(200);
    for (let i = 1; i < dive.length; i++) expect(dive[i]!.altitude).toBeLessThan(dive[i - 1]!.altitude);
    // `dive` = 1 é o corpo virado de cabeça para baixo; a `CharacterVisual` roda π·dive.
    expect(dive[0]!.altitude).toBeGreaterThan(DESCENT_START_HEIGHT * 0.9);
    expect(dive[dive.length - 1]!.altitude).toBeLessThan(1);
    const recover = samples.filter(s => s.phase === 'recover');
    expect(recover.length).toBeGreaterThan(60);
    for (const sample of recover) {
      expect(Math.abs(sample.altitude)).toBeLessThan(1e-6);
      expect(sample.arc).toBeLessThan(1e-6);
    }
    expect(arrival.body).toBeUndefined();
    void anchor;
  });

  it('a orientação da queda vem da entrada autoral: π no topo, de pé ao levantar', () => {
    const anchor = frame.fromDirection({x: 0, y: -1, z: 0});
    const arrival = new PlanetArrival(frame);
    arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
    arrival.play();
    while (arrival.phase !== 'dive') arrival.update(STEP);
    const top = arrival.body!;
    expect(top.local.stride).toBeUndefined();
    expect(top.local.dive).toBeCloseTo(1, 6);
    expect(top.local.recovery).toBe(0);
    while (arrival.phase === 'dive') arrival.update(STEP);
    while (arrival.phase === 'recover') arrival.update(STEP);
    // Levantou: a rotação de mergulho já desfez e a recuperação chegou ao fim.
    expect(arrival.intro.flight.dive).toBeCloseTo(0, 6);
    expect(arrival.intro.flight.recovery).toBeCloseTo(1, 6);
  });

  it('a pose entregue à CharacterVisual é LOCAL e o pai radial a leva ao mundo', () => {
    const anchor = frame.fromDirection({x: 0, y: 0, z: -1});
    const arrival = new PlanetArrival(frame);
    arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
    arrival.play();
    for (let i = 0; i < 400; i++) {
      const body = arrival.body;
      if (!body) break;
      expect(distance(arrival.toWorld(body.local.position!), body.world)).toBeLessThan(1e-9);
      // O prólogo no deck manda clipe e orientação; o mergulho volta a ser o `MeteorArrival`.
      const prologue = body.phase === 'standby' || body.phase === 'run' || body.phase === 'leap';
      expect(body.local.stride !== undefined).toBe(prologue);
      if (prologue) expect(body.local.rootLift).toBe(0);
      arrival.update(STEP);
    }
  });
});

describe('PlanetArrival — câmera com vertical radial local', () => {
  it('a vertical do enquadramento é a radial do ponto da câmera, não a do pouso nem o +Y do mundo', () => {
    const anchor = frame.fromDirection({x: 1, y: 0, z: 0});
    const arrival = new PlanetArrival(frame);
    arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
    arrival.play();
    const anchorUp = frame.up(anchor);
    let sawTilt = false;
    for (let i = 0; i < 700; i++) {
      const shot = arrival.shot;
      if (!shot) break;
      expect(length(shot.up)).toBeCloseTo(1, 12);
      // Radial de verdade: o `up` é paralelo ao raio que passa pela câmera.
      expect(length(cross(shot.up, sub(shot.position, frame.centre)))).toBeLessThan(1e-6);
      for (const value of [shot.position.x, shot.position.y, shot.position.z, shot.target.x, shot.weight]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      if (distance(shot.up, anchorUp) > 1e-3) sawTilt = true;
      arrival.update(STEP);
    }
    // Do alto do deck a vertical local JÁ difere da do pouso: é por isso que ela é recalculada.
    expect(sawTilt).toBe(true);
  });

  it('o peso começa cheio, cai na recuperação e devolve a câmera ao jogo sem corte', () => {
    const anchor = frame.fromDirection({x: 0, y: 0, z: 1});
    const arrival = new PlanetArrival(frame);
    arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
    expect(arrival.shot!.weight).toBeCloseTo(1, 6);
    arrival.play();
    let last = 1;
    while (arrival.visible) {
      last = arrival.shot!.weight;
      expect(last).toBeGreaterThanOrEqual(0);
      expect(last).toBeLessThanOrEqual(1);
      arrival.update(STEP);
    }
    expect(last).toBeLessThan(0.05);
  });
});

describe('PlanetArrival — sinais de áudio e retenção das pragas', () => {
  it('passos no deck, salto, vento na queda, impacto e levantar, nessa ordem', () => {
    const {cues, risenAt, doneAt} = run({x: 0, y: 0, z: 1});
    expect(cues.filter(c => c === 'step')).toHaveLength(INTRO_RUN_STEPS);
    expect(cues.filter(c => c === 'launch')).toHaveLength(1);
    expect(cues.filter(c => c === 'impact')).toHaveLength(1);
    expect(cues.filter(c => c === 'rise')).toHaveLength(1);
    expect(cues.filter(c => c === 'wind').length).toBeGreaterThan(2);
    const order = ['step', 'launch', 'wind', 'impact', 'rise'];
    const seen = cues.filter((cue, index) => cues.indexOf(cue) === index);
    expect(seen).toEqual(order);
    // Levantar vem ANTES do fim da entrada, e o fim vem depois.
    expect(risenAt).toBeGreaterThan(0);
    expect(doneAt).toBeGreaterThan(risenAt);
  });

  it('nenhuma praga é liberada antes de o corpo levantar', () => {
    const anchor = frame.fromDirection({x: 0, y: 1, z: 0});
    const arrival = new PlanetArrival(frame);
    arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
    expect(arrival.holdsSpawns).toBe(true);
    arrival.play();
    let releasedBeforeRise = false, risen = false;
    for (let i = 0; i < 900; i++) {
      arrival.update(STEP, cue => {if (cue === 'rise') risen = true;});
      if (!risen && !arrival.holdsSpawns) releasedBeforeRise = true;
    }
    expect(risen).toBe(true);
    expect(releasedBeforeRise).toBe(false);
    expect(arrival.holdsSpawns).toBe(false);
    expect(arrival.released).toBe(true);
  });

  it('pular a entrada devolve o controle e as pragas sem deixar corpo no ar', () => {
    const anchor = frame.fromDirection({x: -1, y: 0, z: 0});
    const arrival = new PlanetArrival(frame);
    arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
    arrival.play();
    for (let i = 0; i < 90; i++) arrival.update(STEP);
    const cues: IntroCue[] = [];
    arrival.skip(cue => cues.push(cue));
    // Quem pula antes do chão ainda ouve o impacto: a chegada nunca fica sem resolução.
    expect(cues).toContain('impact');
    expect(arrival.holdsControl).toBe(false);
    expect(arrival.holdsSpawns).toBe(false);
    expect(arrival.visible).toBe(false);
    expect(arrival.body).toBeUndefined();
    expect(arrival.shot).toBeUndefined();
  });

  it('abortar e rearmar devolve tudo ao repouso, inclusive a retenção das pragas', () => {
    const anchor = frame.fromDirection({x: 0, y: 0, z: 1});
    const arrival = new PlanetArrival(frame);
    arrival.start(anchor, {heading: headingAt(frame.up(anchor))});
    arrival.play();
    for (let i = 0; i < 120; i++) arrival.update(STEP);
    arrival.abort();
    expect(arrival.visible).toBe(false);
    expect(arrival.holdsControl).toBe(false);
    expect(arrival.holdsSpawns).toBe(false);
    const next = frame.fromDirection({x: 0, y: -1, z: 0});
    arrival.start(next, {heading: headingAt(frame.up(next))});
    expect(arrival.standby).toBe(true);
    expect(arrival.holdsSpawns).toBe(true);
    expect(distance(arrival.anchor, next)).toBeLessThan(1e-9);
    expect(distance(arrival.up, frame.up(next))).toBeLessThan(1e-9);
  });
});

describe('PlanetArrival — a mesma chegada nos seis polos', () => {
  const reference = run(ISLAND_SLOTS[0]!.direction);

  for (const slot of ISLAND_SLOTS) {
    it(`polo ${slot.id}: base radial, geometria e sinais idênticos ao de referência`, () => {
      const anchor = frame.fromDirection(slot.direction);
      const arrival = new PlanetArrival(frame);
      const heading = headingAt(frame.up(anchor));
      arrival.start(anchor, {heading});

      // A base do desembarque é radial e ortonormal, sem polo especial.
      expect(distance(arrival.up, frame.up(anchor))).toBeLessThan(1e-12);
      expect(Math.abs(dot(arrival.up, arrival.reference))).toBeLessThan(1e-12);
      expect(length(arrival.reference)).toBeCloseTo(1, 12);
      expect(distance(arrival.toWorld({x: 0, y: 0, z: 0}), anchor)).toBeLessThan(1e-12);
      // A transformação preserva comprimento: nada de corpo esticado num polo.
      expect(distance(arrival.toWorld({x: 3, y: -4, z: 12}), anchor)).toBeCloseTo(13, 9);

      const actual = run(slot.direction);
      expect(actual.phases).toEqual(reference.phases);
      expect(actual.cues).toEqual(reference.cues);
      expect(actual.samples).toHaveLength(reference.samples.length);
      expect(actual.risenAt).toBe(reference.risenAt);
      expect(actual.doneAt).toBe(reference.doneAt);
      for (const [index, sample] of actual.samples.entries()) {
        const want = reference.samples[index]!;
        expect(sample.phase).toBe(want.phase);
        // Corpo e câmera ocupam a MESMA posição relativa ao pouso em qualquer polo.
        expect(sample.altitude).toBeCloseTo(want.altitude, 6);
        expect(sample.arc).toBeCloseTo(want.arc, 6);
        expect(sample.cameraAltitude).toBeCloseTo(want.cameraAltitude, 6);
        expect(sample.cameraArc).toBeCloseTo(want.cameraArc, 6);
      }
    });
  }
});
