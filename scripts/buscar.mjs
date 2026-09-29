/*
 * Roda na GitHub Action (ver .github/workflows/buscar-cifra.yml).
 * Le CIFRA_URL, busca a pagina no Cifra Club, e grava/atualiza a cifra em
 * docs/dados/biblioteca.json. Se falhar, grava o motivo em docs/dados/ultimo-erro.json
 * para o app mostrar no celular.
 *
 * O Cifra Club (Akamai) barra alguns clientes. Primeiro tenta o fetch do Node; se vier
 * 403, cai para um Chrome de verdade (Playwright), que e o que o site espera.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { normalizaUrl, idDaUrl, parsePagina } from './cifraclub.mjs';

const ARQ = 'docs/dados/biblioteca.json';
const ERRO = 'docs/dados/ultimo-erro.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function falha(url, msg) {
  console.error('[ERRO]', msg);
  fs.writeFileSync(ERRO, JSON.stringify({ url, erro: msg, em: new Date().toISOString() }, null, 1));
  process.exit(0); // o commit do erro precisa acontecer; o workflow segue
}

async function baixarComFetch(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' } });
  return { status: r.status, html: await r.text() };
}
async function baixarComChrome(url) {
  console.log('fetch barrado; abrindo um Chrome de verdade (Playwright)...');
  execSync('npm i --no-save --silent playwright@1.47.2 && npx playwright install --with-deps chromium', { stdio: 'inherit' });
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ userAgent: UA, locale: 'pt-BR' });
    const r = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForSelector('pre', { timeout: 20000 }).catch(() => {});
    return { status: r ? r.status() : 0, html: await p.content() };
  } finally { await b.close(); }
}

const bruto = process.env.CIFRA_URL || process.argv[2] || '';
const url = normalizaUrl(bruto);
if (!url) falha(bruto, 'link invalido: ' + bruto);

let res;
try {
  res = await baixarComFetch(url);
  console.log('fetch:', res.status, res.html.length, 'bytes');
  if (res.status === 404) falha(url, 'o Cifra Club respondeu 404: esse link nao existe');
  // 403/429 = barrado pela Akamai; 200 sem <pre> = pagina de desafio. Nos dois casos, Chrome.
  if (res.status === 403 || res.status === 429 || (res.status === 200 && !/<pre\b/i.test(res.html))) res = await baixarComChrome(url);
} catch (e) { falha(url, 'nao consegui baixar: ' + e.message); }
if (res.status >= 400) falha(url, 'o Cifra Club respondeu ' + res.status);

let cifra;
try { cifra = parsePagina(res.html, url); } catch (e) { falha(url, e.message); }
console.log('lida:', cifra.titulo, '|', cifra.artista, '| tom', cifra.tom, '|', cifra.linhas.length, 'linhas');

const lib = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
lib.itens = lib.itens || [];
const id = idDaUrl(url);
const ja = lib.itens.find((i) => i.id === id);
const agora = new Date().toISOString();
if (ja) {
  Object.assign(ja, { titulo: cifra.titulo, artista: cifra.artista, tom: cifra.tom, capo: cifra.capo, linhas: cifra.linhas, url, em: agora });
  if (!ja.video && cifra.video) ja.video = cifra.video;
  console.log('atualizada');
} else {
  lib.itens.unshift({ id, url, titulo: cifra.titulo, artista: cifra.artista, tom: cifra.tom, capo: cifra.capo, video: cifra.video || '', linhas: cifra.linhas, riffs: [], aj: { n: 0, simples: false, fonte: 17 }, em: agora });
  console.log('adicionada');
}
lib.v = (lib.v || 0) + 1;
lib.em = agora;
fs.writeFileSync(ARQ, JSON.stringify(lib));
fs.writeFileSync(ERRO, '{}');
console.log('ok:', id);
