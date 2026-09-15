from pathlib import Path
p=Path('index.html');s=p.read_text(encoding='utf-8');s=s.replace('  <body>', '''  <body>
    <div id="boot-menu" style="position:fixed;inset:0;z-index:9999;display:grid;place-content:center;text-align:center;background:#09151c;color:#e8ecd6;font:16px system-ui"><small style="letter-spacing:.35em">EXTERMINATION DIVISION</small><h1 style="font-size:clamp(42px,8vw,90px);margin:.2em">MUTANT FARM</h1><p role="status">Preparando a descida…</p></div>''');p.write_text(s,encoding='utf-8')
p=Path('src/ui/PlayerHUD.ts');s=p.read_text(encoding='utf-8');s=s.replace('document.body.append(this.element);','document.body.append(this.element);document.getElementById(\'boot-menu\')?.remove();document.body.classList.add(\'game-menu-open\');')
s=s.replace("this.button.onclick=()=>{this.setActive(true);start();};", "this.button.onclick=()=>{this.setActive(true);start();};this.gateKey=event=>{if(event.code==='Enter'&&!this.button.disabled&&!this.gate.hidden){event.preventDefault();this.button.click();}};window.addEventListener('keydown',this.gateKey);")
s=s.replace('private entered=false;', 'private readonly gateKey:(event:KeyboardEvent)=>void;private entered=false;');s=s.replace("this.button.textContent='ENTRAR NO CAMPO →'", "this.button.textContent='PRESS START · JOGAR' ");s=s.replace('setActive(active: boolean): void {this.gate.hidden=active;', "setActive(active: boolean): void {document.body.classList.toggle('game-menu-open',!active);this.gate.hidden=active;")
s=s.replace('this.dead=true;this.gate.hidden=false;', "this.dead=true;this.gate.hidden=false;document.body.classList.add('game-menu-open');")
s=s.replace('dispose(): void {this.element.remove();}', "dispose(): void {window.removeEventListener('keydown',this.gateKey);document.body.classList.remove('game-menu-open');this.element.remove();}")
s=s.replace('Cada onda vencida concede um item aleatório que acumula poder.', 'Ao vencer cada onda, recolha no centro um item aleatório para acumular poder.')
p.write_text(s,encoding='utf-8')
p=Path('src/style.css');s=p.read_text(encoding='utf-8')+'''
/* An opaque title screen stays above scene assembly and GPU warmup. */
.game-menu-open #game{visibility:hidden}.game-menu-open #status,.game-menu-open #player-hud>:not(.play-gate),.game-menu-open .run-hud{visibility:hidden}
.play-gate{z-index:100;background:linear-gradient(90deg,#07151af5 0%,#07151adb 44%,#08151a45 100%),url('/environment/cosmic-sky-v2.png') center/cover no-repeat;background-color:#09151c;backdrop-filter:none;isolation:isolate}
.play-gate:before{content:'';position:absolute;width:55vw;height:55vw;right:-10vw;top:-15vw;border-radius:50%;border:1px solid #7fffdc24;box-shadow:0 0 120px #4b75a828,inset 0 0 90px #7ecbbf14;pointer-events:none;animation:menu-orbit 28s linear infinite;will-change:transform}
@keyframes menu-orbit{to{transform:rotate(360deg) translateX(12px)}}
.start-play{min-width:260px;letter-spacing:.12em;padding:16px 24px;font-weight:800}.start-play:disabled{cursor:progress;opacity:.65}.gate-card{position:relative;z-index:1}.gate-card h1{font-weight:900;line-height:.94;text-shadow:0 6px 35px #0008}
''';p.write_text(s,encoding='utf-8')
p=Path('src/animation/CharacterVisual.ts');s=p.read_text(encoding='utf-8');s=s.replace('reloadProgress=-1;', 'arrivalPose:{height:number;recovery:number}|undefined;reloadProgress=-1;')
s=s.replace('    if(this.reloadProgress>=0)', "    if(this.arrivalPose){this.root.position.y+=this.arrivalPose.height;this.machine.sample(this.arrivalPose.height>0?'Jump':'Land',this.arrivalPose.height>0?.6:.82+this.arrivalPose.recovery*.18,dt,()=>true,this.arrivalPose.height>0?'Jump':'Jump');this.root.computeWorldMatrix(true);return;}\n    if(this.reloadProgress>=0)")
p.write_text(s,encoding='utf-8')
p=Path('src/game/PlayerScene.ts');s=p.read_text(encoding='utf-8');s="import {MeteorArrival} from '../player/MeteorArrival';\n"+s;s=s.replace('private started=false;', 'private started=false;private readonly arrival=new MeteorArrival();private hasArrived=false;private warming=false;')
s=s.replace("this.started=true;this.audio.unlock();", "this.started=true;if(!this.hasArrived){this.hasArrived=true;this.arrival.start();}this.audio.unlock();")
s=s.replace('if(this.poseReview||this.paused', 'if(this.arrival.active||this.poseReview||this.paused')
s=s.replace('const worldDt=this.cinematic.preparing||this.skillPending?0:animDt;', 'const worldDt=this.arrival.active||this.cinematic.preparing||this.skillPending?0:animDt;')
s=s.replace('    this.visual.update(this.player,alpha,animDt,', '''    this.arrival.update(animDt,()=>{this.elements.aura('fire',[],0,0);this.elements.emit('explosion',this.visual.position,1.3);this.elements.emit('earth',this.visual.position,1.5);this.footing.impactCracks(this.player.position);this.audio.impact(true);this.audio.skill('meteor-impact');this.camera.hurt(.10,1);});
    this.visual.arrivalPose=this.arrival.active?{height:this.arrival.height,recovery:this.arrival.recovery}:undefined;
    this.visual.update(this.player,alpha,animDt,''')
s=s.replace('    this.elements.update(this.poseReview?0:animDt);', "    this.elements.update(this.poseReview?0:animDt);if(this.arrival.active&&this.arrival.height>0)this.elements.aura('fire',[this.visual.position.add(new Vector3(0,this.arrival.height+.7,0))],this.arrival.elapsed,1);")
s=s.replace('this.scene.physicsEnabled=this.started&&!this.paused', 'this.scene.physicsEnabled=this.started&&!this.paused&&!this.arrival.active')
s=s.replace("if(name.startsWith('pose-skill')){", "if(name.startsWith('pose-skill')){this.arrival.active=false;")
s=s.replace('this.hud.ready();}', "{if(this.warming)return;this.warming=true;this.scene.executeWhenReady(()=>{if(!this.disposed)this.hud.ready();});}}")
p.write_text(s,encoding='utf-8')
