/* Service worker: deixa o app abrir sem internet (a biblioteca ja fica no localStorage).
   Casca do app: cache primeiro, atualiza por tras. dados/: rede primeiro e guarda a resposta;
   sem rede, devolve a ultima guardada. YouTube e api.github.com: nunca passam por aqui. */
const CACHE = 'cifras-v3';
const CASCA = ['./', 'index.html', 'manifest.json', 'icone-192.png', 'icone-512.png', 'dados/biblioteca.json'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  const chave = u.origin + u.pathname; // sem ?t=..., que so existe para furar o CDN
  if (u.pathname.includes('/dados/')) {
    e.respondWith(fetch(e.request).then((resp) => {
      if (resp.ok) caches.open(CACHE).then((c) => c.put(chave, resp.clone()));
      return resp;
    }).catch(() => caches.match(chave).then((r) => r || new Response('{"itens":[],"v":0,"erro":"sem conexao"}', { status: 503, headers: { 'content-type': 'application/json' } }))));
    return;
  }
  e.respondWith(caches.match(chave).then((r) => {
    const rede = fetch(e.request).then((resp) => { if (resp.ok) caches.open(CACHE).then((c) => c.put(chave, resp.clone())); return resp; }).catch(() => r);
    return r || rede;
  }));
});
