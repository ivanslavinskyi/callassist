# Проверка хранения текстовых данных — 2026-09-09

Проверены миграции 0063–0067, ротация ключа, восстановление резервной копии и удаление аккаунта при работающем текстовом провайдере. Команды выполнялись из `apps/api` на локальном PostgreSQL. URL и ключи в отчёте не сохраняются.

## Выполненные проверки

| Проверка | Результат | Что подтверждено |
| --- | --- | --- |
| `rotation.integration.test.ts`, включая настоящий Docker backup/restore | 1/1 | Все 17 зашифрованных полей входят в inventory; готовый legacy v1 payload, chunk, оригинальная revision и review receipt читаются только новым ключом. Хеши и содержимое неизменны, повторная ротация ничего не переписывает. |
| `recovery-drill.test.ts` | 3/3 | Проверяются локальная целевая БД, точные контрольные суммы миграций и наличие всех 21 обязательных таблиц, включая каждое новое семейство текстовых данных. |
| `text-deletion.integration.test.ts` | 2/2 | Поздний ответ приходит при pending и completed удалении аккаунта. Новые запросы и сохранение перевода блокируются сразу; удаление обнуляет artifact, chunk, transcript revision и receipt. Ответ не создаёт данные заново; учёт запроса завершается. |
| API TypeScript | Успешно | `tsc --noEmit`. |

Реальный `pg_dump` → `pg_restore` завершился с `database_recovery_drill_succeeded`: 21 обязательная таблица проверена, все таблицы сверены по количеству строк, 14 непустых зашифрованных семейств расшифрованы новым ключом. Три остальных семейства не содержат данных в этой fixture; полнота inventory отдельно сверена со всеми фактическими `*_ciphertext` колонками БД.

## Команды

```powershell
$env:RUN_TEXT_RECOVERY_DRILL = 'true'
node --import tsx --import ./src/config/load-env.ts node_modules/vitest/vitest.mjs run src/db/rotation.integration.test.ts --silent
```

```powershell
node node_modules/vitest/vitest.mjs run src/db/recovery-drill.test.ts --silent
node --import tsx --import ./src/config/load-env.ts node_modules/vitest/vitest.mjs run src/db/text-deletion.integration.test.ts --silent
node node_modules/typescript/bin/tsc --noEmit
```

Флаг `RUN_TEXT_RECOVERY_DRILL` включает настоящий Docker round trip в rotation fixture. Без него выполняется PostgreSQL-проверка ротации без запуска Docker. OpenAI adapter в тестах удаления использует локальный deferred mock `fetch`; внешних запросов, звонков и писем эти проверки не выполняют.

## Изоляция и очистка

- `isolatedTestDatabase()` создаёт собственную БД `callassist_fixture_<uuid>_test` из `template0` и применяет миграции заново. После тестов соединения закрываются и БД удаляется в `afterAll`.
- Recovery drill создаёт дополнительную `callassist_restore_drill_<random>` и временный dump, удаляет их в `finally`. Проверено `temporaryResourcesRemoved: true`.
- Ротация, backup/restore и удаление выполнялись только над этими disposable fixtures. Пользовательские опубликованные CMS revisions, acceptance evidence и AUP draft не изменялись.
- Неизменность production constraints сохранена: обычная попытка подменить готовый payload, source hash или язык receipt отвергается PostgreSQL; специальный режим ротации разрешает замену ciphertext без изменения доказательства.

## Повторная проверка integration setup

Исходный общий прогон начался в 09:47:07 UTC; файл `0065_text_artifacts_and_jobs.sql` был изменён в 09:47:40 UTC во время его выполнения. Четыре поздних набора (`postgres-auth`, `postgres-rate-limiter`, `session-stream`, `postgres-content`) остановились на checksum guard до выполнения assertions. `load-env.ts` сохраняет явно переданные переменные (`override: false`); runner передаёт URL отдельной БД корректно. Проверку checksum и применённые схемы ради зелёных тестов не ослабляли.

Повторный прогон четырёх файлов на новой disposable БД с окончательными миграциями прошёл: **23/23 теста, 0 skipped**. БД удалена в `finally`, временный runner удалён. Машинный отчёт удалён из репозитория по решению пользователя; при повторном запуске отчёты сохраняются локально в игнорируемом `.tools/verification-language/`. Изменений в этих четырёх test setup и production constraints не потребовалось.
