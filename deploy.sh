#!/usr/bin/env bash
# Деплой Aegis на Ubuntu-сервере.
# Запускать в папке /opt/aegis (после копирования web/ и agent/ на сервер).
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/4: зависимости агента =="
cd agent
npm install --omit=dev

echo "== 2/4: сборка фронтенда =="
cd ../web
if [ ! -d dist ]; then
  npm install
  npm run build
fi

echo "== 3/4: systemd-юнит =="
sudo cp ../agent/aegis-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aegis-agent

echo "== 4/4: готово =="
IP=$(hostname -I | awk '{print $1}')
echo "Панель: http://$IP:9000"
echo "Логин по умолчанию: admin / admin"
echo "ВАЖНО: задай AEGIS_PASSWORD (и при желании AEGIS_TOTP_SECRET) в /etc/systemd/system/aegis-agent.service"
echo "  в секции [Service] добавь: Environment=AEGIS_PASSWORD=твой_пароль"
