import fs from 'node:fs';
function edit(path,fn){const old=fs.readFileSync(path,'utf8');const next=fn(old);if(next===old)throw Error(`No change: ${path}`);fs.writeFileSync(path,next);}
edit('src/run/RunInteractables.ts',s=>{
 s="import {LootDrops} from './LootDrops';\nimport type {CollisionWorld} from '../physics/CollisionWorld';\n"+s;
 s=s.replace('offers:ItemDefinition[];','loot?:ItemDefinition;ejected?:boolean;');
 s=s.replace('private container:AssetContainer|undefined;', 'readonly drops:LootDrops;\n  get nearestLoot(){return this.drops.nearest(this.player.position);}\n  private container:AssetContainer|undefined;');
 s=s.replace('private readonly rng:RandomStream){','private readonly rng:RandomStream,world:CollisionWorld){\n    this.drops=new LootDrops(scene,world);');
 s=s.replace(/const offers:ItemDefinition\[\]=\[\];while\(offers.length<\(kind==='shop'\?3:1\)\)\{.*?\}this.entries.push/, 'this.entries.push');
 s=s.replace("'Mercado de campo'","'Baú reforçado'").replace('used:false,offers','used:false');
 s=s.replace("i<(entry.kind==='shop'?3:1)", 'i<1');
 s=s.replace("if(entry.kind==='shop'&&child instanceof TransformNode)child.position.z+=(i-1)*1.15;",'');
 s=s.replace('this.lid(e,e.opening);}', 'this.lid(e,e.opening);if(e.opening>=.4&&e.loot&&!e.ejected){this.drops.eject(e.loot,{x:e.x,y:e.y,z:e.z},this.player.position);e.ejected=true;}}this.drops.update(dt);');
 const a=s.indexOf('  reset():void'),b=s.indexOf('  get atRift',a);
 s=s.slice(0,a)+`  reset():void {this.drops.clear();this.nearest=undefined;this.messageTime=0;for(const e of this.entries){e.used=false;e.opening=0;delete e.loot;e.ejected=false;this.lid(e,0);e.cost=Math.round((e.kind==='altar'?25:e.kind==='shop'?45:30)*(1+(this.run.stage-1)*.3));}this.rift.setEnabled(false);}\n`+s.slice(b);
 const c=s.indexOf('  buy('),d=s.indexOf('  dispose()',c);
 s=s.slice(0,c)+`  buy(_option=0):boolean {
    const collected=this.drops.take(this.player.position);
    if(collected){this.run.addItem(collected.id);this.message=collected.name+' recolhido';this.messageTime=3;return true;}
    const entry=this.nearest;
    if(!entry||entry.used||Math.hypot(entry.x-this.player.position.x,entry.z-this.player.position.z)>=3||Math.abs(entry.y-this.player.position.y)>=2)return false;
    if(this.run.credits<entry.cost){this.message='Créditos insuficientes';this.messageTime=2;return false;}
    this.run.credits-=entry.cost;
    if(entry.kind==='altar'){entry.cost=Math.ceil(entry.cost*1.6);if(this.rng.next()<.58){const item=this.run.randomItem(this.rng);this.drops.eject(item,{x:entry.x,y:entry.y,z:entry.z},this.player.position);this.message='O altar concedeu um item';}else this.message='O altar consumiu a oferta';}
    else{entry.used=true;entry.opening=0;entry.ejected=false;entry.loot=this.run.randomItem(this.rng);this.message='Baú aberto · recolha o item quando cair';}
    this.events.emit('InteractableUsed',{entityId:1,interactableId:entry.id});this.messageTime=3;return true;
  }
`+s.slice(d);
 s=s.replace('this.disposed=true;for(const e', 'this.disposed=true;this.drops.dispose();for(const e');return s;
});
edit('src/game/PlayerScene.ts',s=>s.replace("rng.stream('interactable'))", "rng.stream('interactable'),collision)"));
edit('src/ui/CombatHUD.ts',s=>{
 s=s.replace('const entry=interact.nearest,box=', 'const entry=interact.nearest,loot=interact.nearestLoot,box=').replace('box.hidden=!entry&&', 'box.hidden=!entry&&!loot&&');
 const a=s.indexOf('  box.innerHTML='),b=s.indexOf('\n',a);
 return s.slice(0,a)+`  box.innerHTML=swarm.bossDeadTime>=5&&interact.atRift?'<b>[E] ATRAVESSAR A FENDA</b><span>Créditos restantes viram XP.</span>':loot?\`<b><i class="item-icon" style='\${perkIcon(loot.item.icon)}'></i>\${loot.item.name}</b><span>\${loot.item.description}</span><span>[E] Recolher item</span>\`:entry?\`<b>\${entry.name} · ◈ \${entry.cost}</b><span>[E] \${entry.kind==='altar'?'Oferecer créditos · 58% de chance':'Abrir · item aleatório'}</span>\`:'';`+s.slice(b);
});
edit('src/ui/PlayerHUD.ts',s=>s.replace('compre melhorias','recolha melhorias').replace('E / 1–3</kbd> Interagir / escolher','E</kbd> Abrir / recolher'));
edit('src/input/GameInput.ts',s=>s.replace(/\s*if\(!e.repeat&&\/\^Digit\[123\]\$\/.test\(e.code\)\)this.interaction=Number\(e.code.slice\(-1\)\)-1;/,''));
const path='public/models/farm-collision.json',map=JSON.parse(fs.readFileSync(path,'utf8'));
for(const box of map.boxes.filter(b=>b.id.includes('interactive-chest'))){const z=(box.min.z+box.max.z)/2;box.min.z=z-.43;box.max.z=z+.43;}
fs.writeFileSync(path,JSON.stringify(map));
fs.appendFileSync('docs/OBJECTIVES_QUEUE.md', '\n## Correção dos baús — sorteio e coleta no mundo\n\n- [ ] Remover escolhas e entrega imediata. Cada baú sorteia um único item ao abrir, anima a tampa, ejeta o PNG RGBA e mantém o item girando no chão até a coleta com E. Validar cobrança e coleta únicas, transparência e chão real.\n');
