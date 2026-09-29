/*
 * Recalcula a Content-Security-Policy de docs/index.html.
 *
 * O GitHub Pages nao deixa mandar cabecalho HTTP, entao a CSP vai numa <meta>. Para nao
 * precisar de 'unsafe-inline' em script, o unico <script> inline entra pelo hash SHA-256
 * do seu conteudo. Mudou uma letra do script? Rode:  node scripts/csp.mjs
 * (senao a pagina abre em branco, com erro de CSP no console).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const ARQ = new URL('../docs/index.html', import.meta.url);
// sempre LF: o GitHub serve o arquivo como foi commitado (LF); se o hash fosse calculado
// sobre CRLF do Windows, nao bateria e a pagina abriria em branco.
let html = fs.readFileSync(ARQ, 'utf8').replace(/\r\n/g, '\n');

const hashes = [];
for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  hashes.push("'sha256-" + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64') + "'");
}
if (!hashes.length) throw new Error('nenhum script inline encontrado');

const csp = [
  "default-src 'none'",
  `script-src ${hashes.join(' ')} https://www.youtube.com https://s.ytimg.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://i.ytimg.com",
  "connect-src 'self' https://api.github.com",
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
fs.writeFileSync(ARQ, html);
console.log('CSP atualizada com', hashes.length, 'hash(es):', hashes.join(' '));
