import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  optimizeDeps: { exclude: ['@recast-navigation/core','@recast-navigation/generators','@babylonjs/havok'] },
  server: { port: 5173, strictPort: true },
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
