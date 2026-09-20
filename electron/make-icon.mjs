import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Gera `electron/resources/icon.ico` sem depender de ferramenta de imagem nenhuma.
 *
 * O ícone é obrigatório para o instalador: o electron-builder falha quando `win.icon` aponta para
 * um arquivo que não existe, e sem ele o jogo instalado ficaria com o ícone genérico do Electron —
 * o atalho na área de trabalho não pareceria um jogo.
 *
 * Um `.ico` moderno pode conter um PNG inteiro como imagem, o que evita ter de montar o formato DIB
 * com máscara de transparência invertida. PNG a gente escreve à mão com o `zlib` do próprio Node.
 */
const LADO = 256;

function png(pixels) {
  const bruto = Buffer.alloc((LADO * 4 + 1) * LADO);
  for (let y = 0; y < LADO; y++) {
    // O byte de filtro por linha (0 = nenhum) é o que separa o PNG de um despejo de pixels.
    bruto[y * (LADO * 4 + 1)] = 0;
    pixels.copy(bruto, y * (LADO * 4 + 1) + 1, y * LADO * 4, (y + 1) * LADO * 4);
  }
  const crcTabela = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTabela[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii');
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const soma = Buffer.alloc(4); soma.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, soma]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(LADO, 0); ihdr.writeUInt32BE(LADO, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits por canal, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr), bloco('IDAT', deflateSync(bruto, { level: 9 })), bloco('IEND', Buffer.alloc(0)),
  ]);
}

const pixels = Buffer.alloc(LADO * LADO * 4);
const centro = (LADO - 1) / 2;
for (let y = 0; y < LADO; y++) for (let x = 0; x < LADO; x++) {
  const i = (y * LADO + x) * 4;
  const dx = x - centro, dy = y - centro;
  const raio = Math.hypot(dx, dy);
  // Fundo: quadrado de cantos arredondados, no mesmo tom escuro da janela do jogo (#0b0b0f).
  const cantoX = Math.max(0, Math.abs(dx) - (LADO / 2 - 40)), cantoY = Math.max(0, Math.abs(dy) - (LADO / 2 - 40));
  if (Math.hypot(cantoX, cantoY) > 40) { pixels[i + 3] = 0; continue; }
  pixels[i] = 0x0b; pixels[i + 1] = 0x0b; pixels[i + 2] = 0x0f; pixels[i + 3] = 255;
  // A fruta: um círculo vermelho com brilho, e uma folha verde no topo.
  if (raio < 74) {
    const luz = Math.max(0, 1 - Math.hypot(dx + 22, dy + 26) / 96);
    pixels[i] = Math.min(255, 0xd9 + luz * 60);
    pixels[i + 1] = Math.min(255, 0x2b + luz * 90);
    pixels[i + 2] = Math.min(255, 0x3c + luz * 70);
  }
  const fx = dx - 26, fy = dy + 84;
  if ((fx / 34) ** 2 + (fy / 15) ** 2 < 1) { pixels[i] = 0x4c; pixels[i + 1] = 0xbb; pixels[i + 2] = 0x3f; }
  if (Math.abs(dx + 2) < 5 && dy > -96 && dy < -66) { pixels[i] = 0x6b; pixels[i + 1] = 0x42; pixels[i + 2] = 0x26; }
}

const imagem = png(pixels);
const cabecalho = Buffer.alloc(6);
cabecalho.writeUInt16LE(0, 0); cabecalho.writeUInt16LE(1, 2); cabecalho.writeUInt16LE(1, 4); // reservado, tipo ícone, 1 imagem
const entrada = Buffer.alloc(16);
entrada[0] = 0; entrada[1] = 0; // 0 significa 256 px: o campo tem UM byte, e 256 não cabe nele
entrada[2] = 0; entrada[3] = 0;
entrada.writeUInt16LE(1, 4); entrada.writeUInt16LE(32, 6);
entrada.writeUInt32LE(imagem.length, 8); entrada.writeUInt32LE(6 + 16, 12);

mkdirSync('electron/resources', { recursive: true });
writeFileSync('electron/resources/icon.ico', Buffer.concat([cabecalho, entrada, imagem]));
console.log(`icon.ico gerado (${imagem.length} bytes de PNG 256x256).`);
