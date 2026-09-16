# Validação do jogo original no planeta

Estado: integração em andamento; esta lista é critério de aceite, não declaração de entrega.
Referência anterior à integração: commit 79ceff0, PlayerScene (modo original).

## Mecânicas que devem permanecer

- [ ] Mesmo PlayerScene, DualPistols e EnemySwarm na esfera; sem substitutos simplificados.
- [ ] Rolamento: duas cargas, distância, recarga, colisão e invulnerabilidade originais.
- [ ] Dash por toque duplo; salto, salto extra por item, movimento aéreo e recuperação segura.
- [ ] Tiro alternado, cadência, munição, recarga, mira acompanhando mouse e impacto.
- [ ] Três skills, carregamento de MP, custos, cargas adicionais e continuação.
- [ ] MP recebido por acerto em inimigo; cenário e disparo no vazio não geram MP.
- [ ] Guardar armas, socos/chutes, combos, animações e sons originais.
- [ ] Inimigos com HP, barras sem nome/número, ataques, dano, reações e mortes originais.
- [ ] Diretor, afixos, chefe, fragmentos de fruta e efeitos elementais.
- [ ] Todos os itens, modificadores, procs, baús, créditos e recompensas.
- [ ] Cálice distante, exploração, horda final, chefe, coleta de suco e extração.
- [ ] Próximo estágio mantém inventário e progressão.
- [ ] HUD completo, atributos, relatório de morte, intro, clima e áudio.
- [ ] Árvores, pedras e estruturas sólidas; 520 objetos destrutíveis preservados.
- [ ] Gravidade, câmera, tiros, inimigos e efeitos corretos nos seis lados da esfera.
- [ ] Modo anterior preservado para comparação e rede existente sem regressão.

## Evidência obtida antes da integração

- 152 testes de referência passaram (combate, MP, itens, progressão, etapas, intro, morte e clima).
- Manifesto atual: 38 ilhas, 48 pontes; auditoria anterior de travessia 96/96.
- Quebra de árvore e caixa verificada por tiros reais na prévia. Isto NÃO valida o combate original no planeta.

## Verificação final necessária

Rodar typecheck, build, testes originais e novos testes radiais; depois comparar partidas reais no navegador. Testes de função isolada não bastam para marcar a integração visual como concluída. Registrar regressões e limitações concretas; não retirar recursos para obter uma aprovação artificial.

### Referência visual conferida nesta sessão
Navegador, modo original, seed original-parity-reference: entrada cinematográfica chegou à partida; HUD mostra I/II/III, MP, HP, munição, esquiva e exploração. Tecla V alternou para CORPO A CORPO / COMBO; Shift consumiu uma das duas cargas (◆ ◆ → ◆ ◇). Inimigo visível expõe HP na acessibilidade. Esta verificação ainda é do modo original; falta repeti-la na esfera integrada.

### Pouso e arena no manifesto real
Auditoria com SphereSurface + funções originais de StageSpawn/ExpeditionObjectives: pouso seguro encontrado em 38/38 ilhas; arena de cálice de raio6,5m em16/38. Ainda falta validar sorteio do par, distância de rota e a experiência da chegada no navegador.

### Travessia com o motor original
Auditoria original PlayerMotor, manifesto real de1.750.828 triângulos:96/96 rotas concluídas nas48 pontes em ambos sentidos; nenhuma recuperação por queda, apoio>=90%, folga de pé/piso<=0,35m. A anterior auditoria só do PlanetMotor não foi usada como substituto desta.
### Partida integrada no navegador (16/09/2026)
URL de QA: `?world=planet&replay=1&seed=original-planet-parity`.
- HUD completo visível (HP, MP, três skills, munição, esquivas, exploração).
- V guardou armas; Shift executou rolamento e consumiu uma carga.
- Tiro real: contador 1 disparo/1 acerto no inimigo; skills I/II/III acionadas pelos controles QA, com suas apresentações originais. Acertos subiram a81, houve créditos e nível2.
- Barras de inimigos e HP na acessibilidade; nenhum erro/warning de console capturado.
- 38/38 cartas de navegação carregadas, agentes vivos; partida ficou responsiva após a intro na tentativa atual.
- Falha encontrada: chegada acionou recuperação de queda uma vez sem movimento do jogador. Em correção; não aprovado ainda.
- Queda temporária de FPS após mortes (20 FPS / apresentação45ms) requer investigação; fora dela69–88FPS nesta máquina. Não é benchmark de população alta.
- Invulnerabilidade foi ligada EXPLICITAMENTE nos controles QA depois da chegada para testar habilidades; não é estado padrão.
- Ainda não foi conferida a extração completa com inventário preservado no navegador.
- Morte acionada pelo botão QA: relatório original apareceu sobre a cena, com pontuação1.245, tempo2:25,11abates,nível3,créditos140; botões Renascer/Menu presentes. Não foi substituído por tela simplificada.
### Pouso corrigido e sorteio de estágio
- Segunda partida integrada, mesma seed: HP130/130 aos3s, groundedtrue e0retornos, sem invulnerabilidade. Trace: apoio0,02m; nenhuma correção emergencial necessária na entrega do controle.
- Auditoria do subconjunto atual (120sementes ×6estágios):720/720planos válidos, nenhuma partida/cálice na mesma ilha nem em ilhas vizinhas; mínimo2pontes,rota mínima171,5m e mediana411,7m. Todas38ilhas participaram como partida;16elegíveis como cálice.
- Observação de escopo: as etapas esféricas reutilizam este arquipélago com novas posições. O nome de bioma ainda não implica trocar todo o cenário por outra arte.
- Suíte ampla intermediária:1460passaram,6falhas preexistentes porGLBs autorais ausentes. Um processo de teste de rede encerrou durante execução paralela; repetição isolada passou2/2. Isto não inclui os novos testes de ragdoll ainda em elaboração.

### Validação final — integração e pedidos adicionais
- Jogo principal passou a selecionar PlayerScene + PlanetWorld por padrão e em `mode=planet`. A prévia simplificada ficou somente em `mode=planet-preview`; `world=farm`, modos legados e co-op usam o caminho plano existente.
- Ragdoll do jogador: 16 corpos Havok no rig real, gravidade radial, escala preservada, restauração no reset. Nove testes reais passaram. No navegador o cadáver assentou articulado sobre uma ponte e permaneceu atrás do relatório.
- Braços da introdução corrigidos: removida segunda aplicação de mira depois dos clipes autorais. Teste do GLB real cobre 120 quadros com câmera apontando fora da pose; braços visíveis novamente na prévia.
- Destruição do mundo conectada ao DualPistols original e ao combo; atualização/descarte passam pela fachada de mundo. Tiros reais quebraram caixa em três impactos. Revisão registrou três objetos quebrados, 20 impactos, 7.621 triângulos removidos e nenhum defeito de colisão apontado pelo ledger.
- Rachaduras de superfície em oito estágios, compartilhando geometria e preservando o material original. Fragmentos: até 14 por caixa, 18 por barril, 16 por pedra, 22 por estrutura, 12 por árvore, limitados pelo pool global de 48 e pela geometria disponível. Árvores tombam inteiras antes da fragmentação.
- Corrigido carregamento do shader de overlay dos inimigos, cuja falha acionava fallback de skinning durante ataques. Após recarregar, inimigos exibidos em tamanho normal e nenhum novo erro de shader capturado.
- Cálice/extração conferidos no navegador: E recolheu o suco; estágio 2 começou com Podador de aço x1 preservado e créditos convertidos em XP (nível 2, 55/115).
- Suíte final ampla: 1.503 testes passaram; seis falhas preexistentes somente por arquivos-fonte GLB ausentes em assets/art. Sem falha de worker nesta execução. Depois dos ajustes de acabamento, 53 testes específicos passaram e build/typecheck passaram.
- Limitações mantidas explícitas: arte de biomas ainda reutiliza o mesmo arquipélago; multiplayer esférico não foi implementado. FPS com efeitos ainda precisa de investigação: observou-se queda pontual para 25 FPS durante revisão, sem afirmar otimização concluída.
