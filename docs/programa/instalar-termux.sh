#!/data/data/com.termux/files/usr/bin/bash
# Minhas Cifras - instala no Termux (Android) o programa que atende, no proprio celular, os
# pedidos de "notas pelo link do YouTube" feitos no app.
#
# Uso, dentro do Termux:
#   curl -fsSL https://ferreira096.github.io/cifras/programa/instalar-termux.sh | bash
#
# O que faz: atualiza os pacotes do Termux; instala Node, Python e ffmpeg; instala o yt-dlp;
# baixa servidor.mjs e analise.js deste site para ~/cifras-notas; cria o comando "notas";
# testa um trecho e ja deixa atendendo. Nao pede senha, conta nem permissao de armazenamento.
# Rodar de novo atualiza tudo e mantem o codigo ja criado.
set -e -o pipefail
SITE="https://ferreira096.github.io/cifras"
PASTA="$HOME/cifras-notas"

if [ -z "$PREFIX" ] || [ ! -x "$PREFIX/bin/pkg" ]; then
  echo "Este instalador e para o Termux (Android). Abra o Termux e rode o comando la."
  exit 1
fi

echo
echo "== 1/4  Atualizando o Termux e instalando Node, Python e ffmpeg (alguns minutos) =="
export DEBIAN_FRONTEND=noninteractive
pkg upgrade -y -o Dpkg::Options::="--force-confold"
pkg install -y nodejs-lts python ffmpeg
python -m pip --version >/dev/null 2>&1 || pkg install -y python-pip

echo
echo "== 2/4  Instalando o yt-dlp =="
python -m pip install -q -U yt-dlp

echo
echo "== 3/4  Baixando o programa =="
mkdir -p "$PASTA"
curl -fsSL "$SITE/programa/servidor.mjs" -o "$PASTA/servidor.mjs.novo"
curl -fsSL "$SITE/analise.js" -o "$PASTA/analise.mjs.novo"
grep -q "notas pelo link do YouTube" "$PASTA/servidor.mjs.novo" || { echo "O arquivo do programa veio estranho. Tente de novo daqui a pouco."; exit 1; }
node "$PASTA/servidor.mjs" --parar >/dev/null 2>&1 || true   # se uma versao antiga estiver aberta, fecha
mv "$PASTA/servidor.mjs.novo" "$PASTA/servidor.mjs"
mv "$PASTA/analise.mjs.novo" "$PASTA/analise.mjs"

# comando "notas" e atalho para o Termux:Widget (opcional)
cat > "$PREFIX/bin/notas" <<EOF
#!$PREFIX/bin/sh
cd "$PASTA" && exec node servidor.mjs "\$@"
EOF
chmod 755 "$PREFIX/bin/notas"
mkdir -p "$HOME/.shortcuts"
printf '#!%s/bin/sh\nexec notas\n' "$PREFIX" > "$HOME/.shortcuts/Notas do YouTube"
chmod 700 "$HOME/.shortcuts/Notas do YouTube"

echo
echo "== 4/4  Testando com um trecho de exemplo =="
if notas --teste xINKo1kjnWo 108 114 | tail -n 1; then
  echo "Funcionou."
else
  echo "O teste falhou (veja a mensagem acima). Confira a internet e rode o comando de novo."
  exit 1
fi

echo
echo "Pronto. Daqui em diante, para atender os pedidos: abra o Termux e digite  notas"
echo "Vou ligar agora e abrir o app para voce confirmar a ligacao."
echo
exec notas
