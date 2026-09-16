# Revisão Codex — áudio e fragmentos

## Banco de inimigos

- Estúdio em aba isolada do navegador: novos nomes `eggplant-*.ogg` e `tomato-*.ogg` aparecem nos eventos corretos, sem referência às vozes antigas nesses painéis.
- Botão “Ouvir Atacar como o jogo toca” do tomate chegou ao estado “Como no jogo: atacar + ruído do ataque.”; botão Parar tudo chegou a “Playback interrompido.”; console sem erros.
- Fixture `.temp/audio-decode-review.html` decodificou os **89/89 arquivos novos** via AudioContext no navegador, **zero falhas**, sem tocar todos os sons ou alterar configurações do usuário.
- Essa verificação comprova carregamento e reprodução, não aprovação estética por audição. A avaliação do timbre continua disponível no estúdio.
- Nenhuma substituição personalizada, volume ou mute do usuário foi sobrescrita. Abas temporárias fechadas.

## Fragmentos

- GLB atual renderizado offline por `.temp/render-fruit-library.py`, resultado `.temp/fruit-library-review.png`.
- Melancia tem polpa vermelha, casca verde e cortes internos visíveis; demais famílias possuem materiais distintos de polpa/casca/semente. Não são miniaturas do monstro inteiro.
- A imagem é catálogo de peças, não o efeito em movimento. Ainda falta validar escala/quantidade/dissipação no jogo depois de concluída a integração atual.

## Nave

- `.temp/render-dropship-review.py` foi rodado novamente após polimento de materiais: casco escuro e deck oliva; faixa de perigo amarela/preta legível.
- Persiste relevo de textura estriado no casco no render offline. Confirmar intensidade em câmera de jogo antes de considerar aparência final aprovada.
- Correção de contato dos pés tem medição automatizada no relatório Claude; não reconferida visualmente neste passe para evitar interferir na partida do usuário.
