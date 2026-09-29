/*
 * Roda na GitHub Action (evento "notas"). Baixa SO o trecho do video do YouTube (yt-dlp),
 * converte para PCM mono 22050 Hz (ffmpeg) e roda a MESMA analise do app (docs/analise.js).
 * Escreve o resultado em $RESULTADO para o scripts/aplicar.mjs gravar na biblioteca.
 *
 * Variaveis: VIDEO (id de 11 caracteres), INI e FIM (segundos), ID (id da cifra).
 * O YouTube costuma barrar servidores de datacenter ("Sign in to confirm you're not a bot");
 * por isso tentamos varios clientes do yt-dlp antes de desistir.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { analisarPCM, textoDeteccao } from '../docs/analise.js';

const SAIDA = process.env.RESULTADO || 'resultado.json';
const video = String(process.env.VIDEO || '').trim(), ini = +process.env.INI, fim = +process.env.FIM, id = String(process.env.ID || '');
const chave = `notas:${id}:${ini}-${fim}`;

function falha(msg) {
  fs.writeFileSync(SAIDA, JSON.stringify({ tipo: 'erro', chave, erro: msg, em: new Date().toISOString() }));
  console.error('[ERRO]', msg);
  process.exit(0);
}
if (!/^[\w-]{11}$/.test(video)) falha('id de video invalido');
if (!(fim > ini && fim - ini <= 120)) falha('trecho invalido (maximo 120 s)');

const url = 'https://www.youtube.com/watch?v=' + video;
const a = Math.max(0, ini - 1), b = fim + 1; // baixa com 1 s de folga; o corte exato e no ffmpeg
// com o provedor de PO Token, os clientes web sao os que costumam passar; os outros ficam de reserva
const clientes = ['mweb', 'web', 'web_embedded', 'tv', 'android', 'ios'];
let ok = false, ultimoErro = '';
for (const c of clientes) {
  try { fs.rmSync('trecho.wav', { force: true }); } catch (e) {}
  const r = spawnSync('yt-dlp', ['--no-playlist', '-f', 'ba/b', '--download-sections', `*${a}-${b}`, '--force-keyframes-at-cuts', '-x', '--audio-format', 'wav', '-o', 'trecho.%(ext)s', '--extractor-args', `youtube:player_client=${c}`, url], { encoding: 'utf8', timeout: 240000 });
  const erros = (r.stderr || '').split('\n').filter((l) => /ERROR|WARNING.*(pot|PO Token|token)/i.test(l));
  console.log(`yt-dlp [${c}]: status ${r.status}` + (erros.length ? ' | ' + erros.join(' | ').slice(0, 300) : ''));
  if (r.status === 0 && fs.existsSync('trecho.wav')) { ok = true; break; }
  ultimoErro = erros.pop() || ('yt-dlp saiu com ' + r.status);
}
if (!ok) falha('o YouTube nao deixou baixar o audio pelo servidor: ' + ultimoErro.replace(/^ERROR:\s*/, '').slice(0, 220));

const ff = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(ini - a), '-t', String(fim - ini), '-i', 'trecho.wav', '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
if (ff.status !== 0) falha('ffmpeg: ' + String(ff.stderr).slice(0, 200));
const buf = Buffer.from(ff.stdout);
const pcm = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)));
console.log('trecho:', (pcm.length / 22050).toFixed(1), 's de audio');

let d;
try { d = analisarPCM(pcm, 22050); } catch (e) { falha(e.message); }
const tx = textoDeteccao(d);
const det = { notas: tx.notas, seq: tx.seq, acorde: d.acorde, resumo: tx.resumo, modo: 'youtube', em: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) };
fs.writeFileSync(SAIDA, JSON.stringify({ tipo: 'notas', id, ini, fim, det }));
console.log('ok:', tx.resumo.replace(/\n/g, ' / '));
