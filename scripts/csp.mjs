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
 * 4. Gera docs/programa/arquivos.json (resumo sha256 de cada arquivo do programa de notas), por
 *    onde o programa no celular descobre o que mudou e se atualiza ao abrir.
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
  // 'wasm-unsafe-eval': deixa compilar WebAssembly (o modelo de notas, onnxruntime-web); nao libera eval de JavaScript
  `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')} https://www.youtube.com https://s.ytimg.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://i.ytimg.com",
  // r.jina.ai: leitor publico que devolve a pagina do Cifra Club (busca por link, sem token)
  "connect-src 'self' https://api.github.com https://r.jina.ai https://ntfy.sh",
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
// cache do modelo de notas: o nome so muda quando os arquivos do modelo mudam
const DIR_MODELO = new URL('programa/modelo/', DOCS);
const carimboModelo = sha(fs.readdirSync(DIR_MODELO).filter((n) => /\.(onnx|wasm|mjs)$/.test(n)).sort().map((n) => n + ':' + crypto.createHash('sha256').update(fs.readFileSync(new URL(n, DIR_MODELO))).digest('hex')).join('|')).slice(0, 10);
if (!/const MODELO = '[^']*';/.test(sw)) throw new Error('sw.js sem MODELO');
sw = sw.replace(/const MODELO = '[^']*';/, `const MODELO = 'cifras-modelo-${carimboModelo}';`);
const corpo = sw.replace(/const CACHE = '[^']*';/, '');
const carimbo = sha(html + MODULOS.map(le).join('') + le('manifest.json') + corpo).slice(0, 10);
sw = sw.replace(/const CACHE = '[^']*';/, `const CACHE = 'cifras-${carimbo}';`);
grava('sw.js', sw);

console.log('modulos:', MODULOS.map((m) => m + '?v=' + versoes[m]).join('  '));
console.log('CSP:', hashes.join(' '));
console.log('service worker: cifras-' + carimbo);

// 4. lista dos arquivos do programa de notas (docs/programa/arquivos.json): o programa, quando nao
//    tem o repositorio ao lado (celular, pasta copiada), confere por ela o que mudou e baixa.
//    Nome = como o arquivo se chama na pasta do programa; o caminho no site esta no servidor.mjs.
const DO_PROGRAMA = { 'servidor.mjs': 'programa/servidor.mjs', 'analise.mjs': 'analise.js', 'modelo/nmp.onnx': 'programa/modelo/nmp.onnx', 'modelo/ort.wasm.bundle.min.mjs': 'programa/modelo/ort.wasm.bundle.min.mjs', 'modelo/ort-wasm-simd-threaded.mjs': 'programa/modelo/ort-wasm-simd-threaded.mjs', 'modelo/ort-wasm-simd-threaded.wasm': 'programa/modelo/ort-wasm-simd-threaded.wasm' };
const lista = {};
for (const [nome, de] of Object.entries(DO_PROGRAMA)) {
  let b = fs.readFileSync(new URL(de, DOCS));
  if (/\.(mjs|js)$/.test(de)) b = Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'); // texto: sempre LF, como o GitHub serve
  lista[nome] = { sha256: crypto.createHash('sha256').update(b).digest('hex'), bytes: b.length };
}
grava('programa/arquivos.json', JSON.stringify(lista, null, 1) + '\n');
console.log('programa:', Object.entries(lista).map(([n, x]) => n + ' ' + x.sha256.slice(0, 8)).join('  '));
