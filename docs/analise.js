/* Analise de audio: usada pelo app (navegador) e pelo programa de notas (Node, no computador e no Termux).
   A SEQUENCIA do riff sai de um modelo de notas (mais abaixo, "modelo de notas"), no programa de
   notas e no app; o que segue da as notas/acorde e e a reserva quando o modelo nao carrega.
   Sem dependencias. Como a sequencia de notas do riff e achada (reescrito em 23/11/2026, medido
   contra melodias sinteticas e riffs conhecidos: ver LEIA-ME, "Quanto a deteccao acerta"):
   1. espectro por quadro (janela 4096, passo 512 a 22050 Hz) -> picos com frequencia interpolada;
   2. afinacao da gravacao: desvio medio dos picos em relacao ao La 440 (gravacoes fora do diapasao);
   3. saliencia por nota: cada pico vota na nota de que seria o 1o, 2o ... 8o harmonico, com peso
      caindo. A fundamental de verdade junta os votos de todos os seus harmonicos; a "quinta" (3o
      harmonico) so junta os dela. Antes o riff grave saia como a quinta da nota;
   4. nota sem a propria fundamental e "fantasma" (sub-harmonico de outra) e perde forca; nas
      graves aceita-se fundamental fraca se o 2o e o 3o harmonicos existem;
   5. duas linhas, grave (ate B2) e do riff (C3 para cima, onde os harmonicos da nota grave do
      quadro valem menos); o caminho de cada uma sai por Viterbi (trocar de nota custa, silencio e
      um estado), o que segura a nota em vez de pular a cada quadro;
   6. nota repetida: reataque medido na energia dos harmonicos da propria nota;
   7. se a linha do riff e so harmonico da grave no trecho todo, o riff E a grave (som grave sozinho). */
const NOTAS_S=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function fft(re,im){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
  for(let len=2;len<=n;len<<=1){ const ang=-2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
    for(let i=0;i<n;i+=len){ let cr=1,ci=0; for(let j=0;j<len/2;j++){ const a=i+j,b=a+len/2; const tr=re[b]*cr-im[b]*ci, ti=re[b]*ci+im[b]*cr; re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti; const ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr; } } }
}
const nomeMidi=(m)=>NOTAS_S[((m%12)+12)%12]+(Math.floor(m/12)-1);
const P = { H: 8, w: 0.8, lambda: 1.5, sil: 0.35, minQ: 5, corte: 48, atenua: 0.45, atenua2: 0.15, reat: 1.8, fund: 0.12, fantasma: 0.35, teto: 4 };
const M0 = 28, M1 = 96, NM = M1 - M0 + 1; // E1 .. C7

function analisarPCM(pcm, sr) {
  const N = 4096, hop = 512, win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2);
  const kMin = Math.max(2, Math.floor(60 * N / sr)), kMax = Math.min(N / 2 - 2, Math.ceil(5000 * N / sr));
  const T = Math.max(0, Math.floor((pcm.length - N) / hop) + 1); if (T < 4) throw new Error('Trecho curto demais para analisar.');
  // 1. picos
  const picos = new Array(T), topo = new Float32Array(T), ener = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    const s = t * hop; let e = 0; for (let i = 0; i < N; i++) { const v = pcm[s + i]; e += v * v; re[i] = v * win[i]; im[i] = 0; } ener[t] = e / N;
    fft(re, im); let mx = 0; for (let k = 0; k <= kMax + 1; k++) { mag[k] = Math.hypot(re[k], im[k]); if (k >= kMin && mag[k] > mx) mx = mag[k]; } topo[t] = mx;
    const l = []; for (let k = kMin; k <= kMax; k++) { const b = mag[k]; if (!(b > mag[k - 1] && b >= mag[k + 1]) || b < 0.02 * mx) continue; const a = mag[k - 1], c = mag[k + 1]; let d = 0.5 * (a - c) / (a - 2 * b + c); if (!isFinite(d) || Math.abs(d) > 1) d = 0; l.push({ f: (k + d) * sr / N, a: b }); }
    l.sort((x, y) => y.a - x.a); picos[t] = l.slice(0, 40);
  }
  const eMax = Math.max(...ener); if (!(eMax > 0)) throw new Error('Nao captei som nesse trecho. Aumente o volume ou aproxime o microfone.');
  const ref = [...topo].sort((a, b) => a - b)[Math.floor(T * 0.9)] || 1; // nivel "forte" do trecho
  // 2. afinacao (media circular do desvio em cents)
  let sx = 0, sy = 0; for (let t = 0; t < T; t++) for (const p of picos[t]) { if (p.f < 100 || p.f > 2000) continue; const c = 1200 * Math.log2(p.f / 440); const ang = 2 * Math.PI * (c / 100); sx += p.a * Math.cos(ang); sy += p.a * Math.sin(ang); }
  const desvio = Math.atan2(sy, sx) / (2 * Math.PI); // em semitons, -0.5..0.5
  const midiDe = (f) => 69 + 12 * Math.log2(f / 440) - desvio;
  // 3. saliencia (duas: completa e "sem os harmonicos do grave")
  const S = new Float32Array(T * NM), chroma = new Float64Array(12), porMidi = new Float64Array(128);
  // evidencia de que a nota existe mesmo: F[0] = amplitude da propria fundamental (h=1), F[1] = do 2o, F[2] = do 3o harmonico.
  // Nota sem fundamental e, em geral, 'fantasma': sub-harmonico de outra nota (uma oitava ou uma quinta abaixo).
  const novoF = () => [new Float32Array(T * NM), new Float32Array(T * NM), new Float32Array(T * NM)];
  const F = novoF();
  const vota = (dest, t, f, a, ev) => { for (let h = 1; h <= P.H; h++) { const m = midiDe(f / h), mi = Math.round(m); if (mi < M0) break; if (mi > M1) continue; const d = Math.abs(m - mi); if (d > 0.4) continue; dest[t * NM + mi - M0] += a * Math.pow(P.w, h - 1) * (1 - d); if (h <= 3) ev[h - 1][t * NM + mi - M0] += a; } };
  // real(i): agudas (B3 para cima) precisam da fundamental; graves aceitam fundamental fraca se o 2o E o 3o harmonicos existem
  const real = (ev, i, m, total) => ev[0][i] >= P.fund * total || (m < P.corte && Math.min(ev[1][i], ev[2][i]) >= P.fund * total);
  const castiga = (dest, ev) => { for (let i = 0; i < dest.length; i++) if (dest[i] > 0 && !real(ev, i, M0 + i % NM, dest[i])) dest[i] *= P.fantasma; };
  for (let t = 0; t < T; t++) {
    if (ener[t] < eMax * 0.002) continue;
    for (const p of picos[t]) { const a = Math.sqrt(p.a / ref); vota(S, t, p.f, a, F); const m = midiDe(p.f), mi = Math.round(m); if (Math.abs(m - mi) <= 0.4 && mi >= 0 && mi < 128) { chroma[((mi % 12) + 12) % 12] += p.a * p.a; porMidi[mi] += p.a * p.a; } }
  }
  castiga(S, F);
  // linha grave: melhor nota ate o corte, quadro a quadro (para saber de quem sao os harmonicos)
  const iCorte = P.corte - M0, graveQ = new Int16Array(T).fill(-1);
  for (let t = 0; t < T; t++) { let b = -1, bv = 0; for (let j = 0; j < iCorte; j++) if (S[t * NM + j] > bv) { bv = S[t * NM + j]; b = j; } if (bv > 0.6) graveQ[t] = b + M0; }
  // saliencia aguda: picos que sao harmonicos da nota grave do quadro valem menos
  const SA = new Float32Array(T * NM), FA = novoF();
  for (let t = 0; t < T; t++) {
    if (ener[t] < eMax * 0.002) continue; const g = graveQ[t], fg = g > 0 ? 440 * Math.pow(2, (g - 69 + desvio) / 12) : 0;
    for (const p of picos[t]) { let a = Math.sqrt(p.a / ref); if (fg) { const r = p.f / fg, ri = Math.round(r); if (ri >= 2 && ri <= 12 && Math.abs(12 * Math.log2(r / ri)) < 0.35) a *= ri <= 3 ? P.atenua2 : P.atenua; } vota(SA, t, p.f, a, FA); }
  }
  castiga(SA, FA);
  // 4. Viterbi numa faixa de notas [a,b] de uma matriz de saliencia
  const caminho = (Mx, a, b) => {
    const n = b - a + 2, SIL = n - 1, ant = new Float32Array(n), cur = new Float32Array(n), de = new Int16Array(T * n);
    const em = (t, j) => j === SIL ? P.sil : Math.min(P.teto, Mx[t * NM + a - M0 + j]);
    for (let j = 0; j < n; j++) ant[j] = em(0, j);
    for (let t = 1; t < T; t++) {
      let mj = 0; for (let j = 1; j < n; j++) if (ant[j] > ant[mj]) mj = j; const melhorTroca = ant[mj] - P.lambda;
      for (let j = 0; j < n; j++) { if (ant[j] >= melhorTroca) { cur[j] = ant[j]; de[t * n + j] = j; } else { cur[j] = melhorTroca; de[t * n + j] = mj; } cur[j] += em(t, j); }
      ant.set(cur);
    }
    let j = 0; for (let k = 1; k < n; k++) if (ant[k] > ant[j]) j = k;
    const est = new Int16Array(T); for (let t = T - 1; t >= 0; t--) { est[t] = j === SIL ? -1 : a + j; j = de[t * n + j]; }
    return est;
  };
  // 5. agrupa em notas; reataque = a energia dos harmonicos da nota sobe de novo
  const forcaNota = (t, m) => { const f0 = 440 * Math.pow(2, (m - 69 + desvio) / 12); let v = 0; for (const p of picos[t]) { const r = p.f / f0, ri = Math.round(r); if (ri >= 1 && ri <= 4 && Math.abs(12 * Math.log2(r / ri)) < 0.4) v += p.a; } return v; };
  const notasDe = (est, Mx) => {
    const out = []; let i = 0;
    while (i < T) { if (est[i] < 0) { i++; continue; } let j = i; while (j < T && est[j] === est[i]) j++; out.push({ midi: est[i], a: i, b: j }); i = j; }
    // a mesma nota "pulando" de oitava (o caminho troca entre a nota e a oitava dela) nao e nota nova,
    // a nao ser que haja um ataque de verdade na troca (salto de oitava tocado, como num arpejo)
    for (let k = 1; k < out.length; k++) {
      const x = out[k - 1], y = out[k]; if (x.b !== y.a || x.midi === y.midi || ((x.midi - y.midi) % 12 + 12) % 12 !== 0) continue;
      let antes = Infinity, depois = 0; for (let u = Math.max(x.a, y.a - 3); u < y.a; u++) antes = Math.min(antes, forcaNota(u, y.midi)); for (let u = y.a; u < Math.min(y.b, y.a + 4); u++) depois = Math.max(depois, forcaNota(u, y.midi));
      if (antes > 0 && depois < antes * P.reat) { const fica = (x.b - x.a) >= (y.b - y.a) ? x.midi : y.midi; out.splice(k - 1, 2, { midi: fica, a: x.a, b: y.b }); k--; }
    }
    // reataques dentro de uma nota longa
    const div = [];
    for (const n of out) {
      const E = []; for (let t = n.a; t < n.b; t++) E.push(forcaNota(t, n.midi)); let ini = n.a, ult = n.a;
      for (let k = 4; k < E.length - 3; k++) { const antes = Math.min(E[k - 1], E[k - 2], E[k - 3]), depois = Math.max(E[k], E[k + 1], E[k + 2]); if (antes > 0 && depois > antes * P.reat && E[k] > E[k - 1] && (n.a + k - ult) * hop / sr >= 0.12) { div.push({ midi: n.midi, a: ini, b: n.a + k }); ini = n.a + k; ult = ini; k += 3; } }
      div.push({ midi: n.midi, a: ini, b: n.b });
    }
    return div.filter((n) => n.b - n.a >= P.minQ).map((n) => { let s = 0; for (let t = n.a; t < n.b; t++) s += Mx[t * NM + n.midi - M0]; return { midi: n.midi, ini: n.a * hop / sr, dur: (n.b - n.a) * hop / sr, forca: s / (n.b - n.a) }; });
  };
  const estG = caminho(S, M0, P.corte - 1), estA = caminho(SA, P.corte, M1);
  let baixo = notasDe(estG, S), seq = notasDe(estA, SA);
  // 6. a linha aguda e so harmonico da grave? entao o riff e a grave
  let comA = 0, harm = 0, comG = 0, realG = 0; for (let t = 0; t < T; t++) { if (estG[t] > 0) { comG++; const i = t * NM + estG[t] - M0; if (F[0][i] > 0 || Math.min(F[1][i], F[2][i]) > 0) realG++; } if (estA[t] < 0) continue; comA++; if (estG[t] > 0) { const d = estA[t] - estG[t]; if ([12, 19, 24, 28, 31, 36].includes(d)) harm++; } }
  if (comG && realG / comG < 0.6) baixo = []; // linha grave fantasma: so sub-harmonicos da aguda
  const notas = []; const max = Math.max(...chroma);
  for (let p = 0; p < 12; p++) if (chroma[p] >= max * 0.30) { let oit = -1, ov = 0; for (let m = p; m < 128; m += 12) if (porMidi[m] > ov) { ov = porMidi[m]; oit = m; } notas.push({ p, peso: chroma[p] / max, nome: oit >= 0 ? nomeMidi(oit) : NOTAS_S[p] }); }
  notas.sort((a, b) => b.peso - a.peso);
  let acorde = '', acV = -Infinity;
  for (let r = 0; r < 12; r++) for (const [suf, iv] of [['', [0, 4, 7]], ['m', [0, 3, 7]]]) { let v = 0; for (let p = 0; p < 12; p++) v += iv.includes((p - r + 12) % 12) ? chroma[p] : -0.6 * chroma[p]; if (v > acV) { acV = v; acorde = NOTAS_S[r] + suf; } }
  const dur = pcm.length / sr;
  // nota bem mais fraca que as outras do riff e ruido (batida da bateria, resto de reverberacao)
  const limpa = (s) => { if (s.length < 3) return s; const f = s.map((x) => x.forca).sort((x, y) => x - y), med = f[Math.floor(f.length / 2)]; return s.filter((x) => x.forca >= med * 0.45); };
  if (!seq.length || (baixo.length && comA && harm / comA >= 0.85)) return { notas, acorde, seq: limpa(baixo), baixo: [], dur }; // a linha aguda era so harmonico da grave: o riff e a grave
  return { notas, acorde, seq: limpa(seq), baixo, dur };
}
/* ---- modelo de notas (programa de notas e, desde 23/11/2026, tambem microfone/guia/arquivo no app) ----
   A sequencia do riff sai melhor com um modelo treinado para transcrever notas (basic-pitch, da
   Spotify, licenca Apache-2.0; arquivo docs/programa/modelo/nmp.onnx) do que so com o espectro:
   medido em 23/11/2026 em 18 riffs conhecidos, 80% das notas contra 66% (ver LEIA-ME). O modelo
   devolve, a cada ~11,6 ms, a probabilidade de cada tecla do piano estar soando ("nota") e de
   estar comecando ("ataque"). Daqui sai a linha:
   1. duas linhas, grave (ate B2) e aguda (C3 para cima), cada uma por Viterbi: silencio e um
      estado, e trocar de nota custa mais quanto maior o salto (a melodia fica no registro dela em
      vez de pular para o acompanhamento);
   2. nota repetida: pico de "ataque" da propria nota dentro dela;
   3. o riff e a linha com mais notas claras (riff de guitarra/baixo mora na grave; um baixo de
      duas notas longas perde para a melodia).
   criaModelo(ort, bytes): ort = onnxruntime-web (WASM), bytes = o nmp.onnx. Devolve posteriores(pcm). */
const PM = { corte: 48, topo: 96, sil: 0.2, lambda: 0.3, mu: 0.12, teto: 12, atq: 0.8, minQ: 7, fraca: 0.45, lim: 0.3 };
const BP = { N: 43844, SOBRA: 30, NB: 88, M0: 21, NOTA: 'StatefulPartitionedCall:1', ATAQUE: 'StatefulPartitionedCall:2' };
async function criaModelo(ort, bytes) {
  const sess = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  if (!sess.outputNames.includes(BP.NOTA) || !sess.outputNames.includes(BP.ATAQUE)) throw new Error('modelo de notas com saidas diferentes do esperado');
  const entrada = sess.inputNames[0], PASSO = BP.N - BP.SOBRA * 256, UTIL = 172 - BP.SOBRA, NB = BP.NB; // janelas de 2 s, sobrepostas em 30 quadros
  return async function posteriores(pcm) { // pcm a 22050 Hz
    const x = new Float32Array(pcm.length + BP.SOBRA * 128); x.set(pcm, BP.SOBRA * 128);
    const nj = Math.max(1, Math.ceil(x.length / PASSO)), T = Math.min(nj * UTIL, Math.floor(pcm.length * 86 / 22050));
    const nota = new Float32Array(T * NB), ataque = new Float32Array(T * NB), buf = new Float32Array(BP.N);
    for (let j = 0; j < nj; j++) {
      buf.fill(0); buf.set(x.subarray(j * PASSO, Math.min(x.length, j * PASSO + BP.N)));
      const out = await sess.run({ [entrada]: new ort.Tensor('float32', buf, [1, BP.N, 1]) }), n = out[BP.NOTA].data, a = out[BP.ATAQUE].data;
      for (let q = 0; q < UTIL; q++) { const t = j * UTIL + q; if (t >= T) break; const o = (q + BP.SOBRA / 2) * NB; nota.set(n.subarray(o, o + NB), t * NB); ataque.set(a.subarray(o, o + NB), t * NB); }
    }
    return { T, dt: PASSO / UTIL / 22050, nota, ataque };
  };
}
function linhaDoModelo(post, P = PM) {
  const { T, dt, nota, ataque } = post, NB = BP.NB, M0m = BP.M0; if (T < 8) return { seq: [], baixo: [] };
  const caminho = (a, b) => {
    const n = b - a + 2, SIL = n - 1, ant = new Float32Array(n), cur = new Float32Array(n), de = new Int16Array(T * n);
    const em = (t, j) => j === SIL ? P.sil : nota[t * NB + a - M0m + j];
    const custo = new Float32Array(n); for (let d = 1; d < n; d++) custo[d] = P.lambda + P.mu * Math.min(d, P.teto);
    for (let j = 0; j < n; j++) ant[j] = em(0, j);
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < n; j++) {
        let mv = ant[j], mi = j;
        if (j === SIL) { for (let i = 0; i < SIL; i++) { const v = ant[i] - P.lambda; if (v > mv) { mv = v; mi = i; } } }
        else { const vs = ant[SIL] - P.lambda; if (vs > mv) { mv = vs; mi = SIL; } for (let i = 0; i < SIL; i++) { const v = ant[i] - custo[i > j ? i - j : j - i]; if (v > mv) { mv = v; mi = i; } } }
        cur[j] = mv + em(t, j); de[t * n + j] = mi;
      }
      ant.set(cur);
    }
    let j = 0; for (let k = 1; k < n; k++) if (ant[k] > ant[j]) j = k;
    const est = new Int16Array(T); for (let t = T - 1; t >= 0; t--) { est[t] = j === SIL ? -1 : a + j; j = de[t * n + j]; }
    return est;
  };
  const notasDe = (est) => {
    const out = []; let i = 0;
    while (i < T) { if (est[i] < 0) { i++; continue; } let j = i; while (j < T && est[j] === est[i]) j++; out.push({ midi: est[i], a: i, b: j }); i = j; }
    const div = [];
    for (const n of out) { // nota repetida: pico de "ataque" da propria nota dentro dela
      let ini = n.a; const c = n.midi - M0m;
      for (let t = n.a + 4; t < n.b - 2; t++) { const v = ataque[t * NB + c]; if (v >= P.atq && v >= ataque[(t - 1) * NB + c] && v > ataque[(t + 1) * NB + c] && t - ini >= 6) { div.push({ midi: n.midi, a: ini, b: t }); ini = t; } }
      div.push({ midi: n.midi, a: ini, b: n.b });
    }
    return div.filter((n) => n.b - n.a >= P.minQ).map((n) => { let s = 0; for (let t = n.a; t < n.b; t++) s += nota[t * NB + n.midi - M0m]; return { midi: n.midi, ini: n.a * dt, dur: (n.b - n.a) * dt, forca: s / (n.b - n.a) }; });
  };
  const limpa = (s) => { if (s.length < 3) return s; const f = s.map((x) => x.forca).sort((x, y) => x - y), med = f[Math.floor(f.length / 2)]; return s.filter((x) => x.forca >= med * P.fraca); };
  const grave = limpa(notasDe(caminho(28, P.corte - 1))), aguda = limpa(notasDe(caminho(P.corte, P.topo)));
  const claras = (s) => s.reduce((a, x) => a + Math.max(0, x.forca - P.lim), 0);
  return claras(grave) > claras(aguda) ? { seq: grave, baixo: [], outra: aguda, grave: true } : { seq: aguda, baixo: grave };
}
// analise completa com o modelo: as notas e o acorde saem do espectro (como antes); a sequencia, do modelo
async function analisarComModelo(pcm, sr, posteriores) {
  if (sr !== 22050) throw new Error('o modelo de notas espera audio a 22050 Hz');
  const d = analisarPCM(pcm, sr), l = linhaDoModelo(await posteriores(pcm));
  if (!l.seq.length) return d; // o modelo nao ouviu nota: fica a sequencia do espectro
  return { ...d, seq: l.seq, baixo: l.baixo, motor: 'modelo' };
}

function textoDeteccao(d){
  const notas=d.notas.map(n=>n.nome).join(' ');
  const escreve=(l)=>(l||[]).map(s=>nomeMidi(s.midi)+'('+s.dur.toFixed(1)+'s)').join(' ');
  const seq=escreve(d.seq), baixo=escreve(d.baixo);
  return {notas, seq, baixo, resumo:'Notas: '+notas+(d.acorde?'  ·  acorde provavel: '+d.acorde:'')+(seq?'\nRiff: '+seq:'')+(baixo?'\nBaixo: '+baixo:'')};
}

/* ---- notas de riff: transpor e desenhar para teclado ----
   As notas de um riff (digitadas ou detectadas) ficam guardadas no tom ORIGINAL da cifra e sao
   mostradas no tom que estiver na tela, como os acordes. */
const NOTAS_B=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const PC_NOTA={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,'E#':5,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0};
const nomePc=(pc,bemol)=>(bemol?NOTAS_B:NOTAS_S)[((pc%12)+12)%12];
const nomeMidiTom=(m,bemol)=>nomePc(m,bemol)+(Math.floor(m/12)-1);
// nota solta num texto: "E", "G#", "Bb4"; nao pega letra de palavra ("Em", "Do", "Fim") nem numero de duracao
const RE_NOTA=/(^|[^A-Za-z0-9#.])([A-G][#b]?)(\d)?(?![A-Za-z0-9#])/g;
function transporNotas(texto,n,bemol){
  n=+n||0;
  return String(texto||'').replace(RE_NOTA,(tudo,antes,nome,oit)=>{
    const pc=PC_NOTA[nome]; if(pc==null) return tudo;
    if(oit==null||oit==='') return antes+(n?nomePc(pc+n,bemol):nome);
    return antes+(n?nomeMidiTom(pc+12*(+oit+1)+n,bemol):nome+oit);
  });
}
/* "B4(2.0s) E5(0.5s)" -> [{midi,dur}] ; aceita tambem so "E5 G#5" */
function sequenciaDe(texto){
  const seq=[]; const re=/([A-G][#b]?)(\d)(?:\(([\d.]+)s\))?/g; let m;
  while((m=re.exec(String(texto||'')))){ const pc=PC_NOTA[m[1]]; if(pc==null) continue; seq.push({midi:pc+12*(+m[2]+1),dur:m[3]?+m[3]:0.5}); }
  return seq;
}
/* notas-base: as notas da sequencia na ordem em que aparecem, sem repetir e sem oitava. Nota
   que soma menos de 0,25 s no trecho todo (passagem, escorregada) fica de fora quando sobram
   pelo menos duas mais firmes. */
function notasBase(det,n,bemol){
  n=+n||0; let seq=sequenciaDe(det&&det.seq); if(!seq.length) seq=sequenciaDe(det&&det.notas);
  const total={}; for(const s of seq){ const pc=((s.midi%12)+12)%12; total[pc]=(total[pc]||0)+s.dur; }
  const firmes=Object.keys(total).filter(pc=>total[pc]>=0.25).length;
  const base=[]; for(const s of seq){ const pc=((s.midi%12)+12)%12; if(firmes>=2&&total[pc]<0.25) continue; const nome=nomePc(pc+n,bemol); if(!base.includes(nome)) base.push(nome); }
  return base;
}
/* desenho no tempo, igual a tablatura de teclado: uma linha por tecla, "o" onde a nota entra e
   "=" enquanto dura. Devolve [{nota, corpo}] da mais aguda para a mais grave. */
function roloDeNotas(det,n,bemol){
  n=+n||0; const seq=sequenciaDe(det&&det.seq); if(seq.length<2) return null;
  const passo=0.12; let col=0; const ev=[];
  for(const s of seq){ const w=Math.max(2,Math.round(s.dur/passo)); ev.push({midi:s.midi+n,col,w}); col+=w+1; }
  const largura=col, notas=[...new Set(ev.map(e=>e.midi))].sort((a,b)=>b-a);
  return notas.map(m=>{ const arr=new Array(largura).fill('-'); for(const e of ev) if(e.midi===m){ arr[e.col]='o'; for(let k=1;k<e.w;k++) arr[e.col+k]='='; } return {nota:nomeMidiTom(m,bemol),corpo:arr.join('')}; });
}
/* A sequencia em "tempos", para desenhar quadrinhos com o nome da nota (mesmo formato de
   CifraClub.tabEmTempos): linhas da mais aguda para a mais grave; l = 0..4 conforme a duracao. */
function temposDeNotas(det,n,bemol){
  n=+n||0; const seq=sequenciaDe(det&&det.seq); if(seq.length<2) return null;
  const midis=[...new Set(seq.map(s=>s.midi+n))].sort((a,b)=>b-a);
  const linhas=midis.map(m=>({nome:nomePc(m,bemol),oit:Math.floor(m/12)-1}));
  const tempos=seq.map(s=>({i:[midis.indexOf(s.midi+n)],l:Math.max(0,Math.min(4,Math.round((s.dur-0.25)/0.25)))}));
  return {linhas,tempos};
}
/* A sequencia para mostrar: so os nomes das notas, na ordem em que entram, no tom pedido.
   (Juntar notas seguidas de mesmo nome em oitavas diferentes foi testado e piorou o acerto.) */
function sequenciaNomes(det,n,bemol){
  n=+n||0; let seq=sequenciaDe(det&&det.seq); if(!seq.length) seq=sequenciaDe(det&&det.notas);
  return seq.map(s=>nomePc(s.midi+n,bemol));
}

export { analisarPCM, criaModelo, linhaDoModelo, analisarComModelo, textoDeteccao, nomeMidi, fft, transporNotas, sequenciaDe, notasBase, roloDeNotas, temposDeNotas, sequenciaNomes };
globalThis.Analise = { analisarPCM, criaModelo, linhaDoModelo, analisarComModelo, textoDeteccao, nomeMidi, transporNotas, sequenciaDe, notasBase, roloDeNotas, temposDeNotas, sequenciaNomes };
