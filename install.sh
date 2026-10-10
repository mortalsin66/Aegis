#!/usr/bin/env bash
# Aegis — установка панели управления сервером на Ubuntu/Debian.
# Запуск: sudo bash install.sh   (из корня репозитория)
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL_PORT="${PANEL_PORT:-9000}"

if [[ $EUID -ne 0 ]]; then
  echo "Ошибка: запусти от root — sudo bash install.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "== [1/6] Системные зависимости =="
apt-get update -y
apt-get install -y curl git ca-certificates build-essential python3 ufw

echo "== [2/6] Node.js 22 =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "  Node: $(node -v) / npm: $(npm -v)"

echo "== [3/6] pnpm =="
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm@11
fi
echo "  pnpm: $(pnpm -v)"

echo "== [4/6] Зависимости агента =="
cd "$APP_DIR/agent"
pnpm install

echo "== [5/6] Сборка веб-панели =="
cd "$APP_DIR/web"
pnpm install
pnpm build

echo "== [6/6] systemd-сервис + файрвол =="
sed -e "s#WorkingDirectory=/opt/aegis/agent#WorkingDirectory=$APP_DIR/agent#" \
    -e "s#Environment=PORT=9000#Environment=PORT=$PANEL_PORT#" \
    "$APP_DIR/agent/aegis-agent.service" > /etc/systemd/system/aegis-agent.service
systemctl daemon-reload
systemctl enable --now aegis-agent

# правила файрвола (SSH + порт панели) — сам файрвол можно включить в панели
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow "$PANEL_PORT"/tcp >/dev/null 2>&1 || true

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "Готово!"
echo "  Панель:   http://$IP:$PANEL_PORT"
echo "  Логин:    admin / admin (при первом входе панель попросит сменить пароль)"
echo "  Служба:   systemctl status aegis-agent"
