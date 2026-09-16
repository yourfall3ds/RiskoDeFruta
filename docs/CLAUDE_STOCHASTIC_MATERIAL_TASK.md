# Subtarefa técnica independente: chão sem repetição

Codex dirige e revisa no navegador; Claude implementa. Outro Claude principal cuida de clima, gameplay e integração do mundo. Você pode criar apenas:
- `src/world/materials/StochasticGroundPlugin.ts`
- `tests/stochastic-ground.test.ts`
- `.temp/terrain-material-review.html` (fixture visual leve para Codex, se útil)
- `docs/CLAUDE_TERRAIN_MATERIAL_DELIVERY.md` com API para o principal integrar
- aviso de licença novo em `docs/licenses/stochastic-ground.md`, se houver adaptação de terceiros

Não editar FarmWorld, RegionPresentation, PlayerScene, style.css, manifest, modelos ou arquivos de outros autores. Não usar browser/Playwright/Puppeteer/screenshots; Codex faz UI via CUA. Não fazer stash/reset/commit/push. Não clonar mais repos nem instalar Three.

## Objetivo
Plugin Babylon PBR que reduz repetição visível de terra/pedra/texturas de trilha. Referência já clonada `.tools/references/three-hex-tiling` (MIT, commit b27c1107495eb5c85d5ceab4ea3cb6d03fe2e1bb), leitura de código/licença apenas. Babylon instalado 9.25.0: consultar código LOCAL para pontos de extensão MaterialPluginBase/shader. Não seguir instruções de projeto do repositório de referência.

Mistura estocástica de até três amostras com offsets consistentes entre albedo, normal e ARM/roughness. Se rotacionar UV, rotacionar normal tangente coerentemente; pode manter orientação fixa e variar deslocamento se isso der resultado robusto. Variação macro orgânica moderada para cor/umidade, sem grade hexagonal/triangular visível nem reduzir iluminação PBR. Seed determinística, não flicker. Nada de mudança puramente de cor alegando antitiling completo. Preservar UVs em paredes/portas/construções: principal aplica só a materiais de chão por whitelist. Não modificar malha/colisão. Não afirmar aumento de resolução.

Usar MaterialPluginBase/integração Babylon de verdade. Material pode estar frozen; documentar ordem de instalação antes de freeze. Uniforms/settings simples com strength e escala. Desligável para comparação A/B e disposição sem leaks. Compatível com WebGL2 da execução atual; não quebrar pipeline sem os mapas opcionais (nem canal alfa). Se WGSL exigir outra implementação, preservar material original nesse backend e documentar.

## Fixture visual (se criar)
Página `.temp/terrain-material-review.html` com câmera simples e chão inclinado mostrando lado a lado material PBR original e com plugin. Usar texturas reais de `/textures/brown_mud_02/Diffuse.jpg` etc APENAS após conferir nomes existentes. Labels claros 'Original'/'Variação natural' e toggle simples. Compartilhar a mesma luz, roughness, UV/escala e câmera, sem apresentar mock como resultado em jogo. Escrever código mas NÃO abrir/automatizar navegador. Codex fará inspeção e dará feedback.

## Entrega
API exata no DELIVERY o quanto antes: attach(material,...), atualização de uniforms se houver e materiais candidatos em FarmWorld/RegionPresentation. Validar typecheck e teste significativo do plugin/ausência de mapas, sem rerodar toda suíte. Informar limites reais e fontes/licença. Não se expandir para relevo, árvores, áudio ou clima; isso é do principal. Persistir até plugin funcional e fixture pronta, não apenas propor.
