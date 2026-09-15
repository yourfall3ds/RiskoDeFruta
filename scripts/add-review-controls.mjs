import {readFileSync,writeFileSync} from 'node:fs';const edit=(p,a,b)=>{let s=readFileSync(p,'utf8');if(!s.includes(a))throw Error(p+' missing '+a.slice(0,35));writeFileSync(p,s.replace(a,b));};
edit('src/debug/DebugOverlay.ts',"['barn','Ir ao celeiro']", "['ferry','Ir à ilha móvel'],['review-cliff','Revisar encosta'],['normal-horde','Horda normal (24)'],['barn','Ir ao celeiro']");
edit('src/game/PlayerScene.ts',"if(name==='barn')", "if(name==='ferry'){this.player.resetAt({x:-21,y:0,z:-8});this.input.yaw=-Math.PI/2;this.input.pitch=.10;}\n    if(name==='review-cliff'){this.player.resetAt({x:9,y:0,z:12});this.input.yaw=-.28;this.input.pitch=-.09;}\n    if(name==='barn')");
edit('src/game/PlayerScene.ts',"if(name==='review-enemies')", "if(name==='normal-horde'){this.enemies.nextStage();this.enemies.director.stopped=true;this.enemies.populationCap=24;this.enemies.benchmark=false;for(let i=0;i<24;i++){const angle=i/24*Math.PI*2,p={x:Math.sin(angle)*15,y:0,z:Math.cos(angle)*17};const at=this.enemies.tactical?.closest(p);if(at)this.enemies.spawn((['eggplant','corn','watermelon','tomato','carrot'] as const)[i%5]!,at,'normal');}}\n      if(name==='review-enemies')");
edit('src/ui/PlayerHUD.ts','music:(enabled:boolean)=>void;','');
edit('src/ui/PlayerHUD.ts','<label><input aria-label="Música" type="checkbox" checked> Música</label>','');
edit('src/ui/PlayerHUD.ts',"options.querySelector<HTMLInputElement>('input[type=checkbox]')!.onchange=e=>settings?.music((e.target as HTMLInputElement).checked);",'');
edit('src/game/PlayerScene.ts','music:enabled=>this.audio.music=enabled,','');
