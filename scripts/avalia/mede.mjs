// node scripts/avalia/mede.mjs [modelo|simples] [-v|-vv]
// Mede quanto a deteccao da SEQUENCIA de notas acerta, do jeito que o programa de notas faz:
//   modelo  = docs/analise.js com o modelo de notas (docs/programa/modelo), o padrao do programa;
//   simples = so a analise pelo espectro (o que o app faz no navegador e a reserva do programa).
// Parte 1: riffs conhecidos do YouTube (casos.mjs) contra as notas publicadas. A comparacao ignora
//   oitava e tom (gravacao meio tom abaixo, etc.): procura, em qualquer transposicao, o trecho da
//   sequencia detectada mais parecido com o gabarito. Grupos "antigo" (os 6 primeiros riffs, usados
//   desde o comeco) e "novo" (12 acrescentados em 23/11/2026) saem separados: se um ajuste melhora
//   um grupo e piora o outro, e ajuste demais.
// Parte 2: melodias sinteticas (avalia.mjs), com gabarito exato.
// Os audios ficam FORA do repositorio (pasta notas-youtube/cache/avalia). Precisa da pasta
// notas-youtube ao lado (Python com yt-dlp e ffmpeg) ou de CIFRAS_RUNTIME / CIFRAS_AUDIO.
// Rode antes e depois de mexer em docs/analise.js; o numero nao pode cair. Ver LEIA-ME, "Quanto a deteccao acerta".
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASOS } from './casos.mjs';
const AQUI = path.dirname(fileURLToPath(import.meta.url)), DOCS = path.join(AQUI, '..', '..', 'docs');
const RT = process.env.CIFRAS_RUNTIME || path.join(AQUI, '..', '..', '..', 'notas-youtube', 'runtime', 'python');
const PY = RT + '/python.exe', FF = RT + '/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe';
const AUD = path.join(process.env.CIFRAS_AUDIO || path.join(AQUI, '..', '..', '..', 'notas-youtube', 'cache'), 'avalia'); fs.mkdirSync(AUD, { recursive: true });
const PCN = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const NOMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pcs = (s) => s.trim().split(/\s+/).map((n) => PCN[n]);
function baixar(busca) {
  const marca = path.join(AUD, busca.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) + '.txt');
  if (fs.existsSync(marca)) return fs.readFileSync(marca, 'utf8').split('\n');
  const out = execFileSync(PY, ['-I', '-m', 'yt_dlp', '--no-playlist', '--no-progress', '--no-warnings', '--no-part', '--ffmpeg-location', FF, '-f', '140/bestaudio[ext=m4a]/bestaudio', '--max-filesize', '25M', '--match-filter', 'duration < 600',
    '--print', 'after_move:%(id)s\t%(title)s\t%(filepath)s', '-o', path.join(AUD, '%(id)s.%(ext)s'), 'ytsearch1:' + busca], { encoding: 'utf8', timeout: 240000 }).trim().split('\n').pop().split('\t');
  fs.writeFileSync(marca, out.join('\n')); return out;
}
function pcmDe(arq, ini, fim) {
  const b = execFileSync(FF, ['-v', 'error', '-ss', String(ini), '-t', String(fim - ini), '-i', arq, '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
}
// menor distancia de edicao entre o gabarito e QUALQUER trecho da sequencia detectada (inicio e fim livres), em qualquer tom
function melhorTrecho(g0, det) {
  let melhor = { d: Infinity };
  for (let tr = 0; tr < 12; tr++) {
    const g = g0.map((x) => (x + tr) % 12); let lin = new Array(det.length + 1).fill(0);
    for (let i = 1; i <= g.length; i++) { const cur = [i]; for (let j = 1; j <= det.length; j++) cur[j] = Math.min(lin[j] + 1, cur[j - 1] + 1, lin[j - 1] + (g[i - 1] === det[j - 1] ? 0 : 1)); lin = cur; }
    const d = Math.min(...lin); if (d < melhor.d) melhor = { d, tr };
  }
  return melhor;
}
const pct = (x) => `${x[0]}/${x[1]} = ${x[1] ? (100 * x[0] / x[1]).toFixed(0) : 0}%`;

const metodo = process.argv.includes('simples') ? 'simples' : 'modelo', verboso = process.argv.includes('-vv') ? 2 : process.argv.includes('-v') ? 1 : 0;
const A = await import(pathToFileURL(path.join(DOCS, 'analise.js')).href);
let detecta = async (pcm) => A.analisarPCM(pcm, 22050).seq.map((s) => s.midi);
if (metodo === 'modelo') {
  const m = await import(pathToFileURL(path.join(DOCS, 'programa', 'modelo', 'ort.wasm.bundle.min.mjs')).href), ort = m.default && m.default.InferenceSession ? m.default : m;
  ort.env.wasm.numThreads = 1;
  const posteriores = await A.criaModelo(ort, new Uint8Array(fs.readFileSync(path.join(DOCS, 'programa', 'modelo', 'nmp.onnx'))));
  detecta = async (pcm) => (await A.analisarComModelo(pcm, 22050, posteriores)).seq.map((s) => s.midi);
}
console.log('deteccao: ' + metodo + '\n');
const r = { antigo: [0, 0], novo: [0, 0], total: [0, 0] };
for (const [nome, busca, ini, fim, gab, grupo] of CASOS) {
  let info; try { info = baixar(busca); } catch (e) { console.log(`--    ${nome}: nao baixou (${String(e.message).split('\n')[0].slice(0, 90)})`); continue; }
  let det = []; try { det = (await detecta(pcmDe(info[2], ini, fim))).map((x) => ((x % 12) + 12) % 12); } catch (e) { console.log(`--    ${nome}: ${String(e.message).slice(0, 90)}`); continue; }
  const g = pcs(gab), m = melhorTrecho(g, det), certos = Math.max(0, g.length - m.d);
  r[grupo][0] += certos; r[grupo][1] += g.length; r.total[0] += certos; r.total[1] += g.length;
  console.log(`${m.d === 0 ? 'OK   ' : m.d <= g.length * 0.25 ? 'QUASE' : 'ERR  '} ${String(certos).padStart(2)}/${String(g.length).padEnd(2)} ${nome}  (${info[1].slice(0, 44)}, ${ini}-${fim}s)`);
  if (verboso > 1 || (verboso && m.d)) console.log(`      gabarito${m.tr ? ' (+' + m.tr + ' semitons)' : ''}: ${g.map((x) => NOMES[(x + m.tr) % 12]).join(' ')}\n      detectado: ${det.map((x) => NOMES[x]).join(' ') || '(nada)'}`);
}
console.log(`\nRIFFS REAIS  notas do gabarito encontradas em ordem: ${pct(r.total)}   (antigos ${pct(r.antigo)} | novos ${pct(r.novo)})`);

const S = await import('./avalia.mjs');
let ac = 0, tot = 0, oit = 0;
for (const [titulo, mel, timbre, fundo] of S.CASOS) {
  const certo = mel.filter((x) => x[0] !== '-').map((x) => S.midiDe(x[0])); let achou = []; try { achou = await detecta(S.sintetiza(mel, timbre, fundo)); } catch (e) {}
  const pc = (l) => l.map((x) => ((x % 12) + 12) % 12), e = S.edicao(pc(certo), pc(achou)), eo = S.edicao(certo, achou);
  ac += Math.max(0, certo.length - e); tot += certo.length; oit += Math.max(0, certo.length - eo);
  if (verboso && (e || verboso > 1)) console.log(`${e ? 'ERR' : 'OK '} ${certo.length - e}/${certo.length} ${titulo}\n      certo: ${certo.map(A.nomeMidi).join(' ')}\n      achou: ${achou.map(A.nomeMidi).join(' ')}`);
}
console.log(`SINTETICOS   notas certas (nome): ${pct([ac, tot])}   |   com a oitava certa: ${pct([oit, tot])}`);
