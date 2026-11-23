/*
 * Minhas Cifras - notas pelo link do YouTube (parte do computador).
 *
 * O celular nao consegue baixar o audio do YouTube; este computador consegue. Entao:
 *   1. o app (no celular) publica um pedido {video, inicio, fim} num canal de mensagens
 *      (ntfy.sh) cujo nome e um codigo secreto, criado aqui e guardado so neste computador
 *      e no aparelho pareado;
 *   2. este programa escuta o canal, baixa o audio (yt-dlp), corta o trecho (ffmpeg), roda a
 *      MESMA analise do app (github/docs/analise.js) e publica as notas no mesmo canal;
 *   3. o app recebe e guarda as notas no riff.
 *
 * Nada aqui usa token, senha ou conta. O que passa pelo canal: id do video, inicio/fim e as
 * notas detectadas. Pedidos ficam guardados no canal por ate 12 horas: se o computador estava
 * desligado, ele atende quando ligar.
 *
 * Roda em dois lugares, com o mesmo arquivo (a fonte fica no repositorio, docs/programa/):
 *   - celular Android, dentro do Termux: instalado por docs/programa/instalar-termux.sh, usa o
 *     node, o python (com yt-dlp) e o ffmpeg do proprio Termux; comando "notas";
 *   - computador com Windows: pasta notas-youtube, explicada a seguir.
 *
 * A pasta e autossuficiente: runtime\node.exe e runtime\python (com yt-dlp, ffmpeg e qrcode)
 * vao junto. Copiada inteira para outro computador com Windows, funciona sem instalar nada; com
 * o config.json junto, o codigo e o mesmo e o celular nao precisa parear de novo. Dois
 * computadores ligados com o mesmo codigo nao brigam: quem pega o pedido primeiro avisa, o
 * outro deixa passar.
 *
 * Uso (runtime\node.exe servidor.mjs ...; o LIGAR.bat faz o primeiro):
 *       (sem nada)       escuta os pedidos
 *       --parear         abre de novo a pagina com o QR code / codigo
 *       --novo-codigo    troca o codigo (os aparelhos precisam parear de novo)
 *       --codigo <c>     usa um codigo que ja existe (o do computador, para os dois atenderem)
 *       --instalar       passa a abrir sozinho no login do Windows (pasta Inicializar do usuario)
 *                        ou, no Termux, quando o celular liga (precisa do app Termux:Boot)
 *       --desinstalar    tira do login e fecha o programa que estiver aberto
 *       --parar          fecha o programa que estiver aberto
 *       --teste <video> <ini> <fim>   analisa um trecho sem usar o canal
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RELE = 'https://ntfy.sh/';
const SITE = 'https://ferreira096.github.io/cifras/';
const WIN = process.platform === 'win32' && !process.env.CIFRAS_GENERICO; // CIFRAS_GENERICO=termux: testa no Windows o caminho do celular
const TERMUX = process.platform === 'android' || /com\.termux/.test(process.env.PREFIX || '') || process.env.CIFRAS_GENERICO === 'termux';
const PY = process.env.CIFRAS_PYTHON || (WIN ? path.join(AQUI, 'runtime', 'python', 'python.exe') : 'python');
const REINSTALE = 'Rode de novo o comando de instalacao (app Minhas Cifras > Ajustes > Rodar neste celular).';
const ARQ_REPO = path.join(AQUI, '..', 'github', 'docs', 'analise.js'); // a analise do app, quando o repositorio esta ao lado
const ARQ_ANALISE = path.join(AQUI, 'analise.mjs');                     // copia que viaja com a pasta
const PASTA_AUDIO = path.join(AQUI, 'cache');
const DADOS = process.env.CIFRAS_DADOS || AQUI; // so para testes: guarda codigo e estado em outra pasta
const F_CONFIG = path.join(DADOS, 'config.json');
const F_ESTADO = path.join(DADOS, 'estado.json');
const PORTA_TRAVA = +process.env.CIFRAS_PORTA || 47613;
const F_PAGINA = path.join(DADOS, 'PAREAR O CELULAR.html');
const F_REGISTRO = path.join(DADOS, 'registro.txt');
const CANAL_RE = /^cifras-[a-z0-9]{4}(-[a-z0-9]{4}){3}$/;
const LIMITE_DIA = 80;          // analises novas por dia (as repetidas saem da memoria e nao contam)
const MAX_TRECHO = 120;         // segundos
const MAX_AUDIO_INTEIRO = '25M'; // videos maiores que isso: baixa so o trecho
const MODO = TERMUX ? 'vídeo do YouTube, analisado no celular' : 'vídeo do YouTube, analisado no computador';
const MID = crypto.createHash('sha256').update(os.hostname() + '|' + DADOS).digest('hex').slice(0, 8); // identifica este computador para os outros com o mesmo codigo
const PAR_VALE = 36 * 3600e3; // outro computador conta como presente por 36 h depois do ultimo sinal

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toLocaleTimeString('pt-BR');
function diz(...a) {
  const linha = `[${hora()}] ${a.join(' ')}`;
  console.log(linha);
  try { fs.appendFileSync(F_REGISTRO, new Date().toISOString().slice(0, 10) + ' ' + linha + '\n'); } catch (e) {}
}
const leJson = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return padrao; } };
const gravaJson = (f, o) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o, null, 1)); fs.renameSync(tmp, f); };
const py = (args, opcoes) => roda(PY, ['-I', ...args], opcoes); // -I: ignora variaveis e pacotes do usuario da maquina
const roda = (cmd, args, opcoes = {}) => new Promise((res) => {
  execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 28, ...opcoes }, (erro, stdout, stderr) => res({ ok: !erro, stdout, stderr: String(stderr || ''), erro }));
});

/* ---------------- codigo de pareamento ---------------- */
function novoCanal() {
  const letras = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem i, l, o, 0, 1: da para digitar sem confundir
  let s = ''; for (let i = 0; i < 16; i++) s += letras[crypto.randomInt(letras.length)];
  return 'cifras-' + s.match(/.{4}/g).join('-');
}
function lerConfig(forcarNovo) {
  let c = leJson(F_CONFIG, null);
  let novo = false;
  if (forcarNovo || !c || !CANAL_RE.test(c.canal || '')) { c = { canal: novoCanal(), criado: new Date().toISOString() }; gravaJson(F_CONFIG, c); novo = true; }
  return { ...c, novo };
}
async function paginaDeParear(canal) {
  const link = SITE + '#/parear/' + canal;
  const svgTmp = path.join(DADOS, 'qr.tmp.svg');
  let qr = '';
  const r = await py(['-c', 'import sys, qrcode, qrcode.image.svg as s\nqrcode.make(sys.argv[1], image_factory=s.SvgPathImage, box_size=12, border=3).save(sys.argv[2])', link, svgTmp]);
  if (r.ok && fs.existsSync(svgTmp)) { qr = fs.readFileSync(svgTmp, 'utf8').replace(/^<\?xml[^>]*\?>\s*/, ''); fs.rmSync(svgTmp, { force: true }); }
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Parear o celular - Minhas Cifras</title>
<style>
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#111418;color:#e8e6e1}
main{max-width:620px;margin:0 auto;padding:36px 20px 60px}
h1{font-size:24px;margin:0 0 6px}
p{margin:10px 0;color:#b9b6ae}
ol{padding-left:20px;color:#d9d6ce} li{margin:8px 0}
.qr{background:#fff;border-radius:6px;padding:10px;width:270px;max-width:80%;margin:22px 0}
.qr svg{display:block;width:100%;height:auto}
.codigo{font:600 24px/1.2 ui-monospace,Consolas,monospace;letter-spacing:1px;color:#f2c14e;background:#1b2027;border:1px solid #2b323c;border-radius:6px;padding:14px 16px;display:inline-block;user-select:all}
a{color:#f2c14e}
small{color:#8d8a83}
</style></head><body><main>
<h1>Ligar o celular a este computador</h1>
<p>Serve para o app Minhas Cifras pedir as notas de um trecho do YouTube pelo celular. Faça uma vez em cada aparelho.</p>
<ol>
<li>No celular, aponte a câmera para o QR code e abra o endereço.</li>
<li>O app pergunta se pode ligar ao computador: confirme.</li>
<li>Se o app instalado não abrir pelo QR code, abra o app, toque em <b>Ajustes</b>, e digite o código abaixo em "Notas pelo link do YouTube".</li>
</ol>
<div class="qr">${qr || '<p style="color:#111;margin:0">Não consegui desenhar o QR code. Use o código abaixo.</p>'}</div>
<div class="codigo">${canal}</div>
<p><small>O código é a chave: quem o tiver consegue pedir análises a este computador. Não publique nem envie para grupos. Para trocar, feche o programa e rode <code>LIGAR.bat --novo-codigo</code> nesta pasta.</small></p>
<p><small>As notas só chegam enquanto a janela "LIGAR NOTAS DO YOUTUBE" estiver aberta neste computador. Pedido feito com ela fechada espera até 12 horas.</small></p>
</main></body></html>`;
  fs.writeFileSync(F_PAGINA, html);
  return F_PAGINA;
}
const abrir = (alvo) => { // arquivo ou endereco, no programa padrao do aparelho
  try {
    const f = WIN ? spawn('cmd', ['/c', 'start', '', alvo], { detached: true, stdio: 'ignore', windowsHide: true }) : spawn(TERMUX ? 'termux-open-url' : 'xdg-open', [alvo], { detached: true, stdio: 'ignore' });
    f.on('error', () => {}); f.unref();
  } catch (e) {}
};

/* ---------------- estado (o que ja foi atendido, memoria de resultados) ---------------- */
let estado = leJson(F_ESTADO, {});
estado.feitos = estado.feitos || {};         // id do pedido -> quando
estado.resultados = estado.resultados || {}; // video:ini-fim:versao -> det
estado.dia = estado.dia || { data: '', n: 0 };
estado.pares = estado.pares || {};           // outros computadores com o mesmo codigo -> ultimo sinal
function gravaEstado() {
  const limite = Date.now() - 3 * 864e5;
  for (const k of Object.keys(estado.feitos)) if (estado.feitos[k] < limite) delete estado.feitos[k];
  for (const k of Object.keys(estado.pares)) if (Date.now() - estado.pares[k] > PAR_VALE) delete estado.pares[k];
  const chaves = Object.keys(estado.resultados); if (chaves.length > 400) for (const k of chaves.slice(0, chaves.length - 400)) delete estado.resultados[k];
  try { gravaJson(F_ESTADO, estado); } catch (e) { diz('nao consegui gravar o estado:', e.message); }
}

/* ---------------- audio e analise ---------------- */
let FFMPEG = '', Analise = null, versaoAnalise = '';
let versaoPrograma = ''; try { versaoPrograma = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 8); } catch (e) {}
async function preparar() {
  if (WIN && !fs.existsSync(PY)) throw new Error('pasta incompleta: falta runtime\\python. Copie a pasta notas-youtube inteira.');
  try { // repositorio ao lado: traz a versao atual da analise para a copia da pasta
    if (fs.existsSync(ARQ_REPO)) { const novo = fs.readFileSync(ARQ_REPO); if (!fs.existsSync(ARQ_ANALISE) || !novo.equals(fs.readFileSync(ARQ_ANALISE))) fs.writeFileSync(ARQ_ANALISE, novo); }
  } catch (e) {}
  if (!WIN) { // celular: a analise melhora no site; traz a versao atual ao abrir, se a internet deixar
    try {
      const r = await fetch(SITE + 'analise.js?t=' + Date.now(), { signal: AbortSignal.timeout(8000), cache: 'no-store' }); // ?t=: fura a copia de ate 10 min que o site guarda
      if (r.ok) { const novo = Buffer.from(await r.arrayBuffer()); if (novo.length > 4000 && novo.includes('function analisarPCM') && !(fs.existsSync(ARQ_ANALISE) && novo.equals(fs.readFileSync(ARQ_ANALISE)))) { fs.writeFileSync(ARQ_ANALISE, novo); console.log('  (analise atualizada pelo site)'); } }
    } catch (e) {}
  }
  if (!fs.existsSync(ARQ_ANALISE)) throw new Error('pasta incompleta: falta analise.mjs');
  if (WIN) {
    const r = await py(['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']);
    FFMPEG = r.stdout.trim(); if (!r.ok || !fs.existsSync(FFMPEG)) throw new Error('ffmpeg nao encontrado no ambiente Python');
  } else { // Termux/Linux: os programas do proprio sistema
    FFMPEG = process.env.CIFRAS_FFMPEG || 'ffmpeg';
    if (!(await roda(FFMPEG, ['-version'])).ok) throw new Error('ffmpeg nao encontrado. ' + REINSTALE);
    if (!(await py(['-c', 'import yt_dlp'])).ok) throw new Error('yt-dlp nao encontrado. ' + REINSTALE);
  }
  Analise = await import(pathToFileURL(ARQ_ANALISE).href);
  versaoAnalise = crypto.createHash('sha256').update(fs.readFileSync(ARQ_ANALISE)).digest('hex').slice(0, 8);
  fs.mkdirSync(PASTA_AUDIO, { recursive: true });
}
const audioGuardado = (video) => { try { const f = fs.readdirSync(PASTA_AUDIO).find((n) => n.startsWith(video + '.') && !/\.(part|ytdl|tmp)$/.test(n) && !n.includes('.trecho')); return f ? path.join(PASTA_AUDIO, f) : ''; } catch (e) { return ''; } };
function limparAudios() { // guarda so os 15 mais recentes
  try {
    const arqs = fs.readdirSync(PASTA_AUDIO).map((n) => ({ n, t: fs.statSync(path.join(PASTA_AUDIO, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const a of arqs.slice(15)) fs.rmSync(path.join(PASTA_AUDIO, a.n), { force: true });
  } catch (e) {}
}
const erroDoYt = (r) => (r.stderr.split('\n').filter((l) => /^ERROR/.test(l)).pop() || '').replace(/^ERROR:\s*(\[[^\]]*\]\s*)?([\w-]{11}:\s*)?/, '').slice(0, 200);
async function baixar(video, ini, fim) {
  // devolve {arquivo, deslocamento}: o audio inteiro (guardado para os proximos riffs) ou so o trecho
  let arq = audioGuardado(video); if (arq) return { arquivo: arq, desloc: 0 };
  const url = 'https://www.youtube.com/watch?v=' + video;
  const comum = ['-m', 'yt_dlp', '--no-playlist', '--no-progress', '--no-warnings', '--no-part', ...(path.isAbsolute(FFMPEG) ? ['--ffmpeg-location', FFMPEG] : []), '-f', '140/bestaudio[ext=m4a]/bestaudio'];
  let r = await py([...comum, '--max-filesize', MAX_AUDIO_INTEIRO, '-o', path.join(PASTA_AUDIO, video + '.%(ext)s'), url], { timeout: 240000 });
  arq = audioGuardado(video); if (arq) return { arquivo: arq, desloc: 0 };
  if (r.ok) { // video grande (culto inteiro, ao vivo): baixa so o trecho
    const a = Math.max(0, ini - 2), b = fim + 2, base = path.join(PASTA_AUDIO, `${video}.trecho-${Math.round(a)}-${Math.round(b)}`);
    r = await py([...comum, '--download-sections', `*${a}-${b}`, '-o', base + '.%(ext)s', url], { timeout: 300000 });
    const f = fs.readdirSync(PASTA_AUDIO).find((n) => n.startsWith(path.basename(base) + '.') && !/\.(part|ytdl|tmp)$/.test(n));
    if (f) return { arquivo: path.join(PASTA_AUDIO, f), desloc: a, apagar: true };
  }
  throw new Error(erroDoYt(r) || 'o YouTube nao entregou o audio desse video');
}
async function baixarComReparo(video, ini, fim) {
  try { return await baixar(video, ini, fim); }
  catch (e) {
    // o YouTube muda e o yt-dlp velho para de funcionar: atualiza uma vez por dia e tenta de novo
    const hoje = new Date().toISOString().slice(0, 10);
    if (estado.atualizouYt === hoje || /private|unavailable|removed|not available|age|members/i.test(e.message)) throw e;
    diz('download falhou (' + e.message + '); atualizando o yt-dlp e tentando de novo');
    estado.atualizouYt = hoje; gravaEstado();
    await py(['-m', 'pip', 'install', '-q', '--disable-pip-version-check', '-U', 'yt-dlp'], { timeout: 180000 });
    return await baixar(video, ini, fim);
  }
}
async function analisar(video, ini, fim) {
  const chave = `${video}:${ini.toFixed(2)}-${fim.toFixed(2)}:${versaoAnalise}`;
  if (estado.resultados[chave]) return { det: estado.resultados[chave], daMemoria: true };
  const hoje = new Date().toISOString().slice(0, 10);
  if (estado.dia.data !== hoje) estado.dia = { data: hoje, n: 0 };
  if (estado.dia.n >= LIMITE_DIA) throw new Error('limite de analises de hoje atingido neste computador');
  estado.dia.n++;
  const { arquivo, desloc, apagar } = await baixarComReparo(video, ini, fim);
  const ff = await roda(FFMPEG, ['-v', 'error', '-ss', String(Math.max(0, ini - desloc)), '-t', String(fim - ini), '-i', arquivo, '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { encoding: 'buffer', timeout: 120000 });
  if (apagar) fs.rmSync(arquivo, { force: true });
  if (!ff.ok) throw new Error('nao consegui cortar o trecho do audio');
  const buf = ff.stdout;
  const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)));
  if (pcm.length < 22050 * 0.5) throw new Error('o video termina antes desse trecho');
  const d = Analise.analisarPCM(pcm, 22050), tx = Analise.textoDeteccao(d);
  if (!tx.notas) throw new Error('nao ouvi notas nesse trecho (silencio ou so percussao)');
  const det = { notas: tx.notas, seq: tx.seq, baixo: tx.baixo, acorde: d.acorde, resumo: tx.resumo, modo: MODO, em: new Date().toLocaleDateString('pt-BR') };
  estado.resultados[chave] = det; gravaEstado(); limparAudios();
  return { det, daMemoria: false };
}

/* ---------------- canal de mensagens ---------------- */
let canal = '';
async function publica(obj) {
  const corpo = JSON.stringify(obj);
  for (let t = 0; t < 4; t++) {
    try { const r = await fetch(RELE + canal, { method: 'POST', body: corpo, signal: AbortSignal.timeout(20000) }); if (r.ok) return true; if (r.status === 429) await espera(8000); }
    catch (e) {}
    await espera(1500 * (t + 1));
  }
  diz('nao consegui publicar a resposta (' + obj.t + ')');
  return false;
}
async function publicaResultado(id, det) { // em partes: o canal aceita mensagens de ate ~4 KB
  const txt = JSON.stringify(det), partes = []; for (let i = 0; i < txt.length; i += 2400) partes.push(txt.slice(i, i + 2400));
  for (let i = 0; i < partes.length; i++) if (!(await publica({ t: 'resultado', id, m: MID, n: i + 1, de: partes.length, txt: partes[i] }))) return false;
  return true;
}
const fila = []; let trabalhando = false;
const meus = new Set(), alheios = new Set(); // pedidos que este computador pegou / que outro computador com o mesmo codigo ja pegou
/* Varios computadores com o mesmo codigo: cada um avisa que existe ("ola") e, para cada pedido, a
   ordem de quem tenta primeiro sai de uma conta que todos fazem igual. O primeiro atende na hora;
   os outros esperam 1 s por posicao e so pegam se ninguem avisou que pegou. Sozinho, nao espera. */
let ultimoOla = 0;
function viPar(m, quando) { if (typeof m !== 'string' || !/^[0-9a-f]{8}$/.test(m) || m === MID) return; const novo = !estado.pares[m]; estado.pares[m] = Math.max(estado.pares[m] || 0, quando); if (novo) { diz('outro computador com o mesmo codigo esta na roda (' + Object.keys(estado.pares).length + ' alem deste)'); gravaEstado(); } }
function ola(resposta) { if (resposta && Date.now() - ultimoOla < 30000) return; ultimoOla = Date.now(); publica({ t: 'ola', id: crypto.randomBytes(6).toString('hex'), m: MID, r: resposta ? 1 : 0 }); }
function minhaVez(idPedido) {
  const ativos = [MID, ...Object.keys(estado.pares).filter((k) => Date.now() - estado.pares[k] < PAR_VALE)].sort();
  return (ativos.indexOf(MID) + parseInt(crypto.createHash('sha256').update(idPedido).digest('hex').slice(0, 8), 16)) % ativos.length;
}
async function atender() {
  if (trabalhando) return; trabalhando = true;
  while (fila.length) {
    const p = fila.shift(), t0 = Date.now();
    try {
      const { det, daMemoria } = await analisar(p.video, p.ini, p.fim);
      await publicaResultado(p.id, det);
      diz(`pronto ${p.video} ${p.ini}-${p.fim}s em ${((Date.now() - t0) / 1000).toFixed(1)} s${daMemoria ? ' (da memoria)' : ''}: ${Analise.notasBase(det, 0, false).join(' ')}`);
    } catch (e) {
      diz(`erro ${p.video} ${p.ini}-${p.fim}s: ${e.message}`);
      await publica({ t: 'erro', id: p.id, m: MID, erro: String(e.message || e).slice(0, 220) });
    }
  }
  trabalhando = false;
}
function trata(linha) {
  let j; try { j = JSON.parse(linha); } catch (e) { return; }
  if (!j || j.event !== 'message' || typeof j.message !== 'string') return;
  if (typeof j.id === 'string') estado.ultimo = j.id;
  if (j.message.length > 600) return;
  let m; try { m = JSON.parse(j.message); } catch (e) { return; }
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !/^[a-z0-9]{8,24}$/.test(m.id)) return;
  const idade = Date.now() - (+j.time || 0) * 1000;
  if ((m.t === 'ping' || m.t === 'pedido') && !estado.pareado) { estado.pareado = true; gravaEstado(); }
  if (m.t === 'ola') { if (m.m !== MID) { viPar(m.m, Date.now() - idade); if (!m.r && idade < 60000) ola(true); } return; }
  if (m.t === 'ping') { if (idade < 90000) publica({ t: 'pong', id: m.id, m: MID, v: versaoPrograma, va: versaoAnalise, onde: TERMUX ? 'celular' : 'computador' }); return; } // v/va: da para conferir de longe se atualizou
  if (m.t === 'recebido' || m.t === 'resultado' || m.t === 'erro') { if (!meus.has(m.id)) { alheios.add(m.id); viPar(m.m, Date.now() - idade); } return; }
  if (m.t !== 'pedido') return;
  if (estado.feitos[m.id] || alheios.has(m.id)) return;
  estado.feitos[m.id] = Date.now(); gravaEstado();
  const video = String(m.video || ''), ini = +m.ini, fim = +m.fim;
  let problema = '';
  if (!/^[\w-]{11}$/.test(video) || !Number.isFinite(ini) || !Number.isFinite(fim) || ini < 0 || fim > 6 * 3600 || !(fim > ini)) problema = 'pedido invalido';
  else if (fim - ini > MAX_TRECHO) problema = 'trecho grande demais (maximo 2 minutos)';
  else if (fila.length >= 20) problema = 'fila cheia neste computador; tente daqui a pouco';
  // pedido antigo (da fila): da tempo de o resto da fila chegar antes de decidir de quem e a vez
  const decide = () => setTimeout(pega, minhaVez(m.id) * 1000);
  const pega = () => {
    if (alheios.has(m.id)) { diz(`pedido ${video} ${ini}-${fim}s ficou com outro computador`); return; }
    meus.add(m.id);
    if (problema) { publica({ t: 'erro', id: m.id, m: MID, erro: problema }); return; }
    diz(`pedido ${video} ${ini}-${fim}s` + (idade > 120000 ? ` (feito ha ${Math.round(idade / 60000)} min)` : ''));
    publica({ t: 'recebido', id: m.id, m: MID });
    fila.push({ id: m.id, video, ini: Math.round(ini * 100) / 100, fim: Math.round(fim * 100) / 100 });
    atender();
  };
  if (idade > 30000) setTimeout(decide, 500); else decide();
}
async function escutar() {
  let falhas = 0, avisou = false, ctlAtual = null, dormiu = false, tic = Date.now();
  // celular: o Android congela o programa com a tela apagada; ao acordar, a conexao antiga nao serve mais
  setInterval(() => { const pulo = Date.now() - tic; tic = Date.now(); if (pulo > 30000 && ctlAtual) { dormiu = true; ctlAtual.abort(); } }, 5000).unref();
  for (;;) {
    const ctl = new AbortController(); let vigia = 0; ctlAtual = ctl;
    const renova = () => { clearTimeout(vigia); vigia = setTimeout(() => ctl.abort(), 150000); }; // o canal manda um sinal a cada ~45 s
    try {
      renova();
      const r = await fetch(RELE + canal + '/json?since=' + encodeURIComponent(estado.ultimo || '12h'), { signal: ctl.signal });
      if (!r.ok) throw new Error('o canal respondeu ' + r.status);
      if (!avisou || falhas) diz(falhas ? 'reconectado ao canal' : 'escutando os pedidos do celular');
      avisou = true; falhas = 0; ola(false);
      const dec = new TextDecoder(); let resto = '';
      for await (const pedaco of r.body) {
        renova(); resto += dec.decode(pedaco, { stream: true });
        let i; while ((i = resto.indexOf('\n')) >= 0) { const l = resto.slice(0, i).trim(); resto = resto.slice(i + 1); if (l) trata(l); }
      }
    } catch (e) { if (falhas === 0 && !dormiu) diz('sem conexao com o canal (' + (e.name === 'AbortError' ? 'sem sinal' : e.message) + '); tentando de novo'); }
    clearTimeout(vigia); gravaEstado();
    if (dormiu) { dormiu = false; falhas = 0; await espera(800); continue; }
    falhas++; await espera(Math.min(60000, 3000 * falhas));
  }
}

/* ---------------- uma janela so ---------------- */
// Uma porta local (so 127.0.0.1) serve de trava: o sistema a solta sozinho quando o programa
// fecha, mesmo se a janela for fechada no X. Arquivo de trava ficava para tras e bloqueava a volta.
function travar() {
  return new Promise((res) => {
    const s = net.createServer((c) => { // so 127.0.0.1; a unica ordem aceita e "parar"
      c.setEncoding('utf8'); c.on('error', () => {});
      c.on('data', (d) => { if (String(d).trim() === 'parar') { diz('fechando a pedido'); gravaEstado(); process.exit(0); } c.destroy(); });
      setTimeout(() => c.destroy(), 2000);
    });
    s.once('error', () => res(false));
    s.listen({ port: PORTA_TRAVA, host: '127.0.0.1', exclusive: true }, () => { s.unref(); res(true); });
  });
}
const pararOutro = () => new Promise((res) => {
  let falou = false; const fim = () => res(falou);
  const c = net.connect({ port: PORTA_TRAVA, host: '127.0.0.1' });
  c.once('connect', () => { falou = true; c.end('parar'); setTimeout(fim, 1500); });
  c.once('error', fim); c.once('close', fim);
});

/* ---------------- abrir sozinho no login (sem administrador: pasta Inicializar do usuario) ---------------- */
const F_LOGIN = WIN
  ? path.join(process.env.CIFRAS_INICIALIZAR || path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), 'Minhas Cifras - notas do YouTube.cmd')
  : path.join(process.env.CIFRAS_INICIALIZAR || path.join(os.homedir(), '.termux', 'boot'), 'minhas-cifras-notas');
function instalarNoLogin() {
  if (!WIN) { // Termux:Boot roda o que estiver em ~/.termux/boot quando o celular liga
    fs.mkdirSync(path.dirname(F_LOGIN), { recursive: true });
    const sh = process.env.PREFIX ? process.env.PREFIX + '/bin/sh' : '/bin/sh';
    fs.writeFileSync(F_LOGIN, `#!${sh}\n# Minhas Cifras: atende os pedidos de notas do app. Criado por "notas --instalar"; "notas --desinstalar" apaga.\ncd "${AQUI}" && exec "${process.execPath}" servidor.mjs >> "${path.join(AQUI, 'registro-boot.txt')}" 2>&1\n`);
    fs.chmodSync(F_LOGIN, 0o755);
    return F_LOGIN;
  }
  if (!fs.existsSync(path.dirname(F_LOGIN))) throw new Error('nao achei a pasta Inicializar do Windows');
  // abre minimizado, numa janela comum: da para ver que esta ligado e fechar quando quiser
  fs.writeFileSync(F_LOGIN, '@echo off\r\nrem Minhas Cifras: atende os pedidos de notas feitos no celular. Para tirar, apague este arquivo\r\nrem ou rode DESINSTALAR DESTE COMPUTADOR.bat na pasta notas-youtube.\r\nchcp 65001 >nul\r\nif exist "' + path.join(AQUI, 'LIGAR.bat') + '" start "Minhas Cifras - notas do YouTube" /min "' + path.join(AQUI, 'LIGAR.bat') + '"\r\n');
  return F_LOGIN;
}

/* ---------------- principal ---------------- */
const args = process.argv.slice(2);
try {
  if (args[0] === '--parar') { console.log((await pararOutro()) ? 'Programa fechado.' : 'O programa nao estava aberto.'); process.exit(0); }
  if (args[0] === '--instalar') {
    const onde = instalarNoLogin();
    console.log(WIN ? 'Vai abrir sozinho no login do Windows. Atalho criado em:\n  ' + onde
      : 'Vai ligar sozinho quando o celular ligar, desde que o app Termux:Boot (F-Droid) esteja instalado e tenha sido aberto uma vez.\n  ' + onde);
    process.exit(0);
  }
  if (args[0] === '--codigo') {
    const s = args.slice(1).join('').toLowerCase().replace(/^cifras/, '').replace(/[^a-z0-9]/g, '');
    if (s.length !== 16) { console.log('Codigo incompleto. Sao 16 letras e numeros, como em cifras-xxxx-xxxx-xxxx-xxxx.'); process.exit(1); }
    await pararOutro();
    gravaJson(F_CONFIG, { canal: 'cifras-' + s.match(/.{4}/g).join('-'), criado: new Date().toISOString() });
    estado.pareado = false; estado.ultimo = ''; estado.pares = {}; gravaEstado();
    console.log('Codigo trocado. Abra o programa outra vez.'); process.exit(0);
  }
  if (args[0] === '--desinstalar') {
    const tinha = fs.existsSync(F_LOGIN); fs.rmSync(F_LOGIN, { force: true });
    console.log(tinha ? 'Nao abre mais sozinho.' : 'Nao estava configurado para abrir sozinho.');
    console.log((await pararOutro()) ? 'Programa fechado.' : 'O programa nao estava aberto.'); process.exit(0);
  }
  try { if (fs.statSync(F_REGISTRO).size > 1e6) fs.rmSync(F_REGISTRO); } catch (e) {}
  await preparar();
  if (args[0] === '--teste') {
    const [, video, ini, fim] = args, t0 = Date.now();
    const { det, daMemoria } = await analisar(video, +ini, +fim);
    console.log(JSON.stringify(det, null, 1));
    console.log('notas base:', Analise.notasBase(det, 0, false).join(' '), '|', ((Date.now() - t0) / 1000).toFixed(1) + ' s', daMemoria ? '(da memoria)' : '');
    process.exit(0);
  }
  const cfg = lerConfig(args[0] === '--novo-codigo');
  canal = cfg.canal;
  const linkParear = SITE + '#/parear/' + canal;
  const pagina = WIN ? await paginaDeParear(canal) : '';
  // enquanto nenhum aparelho tiver falado com este programa, abre sozinho o caminho para ligar:
  // no computador, a pagina com o QR code; no celular, o proprio app ja com o codigo
  if ((!estado.pareado || cfg.novo || args[0] === '--parear') && !process.env.CIFRAS_SEM_ABRIR) abrir(WIN ? pagina : linkParear);
  if (args[0] === '--parear' || args[0] === '--novo-codigo') {
    console.log('Codigo: ' + canal + (WIN ? '\nPagina para parear: ' + pagina : '\nAbrindo o app para ligar. Se nao abrir, digite o codigo em Ajustes > Notas pelo link do YouTube.'));
    await espera(600); process.exit(0);
  }
  if (cfg.novo) { estado.pareado = false; estado.ultimo = ''; gravaEstado(); }
  if (!(await travar())) { console.log(WIN ? 'Este programa ja esta aberto em outra janela. Pode fechar esta.' : 'O programa ja esta aberto (em outra sessao do Termux ou desde que o celular ligou).'); process.exit(0); }
  console.log('');
  console.log('  Minhas Cifras - notas pelo link do YouTube');
  if (WIN) {
    console.log('  Deixe esta janela aberta: e ela que atende os pedidos feitos no celular.');
    console.log('  Codigo deste computador: ' + canal);
    console.log('  Para ligar um celular: abra "PAREAR O CELULAR.html" (pasta notas-youtube).');
    console.log('  Abre sozinho no login: ' + (fs.existsSync(F_LOGIN) ? 'sim' : 'nao (rode INSTALAR NESTE COMPUTADOR.bat)'));
  } else {
    console.log('  Atendendo. Pode voltar para o app; deixe o Termux aberto em segundo plano.');
    console.log('  Codigo: ' + canal);
    console.log('  Ligar o app de novo: notas --parear     Parar: Ctrl+C ou "Exit" na notificacao');
    console.log('  Liga sozinho com o celular: ' + (fs.existsSync(F_LOGIN) ? 'sim' : 'nao (notas --instalar, com o Termux:Boot)'));
  }
  console.log('');
  setInterval(() => ola(false), 6 * 3600e3).unref();
  await escutar();
} catch (e) {
  console.error('\nNao deu para iniciar: ' + (e.message || e));
  process.exit(1);
}
