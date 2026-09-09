# Проверка языкового workflow и результатов — 9 сентября 2026

База изменений: `7b86d3a`. Проверяется рабочее дерево, а не новый commit: изменения не закоммичены. Исходное изменение `apps/web/tsconfig.json` сохранено. Основной scope и фактические отметки: [единый план](unified-implementation-plan-2026-09-09.md).

## Реализовано

- Разделены UI locale, определённый язык ввода, сохранённый язык задачи, voice locale и язык артефакта. Автоматический выбор фиксируется при публикации compilation; ручной override имеет собственную revision. UI switch не меняет execution snapshot.
- Новые call selectors используют локализованные EN/DE названия и один `en-GB`; исторический `en-US` читается. Account preference, guest preference и черновик со свободным factsText независимы.
- Перевод плана/уточнений сохраняет исходные field IDs. Receipt связывает утверждение с compilation/hash и точным original либо artifact/hash. Репозитории и SQL start guard требуют receipt у policy v2. Cutover оставляет v1 только точным прежним утверждённым версиям.
- Финальный ASR создаёт immutable original revision. Автоматическая сводка использует вопросы утверждённой compilation именно исходной попытки. Ссылки ведут к оригинальным сегментам; отрицание, условность и неизвестность не меняют outcome, credits или feedback. Полная расшифровка переводится по запросу.
- Работа идёт в отдельном ограниченном text worker; durable lease, generation, дедупликация и сохранённые chunks защищают retry. Максимум 8 исходных частей по 28 000 символов/250 элементов, 24 provider requests на артефакт за все retries, 3 поколения, 6 целевых языков и отдельный пользовательский rate limit. Слишком большой источник явно отклоняется.
- Новые payload зашифрованы, входят в owner export v2, ротацию, recovery и удаление. Поздний provider response после pending/completed удаления не восстанавливает данные.
- UI/CMS имеют расширяемые реестры; третья тестовая локаль не добавляет voice/text capabilities. Для Terms/AUP сохраняется фактически показанный общий acceptedLocale. EN/DE остаются единственными поставленными UI-словарями.
- Учебное демо использует общие компоненты плана и сводки. Исправлены seed/candidate тексты о предварительно утверждённых сведениях, кредите после соединения, AI-распознавании согласия и хранении аудио. От указанного пользователем администратора созданы пять новых CMS drafts; публикация отделена от кода.

## Проверки

По решению пользователя исходные скриншоты, PDF и машинные отчёты удалены из репозитория и не версионируются. Ниже сохранены результаты выполненных проверок без приложенных исходных артефактов. При повторном запуске отчёты сохраняются только в игнорируемом `.tools/verification-language/`.

| Проверка | Результат и границы |
| --- | --- |
| API unit/regression | **493/493**, 0 skipped. Включает consent/bridge, auth, стоимость, языки, start paths, hash fixtures, text processing и лимит генерации при смене языка. |
| Все API PostgreSQL suites | **58/58**, 0 skipped. Fresh disposable БД с миграциями 0001–0067, последовательный запуск, удаление только созданной fixture БД. |
| CMS staging | После добавления transaction adapter: новый atomic staging/rollback/replay test **1/1**, прежний PostgreSQL content suite **5/5** на новой fixture БД; API typecheck прошёл. |
| Реальные CMS drafts | Privacy, Terms, FAQ page, Imprint и FAQ collection созданы от явно указанного пользователем активного superadmin. Проверены 8 page localizations и FAQ items; опубликованные версии, 8 acceptance rows и AUP/Landing drafts не изменились. Порядок воспроизведения: [локальный CMS staging](public-content-staging-2026-09-09.md). |
| Финальные text/resolver проверки | **41/41** после уточнения mixed-source capabilities; затем отдельная регрессия rate-limit при PATCH языка плюс app/auth: **68/68**. Числа/даты, evidence, конфликт ответов между частями, сохранение следующих шагов, rollback и retry проверены. |
| API TypeScript и build | `tsc --noEmit` и `tsup` прошли. Миграции скопированы в dist. После уточнения определения языка по собственной формулировке objective, а не по именам/цитируемым документам, compiler/integrity regression **21/21** и повторный build прошли. |
| Production flags | **20/20** targeted runtime/capability tests и API typecheck после проверки неявно включённого mock. API и worker отвергают production mock при явном `true` и при отсутствии флага, если mock иначе включился бы по умолчанию. Explicit `false` допустим. |
| Web/contracts, браузер, PDF | Web **154/154**, contracts **78/78**. [Отдельный отчёт UI](verification-language-ui-2026-09-09.md): сборка, 1280/390/320 px, EN/DE, обе темы, реальные source links, кириллица PDF. Saved-reader/approved-start retry покрыты регрессией. Авторизованный браузерный workflow остаётся отдельным ограничением ниже. |
| Сквозной HTTP workflow | Login → независимый UI preference → RU task/DE call → перевод → translated receipt → mock start → transcript translation/summary refs. Все providers и данные disposable fixture. |
| Ротация, dump/restore, удаление | [Проверка данных](verification-text-data-2026-09-09.md): 17 encrypted columns, 21 critical table, 14 наполненных семейств реально расшифрованы после Docker pg_dump/restore; pending/completed deletion с поздним ответом. |
| Copy и diff | `copy:check` и `git diff --check` прошли. |
| Локальная схема | 0063–0067 применены к локальной dev БД. `db:migrate:check`: 67 migrations, latest `0067_extensible_content_locales.sql`. Старые опубликованные CMS revisions и acceptances не переписывались. |

Root Turbo-команда `corepack pnpm typecheck` не нашла `pnpm` binary в окружении. Использовались эквивалентные package-scoped команды; успешный root Turbo-run не заявляется. Интеграционные тесты первоначально столкнулись с изменением 0065 во время запуска и одним старым direct-SQL fixture без receipt; после фиксации миграций и корректировки fixture весь новый прогон прошёл. Production start guard не ослаблялся.

## Реальный текстовый провайдер

`verify-text-directions.ts --run-provider` выполнил семь ограниченных запросов с вымышленными данными через настроенную модель `gpt-5.6`: plan DE→RU, clarification DE→RU, plan FR→UK, transcript DE/EN→RU и FR→UK, summary DE/EN→RU и FR→UK. Каждый пример использовал максимум один запрос. Исходники сценариев доступны в `apps/api/scripts/verify-text-directions.ts`; ответы и usage при новом запуске сохраняются только локально в `.tools/verification-language/`.

Все семь ответов прошли структурную проверку. Просмотр результатов подтвердил сохранение запрета на запись, даты `17.09.2026`, reference/email, отрицательного ответа про пятницу, условности понедельника и отсутствия подтверждения. Встроенная в transcript инструкция переведена как реплика. Сводки не придумали цену и содержат ссылки на исходные реплики. Это ограниченная смысловая проверка примеров, а не сертификация всех языковых пар.

После усиления проверки чисел сохранённые реальные ответы повторно прошли текущие validators командой `--validate-recorded`, без новых provider requests. Цифры/даты/время сохраняются в исходном формате: даже перевод с изменённым форматированием числа может быть отклонён. Это консервативное ограничение v1. Валидатор проверяет структуру, существование evidence и идентификаторы/числа; он не доказывает семантическую точность каждого предложения.

## Включение и откат

API и внешний worker должны работать на совместимом коде с одним настроенным processor/model. Для реального processor генерация по умолчанию выключена; пустой список направлений не включает все пары. `.env.example` показывает mock-профиль для локального запуска. Реальный ключ сам по себе не активирует driver или направления.

`TEXT_ARTIFACT_GENERATION_ENABLED` управляет новой генерацией, `TEXT_ARTIFACT_DIRECTIONS` — отдельными операциями/направлениями. Для review источник — язык плана, для clarification — язык вопросов compiler. Для transcript и summary источник `*`: voice locale не доказывает язык смешанной речи. Шесть технических target языков: EN/DE/FR/IT/RU/UK. Каждый публично включаемый набор требует собственного quality gate; семь примеров выше не обосновывают включение всех источников wildcard.

Отключение generation/direction останавливает и queued provider work, сохраняя чтение готовых артефактов и original review. Оно не отменяет уже отправленный запрос. Его late result всё равно проходит source/lease/deletion checks. Review policy v2 и SQL receipt guard при откате не отключаются. Повторная генерация с иной моделью получает иной generatorVersion; старые готовые переводы остаются читаемыми.

## Что остаётся перед выпуском

- Авторизованный браузерный click-through, draft retention при реальной смене URL и loading/retry/stale в браузере. Инструмент вернул `browsers: []`; HTTP и unit tests не выданы за эту проверку. Публичные screenshot checks были выполнены до потери browser surface.
- Согласование существующих AUP/Landing drafts и финальная CMS preview/publication через предусмотренный workflow. Пять новых drafts уже созданы после ответа пользователя об авторе; [процесс staging](public-content-staging-2026-09-09.md). Существующие AUP и Landing drafts сохранены. Drafts не означают publication.
- Включение проверенных направлений в целевом runtime и проверка API/worker конфигурации. Массовый перевод истории не запускался.
- Текущая голосовая приёмка с разрешённым получателем, включая retention/consent, и внешние R06–R14 по release roadmap. Реальных звонков, отправки писем/SMS и публичного выпуска в этом пакете не выполнялось.

## Воспроизведение

Из корня: `corepack pnpm db:migrate:check`, `corepack pnpm copy:check`, `git diff --check`; package-scoped `typecheck`, `lint`, `build` для contracts/API/web.

Из `apps/api`:

```powershell
node node_modules/vitest/vitest.mjs run --exclude '**/*.integration.test.ts' --silent
node --import tsx scripts/run-isolated-integration.ts
node --import tsx scripts/verify-text-directions.ts --validate-recorded
```

`--run-provider` выполняет платные запросы только по явному запуску; `--validate-recorded` локален. Восстановление/ротация и disposable app QA описаны в связанных отчётах.
