#!/data/data/com.termux/files/usr/bin/bash
# Teste automatico do programa de notas dentro de um Termux de verdade (imagem termux-docker),
# rodado pela Action "Testar no Termux". Usa o instalador e o programa PUBLICADOS no site.
# O que NAO da para testar aqui: o download do YouTube (ele barra servidores de nuvem; no
# celular funciona) e o que e do Android (abrir o app, segundo plano, Termux:Boot). Por isso o
# audio do teste e um tom de 440 Hz (La 4) gerado na hora e posto na pasta de audios guardados.
set -e -o pipefail
SITE="https://ferreira096.github.io/cifras"
RAW="__RAW__"
T="${TMPDIR:-$PREFIX/tmp}"; mkdir -p "$T"   # no Termux nao existe /tmp
ok() { echo "  [ok] $*"; }
falhou() { echo "  [FALHOU] $*"; exit 1; }
mascara() { sed -E 's/cifras-[a-z0-9]{4}(-[a-z0-9]{4}){3}/cifras-(codigo)/g'; }

COD="cifras-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n' | sed -E 's/(.{4})/\1-/g; s/-$//')"

echo "=== 1. instalador deste commit, com o codigo vindo do app ==="
curl -fsSL "$RAW/docs/programa/instalar-termux.sh" | CIFRAS_SEM_TESTE=1 CIFRAS_CODIGO="$COD" bash 2>&1 | grep -v -E "^(Get:|Selecting|Preparing|Unpacking|Setting up|\(Reading)" | mascara
command -v notas >/dev/null || falhou "comando notas nao foi criado"
ok "comando notas criado"
echo "  node $(node -v) | $(python --version) | yt-dlp $(python -m yt_dlp --version) | $(ffmpeg -version | head -n 1 | cut -c1-40)"
echo "  plataforma vista pelo node: $(node -e 'console.log(process.platform)')"
grep -q "$COD" "$HOME/cifras-notas/config.json" || falhou "codigo do app nao foi aplicado"
ok "codigo do app aplicado"
test -x "$HOME/.shortcuts/Notas do YouTube" || falhou "atalho do Termux:Widget"
ok "atalho do Termux:Widget criado"

echo "=== 2. analise de um audio (tom de 440 Hz) ==="
mkdir -p "$HOME/cifras-notas/cache"
ffmpeg -v error -f lavfi -i "sine=frequency=440:duration=6" -c:a aac "$HOME/cifras-notas/cache/TESTEAUDIO1.m4a" </dev/null
notas --teste TESTEAUDIO1 0 5 > $T/teste.txt 2>&1 || { cat $T/teste.txt; falhou "analise"; }
tail -n 1 $T/teste.txt
grep -q '"notas": "A4' $T/teste.txt || { cat $T/teste.txt; falhou "esperava La 4 (A4) como nota principal"; }
grep -q 'analisado no celular' $T/teste.txt || falhou "o programa nao se reconheceu como Termux"
ok "ffmpeg + analise devolveram A4; origem = celular"

echo "=== 3. pedido pelo canal, como o app faz ==="
curl -fsSL "$RAW/scripts/teste-cliente.mjs" -o $T/cliente.mjs
(CIFRAS_SEM_ABRIR=1 notas > $T/saida.txt 2>&1 &)
sleep 6
if node $T/cliente.mjs "$HOME/cifras-notas/config.json" TESTEAUDIO1 0 5; then ok "o programa respondeu ao teste de ligacao e ao pedido"; CANAL=ok; else echo "  [aviso] sem resposta pelo canal (o ntfy.sh pode limitar os servidores do GitHub)"; CANAL=falhou; fi
notas --parar
mascara < $T/saida.txt | sed 's/^/    | /'
[ "$CANAL" = ok ] || falhou "canal"

echo "=== 4. abrir o app (aqui nao ha Android; so nao pode quebrar) e ligar com o celular ==="
notas --parear | mascara
notas --instalar
test -x "$HOME/.termux/boot/minhas-cifras-notas" || falhou "arquivo do Termux:Boot"
sh -n "$HOME/.termux/boot/minhas-cifras-notas" || falhou "arquivo do Termux:Boot com erro"
sed 's/^/    | /' "$HOME/.termux/boot/minhas-cifras-notas"
ok "arquivo do Termux:Boot criado"
notas --desinstalar
test ! -e "$HOME/.termux/boot/minhas-cifras-notas" || falhou "desinstalar"
ok "desinstalar apagou"

echo "=== 5. YouTube de verdade (informativo: em servidor de nuvem o esperado e ser barrado) ==="
if notas --teste xINKo1kjnWo 108 114 > $T/yt.txt 2>&1; then echo "  baixou e analisou: $(tail -n 1 $T/yt.txt)"; else echo "  nao baixou: $(tail -n 1 $T/yt.txt | cut -c1-200)"; fi

echo
echo "TUDO CERTO no Termux (menos o que depende do aparelho)."
