# PRISM — arma de três formas

Modelo inspirado na referência enviada pelo usuário: metal violeta, estrutura prateada e energia ciano. A arma tem coronha, núcleo e empunhadura comuns, cano telescópico e placas móveis. O visual é uma interpretação 3D da imagem, não uma reprodução exata da pintura.

## Arquivos

- `art/blender/prism-triform/PRISM_TRIFORM_MASTER.blend`: fonte editável, peças separadas e timeline completa com marcadores.
- `PRISM_ASSAULT.blend`, `PRISM_SNIPER.blend`, `PRISM_GRENADE.blend` na mesma pasta: formas estáticas salvas individualmente.
- `public/models/weapons/prism-triform.glb`: as três formas e nove clipes independentes.
- `prism-assault.glb`, `prism-sniper.glb`, `prism-grenade.glb`: exportações estáticas.
- `prism-triform-cycle.glb`: timeline completa, incluindo transformações, disparos e recargas.
- `http://127.0.0.1:5174/weapon-lab.html`: inspeção interativa, giro, troca de forma, disparo e recarga.

## Clipes

| Nome | Duração | Movimento |
|---|---:|---|
| Assault_to_Sniper | 2 s | Abre placas, estende cano, ajusta mira e trava |
| Sniper_to_Grenade | 2 s | Recolhe cano e abre câmara e íris |
| Grenade_to_Assault | 2 s | Fecha câmara e recompõe a assault |
| Assault_Fire | 0,4 s | Gatilho, recuo curto e retorno |
| Sniper_Fire | 0,8 s | Recuo forte, ferrolho e recuperação |
| Grenade_Fire | 0,867 s | Recuo pesado e recuperação mais longa |
| Assault_Reload | 2,6 s | Extrai célula, gira, reinsere e rearma |
| Sniper_Reload | 3 s | Recarga deliberada da célula e rearme |
| Grenade_Reload | 3,2 s | Abre e gira setores da câmara, recarrega e fecha |

O ciclo de seleção é assault → sniper → lança-granadas → assault. Os disparos e recargas partem da forma correspondente e retornam a ela. O modelo possui sockets de mãos, mira e boca. A origem de autoria está na empunhadura; eixo do cano +X no Blender. Ajustar escala e sockets à mão do personagem durante a integração.

## Validação e limites

`scripts/validate-prism-clips.py` compara início e fim de todos os clipes com as formas estáticas exportadas, incluindo transformações constantes. O `.blend` mantém peças individuais; os GLBs agrupam malhas rígidas por módulo/material para reduzir chamadas de desenho.

A arma está entregue como asset e visualizador. Ainda não substitui as pistolas no jogo: comandos, munição, dano, projéteis, sons e animação das mãos precisam de integração. Os clipes de disparo animam a arma; não simulam balística nem dano.

Reconstrução: `blender -b --python scripts/author-prism-triform.py`. As fontes `.blend` ficam na pasta local `art`, que o repositório já ignora; GLBs e scripts podem ser versionados.


## Revisão orbital

As placas da frente orbitam o eixo do cano: uma volta na transformação, duas na recarga. Anéis e trilhos giram no sentido contrário, com abertura radial antes do encaixe. Quaternions amostrados preservam voltas completas no GLB, sem desfazer a rotação no último quadro.

`FX_charge.position.x` é o envelope de energia (0–1) exportado junto dos clipes. Na oficina, ele controla emissão e glow; no Blender, os materiais também têm emissão animada. A integração futura ao jogo deve consumir esse envelope para manter o brilho sincronizado. O visualizador inclui câmera lenta de ¼× para inspecionar as peças.

A validação confere poses finais, mais de 360° de órbita nas transformações e mais de 720° nas recargas. As formas estáticas permanecem iguais.

## Acabamento violeta surreal

Textura de cor gerada com imagegen em `public/textures/weapons/prism-violet-surreal-basecolor.png`: metal violeta com desgaste fino e veios de ametista. As placas têm UVs por face; a imagem fica incorporada nos GLBs e empacotada nos arquivos Blender. Metalicidade e rugosidade permanecem parâmetros físicos separados; a imagem não é um mapa de normais.

`public/textures/weapons/prism-material-atlas.png` contém prata escovada, grafite usinado, borracha e líquido energético azul, também gerados com imagegen. Todos os materiais têm textura: placas e cristais usam ametista; estrutura usa prata; mecanismos usam grafite; empunhadura usa borracha; núcleo, trilhos e célula usam líquido azul. UVs mantêm margem dentro de cada região do atlas.

Núcleo, trilhos, célula e cristais usam materiais emissivos separados da armadura. A oficina intensifica o glow com o envelope de carga durante recargas e transformações e desloca suavemente a textura do líquido, sem afetar o metal. Esse movimento visual não é uma simulação de fluidos; precisa ser conectado também na futura integração ao jogo. Pausar e arrastar a barra permite inspecionar qualquer ponto de cada animação.

## Superfícies circulares

Lentes e cilindros usam 96 lados, anéis usam 128, com normais suaves nas paredes curvas e faces planas nas tampas. Os arcos da íris e da câmara têm 16 subdivisões por setor. Parafusos, placas e cristais mantêm suas facetas intencionais. A suavização não altera as transformações, os materiais ou a quantidade de módulos animados.

## Encaixes e limpeza do acabamento

Removidos os filetes decorativos salientes, as duas placas laterais sobrepostas do receptor e as aletas roxas dos tubos telescópicos. Parafusos reposicionados com corpo embutido nas placas de apoio; os demais cristais foram preservados.

O carregador possui pescoço de alimentação, lábios metálicos, contatos e três células energéticas no topo. O receptor tem uma cavidade real recortada, com moldura aberta e guias fixas. Nas três recargas, o carregador sai alinhado antes de inclinar, realinha abaixo da abertura, faz uma pausa curta e trava; o ferrolho rearma depois do encaixe.
