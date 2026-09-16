// Monta o foley COMPARTILHADO (passos, água, swish, impactos, sino, pistola) a partir dos pacotes
// em art/source. Os sons de inimigo NÃO saem mais daqui: quem manda neles é
// scripts/prepare-enemy-audio.py, que usa gravações orgânicas licenciadas.
//
// Duas mudanças em relação à versão original, para não desfazer a substituição que o usuário pediu:
//  1. os grupos de voz de monstro (growl/attack/death/spawn/hurt) e o `heavy` de impactSoft_heavy
//     saíram — esse material foi auditado e recusado no estúdio;
//  2. o manifest é MESCLADO, não sobrescrito, senão os grupos `enemy-*`, `rain` e os substitutos
//     desapareceriam a cada execução.
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const MANIFEST='public/audio/foley-manifest.json';
const bank={};mkdirSync('public/audio/foley',{recursive:true});
function add(group,source,name){const path=`foley/${name}`;copyFileSync(source,`public/audio/${path}`);(bank[group]??=[]).push(`/audio/${path}`);}
for(const surface of ['grass','wood','concrete'])for(let i=0;i<5;i++)add(surface,`art/source/foley-impact/Audio/footstep_${surface}_00${i}.ogg`,`${surface}-${i}.ogg`);
for(let i=1;i<=6;i++)add('water',`art/source/foley-water/ezwa-water_splash/water_splash-0${i}.flac`,`water-${i}.flac`);
for(let i=1;i<=6;i++)add('swish',`art/source/foley-swish/swosh-0${i}.flac`,`swish-${i}.flac`);
for(let i=0;i<4;i++){add('impact',`art/source/foley-impact/Audio/impactSoft_medium_00${i}.ogg`,`impact-${i}.ogg`);add('charge',`art/source/foley-impact/Audio/impactBell_heavy_00${i}.ogg`,`charge-${i}.ogg`);}
bank.pistol=[1,2,3,4].map(i=>`/audio/pistol-${i}.wav`);
const current=existsSync(MANIFEST)?JSON.parse(readFileSync(MANIFEST,'utf8').replace(/^﻿/,'')):{};
writeFileSync(MANIFEST,`${JSON.stringify({...current,...bank},null,2)}\n`);
writeFileSync('docs/foley-sources.json',JSON.stringify([{author:'Kenney',license:'CC0',url:'https://kenney.nl/assets/impact-sounds',use:'Grass, wood, concrete footsteps, impacts and bells'},{author:'qubodup',license:'CC0',url:'https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes',use:'Recorded bamboo air swishes for dodge and skill motion'},{author:'ezwa / qubodup',license:'CC0',url:'https://opengameart.org/content/6-short-water-splashes',use:'Water footsteps and splashes'},{author:'Tabasco',license:'CC0',url:'https://opengameart.org/content/gunshot-sounds',use:'Recorded CZ pistol shots'}],null,2));console.log(Object.fromEntries(Object.entries(bank).map(([k,v])=>[k,v.length])));
