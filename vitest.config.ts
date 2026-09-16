import { defineConfig } from 'vitest/config';

/**
 * Configuração da suíte separada da de build.
 *
 * `.temp/` guarda cópias de trabalho, capturas e patches em preparação — nunca é código deste
 * projeto. Sem esta exclusão o vitest coletava as suítes dessas cópias e reportava falhas que
 * não pertencem ao repositório.
 */
export default defineConfig({
  optimizeDeps: { exclude: ['@recast-navigation/core','@recast-navigation/generators','@babylonjs/havok'] },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**','**/dist/**','.temp/**','.tools/**'],
    // Boa parte da suíte roda física e navegação reais por milhares de passos; com os arquivos
    // em paralelo, o limite padrão de 5 s derrubava travessias que passam sozinhas.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
