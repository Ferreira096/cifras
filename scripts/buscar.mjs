/*
 * Roda na GitHub Action (evento "buscar"). Le CIFRA_URL, busca a pagina no Cifra Club e
 * escreve a cifra estruturada em $RESULTADO; o scripts/aplicar.mjs grava na biblioteca.
 *
 * O Cifra Club (Akamai) barra os servidores do GitHub. Primeiro tenta o fetch do Node; se
 * vier 403, cai para um Chrome de verdade (Playwright). Em 29/09/2026 os dois foram
 * barrados por IP; o caminho que funciona e o favorito no navegador do usuario. Este
 * script fica como tentativa: se um dia passar, otimo.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { normalizaUrl, parsePagina } from './cifraclub.mjs';

const SAIDA = process.env.RESULTADO || 'resultado.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function falha(url, msg) {
  console.error('[ERRO]', msg);
  fs.writeFileSync(SAIDA, JSON.stringify({ tipo: 'erro', chave: 'cifra:' + url, url, erro: msg, em: new Date().toISOString() }));
  process.exit(0);
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
  if (res.status === 403 || res.status === 429 || (res.status === 200 && !/<pre\b/i.test(res.html))) res = await baixarComChrome(url);
} catch (e) { falha(url, 'nao consegui baixar: ' + e.message); }
if (res.status === 404) falha(url, 'o Cifra Club respondeu 404: esse link nao existe');
if (res.status >= 400) falha(url, 'o Cifra Club respondeu ' + res.status + ' (bloqueia os servidores do GitHub; use o favorito no navegador)');

let cifra;
try { cifra = parsePagina(res.html, url); } catch (e) { falha(url, e.message); }
cifra.id = url.replace(/^https?:\/\/(www\.)?cifraclub\.com\.br\//, '').replace(/\/$/, '').replace(/\//g, '__');
console.log('lida:', cifra.titulo, '|', cifra.artista, '| tom', cifra.tom, '|', cifra.linhas.length, 'linhas');
fs.writeFileSync(SAIDA, JSON.stringify({ tipo: 'cifra', cifra }));
console.log('ok:', cifra.id);
