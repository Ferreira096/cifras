// node avalia.mjs  (ANALISE=caminho de outro analise.js, para comparar)  -> mede a deteccao da SEQUENCIA de notas contra gabaritos
// Audio sintetico (gabarito exato), so com a analise pelo espectro. O teste completo, com o modelo de
// notas e os riffs conhecidos do YouTube, e o mede.mjs (que importa as melodias daqui).
import { pathToFileURL } from 'node:url';
const ARQ = process.env.ANALISE || new URL('../../docs/analise.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const A = await import(pathToFileURL(ARQ).href);
const SR = 22050;
const PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
export const midiDe = (n) => { const m = /^([A-G]#?)(\d)$/.exec(n); return PC[m[1]] + 12 * (+m[2] + 1); };
const f = (m) => 440 * 2 ** ((m - 69) / 12);
let semente = 7; const rnd = () => (semente = (semente * 16807) % 2147483647) / 2147483647;

// timbres: lista de [harmonico, amplitude], envelope
const TIMBRES = {
  piano: { h: [1, .55, .35, .22, .14, .09, .06, .04], tau: 0.55, atq: 0.006 },
  guitarra: { h: [1, .8, .7, .55, .45, .35, .3, .22, .18, .14, .1, .08], tau: 1.2, atq: 0.004, dist: 2.5 },
  sino: { h: [1, .2, .08], tau: 0.9, atq: 0.01 },            // teclado limpo (poucos harmonicos)
  sintetizador: { h: [1, .5, .33, .25, .2, .17, .14, .12, .11, .1], tau: 5, atq: 0.02 }, // dente de serra sustentado
};
function nota(buf, midi, t0, dur, vol, tb) {
  const i0 = Math.round(t0 * SR), n = Math.round(dur * SR), f0 = f(midi), fases = tb.h.map(() => rnd() * 6.283);
  for (let i = 0; i < n && i0 + i < buf.length; i++) {
    const t = i / SR; let env = Math.min(1, t / tb.atq) * Math.exp(-t / tb.tau); const fim = (n - i) / SR; if (fim < 0.02) env *= fim / 0.02;
    let s = 0; for (let k = 0; k < tb.h.length; k++) { if (f0 * (k + 1) > SR / 2 - 200) break; s += tb.h[k] * Math.sin(6.283185 * f0 * (k + 1) * t + fases[k]); }
    if (tb.dist) s = Math.tanh(s * tb.dist) / Math.tanh(tb.dist);
    buf[i0 + i] += vol * env * s;
  }
}
function bumbo(buf, t0, vol) { const i0 = Math.round(t0 * SR); for (let i = 0; i < SR * 0.12 && i0 + i < buf.length; i++) { const t = i / SR; buf[i0 + i] += vol * Math.exp(-t / 0.03) * Math.sin(6.283 * (110 * Math.exp(-t / 0.02) + 45) * t); } }
function chimbal(buf, t0, vol) { const i0 = Math.round(t0 * SR); let ant = 0; for (let i = 0; i < SR * 0.05 && i0 + i < buf.length; i++) { const r = rnd() * 2 - 1; buf[i0 + i] += vol * Math.exp(-i / SR / 0.012) * (r - ant); ant = r; } }
// melodia: [[nota, duracao], ...]; fundo: {baixo:[nota...] por compasso, acorde:[notas], bateria:true}
export function sintetiza(mel, timbre, fundo) {
  const total = mel.reduce((a, x) => a + x[1], 0) + 0.6, buf = new Float32Array(Math.round(total * SR));
  let t = 0.2; for (const [n, d] of mel) { if (n !== '-') nota(buf, midiDe(n), t, d * 0.92, 0.5, TIMBRES[timbre]); t += d; }
  if (fundo) {
    if (fundo.baixo) { const seg = (total - 0.2) / fundo.baixo.length; fundo.baixo.forEach((b, k) => nota(buf, midiDe(b), 0.2 + k * seg, seg, fundo.volBaixo || 0.6, { h: [1, .6, .3, .15, .08], tau: 2, atq: 0.01 })); }
    if (fundo.acorde) for (const n of fundo.acorde) nota(buf, midiDe(n), 0.2, total - 0.3, fundo.volAcorde || 0.12, TIMBRES.sintetizador);
    if (fundo.bateria) for (let b = 0.2; b < total; b += 0.5) { bumbo(buf, b, 0.5); chimbal(buf, b + 0.25, 0.15); chimbal(buf, b, 0.12); }
  }
  let mx = 0; for (const v of buf) mx = Math.max(mx, Math.abs(v)); for (let i = 0; i < buf.length; i++) buf[i] *= 0.8 / mx;
  return buf;
}
// distancia de edicao entre duas listas
export function edicao(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const PCN = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
export const detecta = (pcm) => { try { const d = A.analisarPCM(pcm, SR); if (process.env.TELA && A.sequenciaNomes) return A.sequenciaNomes(A.textoDeteccao(d), 0, false).map((n) => PCN[n] + 60); return d.seq.map((s) => s.midi); } catch (e) { return []; } };
const nome = (m) => A.nomeMidi(m);

const T = (s, d) => s.split(' ').map((n) => [n, d]);
export const CASOS = [
  ['piano solo, notas de 0,40 s', T('E4 G4 A4 B4 A4 G4 E4 D4', 0.4), 'piano'],
  ['piano solo, notas de 0,25 s', T('C5 D5 E5 G5 E5 D5 C5 A4 G4 A4 C5 D5', 0.25), 'piano'],
  ['piano solo, notas de 0,15 s (rapido)', T('E5 D#5 E5 D#5 E5 B4 D5 C5 A4', 0.15), 'piano'],
  ['piano, nota repetida (0,35 s)', T('E4 E4 G4 E4 D4 C4 B3', 0.35), 'piano'],
  ['piano, duracoes misturadas', [['F#4', 1.0], ['C#4', 0.3], ['B3', 1.1], ['G#4', 0.9], ['D#4', 0.25], ['F#4', 0.4], ['C#4', 0.5], ['B3', 0.7]], 'piano'],
  ['guitarra distorcida solo, 0,30 s', T('G3 A#3 C4 G3 A#3 C#4 C4 G3 A#3 C4 A#3 G3', 0.3), 'guitarra'],
  ['guitarra + baixo + bateria, 0,35 s', T('F#4 C#4 B3 G#4 F#4 C#4 B3 D#4', 0.35), 'guitarra', { baixo: ['B1', 'E2'], bateria: true }],
  ['guitarra + baixo + teclado de fundo + bateria', T('F#4 C#4 B3 G#4 F#4 C#4 B3 D#4', 0.35), 'guitarra', { baixo: ['B1', 'E2'], acorde: ['B3', 'D#4', 'F#4'], bateria: true }],
  ['teclado limpo + baixo forte + bateria', T('B4 A4 G#4 E4 F#4 G#4 E4 C#4', 0.4), 'sino', { baixo: ['E2', 'A1'], volBaixo: 0.9, bateria: true }],
  ['sintetizador sustentado + fundo cheio', T('E5 D5 C5 D5 E5 G5 E5 D5', 0.45), 'sintetizador', { baixo: ['C2', 'G1'], acorde: ['C4', 'E4', 'G4'], bateria: true }],
  ['riff grave (corda grossa) solo, 0,30 s', T('E2 E2 G2 E2 D2 C2 B1', 0.3), 'guitarra'],
  ['arpejo rapido de guitarra limpa, 0,20 s', T('D4 D5 A4 G4 G5 A4 F#5 A4', 0.2), 'piano'],
];
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let acertos = 0, total = 0, oit = 0;
  for (const [titulo, mel, timbre, fundo] of CASOS) {
    const certo = mel.filter((x) => x[0] !== '-').map((x) => midiDe(x[0])), achou = detecta(sintetiza(mel, timbre, fundo));
    const pc = (l) => l.map((m) => ((m % 12) + 12) % 12);
    const e = edicao(pc(certo), pc(achou)), eo = edicao(certo, achou);
    acertos += Math.max(0, certo.length - e); total += certo.length; oit += Math.max(0, certo.length - eo);
    console.log(`${e === 0 ? 'OK ' : 'ERR'} ${String(certo.length - e).padStart(2)}/${String(certo.length).padEnd(2)} ${titulo}`);
    if (e || eo) console.log('      certo: ' + certo.map(nome).join(' ') + '\n      achou: ' + achou.map(nome).join(' '));
  }
  console.log(`\nnotas certas (nome): ${acertos}/${total} = ${(100 * acertos / total).toFixed(0)}%   |   com a oitava certa: ${oit}/${total} = ${(100 * oit / total).toFixed(0)}%`);
}
