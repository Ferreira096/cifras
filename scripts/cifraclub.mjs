/* Leitura da pagina do Cifra Club -> cifra estruturada. Mesma logica do functions/api/cifra.js
   da versao Cloudflare; aqui roda no Node da GitHub Action. */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function desentidade(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const hex = e[1] === 'x' || e[1] === 'X'; return String.fromCodePoint(parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10)); }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const soTexto = (h) => desentidade(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function normalizaUrl(u) {
  const m = String(u || '').trim().match(/^https?:\/\/(?:www\.|m\.)?cifraclub\.com\.br\/([^/?#\s]+)\/([^/?#\s]+)\/?/i);
  if (!m || /\.html?$/i.test(m[2])) return null;
  return `https://www.cifraclub.com.br/${m[1].toLowerCase()}/${m[2].toLowerCase()}/`;
}
export function idDaUrl(url) { return url.replace(/^https?:\/\/(www\.)?cifraclub\.com\.br\//, '').replace(/\/$/, '').replace(/\//g, '__'); }

export function parsePre(preHtml) {
  let h = preHtml.replace(/<div[^>]*>/gi, '').replace(/<\/div>/gi, '').replace(/<br\s*\/?>/gi, '\n');
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
  while (linhas.length && !linhas[0].length) linhas.shift();
  while (linhas.length && !linhas[linhas.length - 1].length) linhas.pop();
  return linhas;
}

export function parsePagina(html, url) {
  const pi = html.search(/<pre\b/i);
  if (pi < 0) throw new Error('nao achei a cifra nessa pagina');
  const pf = html.indexOf('</pre>', pi);
  const preHtml = html.slice(html.indexOf('>', pi) + 1, pf);
  const title = soTexto((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  const p = title.replace(/\s*-\s*Cifra Club\s*$/i, '').split(/\s+-\s+/);
  const titulo = p[0] || soTexto((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  let artista = p.slice(1).join(' - ');
  if (!artista) { const m = url.match(/cifraclub\.com\.br\/([^/]+)\//); artista = m ? m[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : ''; }
  let tom = '';
  const ki = html.indexOf('id="key"');
  if (ki >= 0) { const m = soTexto(html.slice(ki, ki + 2000)).match(/Tom\s+([A-G][#b]?m?)/); if (m) tom = m[1]; }
  if (!tom) { const m = html.match(/id="cifra_tom"[^>]*>[\s\S]*?<a[^>]*>([^<]+)</i); if (m) tom = soTexto(m[1]); }
  let capo = '';
  const ci = html.indexOf('id="capo"');
  if (ci >= 0) { const m = soTexto(html.slice(ci, ci + 2000)).match(/Capotraste\s+(.*?)\s+Afina/); if (m && !/sem capotraste/i.test(m[1])) capo = m[1]; }
  let video = '';
  const v = html.match(/youtube\.com\/embed\/([\w-]{6,})/) || html.match(/"videoId"\s*:\s*"([\w-]{6,})"/);
  if (v) video = v[1];
  return { titulo, artista, tom, capo, video, url, linhas: parsePre(preHtml) };
}
