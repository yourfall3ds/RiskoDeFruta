import fs from 'node:fs';
const file='src/run/LootDrops.ts';let s=fs.readFileSync(file,'utf8');s=s.replace('// Two thin RGBA cards retain the original image and remain readable during a full turn.','// A double-sided RGBA card rotates as the original flat item illustration.').replace('i<2;i++','i<1;i++').replace('{size:.8}','{size:.65}');fs.writeFileSync(file,s);
const current=`# Estado atual — 07/09/2026

Projeto ativo: D:\\Riskodefruta2. Babylon.js 9.25 / TypeScript / Blender. Sem API Meshy. A cópia antiga em C: permanece preservada. A fila cumulativa está em OBJECTIVES_QUEUE.md.

## Combate e inimigos

- Cinco GLBs originais: berinjela, milho, cenoura, tomate e melancia. Geometria, materiais, imagens e skins preservados pela auditoria original-enemy-integrity.json. O chefe reutiliza a melancia em escala maior. Não usar o pipeline histórico de substituição de anatomia.
- Recast/Detour Crowd, separação e setores de ataque; FSM de animação, passadas por deslocamento. Orientação frontal corrigida removendo a rotação extra na raiz. Asas próximas amostradas a cada render, ciclo de 0,44 s.
- Nascimentos individuais saindo da terra e clipes próprios de ataque/carga, sem o ataque de espada de origem. Tomate voa/cospe fogo; melancia anda em quatro patas, rola, morde e cospe caroços. A postura de tiro do milho existe; sua arma aguarda o asset do usuário.
- Ragdoll articulado Havok, limite de quatro corpos ativos e correção da escala refletida dos esqueletos. Knockback, dano visível, barras de vida, rastros e decals.
- Pistolas acompanham os braços em mira vertical. MP I alterna dois disparos perfurantes; seu rastro viaja, mas o dano continua hitscan. MP II distribui 14 disparos ao longo do mortal para evitar o pico simultâneo. MP III alterna mira por braço e pose cruzada com IK.
- População inicial 24, limite adaptativo entre 12 e 32; spawns graduais e respiros entre hordas. 50/100/150 são testes de QA. Geometria compartilhada, poses por distância, sombras e ragdolls limitados.
- Elites dourados têm defesa/ouro; gigantes multiplicam vida/dano/velocidade por três e tamanho por 1,6; luminosos têm dano e ataque extra. Nem todo parâmetro do gigante é multiplicado por três.

## Mundo e travessia

- Dez volumes fechados de rocha/terra texturizada sob as ilhas, quatro locais e seis distantes; relatório solid-geology.json registra zero arestas não-manifold. Colisão do relevo e navmesh recompostos.
- Cinco ilhotas flutuantes de cenário, dois discos voadores decorativos e uma ilha móvel acessível entre a principal e o posto oeste. Ciclo de 18 s, paradas de 3 s, piso elíptico e transporte do jogador testados. Os inimigos usam as pontes fixas; não embarcam na ilha móvel.
- Cachoeiras com advecção e mistura de textura; poças com reflexo de ambiente e ondulações; vento na esquiva e passos gravados por superfície. Reflexo das poças não é planar.
- Camadas de nuvens abaixo das ilhas e cabo de resgate durante a queda. O retorno usa o último piso fixo seguro e penalidade de vida. Revisão visual ampla do resgate ainda pendente.

## Baús e progressão

- Baú próprio do Blender, oco, com tampa articulada. Cada baú cobra uma vez e sorteia um item ao abrir. A tampa começa a levantar antes da ejeção; o PNG RGBA descreve um arco, cai junto ao baú e permanece girando. E recolhe o item e só então aplica seu efeito. Sem menu de escolha, sem entrega imediata e sem seleção por teclas 1–3.
- O chão do drop é consultado na colisão; posições obstruídas são evitadas. Os itens permanecem até a coleta ou mudança de estágio. O altar também entrega recompensas no mundo.
- 90 PNGs importados com integridade binária; o catálogo jogável atual tem 12 efeitos empilháveis. Ícones disponíveis não significam 90 efeitos implementados.
- XP, níveis, atributos no Tab, créditos por abate, itens, chefe e fenda. A passagem aumenta o estágio reutilizando o mesmo mapa; ainda não há outro mapa autoral distinto.

## Validação e limites

87 testes em 19 arquivos aprovados; TypeScript e build de produção aprovados. Registros: art/latest-tests.log e art/latest-build.log. O build avisa sobre chunks maiores que 500 kB.

No navegador, baú reforçado abriu e sorteou Mira de precisão: créditos 100 → 55, inventário permaneceu igual até E. Após recolher: ícone entrou uma vez e créditos continuaram em 55. Tampa aberta e transparência do item conferidas. Navegação para celeiro, oeste e leste validada após ajuste dos baús.

Desempenho ainda varia: houve amostras anteriores de 60 FPS com cinco inimigos e 41–60 com 24, mas a revisão recente em Alta chegou a 17 FPS com 14 hostis. Não são medições isoladas nem garantia de 60 FPS. O disco C: voltou a ficar cheio durante testes; uma execução falhou por arquivos temporários ausentes, e a repetição com TEMP/TMP em D: passou inteira. Não atribuir toda queda de FPS ao disco sem perfil.

A referência visual ainda não foi alcançada. Próximos trabalhos: perfil de desempenho em horda, revisão visual de orientação e animações em todos os estados, arma do milho, expansão dos itens/mapas e investigação separada de terreno destrutível. Não considerar decal como buraco físico.

## Fontes atuais

- art/blender/Farm_World_Polished.blend + Solid_Island_Geology.blend + Alien_Islets_And_Fruit_Saucer.blend + Interactive_Farm_Chest.blend.
- scripts/build-solid-geology.py, build-alien-world.py, build-interactive-chest.py.
- scripts/restore-original-enemies.mjs + biped-combat-clips.mjs + creature-clips.mjs preservam os originais e acrescentam animações.
- O GLB runtime do jogador inclui a correção posterior de scripts/repair-player-grips.mjs. Gunslinger_Final.blend sozinho ainda não reproduz todos os ajustes finais dos sockets.
- npm usa cache no D:; Iniciar-Jogo.ps1 configura também TEMP/TMP no D:. Não apagar a cópia antiga como parte destas correções.
`;
fs.writeFileSync('docs/CURRENT_IMPLEMENTATION.md',current);
for(const f of ['docs/RUN_IMPLEMENTATION.md','docs/BROWSER_VALIDATION.md']){let old=fs.readFileSync(f,'utf8');if(!old.startsWith('> HISTÓRICO'))old='> HISTÓRICO de 06/09, anterior à restauração dos cinco inimigos e aos baús aleatórios. O estado vigente, validações e limitações estão em [CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md). Limites de população, roster, áudio e escolhas abaixo descrevem a versão antiga.\n\n'+old;fs.writeFileSync(f,old);}
fs.writeFileSync('docs/MILESTONES.md',`# Progresso atual — 07/09/2026

Estado detalhado e evidências: [CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md). Fila acumulada: [OBJECTIVES_QUEUE.md](OBJECTIVES_QUEUE.md).

- [x] Cinco inimigos originais preservados, navegação Recast/Detour e FSM.
- [x] Mira vertical, grips, dois disparos MP I, barragem MP II distribuída e pose cruzada MP III.
- [x] Ragdoll articulado com orçamento e escala corrigida; knockback e reação ao dano.
- [x] Hordas graduais, população adaptativa 12–32, elites, progressão e 90 ícones importados (12 efeitos jogáveis).
- [x] Dez volumes fechados sob as ilhas, ilha móvel com piso/transporte do jogador, ilhotas e discos voadores decorativos.
- [x] Nascimentos e ataques próprios por esqueleto; cachoeiras com fluxo, poças, vento e áudio gravado.
- [x] Baús com tampa articulada, sorteio único, ejeção, item girando e coleta com E. Validado no navegador.
- [x] 87 testes em 19 arquivos; TypeScript e build aprovados. Navmesh para celeiro/oeste/leste aprovado.
- [ ] 60 FPS sustentados em combate: ainda não certificado; amostra recente caiu a 17 FPS.
- [ ] Revisão visual completa das animações, resgate e comparação com referências.
- [ ] Arma do milho (aguardando asset), mais efeitos de itens e mapa seguinte distinto.
- [ ] Terreno destrutível com atualização real de geometria, colisão e navegação.

O visual ainda não equivale às referências. Os registros históricos não substituem o relatório atual.
`);
fs.writeFileSync('docs/CONTINUE_ON_D.md',`# Continuidade no disco D:

Projeto ativo: D:\\Riskodefruta2. Fila cumulativa: docs/OBJECTIVES_QUEUE.md. Estado atual: docs/CURRENT_IMPLEMENTATION.md.

87 testes / 19 arquivos, TypeScript e build aprovados em 07/09. A última correção entrega o item aleatório dos baús no mundo, após abrir a tampa; E recolhe. Conferido no navegador com Mira de precisão, cobrança única e inventário após coleta.

Iniciar-Jogo.ps1 inicia o servidor em 127.0.0.1:5173 e configura cache/temporários no D:. Ao rodar testes diretamente no PowerShell, definir TEMP e TMP para D:\\Riskodefruta2\\.temp. C: está com espaço volátil; a cópia antiga continua preservada.

Prioridades restantes: perfil de horda/FPS, revisão visual dos inimigos em todos os estados, resgate de queda, arma do milho aguardando usuário, expansão de itens/mapas e terreno destrutível como pesquisa separada. Não declarar o jogo concluído nem equivalente às referências.

Preservar geometria, UVs e texturas dos cinco inimigos; apenas animações são editadas. Meshy API desativada. Os 90 ícones não equivalem ainda a 90 efeitos distintos.
`);
let readme=fs.readFileSync('README.md','utf8').replace('sete espécies','cinco espécies originais').replace('docs/RUN_IMPLEMENTATION.md','docs/CURRENT_IMPLEMENTATION.md').replace('volume, música e qualidade','volume e qualidade').replace('E interage com compras/fenda; 1–3 escolhe ofertas do mercado.','E abre baús, recolhe itens do chão e atravessa a fenda. Cada baú sorteia um item, abre a tampa e ejeta o PNG que fica girando até a coleta. Não há escolha de oferta.').replace('A população normal é limitada a 50; F1 também oferece testes de estresse com 100 e 150 atores.','A população começa em 24 e se adapta entre 12 e 32; F1 oferece testes de 50, 100 e 150 atores.');
fs.writeFileSync('README.md',readme);
let q=fs.readFileSync('docs/OBJECTIVES_QUEUE.md','utf8');
for(const prefix of ['Limite máximo normal','Compartilhamento entre inimigos iguais','Hordas com crescimento','Elite dourado:','Knockback aplicado','Integrar os 90','Criar animação própria','Trocar ataques genéricos','Reforçar movimento','Vento na esquiva','Poças com reflexos','Passos de grama','Substituir efeitos sintéticos','Fechar os platôs','Corrigir orientação frontal','Eliminar pico de trabalho','Habilidade 1:','Habilidade 3:','Ilhas flutuantes de cenário','Ilhas conectadas por pontes','Discos voadores das frutas','Remover escolhas e entrega imediata'])q=q.replace('- [ ] '+prefix,'- [x] '+prefix);
q=q.replace('baús, escolhas e objetivo','baús aleatórios e objetivo').replace('plataformas/ilhas','plataformas/ilhas');
q+='\nEstado consolidado: CURRENT_IMPLEMENTATION.md (07/09). Itens marcados indicam implementação; revisão visual global e performance sustentada continuam pendentes. A ilha móvel já transporta o jogador com colisão, mas a navegação dos inimigos permanece nas pontes fixas.\n';fs.writeFileSync('docs/OBJECTIVES_QUEUE.md',q);
fs.appendFileSync('docs/ASSET_LICENSES.md','\n## Áudio gravado e acessórios — 07/09/2026\n\nAmostras locais CC0; fontes e autores detalhados em [foley-sources.json](foley-sources.json): Kenney (impactos/passos), pauliuw (criaturas), qubodup (swishes), ezwa/qubodup (água) e TabascoCZ (tiros). Não há síntese por osciladores no áudio atual.\n\nBaú articulado, volumes geológicos, ilha móvel e discos voadores foram modelados localmente no Blender e usam texturas PBR já existentes do acervo Poly Haven CC0. Os cinco inimigos originais fornecidos pelo usuário preservam malhas, materiais, imagens e skins; ver original-enemy-integrity.json.\n');
