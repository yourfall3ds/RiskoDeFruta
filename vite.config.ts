import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  optimizeDeps: { exclude: ['@recast-navigation/core','@recast-navigation/generators','@babylonjs/havok'] },
  // Os ambientes de geração de asset (venvs do Python, repositórios vendorizados, pesos de modelo)
  // são dezenas de milhares de arquivos que o jogo NUNCA importa, e o observador do Vite morria ao
  // tentar `lstat` num `.pyd` de dentro da venv — derrubando o servidor inteiro com
  // `UNKNOWN: unknown error`. Ignorar aqui é o que mantém `npm run dev` de pé.
  //
  // Os padrões apontam as pastas EXATAS de propósito. Um `**/tools/**` genérico parece equivalente
  // e não é: ele também casa com `src/tools/`, onde moram as ferramentas de revisão do jogo — o
  // resultado é o Vite servir versões velhas desses arquivos para sempre, sem erro nenhum.
  server: {
    port: 5173, strictPort: true,
    watch: { ignored: ['**/tools/asset-gen/**', '**/tools/partcrafter/**', '**/art/**'] },
  },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    copyPublicDir: false,
    // O estúdio de sons é uma página própria: precisa entrar no build, senão o link do F1
    // funciona em desenvolvimento e quebra na versão publicada.
    rollupOptions: {
      input: {
        // `import.meta.dirname` e não `__dirname`: o Vite avisa em toda inicialização que o
        // carregador nativo de configuração — que vira o padrão numa versão maior futura — não
        // suporta `__dirname`, e quando isso acontecer o build quebraria aqui, nas três entradas.
        main: resolve(import.meta.dirname, 'index.html'),
        'audio-lab': resolve(import.meta.dirname, 'audio-lab.html'),
        'weapon-lab': resolve(import.meta.dirname, 'weapon-lab.html'),
      },
    },
  },
});
