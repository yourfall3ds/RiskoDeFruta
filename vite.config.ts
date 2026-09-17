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
        main: resolve(__dirname, 'index.html'),
        'audio-lab': resolve(__dirname, 'audio-lab.html'),
        'weapon-lab': resolve(__dirname, 'weapon-lab.html'),
      },
    },
  },
});
