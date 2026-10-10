# Aegis

Само-хостинговая панель управления Linux-сервером (аналог Cockpit / Portainer).

## Стек
- **Бэкенд**: Node.js + Fastify + Socket.IO + systeminformation
- **Фронтенд**: Vue 3 + Vite + Tailwind CSS

## Структура
- `agent/` — агент (REST API + WebSocket, systemd-сервис `aegis-agent`)
- `web/` — веб-панель (SPA)

## Установка
См. `deploy.sh` и `agent/aegis-agent.service`.

## Обновление
Панель автоматически проверяет новые релизы в этом репозитории
(раздел «Настройки → Обновление панели»).
