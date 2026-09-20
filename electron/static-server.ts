import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

/**
 * Servidor estático mínimo para o build do Vite dentro do aplicativo empacotado.
 *
 * Ver `electron/address.ts` para por que `file://` não serve. Aqui só existe o suficiente para
 * servir uma pasta: nada de cache, nada de compressão, nada de índice de diretório — é tudo
 * tráfego de `127.0.0.1` para o próprio processo.
 */
const TIPOS: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.gz': 'application/gzip',
};

export function tipoDoArquivo(caminho: string): string {
  return TIPOS[extname(caminho).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Converte o caminho pedido pela URL num caminho DENTRO da raiz — ou em nada.
 *
 * A travessia (`../../`) tem de ser barrada mesmo aqui. O servidor só escuta em `127.0.0.1`, mas a
 * página que ele serve executa código de terceiros (os módulos do próprio jogo) e qualquer `fetch`
 * dela chega aqui; sem a checagem, um caminho montado leria qualquer arquivo do disco do jogador.
 * Normalizar ANTES de comparar é o ponto: `a/../../b` só revela o que é depois de normalizado.
 */
export function resolverCaminho(raiz: string, urlPedida: string): string | undefined {
  let pedido: string;
  try { pedido = decodeURIComponent(new URL(urlPedida, 'http://127.0.0.1').pathname); } catch { return undefined; }
  if (pedido === '/' || pedido === '') pedido = '/index.html';
  const alvo = normalize(join(raiz, pedido));
  const raizNormal = normalize(raiz);
  // O `+ sep` evita que `/raiz-secreta` passe por estar dentro de `/raiz` como prefixo de texto.
  if (alvo !== raizNormal && !alvo.startsWith(raizNormal.endsWith(sep) ? raizNormal : raizNormal + sep)) return undefined;
  return alvo;
}

export function servirPasta(raiz: string, porta: number, host = '127.0.0.1'): Promise<{ servidor: Server; porta: number }> {
  const servidor = createServer((req, res) => {
    const alvo = resolverCaminho(raiz, req.url ?? '/');
    if (!alvo) { res.writeHead(403).end('fora da raiz'); return; }
    void stat(alvo)
      .then((info) => {
        if (!info.isFile()) throw new Error('não é arquivo');
        res.writeHead(200, { 'Content-Type': tipoDoArquivo(alvo), 'Content-Length': String(info.size) });
        createReadStream(alvo).pipe(res);
      })
      .catch(() => { res.writeHead(404).end('não encontrado'); });
  });
  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(porta, host, () => {
      const info = servidor.address();
      resolve({ servidor, porta: typeof info === 'object' && info ? info.port : porta });
    });
  });
}
