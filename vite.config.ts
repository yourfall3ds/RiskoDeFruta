import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { exclude: ['@recast-navigation/core','@recast-navigation/generators','@babylonjs/havok'] },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022', copyPublicDir:false },
});
