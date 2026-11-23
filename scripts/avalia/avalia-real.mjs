// node avalia-real.mjs [analise.js] -> riffs conhecidos do YouTube: a sequencia detectada bate com as notas publicadas?
// A comparacao ignora oitava e tom (gravacoes afinadas meio tom abaixo, etc.): procura, em qualquer
// transposicao, o trecho da sequencia detectada mais parecido com o gabarito.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ARQ = process.argv[2] || new URL('../../docs/analise.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const A = await import(pathToFileURL(ARQ).href);
const RT = process.env.CIFRAS_RUNTIME || path.join(AQUI, '..', '..', '..', 'notas-youtube', 'runtime', 'python'); // Python com yt-dlp e ffmpeg (pasta notas-youtube ao lado do repositorio)
const PY = RT + '/python.exe', FF = RT + '/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe';
const AUD = path.join(process.env.CIFRAS_AUDIO || path.join(AQUI, '..', '..', '..', 'notas-youtube', 'cache'), 'avalia'); // audios de teste ficam FORA do repositorio fs.mkdirSync(AUD, { recursive: true });
const PCN = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const NOMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pcs = (s) => s.trim().split(/\s+/).map((n) => PCN[n]);

// [nome, busca no YouTube, inicio, fim, gabarito (uma passada do riff), observacao]
const CASOS = [
  ['Seven Nation Army (guitarra sozinha)', 'The White Stripes Seven Nation Army official music video', 0, 16, 'E E G E D C B', 'riff grave, com nota repetida'],
  ['Clocks (piano)', 'Coldplay Clocks official video', 0, 30, 'Eb Bb G Eb Bb G Eb Bb Db Bb F Db Bb F Db Bb', 'arpejo rapido de piano (0,23 s por nota)'],
  ['Sweet Child O Mine (guitarra sozinha)', "Guns N' Roses Sweet Child O' Mine official music video", 0, 8, 'D D A G G A F# A D D A G G A F# A', 'arpejo rapido de guitarra'],
  ['Fur Elise (piano solo)', 'Beethoven Fur Elise piano Lang Lang', 0, 8, 'E D# E D# E B D C A', 'piano solo, notas rapidas'],
  ['Come As You Are (guitarra + baixo)', 'Nirvana Come As You Are official music video', 0, 30, 'E E F F# A F# A F# F# F E B E E B E', 'riff grave'],
  ['Smoke on the Water (guitarra em quartas)', 'Deep Purple Smoke on the Water official audio', 0, 30, 'G Bb C G Bb Db C G Bb C Bb G', 'duas notas juntas; vale a de baixo'],
];
function baixar(busca) {
  const marca = path.join(AUD, busca.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) + '.txt');
  if (fs.existsSync(marca)) return fs.readFileSync(marca, 'utf8').split('\n');
  const out = execFileSync(PY, ['-I', '-m', 'yt_dlp', '--no-playlist', '--no-progress', '--no-warnings', '--no-part', '--ffmpeg-location', FF, '-f', '140/bestaudio[ext=m4a]/bestaudio', '--max-filesize', '25M', '--match-filter', 'duration < 600',
    '--print', 'after_move:%(id)s\t%(title)s\t%(filepath)s', '-o', path.join(AUD, '%(id)s.%(ext)s'), 'ytsearch1:' + busca], { encoding: 'utf8', timeout: 240000 }).trim().split('\n').pop().split('\t');
  fs.writeFileSync(marca, out.join('\n')); return out;
}
function pcm(arq, ini, fim) {
  const b = execFileSync(FF, ['-v', 'error', '-ss', String(ini), '-t', String(fim - ini), '-i', arq, '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
}
// menor distancia de edicao entre o gabarito e QUALQUER trecho da sequencia detectada (inicio e fim livres)
function melhorTrecho(gab, det) {
  let melhor = { d: Infinity };
  for (let tr = 0; tr < 12; tr++) {
    const g = gab.map((x) => (x + tr) % 12), ant = new Array(det.length + 1).fill(0); let lin = ant;
    for (let i = 1; i <= g.length; i++) { const cur = [i]; for (let j = 1; j <= det.length; j++) cur[j] = Math.min(lin[j] + 1, cur[j - 1] + 1, lin[j - 1] + (g[i - 1] === det[j - 1] ? 0 : 1)); lin = cur; }
    const d = Math.min(...lin); if (d < melhor.d) melhor = { d, tr };
  }
  return melhor;
}
let soma = 0, tot = 0;
for (const [nome, busca, ini, fim, gab, obs] of CASOS) {
  let info; try { info = baixar(busca); } catch (e) { console.log(`--  ${nome}: nao baixou (${String(e.message).split('\n')[0].slice(0, 80)})`); continue; }
  const [id, titulo, arq] = info;
  let seq = [], d = null; try { d = A.analisarPCM(pcm(arq, ini, fim), 22050); seq = d.seq; } catch (e) { console.log(`--  ${nome}: ${e.message}`); continue; }
  const det = (process.env.TELA && A.sequenciaNomes) ? A.sequenciaNomes(A.textoDeteccao(d), 0, false).map((n) => PCN[n]) : seq.map((s) => ((s.midi % 12) + 12) % 12), g = pcs(gab), m = melhorTrecho(g, det), certos = Math.max(0, g.length - m.d);
  soma += certos; tot += g.length;
  console.log(`${m.d === 0 ? 'OK ' : m.d <= g.length * 0.25 ? 'QUASE' : 'ERR'} ${String(certos).padStart(2)}/${String(g.length).padEnd(2)} ${nome}  [${obs}]`);
  console.log(`      video: ${titulo.slice(0, 60)} (${id}), ${ini}-${fim}s`);
  console.log(`      gabarito${m.tr ? ' (+' + m.tr + ' semitons)' : ''}: ${g.map((x) => NOMES[(x + m.tr) % 12]).join(' ')}`);
  console.log(`      detectado: ${det.map((x) => NOMES[x]).join(' ') || '(nada)'}`);
}
console.log(`\nnotas do gabarito encontradas em ordem: ${soma}/${tot} = ${tot ? (100 * soma / tot).toFixed(0) : 0}%`);
