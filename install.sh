#!/usr/bin/env bash
# Aegis — установка панели управления сервером одной командой.
#
#   curl -fsSL https://raw.githubusercontent.com/mortalsin66/Aegis/main/install.sh | sudo bash
#
# Или из клонированного репозитория:  sudo bash install.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mortalsin66/Aegis.git}"
PANEL_PORT="${PANEL_PORT:-9000}"

if [[ $EUID -ne 0 ]]; then
  echo "Ошибка: нужен root. Запусти одной командой:"
  echo "  curl -fsSL https://raw.githubusercontent.com/mortalsin66/Aegis/main/install.sh | sudo bash"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# --- 0. исходники: если запущен не из репозитория — клонируем/обновляем /opt/aegis ---
if [[ -d "agent" && -d "web" && -f "agent/src/index.js" ]]; then
  APP_DIR="$(pwd)"
  echo "== [0/7] Исходники уже на месте: $APP_DIR =="
else
  apt-get update -y
  apt-get install -y git curl ca-certificates
  APP_DIR="${APP_DIR:-/opt/aegis}"
  if [[ -d "$APP_DIR/.git" ]]; then
    echo "== [0/7] Обновление существующего $APP_DIR =="
    cd "$APP_DIR"
    git pull --ff-only
  else
    echo "== [0/7] Клонирование $REPO_URL =="
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  fi
fi

echo "== [1/7] Системные зависимости =="
apt-get update -y
apt-get install -y curl git ca-certificates build-essential python3 ufw tmux zip unzip util-linux

echo "== [2/7] Node.js 22 =="
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "  Node: $(node -v) / npm: $(npm -v)"

echo "== [3/7] pnpm =="
if ! command -v pnpm >/dev/null 2>&1 || [[ "$(pnpm --version)" != "11.25.0" ]]; then
  npm install -g pnpm@11.25.0
fi
echo "  pnpm: $(pnpm -v)"

echo "== [4/7] Зависимости агента =="
cd "$APP_DIR/agent"
pnpm install --frozen-lockfile
pnpm rebuild node-pty || true

echo "== [5/7] Сборка веб-панели =="
cd "$APP_DIR/web"
pnpm install --frozen-lockfile
pnpm build

echo "== [6/7] systemd-сервис + файрвол =="
sed -e "s#WorkingDirectory=/opt/aegis/agent#WorkingDirectory=$APP_DIR/agent#" \
    -e "s#Environment=PORT=9000#Environment=PORT=$PANEL_PORT#" \
    "$APP_DIR/agent/aegis-agent.service" > /etc/systemd/system/aegis-agent.service
systemctl daemon-reload
if [[ ! -f "$APP_DIR/agent/.aegis-password" && ! -f "$APP_DIR/agent/.aegis-initial.env" ]]; then
  INITIAL_PASSWORD=$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')
  umask 077
  printf 'AEGIS_PASSWORD=%s\n' "$INITIAL_PASSWORD" > "$APP_DIR/agent/.aegis-initial.env"
fi
sed -i "/^\[Service\]/a EnvironmentFile=-$APP_DIR/agent/.aegis-initial.env" /etc/systemd/system/aegis-agent.service
systemctl daemon-reload
systemctl enable aegis-agent
systemctl restart aegis-agent
node -p 'require("./package.json").version' > "$APP_DIR/.aegis-version"

ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow "$PANEL_PORT"/tcp >/dev/null 2>&1 || true

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "Готово!"
echo "  Панель:   http://$IP:$PANEL_PORT"
echo "  Логин:    admin"
if [[ -n "${INITIAL_PASSWORD:-}" ]]; then echo "  Пароль:   $INITIAL_PASSWORD"; else echo "  Пароль:   существующий пароль сохранён"; fi
echo "  Служба:   systemctl status aegis-agent"
