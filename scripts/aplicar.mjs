/*
 * Aplica um resultado (de buscar.mjs ou notas.mjs) em docs/dados/biblioteca.json.
 * Roda DEPOIS de um `git reset --hard origin/main`, para editar sempre a versao mais nova
 * do arquivo: o app pode ter gravado no GitHub enquanto o download rodava.
 *
 *   node scripts/aplicar.mjs <resultado.json>
 *
 * Formatos: { tipo:'cifra', cifra:{...} } | { tipo:'notas', id, ini, fim, det } |
 *           { tipo:'erro', chave, url?, erro, em }
 */
import fs from 'node:fs';

const ARQ = 'docs/dados/biblioteca.json', ERRO = 'docs/dados/ultimo-erro.json';
const res = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const agora = new Date().toISOString();

function erro(chave, msg, extra) {
  fs.writeFileSync(ERRO, JSON.stringify(Object.assign({ chave, erro: msg, em: agora }, extra || {}), null, 1));
  console.log('erro registrado:', msg);
  process.exit(0);
}
if (res.tipo === 'erro') erro(res.chave, res.erro, { url: res.url });

const lib = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
lib.itens = lib.itens || [];

if (res.tipo === 'cifra') {
  const c = res.cifra;
  const ja = lib.itens.find((i) => i.id === c.id);
  if (ja) {
    Object.assign(ja, { titulo: c.titulo, artista: c.artista, tom: c.tom, capo: c.capo, linhas: c.linhas, url: c.url, em: agora });
    if (!ja.video && c.video) ja.video = c.video;
    console.log('cifra atualizada:', c.id);
  } else {
    lib.itens.unshift({ id: c.id, url: c.url, titulo: c.titulo, artista: c.artista, tom: c.tom, capo: c.capo, video: c.video || '', linhas: c.linhas, riffs: [], aj: { n: 0, simples: false, fonte: 17 }, em: agora });
    console.log('cifra adicionada:', c.id);
  }
} else if (res.tipo === 'notas') {
  const it = lib.itens.find((i) => i.id === res.id);
  if (!it) erro(`notas:${res.id}:${res.ini}-${res.fim}`, 'a cifra nao esta mais na biblioteca');
  const r = (it.riffs || []).find((x) => Math.abs(x.ini - res.ini) < 0.05 && Math.abs(x.fim - res.fim) < 0.05);
  if (!r) erro(`notas:${res.id}:${res.ini}-${res.fim}`, 'nao achei o riff com esse inicio/fim (foi editado enquanto analisava?)');
  r.det = res.det;
  console.log('notas gravadas no riff', r.nome || '', res.ini, '-', res.fim);
} else {
  erro('?', 'resultado desconhecido: ' + res.tipo);
}

lib.v = (lib.v || 0) + 1;
lib.em = agora;
fs.writeFileSync(ARQ, JSON.stringify(lib));
fs.writeFileSync(ERRO, '{}');
console.log('biblioteca v' + lib.v);
