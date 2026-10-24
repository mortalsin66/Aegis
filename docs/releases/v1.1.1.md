# Aegis v1.1.1

[English](#english) · [Русский](#русский)

## English

Fixed small network traffic values that previously rounded down to `0.0 MB/s`.

- The dashboard and Network page automatically choose B/s, KB/s, MB/s or GB/s.
- Incoming and outgoing traffic use independent units.
- History chart tooltips and axes also keep small rates visible.
- The agent collects all interface counters through a shared cache. The dashboard selects the default-route interface; the Network page shows each interface's own counters.
- Regression tests cover small rates, interface selection and invalid readings.
- When the installed-version file is missing, the agent reads its version from package.json.

Update through **Settings → Panel update → Check → Update**, then sign in again after the restart.
Metrics describe server interface traffic, not only panel requests: ↓ received, ↑ sent.

## Русский

Исправлено отображение небольшого сетевого трафика, который ранее округлялся до `0.0 МБ/с`.

- Дашборд и раздел «Сеть» автоматически выбирают Б/с, КБ/с, МБ/с или ГБ/с.
- Входящий и исходящий потоки показывают собственные единицы измерения.
- Подсказки и оси графика истории также сохраняют видимость небольших скоростей.
- Агент собирает статистику всех интерфейсов через общий кэш. Дашборд выбирает интерфейс маршрута по умолчанию; остальные интерфейсы получают свои счётчики в разделе «Сеть».
- Добавлены регрессионные тесты для малых скоростей, выбора интерфейса и некорректных показаний.
- Версия агента при отсутствии файла установленной версии берётся из package.json.

Обновление: **Настройки → Обновление панели → Проверить → Обновить**. После перезапуска войдите заново.
Метрики показывают трафик интерфейса сервера, а не только запросы панели: ↓ входящий, ↑ исходящий.
