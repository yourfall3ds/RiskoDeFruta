> Registro histórico da primeira composição. O estado atual e a validação estão em [RUN_IMPLEMENTATION.md](RUN_IMPLEMENTATION.md). Fontes atuais: Farm_World_Polished.blend e Gunslinger_Final.blend. Os caminhos intermediários abaixo podem ter sido substituídos.

# Direção do mundo — revisão de 06/09/2026

O usuário apontou que a bancada de combate não parecia com as referências. A prioridade desta revisão é construir o ambiente M10 antecipadamente, mantendo as pendências de gameplay explícitas.

## Composição implementada

- Ilha principal cultivada e ilha elevada com celeiro ao fundo.
- Caminho com subida contínua, cercas de madeira, canteiros, vegetação, rochas e árvores.
- Celeiro vermelho com telhado gambrel, portas, travessas, janela, lanternas e cúpula; silos com cintas e escadas; moinho.
- Ilhas em planos distantes com arquitetura agrícola e rochas texturizadas.
- Céu azul cósmico com planeta, nebulosa violeta e nuvens; HDRI fotográfico permanece como fonte de iluminação ambiente.
- Pequenos focos emissivos de corrupção nas bordas, sem cobrir todo o cenário com luz roxa.

Geometria de arquitetura construída em uma composição fixa no Blender; rochas e vegetação vêm de modelos texturizados CC0. Não são texturas de referência projetadas como cenário falso. A cena é 3D e a câmera continua móvel.

Arquivos: `scripts/build-farm-world.py`, `art/blender/Farm_World.blend`, `public/models/farm-world.glb`, `public/models/farm-collision.json`, `src/world/FarmWorld.ts`.

Segunda passagem: `scripts/optimize-farm-world.py` e `scripts/detail-farm-world.py`. Arquivo final de trabalho: `art/blender/Farm_World_Dressed.blend`. Scans compartilham malhas, com redução maior nas ilhas distantes. GLB passou de 141.554.992 para 31.101.556 bytes, incluindo o novo caminho e metal dos silos. O arquivo `farm-optimization.json` registra a primeira redução, anterior ao ajuste final de distância.

Validação: 42 testes em sete arquivos aprovados e build de produção aprovado. A travessia automatizada usa o JSON de colisão exportado e o motor real do personagem, do spawn até a porta do celeiro; bordas elípticas não criam piso retangular invisível. Inspeção visual no navegador local, 1280×720, confirmou modelos, texturas, personagem e HUD carregados. O primeiro perfil registrou 45 FPS e 4,28 milhões de triângulos antes da segunda redução; não é benchmark de hordas. O bundle principal ainda gera aviso de tamanho no Vite.

## Fontes locais

Poly Haven, CC0 (https://polyhaven.com/license):

- https://polyhaven.com/a/wood_planks
- https://polyhaven.com/a/rock_face_03
- https://polyhaven.com/a/rusty_painted_metal
- https://polyhaven.com/a/corrugated_iron
- https://polyhaven.com/a/brown_mud_02
- https://polyhaven.com/a/coast_land_rocks_02
- https://polyhaven.com/a/fern_02
- https://polyhaven.com/a/grass_medium_01
- https://polyhaven.com/a/island_tree_01

Downloads pelos endpoints oficiais da Poly Haven; nenhuma chamada externa é necessária durante o jogo. Mapas de arquitetura 2K, mapas dos scans 1K.

## Céu gerado

Ferramenta: image_gen integrada, sem Meshy e sem chave de API. Arquivo consumido: `public/environment/cosmic-sky.png`. Original preservado na pasta generated_images do Codex.

Prompt usado:

> Create a production sky texture for a 3D fantasy agricultural action game. Output a very wide 2:1 equirectangular 360-degree panorama, full image is ONLY SKY, no land, no islands, no buildings, no people, no text or HUD. Seamless left-right wrap. Horizon at the image equator with brilliant soft distant cumulus clouds and clear blue atmosphere. Upper hemisphere has deep rich midnight cobalt blue transitioning to bright blue near horizon, fine sparse stars, subtle detailed magenta-violet nebula concentrated in the upper RIGHT half. A huge physically textured blue-white moon/planet with cratered and cloud-like surface occupying about 20% image width in the upper LEFT quadrant, its lower limb just above the horizon. Warm late-afternoon sun glow at far right horizon, realistic HDR-inspired cinematic sky photographic detail. Bottom hemisphere softer cool cloud haze. Crisp high resolution, natural nuanced tonal range. This is a texture used behind real 3D islands, do not draw the game world itself.

## Diferenças ainda abertas

Inspeção adicional: 1,35 milhão de triângulos na prévia 1280×720 após redução (34 FPS com múltiplas prévias concorrendo). Fechadas as abas temporárias, a janela original menor registrou 58 FPS, 55 draw calls e 1,22 milhão de triângulos. São observações pontuais em tamanhos diferentes, sem comparação direta de desempenho. A rampa foi encurtada para terminar em z=20, na borda do platô; um teste adicional cobre a continuidade de altura. Scans na entrada foram rebaixados para liberar a passagem visual.

Não declarar fidelidade idêntica: faltam portais/cavernas, pontes suspensas jogáveis, cachoeiras, raízes detalhadas, tratores, frutas nos canteiros e a densidade artística das imagens. As ilhas distantes são cenário, sem acesso nesta revisão. As superfícies jogáveis usam elipses e uma rampa; a irregularidade fina dos scans não é colisão de triângulos.

Os três espécimes continuam sendo treino com vida e reação; esta revisão visual não completa IA, director, progressão, boss ou balanceamento. A bancada técnica anterior permanece em `?mode=training`.

