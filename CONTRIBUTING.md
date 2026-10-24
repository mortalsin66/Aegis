# Documentation and release notes / Документация и описания релизов

## English

- Keep `README.md` in English and `README.ru.md` in Russian, with matching information and links between languages.
- Write `RELEASE_NOTES.md` with both `## English` and `## Русский` sections. Describe the same changes, limitations and upgrade steps in both languages.
- When preparing a release, save the same notes in `docs/releases/vX.Y.Z.md` and update both package versions.
- Do not change a published version tag when correcting documentation. CI updates the release description while preserving its tag and target commit.
- The release workflow checks that both language sections are present. Translation itself must be supplied in the source files.

## Русский

- Поддерживайте `README.md` на английском и `README.ru.md` на русском, с одинаковой информацией и ссылками для переключения языка.
- В `RELEASE_NOTES.md` должны быть разделы `## English` и `## Русский`. Изменения, ограничения и порядок обновления должны совпадать в обеих версиях.
- При подготовке релиза сохраняйте тот же текст в `docs/releases/vX.Y.Z.md` и обновляйте версии обоих пакетов.
- Исправляя документацию, не меняйте опубликованный тег версии. CI обновляет описание релиза, сохраняя тег и коммит.
- Workflow проверяет наличие обоих языковых разделов. Перевод необходимо подготовить в исходных файлах.
