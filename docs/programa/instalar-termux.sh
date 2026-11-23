#!/data/data/com.termux/files/usr/bin/bash
# Minhas Cifras - instala no Termux (Android) o programa que atende, no proprio celular, os
# pedidos de "notas pelo link do YouTube" feitos no app.
#
# Uso, dentro do Termux (o app mostra e copia o comando em Ajustes > Rodar neste celular):
#   curl -fsSL https://ferreira096.github.io/cifras/programa/instalar-termux.sh | CIFRAS_CODIGO=cifras-xxxx-xxxx-xxxx-xxxx bash
#
# O que faz: atualiza os pacotes do Termux; instala Node, Python e ffmpeg; instala o yt-dlp;
# baixa servidor.mjs e analise.js deste site para ~/cifras-notas; cria o comando "notas";
# testa um trecho e ja deixa atendendo. Nao pede senha, conta nem permissao de armazenamento.
# Rodar de novo atualiza tudo.
#
#   CIFRAS_CODIGO     codigo que o app ja usa: o programa nasce ligado ao app (e ao computador,
#                     se ele usar o mesmo codigo). Sem ele, o programa cria um codigo e abre o
#                     app para confirmar.
#   CIFRAS_SEM_TESTE  so instala: nao testa o trecho de exemplo nem deixa atendendo (usado pelo
#                     teste automatico, que roda em servidor onde o YouTube nao entrega audio).
set -e -o pipefail
SITE="https://ferreira096.github.io/cifras"
PASTA="$HOME/cifras-notas"

if [ -z "$PREFIX" ] || [ ! -x "$PREFIX/bin/pkg" ]; then
  echo "Este instalador e para o Termux (Android). Abra o Termux e rode o comando la."
  exit 1
fi

# "</dev/null": este script chega pelo "curl | bash"; nenhum programa chamado aqui pode ler
# da mesma entrada, senao come o resto do script.
echo
echo "== 1/4  Atualizando o Termux e instalando Node, Python e ffmpeg (alguns minutos) =="
export DEBIAN_FRONTEND=noninteractive
pkg upgrade -y -o Dpkg::Options::="--force-confold" </dev/null
pkg install -y nodejs-lts python ffmpeg </dev/null
python -m pip --version >/dev/null 2>&1 </dev/null || pkg install -y python-pip </dev/null

echo
echo "== 2/4  Instalando o yt-dlp =="
python -m pip install -q -U yt-dlp </dev/null

echo
echo "== 3/4  Baixando o programa =="
mkdir -p "$PASTA"
curl -fsSL "$SITE/programa/servidor.mjs" -o "$PASTA/servidor.mjs.novo" </dev/null
curl -fsSL "$SITE/analise.js" -o "$PASTA/analise.mjs.novo" </dev/null
grep -q "notas pelo link do YouTube" "$PASTA/servidor.mjs.novo" || { echo "O arquivo do programa veio estranho. Tente de novo daqui a pouco."; exit 1; }
if [ -f "$PASTA/servidor.mjs" ]; then (cd "$PASTA" && node servidor.mjs --parar >/dev/null 2>&1 </dev/null) || true; fi   # versao antiga aberta: fecha
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

if [ -n "$CIFRAS_CODIGO" ]; then
  notas --codigo "$CIFRAS_CODIGO" </dev/null >/dev/null || { echo "O codigo do comando esta incompleto. Copie o comando de novo no app (Ajustes > Rodar neste celular)."; exit 1; }
  echo "Codigo do app aplicado."
fi

if [ -n "$CIFRAS_SEM_TESTE" ]; then
  echo "Instalado. (CIFRAS_SEM_TESTE: sem teste do trecho de exemplo e sem deixar atendendo.)"
  exit 0
fi

echo
echo "== 4/4  Testando com um trecho de exemplo =="
if notas --teste xINKo1kjnWo 108 114 </dev/null | tail -n 1; then
  echo "Funcionou."
else
  echo "O teste falhou (veja a mensagem acima). Confira a internet e rode o comando de novo."
  exit 1
fi

echo
echo "Pronto. Daqui em diante, para atender os pedidos: abra o Termux e digite  notas"
echo "Vou ligar agora e abrir o app para mostrar que esta respondendo."
echo
exec notas </dev/null
