# Реализация гибридного согласия — 4 октября 2026

Ветка: `codex/hybrid-consent-feasibility`. Основание — явное утверждение пользователем первого варианта из [исследования](hybrid-consent-feasibility-plan-2026-10-04.md): Live deltas и короткое окно ожидания. Риск позднего отрицательного продолжения принят пользователем. Новый источник ASR/finality не добавлялся.

## Реализованное поведение

После непрерванного проигрывания существующего initial disclosure и совпавшего Twilio mark гибридный режим собирает ограниченный текстовый кандидат только в памяти. Новые фрагменты или голосовая активность отменяют ожидающее решение. После 200 мс settle вызывается `classifyHybridConsent()`: affirmative сразу входит в существующий grant/recording flow, negative — в reject/hangup. Только unclear открывает semantic backend. Его запрос начинается после суммарных 900 мс, а не 200 + 900 мс. Semantic unclear сохраняет clarification → DTMF recovery.

При обнаруженной речи существующий PCMU detector сначала ждёт 600 мс тишины. Поэтому обычный минимальный путь после акустического окончания ответа составляет примерно 600 + 200 мс, затем транзакция БД и запуск записи Twilio. Это не обещание ответа за 200 мс от последнего звука. Потенциально устраняются около 700 мс прежнего settle и отдельное semantic delegation; фактический выигрыш нужно измерить на звонке.

Все семь call locales поддержаны: `de-CH`, `de-DE`, `fr-CH`, `it-CH`, `en-GB`, `en-US`, `ru-RU`. Словарь включает краткие естественные affirmative и reviewed Swiss German ASR-варианты. Сопоставляется целый нормализованный кандидат; отрицательные варианты имеют приоритет. Неизвестные длинные/условные фразы, вопросы, цитаты и текстовые признаки незавершённости направляются в semantic fallback. Кириллица `й` сохраняется; Latin accents нормализуются симметрично в словаре и входе. Старый `classifyConsent()` оставлен неизменным для compatibility paths.

**Сохраняющееся ограничение:** Live transcript delta не доказывает завершённость реплики. Полное `Yes, but don't record` не даст affirmative. Но если `but don't record` придёт после уже принятого решения по `Yes`, короткий таймер не предотвратит ранний grant. Это принятый компромисс первого варианта; тесты не доказывают его отсутствия в реальном ASR.

## Переключение и совместимость

В `/admin/system#voice-consent` добавлен раздел распознавания устного согласия. Администратор может прочитать текущую настройку; изменение разрешено active superadmin с указанием причины. Revision защищает от одновременных конфликтующих сохранений. API: GET/PUT `/api/admin/system/voice-consent`.

- `semantic_native` — исходное значение после миграции, прежний semantic flow.
- `hybrid_deterministic_v1` — local classifier с semantic fallback.

Выбор фиксируется при создании call attempt и сохраняется при reconnect. Изменение настройки действует только на новые попытки; старые attempts с NULL policy продолжают native behavior. Для локального теста гибрид включён отдельным аудируемым изменением, revision 2. Новый default для других окружений не менялся.

Initial disclosure и approved execution snapshots не переписаны. `assistanceReason=none` остаётся default без озвучивания причины; `speech_impairment` и `language_barrier` остаются добровольными вариантами. Historical/legacy disclosure не изменён. AMD, appointment/task policy и transcript persistence boundary сохранены.

## Аудит и запись

Миграция `0100_voice_consent_policy.sql` добавляет settings/audit и сохранённую policy attempt. Последовательность событий:

`disclosure.completed → consent.decision → consent.granted → recording.requested → recording.started`

Связи включают attempt, approved snapshot hash, disclosure version/text hash, playback generation/session/mark и его acknowledgement, receipt ID, decision ID и revision. Методы различаются как `deterministic_voice`, `semantic_voice`, `dtmf`; прежнее поле `method=voice|dtmf` остаётся совместимым. Recording start содержит provider recording ID, когда он подтверждён.

Affirmative decision, grant и request сохраняются в транзакции до вызова Twilio. Для нового unified runtime обязательны согласованные attempt/receipt/decision bindings. Повторные requests и callbacks идемпотентны; поздний callback после completed не теряет start evidence и не возвращает статус назад. Provider timestamps не сдвигают консервативную transcript boundary.

Исходящий Twilio call по-прежнему создаётся с `record: false`. Запись запрашивается только после affirmative. Аудит не содержит pre-consent recipient text/audio; локальный кандидат живёт только в памяти. При ошибке обязательного аудита запись не разрешается.

Диагностический экспорт включает закреплённую policy конкретного attempt и существующие call events. Глобальные settings, идентификаторы операторов и свободный текст причин их изменений явно исключены из call export. Историческое NULL не заменяется текущей настройкой; удалённые звонки не возвращают policy через экспорт.

## Проверки и локальный запуск первоначальной реализации

Этот раздел фиксирует первый запуск гибридного согласия. Последующие изменения и телефонная проверка `live-managed-v9` описаны в [разборе стабильности runtime](live-runtime-stability-plan-2026-10-04.md); итоговые проверки всей ветки — в [диагностике подготовки](preparation-latency-diagnostics-2026-10-04.md#проверка-перед-слиянием).

Финальные полные прогоны: API — **1 896 тестов / 154 файла**, contracts — **243 теста / 24 файла**, web — **366 тестов / 67 файлов**. Все **2 505 тестов** прошли. API запускался через `scripts/test-isolated-db.mjs` с отдельной временной PostgreSQL-базой; рабочая база не использовалась для тестов. Проверены typecheck API/contracts/web, production build API/contracts/web, каталог миграций, лицензия, public-copy consistency и `git diff --check`.

Первый общий API-прогон обнаружил отсутствие явного export scope для новых settings tables/attempt column — это исправлено и покрыто ZIP integration tests. Четыре промежуточных audit failure возникли при запуске до завершения параллельных правок; отдельные повторные audit suites и затем полный финальный API-прогон прошли на неизменной финальной версии.

Регрессии покрывают affirmative/negative по всем call locales, negative/qualification precedence, неполные/разделённые фрагменты и границу playback mark, semantic fallback, clarification/DTMF, все три assistanceReason и оба голоса. Отдельно проверены отмена устаревшего решения при возобновлении речи, первые voiced frames до события started, ожидающий audit receipt, конкуренция DTMF и речи, exactly-once recording, отсутствие pre-consent текста в persistence, идемпотентность/перестановка provider callbacks, immutable policy, административные права/revision и privacy диагностического экспорта.

Локальное окружение поднято 4 октября:

- Web: http://localhost:3000/ru; настройки: http://localhost:3000/admin/system#voice-consent.
- API: `127.0.0.1:4000`; Twilio gateway: `127.0.0.1:4001`; worker — embedded; PostgreSQL приложения — порт 55432.
- Unified Live, fallback=false, async AMD и agent hangup включены.
- Миграция 0100 применена после резервной копии; hybrid revision 2 включён для новых attempts.
- `/health/live` и `/health/ready` вернули 200; web вернул 200; защищённая админка без сессии корректно переадресует на login.
- Публичный Cloudflare tunnel ведёт только на gateway: приватный API возвращает 404, unsigned status webhook — 403, signed empty probe — 400 `INVALID_TWILIO_STATUS`. Это проверка связности/подписи без создания звонка.

Актуальные PID, временный tunnel URL, логи, время проверок и путь резервной копии сохранены локально в `.tools/runtime/hybrid-state.json`; результаты внешней проверки — `.tools/runtime/hybrid-tunnel-verification.json`. Секреты и `.env` не изменены. Телефонный звонок автоматически не выполнялся, реальная акустическая задержка пока не измерена.

Для ручной проверки сначала используйте новый attempt с кратким ответом (`Ja`, `Oui`, `Sì`, `Yes`, `Да`) и проверьте `decisionMethod=deterministic_voice`. Затем проверьте полный отказ с affirmative-префиксом, неоднозначный ответ с semantic fallback, clarification/DTMF и барж-ин во время disclosure. Для сравнения переключите режим в админке и создайте новый attempt: уже начатый звонок настройки не меняет.
