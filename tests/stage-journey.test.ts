import {describe,it,expect} from 'vitest';
import {StageJourney,JOURNEY_HARVEST_SECONDS,JOURNEY_BOARD_SECONDS,JOURNEY_MIN_TRAVEL_SECONDS,JOURNEY_RETRY_SECONDS,type JourneyCue} from '../src/stages/StageJourney';

function run(journey:StageJourney,seconds:number,cues:JourneyCue[]=[]):JourneyCue[] {
  for(let i=0;i<Math.round(seconds*60);i++)journey.update(1/60,cue=>cues.push(cue));
  return cues;
}

describe('conclusão do estágio: suco, embarque, viagem e chegada',()=>{
  it('percorre as etapas, congela o jogo e pede o destino uma única vez',()=>{
    const journey=new StageJourney(),cues:JourneyCue[]=[];
    expect(journey.active).toBe(false);
    expect(journey.holdsControl).toBe(false);
    expect(journey.begin(3,'Bosque das raízes')).toBe(true);
    expect(journey.phase).toBe('harvest');
    expect(journey.fromStage).toBe(3);
    expect(journey.destination).toBe('Bosque das raízes');
    // Nada de carregamento antes do embarque terminar.
    run(journey,JOURNEY_HARVEST_SECONDS-.1,cues);
    expect(journey.takeLoadRequest()).toBe(false);
    run(journey,.2,cues);
    expect(journey.phase).toBe('board');
    expect(journey.holdsControl).toBe(true);
    run(journey,JOURNEY_BOARD_SECONDS,cues);
    expect(journey.phase).toBe('travel');
    expect(journey.waiting).toBe(true);
    // O pedido sai uma vez; repetir a leitura no mesmo quadro não dispara outro carregamento.
    expect(journey.takeLoadRequest()).toBe(true);
    expect(journey.takeLoadRequest()).toBe(false);
    expect(journey.attempts).toBe(1);
    // Sem rota carregada a viagem não termina, por mais que o relógio avance.
    run(journey,30,cues);
    expect(journey.phase).toBe('travel');
    expect(journey.takeArrival()).toBe(false);
    journey.routeReady();
    expect(journey.waiting).toBe(false);
    run(journey,JOURNEY_MIN_TRAVEL_SECONDS+.1,cues);
    expect(journey.phase).toBe('arrival');
    expect(journey.holdsControl).toBe(false); // a partir daqui quem segura é a entrada pela nave
    expect(cues).toEqual(['board','launch','arrive']);
  });

  it('avança o estágio e aplica o plano exatamente uma vez por viagem',()=>{
    const journey=new StageJourney();
    journey.begin(1,'Fronteira solar');
    expect(journey.consumeAdvance()).toBe(true);
    expect(journey.consumeAdvance()).toBe(false);
    run(journey,JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+.1);
    journey.takeLoadRequest();journey.routeReady();
    run(journey,JOURNEY_MIN_TRAVEL_SECONDS+.1);
    expect(journey.takeArrival()).toBe(true);
    expect(journey.takeArrival()).toBe(false);
    // Repetir quadros na chegada não reabre nenhum portão.
    run(journey,5);
    expect(journey.takeArrival()).toBe(false);
    expect(journey.consumeAdvance()).toBe(false);
  });

  it('recusa uma segunda viagem enquanto a primeira não termina',()=>{
    const journey=new StageJourney();
    expect(journey.begin(2,'Campos altos')).toBe(true);
    expect(journey.begin(2,'Campos altos')).toBe(false);
    expect(journey.begin(9,'Outro')).toBe(false);
    expect(journey.fromStage).toBe(2);
    run(journey,JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+.1);
    expect(journey.begin(2,'Campos altos')).toBe(false);
  });

  it('uma falha de carregamento espera, anuncia e tenta de novo sem avançar nada',()=>{
    const journey=new StageJourney();
    journey.begin(1,'Fronteira solar');
    expect(journey.consumeAdvance()).toBe(true);
    run(journey,JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+.1);
    expect(journey.takeLoadRequest()).toBe(true);
    journey.routeFailed('A região Fronteira solar não carregou');
    expect(journey.failed).toBe(true);
    expect(journey.phase).toBe('travel');
    expect(journey.detail).toContain('não carregou');
    expect(journey.detail).toContain('progresso está guardado');
    expect(journey.retryIn).toBeGreaterThan(0);
    // A chegada continua fechada e o avanço NÃO se repete durante a falha.
    run(journey,JOURNEY_RETRY_SECONDS-.2);
    expect(journey.takeArrival()).toBe(false);
    expect(journey.consumeAdvance()).toBe(false);
    expect(journey.takeLoadRequest()).toBe(false);
    run(journey,.4);
    expect(journey.failed).toBe(false);
    expect(journey.takeLoadRequest()).toBe(true);
    expect(journey.attempts).toBe(2);
    journey.routeReady();
    run(journey,JOURNEY_MIN_TRAVEL_SECONDS+.1);
    expect(journey.takeArrival()).toBe(true);
  });

  it('o jogador pode antecipar a nova tentativa',()=>{
    const journey=new StageJourney();
    journey.begin(1,'Fronteira solar');
    run(journey,JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+.1);
    journey.takeLoadRequest();journey.routeFailed('sem rota');
    expect(journey.retryNow()).toBe(true);
    run(journey,1/60);
    expect(journey.takeLoadRequest()).toBe(true);
    expect(journey.failed).toBe(false);
    // Fora de uma falha o pedido manual não faz nada.
    expect(journey.retryNow()).toBe(false);
  });

  it('uma rota já pronta ignora uma falha tardia',()=>{
    const journey=new StageJourney();
    journey.begin(1,'Fronteira solar');
    run(journey,JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+.1);
    journey.takeLoadRequest();journey.routeReady();
    journey.routeFailed('resposta atrasada de uma tentativa anterior');
    expect(journey.failed).toBe(false);
    run(journey,JOURNEY_MIN_TRAVEL_SECONDS+.1);
    expect(journey.phase).toBe('arrival');
  });

  it('a chegada sem plano volta à viagem em vez de avançar de estágio',()=>{
    const journey=new StageJourney();
    journey.begin(1,'Fronteira solar');
    journey.consumeAdvance();
    run(journey,JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+.1);
    journey.takeLoadRequest();journey.routeReady();
    run(journey,JOURNEY_MIN_TRAVEL_SECONDS+.1);
    expect(journey.takeArrival()).toBe(true);
    journey.returnToTravel('Plano do destino perdido');
    expect(journey.phase).toBe('travel');
    expect(journey.failed).toBe(true);
    expect(journey.consumeAdvance()).toBe(false);
    run(journey,JOURNEY_RETRY_SECONDS+.1);
    expect(journey.takeLoadRequest()).toBe(true);
  });

  it('a chegada termina quando a entrada pela nave acaba e o reinício zera tudo',()=>{
    const journey=new StageJourney();
    journey.begin(4,'Cidade agrícola');
    run(journey,JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS+.1);
    journey.takeLoadRequest();journey.routeReady();
    run(journey,JOURNEY_MIN_TRAVEL_SECONDS+.1);
    journey.takeArrival();journey.consumeAdvance();
    journey.arrived();
    expect(journey.phase).toBe('done');
    expect(journey.active).toBe(false);
    expect(journey.progress).toBe(1);
    journey.reset();
    expect(journey.phase).toBe('idle');
    expect(journey.destination).toBe('');
    expect(journey.attempts).toBe(0);
    expect(journey.holdsControl).toBe(false);
    expect(journey.label).toBe('');
    // Depois do reinício uma nova viagem é permitida de novo.
    expect(journey.begin(1,'Fronteira solar')).toBe(true);
  });

  it('o andamento cresce sem retroceder e ignora tempos inválidos',()=>{
    const journey=new StageJourney();
    expect(journey.progress).toBe(0);
    journey.begin(1,'Fronteira solar');
    let last=journey.progress;
    for(let i=0;i<Math.round((JOURNEY_HARVEST_SECONDS+JOURNEY_BOARD_SECONDS)*60)+6;i++){
      journey.update(1/60);
      expect(journey.progress).toBeGreaterThanOrEqual(last-1e-9);
      last=journey.progress;
    }
    const frozen=journey.phase;
    journey.update(Number.NaN);journey.update(-1);
    expect(journey.phase).toBe(frozen);
    expect(journey.progress).toBeLessThanOrEqual(1);
  });
});
