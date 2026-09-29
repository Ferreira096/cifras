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
  const bMin=Math.max(1,Math.floor(55*N/sr)), bMax=Math.min(N/2-1,Math.ceil(2500*N/sr));
  let limiar=0; const energias=[];
  for(let s=0;s+N<=pcm.length;s+=hop){ let e=0; for(let i=0;i<N;i++) e+=pcm[s+i]*pcm[s+i]; energias.push(e/N); }
  if(!energias.length) throw new Error('Trecho curto demais para analisar.');
  limiar=Math.max(1e-7, Math.max(...energias)*0.002); // abaixo disso e silencio/ruido de fundo
  let q=0;
  for(let s=0;s+N<=pcm.length;s+=hop,q++){
    if(energias[q]<limiar){ quadros.push({t:s/sr,midi:-1}); continue; }
    for(let i=0;i<N;i++){ re[i]=pcm[s+i]*win[i]; im[i]=0; }
    fft(re,im);
    for(let k=0;k<N/2;k++) mag[k]=Math.hypot(re[k],im[k]);
    // so os PICOS do espectro contam: somar todas as raias espalha a energia de uma nota nas
    // vizinhas (lobo principal da janela) e inventa um C# ao lado de um C.
    for(let k=bMin;k<=bMax;k++){ if(!(mag[k]>mag[k-1]&&mag[k]>=mag[k+1])) continue; const a=mag[k-1],b=mag[k],c=mag[k+1]; let d=0.5*(a-c)/(a-2*b+c); if(!isFinite(d)||Math.abs(d)>1) d=0; const m=69+12*Math.log2((k+d)*sr/N/440), mi=Math.round(m); if(Math.abs(m-mi)>0.5) continue; const w=b*b; chroma[((mi%12)+12)%12]+=w; if(mi>=0&&mi<128) porMidi[mi]+=w; }
    let melhor=-1, melhorV=0;
    for(let k=bMin;k<=bMax;k++){ let v=mag[k]; v*=(2*k<N/2)?mag[2*k]:0; v*=(3*k<N/2)?mag[3*k]:0; if(v>melhorV){melhorV=v;melhor=k;} }
    if(melhor<1){ quadros.push({t:s/sr,midi:-1}); continue; }
    let f=melhor*sr/N; if(melhor<N/2-1){ const a=mag[melhor-1],b=mag[melhor],c=mag[melhor+1]; const d=0.5*(a-c)/(a-2*b+c); if(isFinite(d)&&Math.abs(d)<1) f=(melhor+d)*sr/N; }
    quadros.push({t:s/sr,midi:Math.round(69+12*Math.log2(f/440))});
  }
  const max=Math.max(...chroma); if(!(max>0)) throw new Error('Nao captei som nesse trecho. Aumente o volume ou aproxime o microfone.');
  const notas=[]; for(let p=0;p<12;p++) if(chroma[p]>=max*0.30){ let oit=-1,ov=0; for(let m=p;m<128;m+=12) if(porMidi[m]>ov){ov=porMidi[m];oit=m;} notas.push({p,peso:chroma[p]/max,nome:oit>=0?nomeMidi(oit):NOTAS_S[p]}); }
  notas.sort((a,b)=>b.peso-a.peso);
  let acorde='', acV=-Infinity;
  for(let r=0;r<12;r++) for(const [suf,iv] of [['',[0,4,7]],['m',[0,3,7]]]){ let v=0; for(let p=0;p<12;p++) v+=iv.includes((p-r+12)%12)?chroma[p]:-0.6*chroma[p]; if(v>acV){acV=v;acorde=NOTAS_S[r]+suf;} }
  const med=quadros.map((x,i)=>{ const j=quadros.slice(Math.max(0,i-2),i+3).map(y=>y.midi).filter(m=>m>0).sort((a,b)=>a-b); return j.length?j[Math.floor(j.length/2)]:-1; });
  const seq=[]; let atual=-1, ini=0, n=0;
  for(let i=0;i<=med.length;i++){ const m=i<med.length?med[i]:-2; if(m===atual){n++;continue;} if(atual>0&&n>=4) seq.push({midi:atual,ini:quadros[ini].t,dur:(i-ini)*hop/sr}); atual=m; ini=i; n=1; }
  return {notas,acorde,seq,dur:pcm.length/sr};
}
function textoDeteccao(d){
  const notas=d.notas.map(n=>n.nome).join(' ');
  const seq=d.seq.map(s=>nomeMidi(s.midi)+'('+s.dur.toFixed(1)+'s)').join(' ');
  return {notas, seq, resumo:'Notas: '+notas+(d.acorde?'  ·  acorde provavel: '+d.acorde:'')+(seq?'\nSequencia: '+seq:'')};
}

export { analisarPCM, textoDeteccao, nomeMidi, fft };
globalThis.Analise = { analisarPCM, textoDeteccao, nomeMidi };
