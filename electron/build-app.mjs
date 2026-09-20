import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

/**
 * Compila as TRÊS entradas do aplicativo empacotado.
 *
 * O esbuild vem junto do Vite, que já é dependência — nenhuma ferramenta nova entra no projeto só
 * por causa disto.
 *
 * Tudo sai em CommonJS (`.cjs`) de propósito, embora o projeto seja `"type": "module"`. O processo
 * principal do Electron e o `preload` carregam CommonJS de forma confiável em toda versão; ESM no
 * main ainda é recente e o `preload` com `contextBridge` é o caso onde ESM mais tropeça. A extensão
 * `.cjs` é o que impede o `"type": "module"` do `package.json` de reinterpretar esses arquivos.
 */
const dev = process.argv.includes('--dev');
mkdirSync('dist-electron', { recursive: true });

const comum = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  sourcemap: dev,
  minify: !dev,
  // `electron` é fornecido pelo próprio runtime: empacotá-lo quebraria o `require('electron')`.
  external: ['electron'],
};

await build({ ...comum, entryPoints: ['electron/main.ts'], outdir: 'dist-electron' });
await build({ ...comum, entryPoints: ['electron/preload.ts'], outdir: 'dist-electron' });

/**
 * O SERVIDOR entra no pacote como um bundle próprio, e não como TypeScript com `tsx`.
 *
 * No aplicativo instalado não há `tsx` nem `node_modules`: o que existe é o `asar`. Então o
 * servidor precisa chegar compilado e com as dependências dentro — é o que faz o multijogador
 * funcionar sem `npm install` na máquina do jogador.
 *
 * Os decoradores de `@colyseus/schema` exigem o legado (`experimentalDecorators`), que o esbuild lê
 * do tsconfig do servidor. Sem isso os `@type()` do schema somem e a replicação para de existir —
 * em silêncio, o que é pior do que quebrar.
 */
if (!dev) {
  // `outExtension` e `outfile` não convivem no esbuild, então a cópia do servidor é montada sem ele.
  const { outExtension: _ignorado, ...semExtensao } = comum;
  await build({
    ...semExtensao,
    entryPoints: ['server/index.ts'],
    outfile: 'dist-electron/server.cjs',
    tsconfig: 'server/tsconfig.json',
  });
}

console.log(`Aplicativo compilado em dist-electron/ (${dev ? 'desenvolvimento' : 'empacotamento'}).`);
