# Деплой Orbit на Ubuntu Server

Агент Orbit собирает метрики и управляет сервером; он же раздаёт собранный фронтенд.
Всё работает на одном сервере (как Cockpit): ставишь агент, открываешь панель в браузере.

## Итоговая структура на сервере

```
/opt/orbit/
├── web/dist/      ← собранный фронтенд (Vite)
└── agent/         ← код агента + node_modules
```

## Шаги

### 1. Собери фронтенд (на машине разработки, Windows)

```bash
cd web
pnpm install
pnpm build          # создаст web/dist
```

### 2. Скопируй на сервер

```bash
# с Windows (или через любой scp/sftp)
scp -r web/dist user@SERVER:/opt/orbit/web/
scp -r agent       user@SERVER:/opt/orbit/
```

### 3. На сервере: установи Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # должно быть v20.x
```

### 4. Установи зависимости агента

```bash
cd /opt/orbit/agent
npm install --omit=dev      # или: pnpm install --prod
```

> Терминал использует `node-pty` (опциональная зависимость). Если pnpm заблокирует
> его build-скрипт, выполни `pnpm approve-builds` и разреши `node-pty`. Без него
> терминал переключится на fallback без полноценного TTY.

### 5. Установи systemd-юнит

```bash
sudo cp /opt/orbit/agent/orbit-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now orbit-agent
sudo systemctl status orbit-agent
```

### 6. Открой панель

Браузер → `http://<IP-сервера>:9000`

## Переменные окружения агента

| Переменная | По умолчанию | Описание |
|-----------|--------------|----------|
| `PORT` | `9000` | Порт панели |
| `HOST` | `0.0.0.0` | Интерфейс для прослушивания |
| `WEB_DIST` | `../../web/dist` | Путь к собранному фронтенду |
| `METRICS_INTERVAL` | `2000` | Интервал пушей метрик (мс) |

## Разработка (Windows)

```bash
# терминал 1 — фронтенд (Vite dev server, :5173)
cd web && pnpm dev

# терминал 2 — агент (:9000)
cd agent && pnpm start
```

Фронтенд в dev подключается к агенту на `http://localhost:9000` (можно переопределить
переменной `VITE_AGENT_URL`).
