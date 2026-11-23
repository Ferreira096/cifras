// node teste-cliente.mjs <config.json> <video> <ini> <fim>
// Faz o que o app faz: teste de ligacao (ping) e um pedido de notas pelo canal. Sai com 0 se
// o programa respondeu aos dois. Nao imprime o codigo.
import fs from 'node:fs';
const [arq, video, ini, fim] = process.argv.slice(2);
const R = 'https://ntfy.sh/' + JSON.parse(fs.readFileSync(arq, 'utf8')).canal;
const id = () => Math.random().toString(16).slice(2, 14).padEnd(12, '0');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const envia = async (o) => { const r = await fetch(R, { method: 'POST', body: JSON.stringify(o) }); if (!r.ok) throw new Error('canal respondeu ' + r.status + ' ao enviar'); };
const le = async () => (await (await fetch(R + '/json?poll=1&since=5m')).text()).split('\n').filter(Boolean).map((l) => { try { const j = JSON.parse(l); return j.event === 'message' ? JSON.parse(j.message) : null; } catch (e) { return null; } }).filter(Boolean);
try {
  const ping = id(), ped = id();
  await envia({ t: 'ping', id: ping });
  await envia({ t: 'pedido', id: ped, video, ini: +ini, fim: +fim });
  let pong = false, det = null, erro = '';
  for (let i = 0; i < 20 && !(pong && (det || erro)); i++) {
    await espera(1500);
    const ms = await le();
    pong = pong || ms.some((m) => m.t === 'pong' && m.id === ping);
    const e = ms.find((m) => m.t === 'erro' && m.id === ped); if (e) erro = e.erro;
    const ps = ms.filter((m) => m.t === 'resultado' && m.id === ped).sort((a, b) => a.n - b.n);
    if (ps.length && ps.length === ps[0].de) det = JSON.parse(ps.map((p) => p.txt).join(''));
  }
  console.log('  ligacao:', pong ? 'respondeu' : 'SEM RESPOSTA', '| pedido:', det ? 'notas ' + det.notas + ' (' + det.modo + ')' : erro ? 'ERRO ' + erro : 'SEM RESPOSTA');
  process.exit(pong && det ? 0 : 1);
} catch (e) { console.log('  falha no canal:', e.message); process.exit(1); }
