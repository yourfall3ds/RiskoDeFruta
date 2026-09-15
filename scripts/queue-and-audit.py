from pathlib import Path
p=Path('src/combat/SkillTimeline.ts');s=p.read_text(encoding='utf-8').replace('duration=SKILL_CUES[tier].voiceEnd','duration:number=SKILL_CUES[tier].voiceEnd');p.write_text(s,encoding='utf-8')
p=Path('src/game/PlayerScene.ts');s=p.read_text(encoding='utf-8');s=s.replace('private poseReview=false;',"private cameraAudit='';private poseReview=false;");s=s.replace("    if(name==='element-off')", "    if(name==='camera-audit'){const ray=this.camera.camera.getForwardRay(8),hit=this.scene.pickWithRay(ray,m=>m.isEnabled()&&m.isVisible&&m.getTotalVertices()>0);this.cameraAudit='Câmera '+this.camera.camera.position.toString()+' · centro '+(hit?.pickedMesh?.name??'vazio')+' · material '+hit?.pickedMesh?.material?.name+' · distância '+hit?.distance;}\n    if(name==='element-off')");s=s.replace('player:`Posição ', 'player:`${this.cameraAudit}\\nPosição ');p.write_text(s,encoding='utf-8')
p=Path('src/debug/DebugOverlay.ts');s=p.read_text(encoding='utf-8').replace("[['element-fire'", "[['camera-audit','Auditar obstrução da câmera'],['element-fire'");p.write_text(s,encoding='utf-8')
p=Path('docs/OBJECTIVES_QUEUE.md');s=p.read_text(encoding='utf-8')+'''\n## Novos pedidos — combate, recompensa e entrada
- [ ] Melhorar animação dos disparos básicos com alternância, recuo e recuperação do corpo.
- [ ] Recarga mais ágil, mantendo a câmera de gameplay.
- [ ] Melhorar áudio dos inimigos e de seus ataques com gravações.
- [ ] Recompensa da horda ejetada no centro da fase e concedida somente ao recolher.
- [ ] Menu Press Start com carregamento por trás e entrada do jogador como meteoro, impacto no solo e liberação do controle somente após chegada.
''';p.write_text(s,encoding='utf-8')
