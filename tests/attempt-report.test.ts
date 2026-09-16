import {it,expect} from 'vitest';
import {EventBus} from '../src/core/EventBus';
import type {GameEvents} from '../src/core/contracts';
import {RunProgression} from '../src/run/RunProgression';
import {attemptSummary,attemptScore,SCORE_PER_MILESTONE,SCORE_PER_KILL,SCORE_PER_ITEM,SCORE_PER_STAGE,SCORE_BOSS} from '../src/run/AttemptSummary';
import {modeBrief} from '../src/ui/CombatHUD';

const run=()=>{const r=new RunProgression(new EventBus<GameEvents>());r.addItem('feather');r.addItem('feather');r.addItem('fire');r.time=212;r.stage=2;return r;};

it('scores the expedition by real milestones instead of horde counters',()=>{
 const progression=run();for(let i=0;i<7;i++)progression.reward();
 const summary=attemptSummary(progression,1,0,{mode:'expedition',completed:3,total:4,phase:'totems',bossDefeated:false});
 const score=attemptScore(summary);
 expect(score.progressLabel).toBe('CÁLICE CHEIO');
 expect(score.progress).toBe(3*SCORE_PER_MILESTONE);
 expect(score.kills).toBe(summary.kills*SCORE_PER_KILL);
 expect(score.items).toBe(3*SCORE_PER_ITEM);
 expect(score.time).toBe(212);
 expect(score.stage).toBe(SCORE_PER_STAGE);
 expect(score.boss).toBe(0);
 expect(score.total).toBe(score.kills+score.progress+score.items+score.time+score.stage);
 // Zero marcos não some com o resto da pontuação.
 const none=attemptScore(attemptSummary(progression,1,0,{mode:'expedition',completed:0,total:4,phase:'totems'}));
 expect(none.progress).toBe(0);
 expect(none.total).toBeGreaterThan(0);
});

it('rewards reaching the Alpha Blight and crossing the rift',()=>{
 const progression=run();
 const beaten=attemptScore(attemptSummary(progression,1,0,{mode:'expedition',completed:4,total:4,phase:'extract',bossDefeated:true}));
 const stalled=attemptScore(attemptSummary(progression,1,0,{mode:'expedition',completed:4,total:4,phase:'boss',bossDefeated:false}));
 expect(beaten.boss).toBe(SCORE_BOSS);
 expect(beaten.total-stalled.total).toBe(SCORE_BOSS);
});

it('keeps the legacy horde mode scoring untouched',()=>{
 const progression=run();
 const summary=attemptSummary(progression,9,8,{mode:'horde'});
 const score=attemptScore(summary);
 expect(score.progressLabel).toBe('HORDAS VENCIDAS');
 expect(score.progress).toBe(8*SCORE_PER_MILESTONE);
 // A fórmula antiga — 100/abate + 500/horda + 75/item + 1/segundo — continua valendo no modo horda.
 expect(score.kills+score.progress+score.items+score.time).toBe(summary.kills*100+8*500+3*75+212);
 // O padrão de `attemptSummary` continua sendo o modo horda, para quem não passa objetivos.
 expect(attemptSummary(progression,9,8).objectives).toEqual({mode:'horde'});
});

it('writes TAB copy for the mode that is actually running',()=>{
 const expedition=modeBrief(true,false),horde=modeBrief(false,true),classic=modeBrief(false,false);
 expect(expedition).toContain('cálice');
 expect(expedition).toContain('suco');
 expect(expedition).toContain('Praga Alfa');
 // Nada de prometer chefe a cada cinco ondas fora do modo horda.
 expect(expedition).not.toContain('cinco ondas');
 expect(classic).not.toContain('cinco ondas');
 expect(horde).toContain('cinco ondas');
 expect(new Set([expedition,horde,classic]).size).toBe(3);
});
