export type EnemyVariant='normal'|'golden'|'giant'|'charged';
export const ENEMY_AFFIXES={
 normal:{label:'',health:1,damage:1,speed:1,scale:1,armor:0,gold:1,color:''},
 golden:{label:'DOURADO',health:1.5,damage:1,speed:1,scale:1.08,armor:100,gold:4,color:'#ffd45c'},
 giant:{label:'GIGANTE ×3',health:3,damage:3,speed:3,scale:1.6,armor:0,gold:3,color:'#cf8260'},
 charged:{label:'SOBRECARREGADO',health:1.4,damage:2,speed:1.15,scale:1.05,armor:0,gold:2,color:'#c57aff'},
} as const;
export function chooseVariant(random:number,seconds:number):EnemyVariant {if(seconds<35)return'normal';return random<.07?'giant':random<.16?'golden':random<.24?'charged':'normal';}
