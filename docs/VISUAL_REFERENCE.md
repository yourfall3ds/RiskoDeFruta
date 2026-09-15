# Leitura das referências e preparação de arte

Quatro PNGs 1672 × 941 foram inspecionados visualmente. São alvos de direção artística, não screenshots do jogo implementado. M0 não tenta reproduzir sua arte.

Atualização explícita do usuário: qualidade **ultra-realista**, especialmente em materiais, iluminação, geometria, animações e efeitos. O mundo continua fantástico, com as criaturas agrícolas das referências. Essa direção substitui qualquer interpretação que aceite arte simplificada como resultado final. Validar qualidade visual e desempenho em cenas reais; a escolha da stack sozinha não garante esse resultado.

## Características observadas

1. **Imagem (1):** visão elevada de múltiplas ilhas. Pontes definem rotas, bordas expõem rocha e raízes, cachoeiras reforçam a escala. Celeiro vermelho funciona como marco visual.
2. **Imagem (2):** combate em terceira pessoa com o exterminador à esquerda, escala grande de melancia em primeiro plano, silhuetas de brócolis/banana/milho legíveis. Terreno rico em vegetação e poças.
3. **Imagem (3):** tomate voador focal, antecipação circular vermelha, clarões quentes e fragmentos vegetais. O fundo continua reconhecível durante o combate.
4. **Imagem (4):** caminho principal conduz ao portal/caverna sob o celeiro. Silo e moinho recortam o céu; corrupção roxa conecta chão, bordas e raízes.

Paleta: céu azul profundo, nebulosa violeta, sol dourado, vegetação verde-amarela, construções vermelhas e metais claros. O visor e tanque do exterminador têm acentos ciano/verde. Evitar iluminar toda a cena com bloom roxo; reservar emissão para elementos específicos.

Profundidade: primeiro plano próximo, rota e combate no plano médio, ilhas em várias distâncias, planeta grande no céu. A escala precisa sobreviver à câmera móvel. Materiais sugerem madeira envelhecida, metal gasto, pedra úmida, terra irregular e cascas vegetais.

## Conflitos resolvidos pelo texto do master prompt

Atualização do usuário em 06/09/2026: **a câmera deve acompanhar a imagem de referência**, substituindo o enquadramento central a 7 m do texto inicial. A revisão usa distância 2,25 m, FOV vertical 60°, pivô 1,50 m e deslocamento de ombro 0,72 m em 16:9, adaptado para telas estreitas. Personagem próximo no terço esquerdo, mira central; colisão e controle permanecem ativos. Valores são uma aproximação de composição, não calibração fotogramétrica da imagem.

Evitar excesso de geometria procedural, sobretudo sem textura. Chão usa mapas PBR fotográficos; ilhas distantes sem textura foram removidas. Céu fotográfico temporário substitui o fundo plano até a produção da ambientação cósmica. Regras de HP 130, pistolas infinitas e MP continuam seguindo o texto. Não copiar munição ou granadas só porque aparecem na imagem.

## Assets existentes

Inventário completo em `asset-inventory.json`, regenerável com `npm run assets:audit`.

- Quatro PNGs de referência.
- Dois GLBs soltos, aproximadamente 50–53 MiB cada; metadados de malhas, skins, triângulos e animações auditados sem carregá-los no browser.
- ZIPs de cenoura, milho e berinjela: character + clipes nomeados de corrida, caminhada, hit, knockdown e golpe de espada. Os nomes não provam que o ataque corresponde ao design final.
- ZIP gunslinger: character + idle, corrida, caminhada, salto, dodge, quick draw, hit e knockdown.
- Blender encontrado em `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`. Não houve necessidade de alterar modelos em M0.

Os GLBs soltos não contêm animações. Os clipes dos ZIPs ainda precisam de inspeção de rig, eixos, escala, root motion e compatibilidade no Blender. Não inferir a identidade de `Meshy_AI_Character_output.glb` pelo nome genérico.

## Pendências de produção

- M1: extrair cópias de trabalho do gunslinger, validar escala em metros, clips e pontos das duas armas; preservar originais.
- M4–M6: animações específicas de ataques/telegraphs e espécies ausentes; os clipes genéricos não cumprem sozinhos o checklist de inimigos.
- M10: criar celeiro, silos, moinho, pontes, rochas, terreno, vegetação, raízes, planetas e camadas de diorama. Não foram encontrados modelos separados desses elementos na pasta.
- M11: eliminar duplicação de malha/textura nos arquivos withSkin, preparar LOD, revisar densidade de textura e compressão antes de carregar hordas.
- Rodadas visuais: capturar a mesma câmera e condições, comparar composição, silhueta, materiais, luz e legibilidade de combate; registrar divergências e corrigir. Não declarar “idêntico” sem comprovação e não sacrificar resposta do controle para copiar uma composição estática.

Meshy está desativado por instrução do usuário. Somente assets locais e Blender; nenhuma geração externa paga é necessária para M0.
