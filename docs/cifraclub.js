/* Leitura de cifras: usada pelo app (navegador) e pelos scripts da Action (Node).
   - parsePagina(html, url): pagina inteira do Cifra Club -> { titulo, artista, tom, capo, video, url, linhas }
   - parsePre(innerHTML do <pre>): linhas de segmentos (texto ou { c: "G#m7" }), preservando os
     espacos que mantem cada acorde em cima da silaba certa
   - parseTexto(texto colado): mesma estrutura, detectando as linhas de acordes
   Sem dependencias e sem DOM. */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function desentidade(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const hex = e[1] === 'x' || e[1] === 'X'; const n = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
// U+200B..U+200D e U+FEFF: o DOM renderizado do Cifra Club poe um "zero-width" no inicio de cada linha
const limpa = (s) => String(s || '').replace(/[​-‍﻿]/g, '');
const soTexto = (h) => limpa(desentidade(String(h || '').replace(/<[^>]+>/g, ' '))).replace(/\s+/g, ' ').trim();

function normalizaUrl(u) {
  const m = String(u || '').trim().match(/https?:\/\/(?:www\.|m\.)?cifraclub\.com\.br\/([^/?#\s]+)\/([^/?#\s]+)\/?/i);
  if (!m || /\.html?$/i.test(m[2])) return null;
  return `https://www.cifraclub.com.br/${m[1].toLowerCase()}/${m[2].toLowerCase()}/`;
}
const idDaUrl = (url) => url.replace(/^https?:\/\/(www\.)?cifraclub\.com\.br\//, '').replace(/\/$/, '').replace(/\//g, '__');

function aparar(linhas) {
  while (linhas.length && !linhas[0].length) linhas.shift();
  while (linhas.length && !linhas[linhas.length - 1].length) linhas.pop();
  return linhas;
}

function parsePre(preHtml) {
  const h = limpa(preHtml).replace(/<div[^>]*>/gi, '').replace(/<\/div>/gi, '').replace(/<br\s*\/?>/gi, '\n');
  const linhas = [];
  for (const raw of h.split(/\r?\n/)) {
    const segs = []; let resto = raw, buf = '', m;
    const re = /<b\b[^>]*>([\s\S]*?)<\/b>/i;
    while ((m = re.exec(resto))) {
      buf += resto.slice(0, m.index);
      const c = soTexto(m[1]);
      if (buf) { segs.push(desentidade(buf.replace(/<[^>]+>/g, ''))); buf = ''; }
      if (c) segs.push({ c });
      resto = resto.slice(m.index + m[0].length);
    }
    buf += resto;
    if (buf) segs.push(desentidade(buf.replace(/<[^>]+>/g, '')));
    linhas.push(segs.filter((s) => s !== ''));
  }
  return aparar(linhas);
}

function tituloArtista(title, url) {
  const p = soTexto(title).replace(/\s*-\s*Cifra Club\s*$/i, '').split(/\s+-\s+/);
  const m = String(url || '').match(/cifraclub\.com\.br\/([^/]+)\/([^/]+)/);
  const bonito = (s) => s.replace(/-/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  return { titulo: p[0] || (m ? bonito(m[2]) : ''), artista: p.slice(1).join(' - ') || (m ? bonito(m[1]) : '') };
}
const tomDoTexto = (t) => { const m = String(t || '').replace(/\s+/g, ' ').match(/Tom\s*([A-G][#b]?m?)(?![A-Za-z])/); return m ? m[1] : ''; };
const capoDoTexto = (t) => { const m = String(t || '').replace(/\s+/g, ' ').match(/Capotraste\s*(.*?)\s*Afina/); return m && !/sem capotraste/i.test(m[1]) ? m[1].slice(0, 30) : ''; };

function parsePagina(html, url) {
  const pi = html.search(/<pre\b/i);
  if (pi < 0) throw new Error('a página não tem o bloco da cifra');
  const pf = html.indexOf('</pre>', pi);
  const linhas = parsePre(html.slice(html.indexOf('>', pi) + 1, pf < 0 ? undefined : pf));
  if (!linhas.some((l) => l.some((s) => s && s.c))) throw new Error('a página não tem acordes, talvez seja só a letra');
  const { titulo, artista } = tituloArtista((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1], url);
  let tom = '';
  const ki = html.indexOf('id="key"');
  if (ki >= 0) tom = tomDoTexto(soTexto(html.slice(ki, ki + 2500)));
  if (!tom) { const m = html.match(/id="cifra_tom"[^>]*>[\s\S]*?<a[^>]*>([^<]+)</i); if (m) tom = soTexto(m[1]); }
  let capo = '';
  const ci = html.indexOf('id="capo"');
  if (ci >= 0) capo = capoDoTexto(soTexto(html.slice(ci, ci + 2500)));
  let video = '';
  const v = html.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/) || html.match(/"videoId"\s*:\s*"([\w-]{11})"/);
  if (v) video = v[1];
  return { titulo, artista, tom, capo, video, url, linhas };
}

/* ---- texto colado ---- */
const RE_ACORDE = /^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|M|°|º|ø|\+)?[0-9A-Za-z#()+°º,-]*(?:\/[A-G][#b]?)?(?:\([^)]*\))?$/;
function ehAcorde(tok) {
  if (!RE_ACORDE.test(tok)) return false;
  // corta palavras que comecam com A-G: "Deus", "Agua", "Em" passa (e acorde), "Eu" nao
  const resto = tok.replace(/^[A-G][#b]?/, '').replace(/\/[A-G][#b]?$/, '');
  return /^(?:m|maj|min|dim|aug|sus|add|M|°|º|ø|\+|-)?(?:[0-9]|[#b+()°º,/-]|maj|sus|add|dim|aug|M|m(?=[0-9(]|$))*$/.test(resto);
}
// tira parenteses/barras que EMBRULHAM o acorde ("( Am", "G )", "|C|"), sem comer o ")" de "D7(9)"
function desembrulha(tok) {
  let s = tok.replace(/^[(|[]+/, '');
  for (;;) {
    const u = s[s.length - 1];
    if (u === '|' || u === ']') { s = s.slice(0, -1); continue; }
    if (u === ')' && (s.match(/[(]/g) || []).length < (s.match(/[)]/g) || []).length) { s = s.slice(0, -1); continue; }
    return s;
  }
}
function linhaDeAcordes(txt) {
  const toks = txt.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  const limpos = toks.map(desembrulha).filter(Boolean);
  if (!limpos.length) return false;
  const n = limpos.filter(ehAcorde).length;
  return n === limpos.length || (limpos.length >= 4 && n >= limpos.length - 1);
}
function parseTexto(texto) {
  const linhas = [];
  for (const bruto of limpa(texto).replace(/\t/g, '    ').split(/\r?\n/)) {
    const raw = bruto.replace(/\s+$/, '');
    if (!raw.trim()) { linhas.push([]); continue; }
    // "[Intro] E  G#m  F#": o rotulo fica como texto, o resto e analisado como acordes
    const rot = raw.match(/^(\s*\[[^\]]+\]\s*)(.*)$/);
    const cabeca = rot ? rot[1] : '', corpo = rot ? rot[2] : raw;
    if (corpo.trim() && linhaDeAcordes(corpo)) {
      const segs = cabeca ? [cabeca] : [];
      for (const parte of corpo.split(/(\s+)/)) {
        if (!parte) continue;
        if (/^\s+$/.test(parte)) { segs.push(parte); continue; }
        const nu = desembrulha(parte);
        if (nu && ehAcorde(nu)) { const i = parte.indexOf(nu); if (i > 0) segs.push(parte.slice(0, i)); segs.push({ c: nu }); if (i + nu.length < parte.length) segs.push(parte.slice(i + nu.length)); }
        else segs.push(parte);
      }
      // junta textos vizinhos
      const junto = []; for (const s of segs) { if (typeof s === 'string' && typeof junto[junto.length - 1] === 'string') junto[junto.length - 1] += s; else junto.push(s); }
      linhas.push(junto);
    } else linhas.push([raw]);
  }
  aparar(linhas);
  // no maximo uma linha vazia seguida
  return linhas.filter((l, i) => l.length || (i > 0 && linhas[i - 1].length));
}

export { normalizaUrl, idDaUrl, parsePre, parsePagina, parseTexto, tituloArtista, tomDoTexto, capoDoTexto, ehAcorde };
globalThis.CifraClub = { normalizaUrl, idDaUrl, parsePre, parsePagina, parseTexto, tituloArtista, tomDoTexto, capoDoTexto, ehAcorde };
