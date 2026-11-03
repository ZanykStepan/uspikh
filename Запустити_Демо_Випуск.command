#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Потрібен Node.js 22.12 або новіший. Після встановлення запустіть цей файл повторно.'
  read
  exit 1
fi
echo 'Демонстрація випуску: дата в системі 05.07.2027, дані зберігаються окремо в server/demo-data.json.'
echo 'Для зупинки натисніть Control+C.'
DEMO_TODAY=2027-07-05 DATA_FILE=server/demo-data.json node server/start.mjs
