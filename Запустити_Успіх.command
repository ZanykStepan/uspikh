#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Потрібен Node.js 22.12 або новіший. Після встановлення запустіть цей файл повторно.'
  read
  exit 1
fi
echo 'Адресу сайту буде виведено нижче. Для зупинки натисніть Control+C.'
node server/start.mjs
