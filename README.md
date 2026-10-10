# RezKery Randomizer

Проект рандомайзера каталога rezkery.com: браузерное расширение для Chrome/Chromium и Firefox, а также исходный Gradle-проект Android-приложения.

## Импорт исходников

Для завершения переноса исходников нужен один ручной шаг: загрузите подготовленный архив `rezkery-randomizer-repository.zip` в репозиторий по пути `releases/rezkery-randomizer-repository.zip`. Затем откройте вкладку **Actions**, выберите **Import source archive** и нажмите **Run workflow**. Workflow извлечёт каталоги `extension/` и `android/`, добавит их в репозиторий отдельным коммитом и удалит загруженный ZIP.

Архив можно взять из предыдущего сообщения ChatGPT, где он был приложен как файл. После импорта проверьте результаты запусков workflows в Actions.

## Документация

- [Архитектура](docs/architecture.md)
- [Сборка и тестирование](docs/build-and-test.md)
- [Чек-лист релиза](docs/release-checklist.md)
- [История изменений](CHANGELOG.md)

## Целевые платформы

- Chrome 109 / Windows 7
- Современный Chrome / Chromium
- Firefox 115 ESR
- Современный Firefox
- Android (Gradle source project; APK ещё не собран)

## Важно

Исходники расширений и Android будут считаться импортированными только после успешного запуска workflow. APK пока не собран. Используйте проект в соответствии с правилами сайта и применимым законодательством.
