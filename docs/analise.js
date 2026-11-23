/* Analise de audio: usada pelo app (navegador) e pela GitHub Action (Node).
   FFT por quadro; chroma so com os PICOS do espectro (somar todas as raias espalha a energia
   de uma nota nas vizinhas e inventa um C# ao lado de um C); templates maior/menor para o
   acorde provavel; HPS (produto harmonico, 3 harmonicos) + mediana movel para a nota mais
   forte de cada instante, agrupada em sequencia. Sem dependencias. */
const NOTAS_S=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function fft(re,im){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
  for(let len=2;len<=n;len<<=1){ const ang=-2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
    for(let i=0;i<n;i+=len){ let cr=1,ci=0; for(let j=0;j<len/2;j++){ const a=i+j,b=a+len/2; const tr=re[b]*cr-im[b]*ci, ti=re[b]*ci+im[b]*cr; re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti; const ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr; } } }
}
const nomeMidi=(m)=>NOTAS_S[((m%12)+12)%12]+(Math.floor(m/12)-1);
function analisarPCM(pcm,sr){
  const N=4096, hop=1024, win=new Float32Array(N); for(let i=0;i<N;i++) win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));
  const chroma=new Float64Array(12), porMidi=new Float64Array(128), quadros=[];
  const re=new Float32Array(N), im=new Float32Array(N), mag=new Float32Array(N/2);
  const bMin=Math.max(1,Math.floor(55*N/sr)), bMax=Math.min(N/2-1,Math.ceil(2500*N/sr)), bCorte=Math.round(240*N/sr); // 240 Hz ~ B3: abaixo e regiao de baixo
  let limiar=0; const energias=[];
  for(let s=0;s+N<=pcm.length;s+=hop){ let e=0; for(let i=0;i<N;i++) e+=pcm[s+i]*pcm[s+i]; energias.push(e/N); }
  if(!energias.length) throw new Error('Trecho curto demais para analisar.');
  limiar=Math.max(1e-7, Math.max(...energias)*0.002); // abaixo disso e silencio/ruido de fundo
  let q=0;
  for(let s=0;s+N<=pcm.length;s+=hop,q++){
    if(energias[q]<limiar){ quadros.push({t:s/sr,midi:-1,grave:-1}); continue; }
    for(let i=0;i<N;i++){ re[i]=pcm[s+i]*win[i]; im[i]=0; }
    fft(re,im);
    for(let k=0;k<N/2;k++) mag[k]=Math.hypot(re[k],im[k]);
    // so os PICOS do espectro contam: somar todas as raias espalha a energia de uma nota nas
    // vizinhas (lobo principal da janela) e inventa um C# ao lado de um C.
    for(let k=bMin;k<=bMax;k++){ if(!(mag[k]>mag[k-1]&&mag[k]>=mag[k+1])) continue; const a=mag[k-1],b=mag[k],c=mag[k+1]; let d=0.5*(a-c)/(a-2*b+c); if(!isFinite(d)||Math.abs(d)>1) d=0; const m=69+12*Math.log2((k+d)*sr/N/440), mi=Math.round(m); if(Math.abs(m-mi)>0.5) continue; const w=b*b; chroma[((mi%12)+12)%12]+=w; if(mi>=0&&mi<128) porMidi[mi]+=w; }
    // nota mais forte do quadro (produto harmonico), em DUAS regioes: numa gravacao de banda o
    // baixo domina o espectro inteiro e esconderia o riff; separando, saem a linha do baixo
    // (mao esquerda) e a do riff/melodia (mao direita).
    const pico=(k0,k1)=>{ let melhor=-1, melhorV=0; for(let k=k0;k<=k1;k++){ if(3*k+2>=N/2) break; // nos graves a raia e larga perto da nota: o 2o e o 3o harmonicos caem ate 2 raias ao lado de 2k e 3k
        const h2=Math.max(mag[2*k-1],mag[2*k],mag[2*k+1]), h3=Math.max(mag[3*k-2],mag[3*k-1],mag[3*k],mag[3*k+1],mag[3*k+2]); const v=mag[k]*h2*h3; if(v>melhorV){melhorV=v;melhor=k;} }
      if(melhor<1) return null; let f=melhor*sr/N; if(melhor<N/2-1){ const a=mag[melhor-1],b=mag[melhor],c=mag[melhor+1]; const d=0.5*(a-c)/(a-2*b+c); if(isFinite(d)&&Math.abs(d)<1) f=(melhor+d)*sr/N; }
      return {k:melhor,f,midi:Math.round(69+12*Math.log2(f/440))}; };
    let topo=0; for(let k=bMin;k<=bMax;k++) if(mag[k]>topo) topo=mag[k];
    let grave=pico(bMin,bCorte-1), agudo=pico(bCorte,bMax);
    if(grave&&mag[grave.k]<0.08*topo) grave=null;   // regiao vazia: o "pico" seria so ruido
    if(agudo&&mag[agudo.k]<0.02*topo) agudo=null;
    // o agudo e um harmonico exato do grave (2x a 6x, 8x)? Um quadro assim nao prova nada (riff em
    // quinta ou oitava do baixo e comum); se for assim no trecho INTEIRO, e um som grave sozinho.
    let harm=false;
    if(grave&&agudo){ const razao=agudo.f/grave.f, inteiro=Math.round(razao); harm=[2,3,4,5,6,8].includes(inteiro)&&Math.abs(12*Math.log2(razao/inteiro))<0.35; }
    quadros.push({t:s/sr,midi:agudo?agudo.midi:-1,grave:grave?grave.midi:-1,harm});
  }
  const max=Math.max(...chroma); if(!(max>0)) throw new Error('Nao captei som nesse trecho. Aumente o volume ou aproxime o microfone.');
  const notas=[]; for(let p=0;p<12;p++) if(chroma[p]>=max*0.30){ let oit=-1,ov=0; for(let m=p;m<128;m+=12) if(porMidi[m]>ov){ov=porMidi[m];oit=m;} notas.push({p,peso:chroma[p]/max,nome:oit>=0?nomeMidi(oit):NOTAS_S[p]}); }
  notas.sort((a,b)=>b.peso-a.peso);
  let acorde='', acV=-Infinity;
  for(let r=0;r<12;r++) for(const [suf,iv] of [['',[0,4,7]],['m',[0,3,7]]]){ let v=0; for(let p=0;p<12;p++) v+=iv.includes((p-r+12)%12)?chroma[p]:-0.6*chroma[p]; if(v>acV){acV=v;acorde=NOTAS_S[r]+suf;} }
  const linha=(campo)=>{ // mediana movel de 5 quadros + agrupamento; nota que dura menos de 4 quadros e descartada
    const med=quadros.map((x,i)=>{ const j=quadros.slice(Math.max(0,i-2),i+3).map(y=>y[campo]).filter(m=>m>0).sort((a,b)=>a-b); return j.length?j[Math.floor(j.length/2)]:-1; });
    const out=[]; let atual=-1, ini=0, n=0;
    for(let i=0;i<=med.length;i++){ const m=i<med.length?med[i]:-2; if(m===atual){n++;continue;} if(atual>0&&n>=4){ const ult=out[out.length-1]; const d=(i-ini)*hop/sr; if(ult&&ult.midi===atual&&quadros[ini].t-(ult.ini+ult.dur)<0.25) ult.dur=quadros[ini].t+d-ult.ini; else out.push({midi:atual,ini:quadros[ini].t,dur:d}); } atual=m; ini=i; n=1; }
    return out; };
  const seq=linha('midi'), baixo=linha('grave');
  const comAgudo=quadros.filter(x=>x.midi>0).length, soHarmonico=quadros.filter(x=>x.midi>0&&x.harm).length;
  if(!seq.length||(baixo.length&&comAgudo&&soHarmonico/comAgudo>=0.9)) return {notas,acorde,seq:baixo,baixo:[],dur:pcm.length/sr}; // so havia som grave: ele e o riff
  return {notas,acorde,seq,baixo,dur:pcm.length/sr};
}
function textoDeteccao(d){
  const notas=d.notas.map(n=>n.nome).join(' ');
  const escreve=(l)=>(l||[]).map(s=>nomeMidi(s.midi)+'('+s.dur.toFixed(1)+'s)').join(' ');
  const seq=escreve(d.seq), baixo=escreve(d.baixo);
  return {notas, seq, baixo, resumo:'Notas: '+notas+(d.acorde?'  ·  acorde provavel: '+d.acorde:'')+(seq?'\nRiff: '+seq:'')+(baixo?'\nBaixo: '+baixo:'')};
}

/* ---- notas de riff: transpor e desenhar para teclado ----
   As notas de um riff (digitadas ou detectadas) ficam guardadas no tom ORIGINAL da cifra e sao
   mostradas no tom que estiver na tela, como os acordes. */
const NOTAS_B=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const PC_NOTA={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,'E#':5,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0};
const nomePc=(pc,bemol)=>(bemol?NOTAS_B:NOTAS_S)[((pc%12)+12)%12];
const nomeMidiTom=(m,bemol)=>nomePc(m,bemol)+(Math.floor(m/12)-1);
// nota solta num texto: "E", "G#", "Bb4"; nao pega letra de palavra ("Em", "Do", "Fim") nem numero de duracao
const RE_NOTA=/(^|[^A-Za-z0-9#.])([A-G][#b]?)(\d)?(?![A-Za-z0-9#])/g;
function transporNotas(texto,n,bemol){
  n=+n||0;
  return String(texto||'').replace(RE_NOTA,(tudo,antes,nome,oit)=>{
    const pc=PC_NOTA[nome]; if(pc==null) return tudo;
    if(oit==null||oit==='') return antes+(n?nomePc(pc+n,bemol):nome);
    return antes+(n?nomeMidiTom(pc+12*(+oit+1)+n,bemol):nome+oit);
  });
}
/* "B4(2.0s) E5(0.5s)" -> [{midi,dur}] ; aceita tambem so "E5 G#5" */
function sequenciaDe(texto){
  const seq=[]; const re=/([A-G][#b]?)(\d)(?:\(([\d.]+)s\))?/g; let m;
  while((m=re.exec(String(texto||'')))){ const pc=PC_NOTA[m[1]]; if(pc==null) continue; seq.push({midi:pc+12*(+m[2]+1),dur:m[3]?+m[3]:0.5}); }
  return seq;
}
/* notas-base: as notas da sequencia na ordem em que aparecem, sem repetir e sem oitava. Nota
   que soma menos de 0,25 s no trecho todo (passagem, escorregada) fica de fora quando sobram
   pelo menos duas mais firmes. */
function notasBase(det,n,bemol){
  n=+n||0; let seq=sequenciaDe(det&&det.seq); if(!seq.length) seq=sequenciaDe(det&&det.notas);
  const total={}; for(const s of seq){ const pc=((s.midi%12)+12)%12; total[pc]=(total[pc]||0)+s.dur; }
  const firmes=Object.keys(total).filter(pc=>total[pc]>=0.25).length;
  const base=[]; for(const s of seq){ const pc=((s.midi%12)+12)%12; if(firmes>=2&&total[pc]<0.25) continue; const nome=nomePc(pc+n,bemol); if(!base.includes(nome)) base.push(nome); }
  return base;
}
/* desenho no tempo, igual a tablatura de teclado: uma linha por tecla, "o" onde a nota entra e
   "=" enquanto dura. Devolve [{nota, corpo}] da mais aguda para a mais grave. */
function roloDeNotas(det,n,bemol){
  n=+n||0; const seq=sequenciaDe(det&&det.seq); if(seq.length<2) return null;
  const passo=0.12; let col=0; const ev=[];
  for(const s of seq){ const w=Math.max(2,Math.round(s.dur/passo)); ev.push({midi:s.midi+n,col,w}); col+=w+1; }
  const largura=col, notas=[...new Set(ev.map(e=>e.midi))].sort((a,b)=>b-a);
  return notas.map(m=>{ const arr=new Array(largura).fill('-'); for(const e of ev) if(e.midi===m){ arr[e.col]='o'; for(let k=1;k<e.w;k++) arr[e.col+k]='='; } return {nota:nomeMidiTom(m,bemol),corpo:arr.join('')}; });
}
/* A sequencia em "tempos", para desenhar quadrinhos com o nome da nota (mesmo formato de
   CifraClub.tabEmTempos): linhas da mais aguda para a mais grave; l = 0..4 conforme a duracao. */
function temposDeNotas(det,n,bemol){
  n=+n||0; const seq=sequenciaDe(det&&det.seq); if(seq.length<2) return null;
  const midis=[...new Set(seq.map(s=>s.midi+n))].sort((a,b)=>b-a);
  const linhas=midis.map(m=>({nome:nomePc(m,bemol),oit:Math.floor(m/12)-1}));
  const tempos=seq.map(s=>({i:[midis.indexOf(s.midi+n)],l:Math.max(0,Math.min(4,Math.round((s.dur-0.25)/0.25)))}));
  return {linhas,tempos};
}

export { analisarPCM, textoDeteccao, nomeMidi, fft, transporNotas, sequenciaDe, notasBase, roloDeNotas, temposDeNotas };
globalThis.Analise = { analisarPCM, textoDeteccao, nomeMidi, transporNotas, sequenciaDe, notasBase, roloDeNotas, temposDeNotas };
