/*
 * Prepara docs/ para publicar. Rode sempre antes de subir:  node scripts/csp.mjs
 *
 * 1. Carimba a versao dos modulos em docs/index.html (cifraclub.js?v=..., analise.js?v=...):
 *    o endereco muda quando o conteudo muda, entao pagina nova nunca carrega modulo velho
 *    do cache do navegador, do CDN ou do service worker.
 * 2. Recalcula a Content-Security-Policy. O GitHub Pages nao manda cabecalho HTTP, entao a
 *    CSP vai numa <meta>; para nao precisar de 'unsafe-inline', o script inline entra pelo
 *    hash SHA-256 do conteudo. Hash velho = pagina em branco.
 * 3. Carimba docs/sw.js: nome do cache e lista de arquivos, para o app instalado trocar tudo
 *    junto.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const DOCS = new URL('../docs/', import.meta.url);
const le = (n) => fs.readFileSync(new URL(n, DOCS), 'utf8').replace(/\r\n/g, '\n'); // sempre LF, como o GitHub serve
const grava = (n, t) => fs.writeFileSync(new URL(n, DOCS), t);
const sha = (t, alg = 'sha256', enc = 'hex') => crypto.createHash(alg).update(t, 'utf8').digest(enc);
const MODULOS = ['cifraclub.js', 'analise.js'];

let html = le('index.html');

// 1. versao dos modulos
const versoes = {};
for (const m of MODULOS) {
  versoes[m] = sha(le(m)).slice(0, 10);
  const re = new RegExp('(<script type="module" src=")' + m.replace('.', '\\.') + '(?:\\?v=[0-9a-f]+)?(")');
  if (!re.test(html)) throw new Error('nao achei a tag do modulo ' + m);
  html = html.replace(re, '$1' + m + '?v=' + versoes[m] + '$2');
}

// 2. CSP
const hashes = [];
for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) hashes.push("'sha256-" + sha(m[1], 'sha256', 'base64') + "'");
if (!hashes.length) throw new Error('nenhum script inline encontrado');
const csp = [
  "default-src 'none'",
  // 'self' libera os modulos do proprio site (cifraclub.js, analise.js); o script inline entra pelo hash
  `script-src 'self' ${hashes.join(' ')} https://www.youtube.com https://s.ytimg.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://i.ytimg.com",
  // r.jina.ai: leitor publico que devolve a pagina do Cifra Club (busca por link, sem token)
  "connect-src 'self' https://api.github.com https://r.jina.ai",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');
const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
if (/<meta http-equiv="Content-Security-Policy"[^>]*>/i.test(html)) html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, meta);
else html = html.replace(/<meta name="robots"[^>]*>/i, (m) => m + '\n' + meta);
grava('index.html', html);

// 3. service worker
let sw = le('sw.js');
const casca = ['./', 'manifest.json', 'icone-192.png', 'icone-512.png', ...MODULOS.map((m) => m + '?v=' + versoes[m]), 'dados/biblioteca.json'];
if (!/const CASCA = \[[^\]]*\];/.test(sw) || !/const CACHE = '[^']*';/.test(sw)) throw new Error('sw.js sem CACHE/CASCA');
sw = sw.replace(/const CASCA = \[[^\]]*\];/, 'const CASCA = [' + casca.map((c) => "'" + c + "'").join(', ') + '];');
const corpo = sw.replace(/const CACHE = '[^']*';/, '');
const carimbo = sha(html + MODULOS.map(le).join('') + le('manifest.json') + corpo).slice(0, 10);
sw = sw.replace(/const CACHE = '[^']*';/, `const CACHE = 'cifras-${carimbo}';`);
grava('sw.js', sw);

console.log('modulos:', MODULOS.map((m) => m + '?v=' + versoes[m]).join('  '));
console.log('CSP:', hashes.join(' '));
console.log('service worker: cifras-' + carimbo);
