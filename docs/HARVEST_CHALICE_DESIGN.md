# Cálice da colheita — direção aprovada pelo pedido do usuário

Pedido de 15/09/2026: gerar uma imagem de um cálice com suco; cada fruta morta envia seu suco ao cálice; cheio conclui o marco. SUBSTITUI o objetivo anterior de permanência cronometrada. Não exige zerar inimigos.

## Imagem
Gerada com ferramenta integrada ImageGen, salva em `public/images/objectives/harvest-chalice-concept.png`. É conceito/ícone, não um modelo3D. Cálice largo de cristal, estrutura de folhas em latão envelhecido, suco vermelho/laranja visível e gotas entrando. Usar a imagem como referência visual para modelo Blender, com malhas separadas para recipiente e líquido que sobe. Não simular cálice usando esfera/cilindro runtime.

## Mecânica
- Ativar o cálice no marco com E começa uma coleta de suco e aumenta pressão do diretor.
- Mortes reais de inimigos na região do cálice ativo adicionam suco; despawn/reciclagem/debug de eliminar tudo não contam como morte de combate.
- O valor pode variar com a espécie (comum1, tanque3, elite maior) para reconhecer peso sem depender de um inimigo específico. Metas finitas por marco, quatro na expedição.
- Gotas de suco saem da posição da morte e seguem arco até a taça. O crédito deve ser autoritativo/imediato e idempotente; o VFX ilustra, não decide a conclusão.
- Progresso persiste ao sair da área; inimigos continuam surgindo localmente. Não cobrar tempo parado. HUD mostra suco coletado/meta e nível da taça, não45s/55s.
- Encher conclui exatamente uma vez; recompensa aparece junto da fruta que forneceu o suco final ou piso válido próximo. Chefe/fenda continuam após quatro cálices.
- Falhas de animação/VFX/streaming não podem bloquear o marco. Recomeçar limpa progresso da tentativa.

## Prompt final (ImageGen integrado)
Use case: stylized-concept. Asset type: concept art and objective icon for a polished 3D action roguelike about fighting mutant fruit on floating farm islands. Primary request: one beautiful chalice containing fresh fruit juice; fallen fruit enemies release their juice which flows into this chalice until full. Depict a single distinctive large chalice, full object visible, 3/4 elevated view, broad translucent crystal bowl held by aged brass leaf-shaped ribs, sturdy elegant stem and grounded circular base. The bowl is about two-thirds filled with luminous rich watermelon-red and orange fruit juice with tiny pulp flecks, glossy meniscus, subtle liquid swirl. A few arcing juice droplets approach and fall into the open bowl, conveying collection, tasteful and readable. Crafted PBR materials, sculpted botanical details, slight wear, realistic glass thickness and juice refraction, strong clear silhouette, game-ready art direction, not cartoon clipart. Centered isolated object, genuinely transparent background, no scene, no characters, no UI, no text, no watermark, no gore. Warm key light and restrained rim light, balanced metal and liquid, no huge glow bloom. Square composition with generous clean margin.
