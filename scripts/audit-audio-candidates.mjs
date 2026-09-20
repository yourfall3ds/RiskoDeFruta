#!/usr/bin/env node
/**
 * Juiz automático dos candidatos a som de praga.
 *
 * Reprova por MEDIDA, antes de qualquer ouvido humano. Ver `docs/CLAUDE_MONSTER_AUDIO_TASK.md` §7.
 *
 * Por que WAV e não OGG: não há decodificador de Vorbis neste ambiente (sem ffmpeg, sem Python
 * funcional, sem dependência nativa). A sessão de geração entrega o par `.wav` + `.ogg` do MESMO
 * buffer normalizado; este script lê o WAV e o veredicto vale para o OGG irmão.
 *
 * Uso:
 *   node scripts/audit-audio-candidates.mjs .temp/audio-candidates/eggplant-hurt --group hurt
 *   node scripts/audit-audio-candidates.mjs <dir> --group hurt --reference <dir-de-sementes-wav>
 *
 * Saída: uma linha por candidato com APROVADO/REPROVADO e o motivo, e um resumo final. Código de
 * saída 0 sempre — reprovar candidato é trabalho normal, não falha de ferramenta.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// ---------------------------------------------------------------- limites (espelham o teste)

/** Bandas de duração por grupo, iguais às de `tests/enemy-audio-assets.test.ts`. */
const DURATION = {
  hurt: [0.12, 0.65], heavy: [0.12, 0.65], pistol: [0.12, 0.65], swish: [0.12, 0.65], charge: [0.12, 0.65],
  growl: [0.15, 0.75], strain: [0.15, 0.75], attack: [0.12, 0.98], spawn: [0.15, 1.05], death: [0.15, 1.05],
};
const PEAK = [0.30, 0.95];
const RATE = 44100, CHANNELS = 1;
/** Tempo até o pico, nos grupos percussivos. Difusão devolve ataque lento — é o defeito nº 1. */
const ATTACK_MS = 25;
const PERCUSSIVE = new Set(['hurt', 'attack', 'heavy', 'impact', 'shot', 'pistol']);
/** Silêncio tolerado no fim, em ms. Acima disso o corte ficou frouxo. */
const TAIL_MS = 30;
const SILENCE = 0.02;
/** Distância de cosseno MÍNIMA entre irmãos aprovados. Abaixo disso são o mesmo som. */
const MIN_DISTANCE = 0.12;

// ---------------------------------------------------------------- WAV

/** Lê WAV PCM (16/24/32 bits inteiros ou 32 float) e devolve o canal 0 normalizado em -1..1. */
function readWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('não é WAV RIFF');
  let offset = 12, fmt, dataStart, dataLength;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') fmt = {
      format: buffer.readUInt16LE(offset + 8), channels: buffer.readUInt16LE(offset + 10),
      rate: buffer.readUInt32LE(offset + 12), bits: buffer.readUInt16LE(offset + 22),
    };
    else if (id === 'data') { dataStart = offset + 8; dataLength = Math.min(size, buffer.length - dataStart); }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataStart === undefined) throw new Error('WAV sem fmt/data');
  const { channels, bits, format } = fmt, bytes = bits / 8, frames = Math.floor(dataLength / (bytes * channels));
  const samples = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const at = dataStart + i * bytes * channels;
    if (format === 3 && bits === 32) samples[i] = buffer.readFloatLE(at);
    else if (bits === 16) samples[i] = buffer.readInt16LE(at) / 32768;
    else if (bits === 24) { const v = buffer.readUInt8(at) | (buffer.readUInt8(at + 1) << 8) | (buffer.readInt8(at + 2) << 16); samples[i] = v / 8388608; }
    else if (bits === 32) samples[i] = buffer.readInt32LE(at) / 2147483648;
    else throw new Error(`profundidade não suportada: ${bits} bits`);
  }
  return { samples, rate: fmt.rate, channels, bits };
}

// ---------------------------------------------------------------- descritor espectral

/** FFT radix-2 no lugar. `re`/`im` têm comprimento potência de dois. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/**
 * Impressão digital: energia em bandas logarítmicas ao longo do tempo, mais a TRAJETÓRIA do brilho.
 *
 * Os segmentos temporais existem porque dois sons podem ter o mesmo espectro médio e envelopes
 * completamente diferentes — e é o envelope que o ouvido usa para dizer "de novo esse".
 *
 * O centroide por segmento foi acrescentado depois de uma falha MEDIDA: com três segmentos e só as
 * bandas, um assobio e a sua INVERSÃO EXATA NO TEMPO mediam 0,063 de distância — abaixo do limiar,
 * ou seja, o juiz dizia que subir e descer eram o mesmo som. Para varredura (arremesso, passagem,
 * carga) a direção é a identidade inteira do efeito, e energia média por banda não a enxerga.
 *
 * O centroide é o "brilho" do quadro: subindo ao longo do tempo é um apito que sobe, descendo é um
 * que desce. Ele entra com peso alto de propósito — é a única parte do vetor que distingue os dois.
 */
const SEGMENTOS = 6;
/**
 * Divisores que trazem direcao e modulacao para a faixa do cosseno.
 *
 * MEDIDOS, nao escolhidos. Os tres casos de calibracao, em valor bruto:
 *
 *   caso                        forma   direcao   modulacao
 *   mesma receita, so semente   0,019   0,072     0,124      <- tem de REPROVAR
 *   inversao no tempo           0,107   0,224     0,089      <- tem de APROVAR
 *   tremulo sobre o mesmo ruido 0,012   0,035     0,673      <- tem de APROVAR
 *
 * Ruido aleatorio tem inclinacao e flutuacao proprias por acaso: duas sementes da MESMA receita
 * diferem 0,072 em direcao e 0,124 em modulacao so por amostragem. Os divisores poem esse acaso
 * abaixo do limiar de 0,12 e deixam a diferenca de verdade acima dele.
 */
const DIVISOR_DIRECAO = 1.0;
const DIVISOR_MODULACAO = 2.0;

/**
 * Impressão digital em TRÊS aspectos independentes, e não num vetor único.
 *
 * A versão anterior somava tudo num cosseno só, e cada característica nova diluía as outras na
 * normalização: ao acrescentar a flutuação, a inversão no tempo caiu de 0,128 para 0,096 e um som
 * de mesmo caráter subiu de 0,095 para 0,167 — os dois veredictos se inverteram sem que nenhuma
 * das duas medidas estivesse errada. Empilhar características ponderadas num vetor único não escala.
 *
 * Aqui cada aspecto mede sozinho e a distância final é o MAIOR dos três: dois sons são diferentes
 * quando diferem em QUALQUER aspecto, que é como o ouvido decide. Acrescentar um quarto aspecto
 * amanhã não mexe nos três de hoje.
 */
function fingerprint(samples, rate) {
  const size = 1024, hop = 512, bands = 24;
  const porSegmento = Array.from({length: SEGMENTOS}, () => []);
  const re = new Float64Array(size), im = new Float64Array(size);
  const edges = [];
  for (let b = 0; b <= bands; b++) edges.push(Math.round(20 * Math.pow(rate / 2 / 20, b / bands) / (rate / size)));
  for (let start = 0; start + size <= samples.length; start += hop) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < size; i++) re[i] = samples[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
    fft(re, im);
    const frame = new Float64Array(bands);
    for (let b = 0; b < bands; b++) {
      let sum = 0, lo = Math.max(1, edges[b]), hi = Math.min(size / 2, Math.max(lo + 1, edges[b + 1]));
      for (let k = lo; k < hi; k++) sum += re[k] * re[k] + im[k] * im[k];
      frame[b] = Math.log10(1 + sum / (hi - lo));
    }
    const at = Math.min(SEGMENTOS - 1, Math.floor(start / Math.max(1, samples.length - size + 1) * SEGMENTOS));
    porSegmento[at].push(frame);
  }

  // 1. FORMA — energia por banda em cada segmento. Pega timbre e envelope espectral.
  const forma = [];
  for (const seg of porSegmento)
    for (let b = 0; b < bands; b++)
      forma.push(seg.length ? seg.reduce((soma, f) => soma + f[b], 0) / seg.length : 0);
  const normaForma = Math.hypot(...forma) || 1;

  // 2. DIREÇÃO — inclinação do centroide espectral. Troca de sinal quando o tempo inverte.
  const centroide = porSegmento.map(seg => {
    if (!seg.length) return 0;
    let total = 0;
    for (const f of seg) {
      let soma = 0, peso = 0;
      for (let b = 0; b < bands; b++) {soma += f[b] * b; peso += f[b];}
      total += peso > 1e-9 ? soma / peso / (bands - 1) : 0;
    }
    return total / seg.length;
  });
  const direcao = centroide[SEGMENTOS - 1] - centroide[0];

  // 3. MODULAÇÃO — desvio relativo da energia dentro de cada segmento. Enxerga trêmulo, que some
  // numa média por banda: amplitude modulada e amplitude constante carregam a MESMA energia.
  const modulacao = porSegmento.map(seg => {
    if (!seg.length) return 0;
    const energias = seg.map(f => f.reduce((a, b) => a + b, 0));
    const media = energias.reduce((a, b) => a + b, 0) / energias.length;
    const variancia = energias.reduce((a, e) => a + (e - media) ** 2, 0) / energias.length;
    return media > 1e-9 ? Math.sqrt(variancia) / media : 0;
  });

  return {forma: forma.map(v => v / normaForma), direcao, modulacao};
}

/**
 * Distância entre duas impressões: o MAIOR desacordo entre os três aspectos.
 *
 * Os divisores trazem direção e modulação para a faixa do cosseno, e são medidos: uma inversão
 * completa de varredura muda a inclinação em torno de 0,25, e um trêmulo forte muda o desvio
 * relativo em torno de 0,5.
 */
function distance(a, b) {
  const cosseno = 1 - a.forma.reduce((soma, v, i) => soma + v * b.forma[i], 0);
  const direcao = Math.abs(a.direcao - b.direcao) / DIVISOR_DIRECAO;
  let modulacao = 0;
  for (let i = 0; i < a.modulacao.length; i++)
    modulacao = Math.max(modulacao, Math.abs(a.modulacao[i] - b.modulacao[i]) / DIVISOR_MODULACAO);
  return Math.max(cosseno, Math.min(1, direcao), Math.min(1, modulacao));
}

// ---------------------------------------------------------------- medidas

function measure(samples, rate) {
  let peak = 0, peakAt = 0, sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) { peak = v; peakAt = i; }
    sum += samples[i];
  }
  let tail = samples.length;
  while (tail > 0 && Math.abs(samples[tail - 1]) < SILENCE * peak) tail--;
  return {
    seconds: samples.length / rate, peak, dc: sum / (samples.length || 1),
    attackMs: peakAt / rate * 1000, tailMs: (samples.length - tail) / rate * 1000,
  };
}

// ---------------------------------------------------------------- execução

const args = process.argv.slice(2);
const dir = args[0];
const flag = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
if (!dir || !existsSync(dir)) {
  console.error('uso: node scripts/audit-audio-candidates.mjs <dir-com-wav> --group <hurt|strain|attack|spawn|death> [--reference <dir>]');
  process.exit(2);
}
const group = flag('group') ?? basename(dir).split('-').pop();
const band = DURATION[group];
if (!band) { console.error(`grupo desconhecido: ${group} — conhecidos: ${Object.keys(DURATION).join(', ')}`); process.exit(2); }

const load = folder => readdirSync(folder).filter(f => f.toLowerCase().endsWith('.wav')).sort().map(file => {
  const { samples, rate, channels, bits } = readWav(readFileSync(join(folder, file)));
  return { file, samples, rate, channels, bits, ...measure(samples, rate) };
});

const reference = flag('reference') && existsSync(flag('reference'))
  ? load(flag('reference')).map(r => ({ file: 'ref:' + r.file, print: fingerprint(r.samples, r.rate) }))
  : [];

const candidates = load(dir);
if (candidates.length === 0) { console.error(`nenhum .wav em ${dir}`); process.exit(2); }

console.log(`\nGrupo "${group}" · banda ${band[0]}–${band[1]} s · ${candidates.length} candidatos · ${reference.length} referências\n`);

const approved = [...reference];
const verdicts = [];
for (const c of candidates) {
  const fails = [];
  if (c.rate !== RATE) fails.push(`taxa ${c.rate} (exige ${RATE})`);
  if (c.channels !== CHANNELS) fails.push(`${c.channels} canais (exige mono)`);
  if (c.seconds < band[0] || c.seconds > band[1]) fails.push(`duração ${c.seconds.toFixed(3)} s fora de ${band[0]}–${band[1]}`);
  if (c.peak <= PEAK[0] || c.peak >= PEAK[1]) fails.push(`pico ${c.peak.toFixed(3)} fora de ${PEAK[0]}–${PEAK[1]}`);
  if (PERCUSSIVE.has(group) && c.attackMs > ATTACK_MS) fails.push(`ataque lento ${c.attackMs.toFixed(1)} ms (máx ${ATTACK_MS}) — papa de difusão`);
  if (c.tailMs > TAIL_MS) fails.push(`cauda de silêncio ${c.tailMs.toFixed(1)} ms (máx ${TAIL_MS})`);
  if (Math.abs(c.dc) > 0.01) fails.push(`deslocamento DC ${c.dc.toFixed(4)}`);

  let nearest = null;
  if (fails.length === 0) {
    const print = fingerprint(c.samples, c.rate);
    for (const other of approved) {
      const d = distance(print, other.print);
      if (!nearest || d < nearest.d) nearest = { d, file: other.file };
    }
    if (nearest && nearest.d < MIN_DISTANCE)
      fails.push(`parecido demais com ${nearest.file} (distância ${nearest.d.toFixed(3)}, mín ${MIN_DISTANCE})`);
    else approved.push({ file: c.file, print });
  }
  verdicts.push({ ...c, fails, nearest });
}

for (const v of verdicts) {
  const ok = v.fails.length === 0;
  const near = v.nearest ? ` · + próximo ${v.nearest.d.toFixed(3)}` : '';
  console.log(`${ok ? 'APROVADO ' : 'REPROVADO'} ${v.file.padEnd(28)} ${v.seconds.toFixed(3)}s pico ${v.peak.toFixed(2)} ataque ${v.attackMs.toFixed(0)}ms${ok ? near : ''}`);
  for (const f of v.fails) console.log(`            ↳ ${f}`);
}

const ok = verdicts.filter(v => v.fails.length === 0).length;
const reasons = {};
for (const v of verdicts) for (const f of v.fails) { const key = f.split(' ')[0]; reasons[key] = (reasons[key] ?? 0) + 1; }
console.log(`\n${ok}/${verdicts.length} aprovados (${(ok / verdicts.length * 100).toFixed(0)}% de rendimento)`);
if (Object.keys(reasons).length) console.log('motivos de reprova:', Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' · '));
console.log();
