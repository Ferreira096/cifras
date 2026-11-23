/* Service worker: deixa o app abrir sem internet e garante que pagina e modulos sejam sempre
   da MESMA versao.
   - Pagina (index.html): rede primeiro, revalidando; sem rede ou lenta (3,5 s), a guardada.
     Assim uma atualizacao aparece ja na primeira abertura, e nao so na segunda.
   - Modulos (.js?v=...): o endereco muda quando o conteudo muda (scripts/csp.mjs carimba),
     entao cache primeiro e seguro.
   - dados/: rede primeiro e guarda; sem rede, a ultima resposta.
   - programa/modelo/ (modelo de notas, uns 15 MB, so baixado quando alguem pede deteccao por
     microfone, guia ou arquivo): cache primeiro, num cache proprio (MODELO) que so muda quando os
     arquivos do modelo mudam. Atualizar o app nao faz o celular baixar o modelo de novo.
   - YouTube, api.github.com e o leitor: nunca passam por aqui.
   CACHE, MODELO e CASCA sao carimbados por scripts/csp.mjs; nao editar a mao. */
const CACHE = 'cifras-e4e52f7f9b';
const MODELO = 'cifras-modelo-067567cc01';
const CASCA = ['./', 'manifest.json', 'icone-192.png', 'icone-512.png', 'cifraclub.js?v=48499b4c37', 'analise.js?v=2343a5971b', 'dados/biblioteca.json'];
const RAIZ = self.registration.scope; // .../cifras/

function ehPagina(u) { return u.href.split(/[?#]/)[0] === RAIZ || u.pathname.endsWith('/index.html'); }
function chaveDe(u) {
  if (ehPagina(u)) return RAIZ;                                             // "./", "index.html", "?add=..." -> uma chave so
  if (u.searchParams.has('v') && /\.js$/.test(u.pathname)) return u.href;   // modulo versionado
  return u.origin + u.pathname;                                             // o resto, sem ?t=...
}
const guarda = (chave, resp) => { if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(chave, copia)); } return resp; };

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CASCA.map((p) => {
    const url = new URL(p, RAIZ);
    return fetch(url.href, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return c.put(chaveDe(url), r); });
  }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('cifras-') && k !== CACHE && k !== MODELO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET' || !u.href.startsWith(RAIZ)) return;
  const chave = chaveDe(u);
  if (ehPagina(u)) {
    e.respondWith(caches.match(chave).then((guardada) => {
      const rede = fetch(u.origin + u.pathname, { cache: 'no-cache' }).then((r) => guarda(chave, r));
      if (!guardada) return rede;
      const espera = new Promise((res) => setTimeout(() => res(guardada), 3500));
      return Promise.race([rede.then((r) => (r.ok ? r : guardada)).catch(() => guardada), espera]);
    }));
    return;
  }
  if (u.pathname.includes('/programa/modelo/')) {
    e.respondWith(caches.open(MODELO).then((c) => c.match(chave).then((r) => r || fetch(e.request).then((resp) => { if (resp.ok) c.put(chave, resp.clone()); return resp; }))));
    return;
  }
  if (u.pathname.includes('/dados/')) {
    e.respondWith(fetch(e.request).then((r) => guarda(chave, r)).catch(() => caches.match(chave).then((r) => r || new Response('{"itens":[],"v":0,"erro":"sem conexao"}', { status: 503, headers: { 'content-type': 'application/json' } }))));
    return;
  }
  const versionado = chave === u.href && u.searchParams.has('v');
  e.respondWith(caches.match(chave).then((r) => {
    if (r && versionado) return r;
    const rede = fetch(e.request, versionado ? { cache: 'no-cache' } : undefined).then((resp) => guarda(chave, resp)).catch(() => r);
    return r || rede;
  }));
});
