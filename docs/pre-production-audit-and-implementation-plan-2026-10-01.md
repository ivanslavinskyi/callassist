# План аудита и подготовки SHPROHLI к production

Дата: 1 октября 2026 года. Статус: **утверждён; реализация и локальные проверки завершены**.

Итоговые изменения, результаты тестов и границы приёмки зафиксированы в
[отчёте о реализации](pre-production-implementation-2026-10-01.md). Production
deployment и реальная провайдерная приёмка этим статусом не подтверждаются.

Документ фиксирует результаты предварительного исследования текущего Live, план исправлений и критерии приемки. Он охватывает расходы, телеметрию и аудиоэкспорт, подготовку и отклонение планов, ограничения беты, очистку репозитория, документацию и последующий переход к proprietary / All Rights Reserved. Пользователь утвердил предложенные решения и уточнил: **все документы по ранбуку деплоя и топологии VPS остаются локально под `.gitignore`**. Это уточнение заменяет первоначальное предложение о version-controlled deployment runbook.

## Основание и границы исследования

Проверена ветка `main`, HEAD `938bc546d374ec72b044a0319c380d41fe411b0e`. До создания этого документа рабочее дерево было чистым. Изучены исходники API, web и contracts, соответствующие migrations, тесты, CI, release helper и актуальные/исторические документы. Исходный скриншот подтверждает существующий блок Admission limits; он не устанавливает сегодняшние значения настроек или состояние production.

Дополнительно выполнены только читающие запросы к **локальной** PostgreSQL с `default_transaction_read_only=on` и ограничением времени запросов. Подтверждены:

- `/health/ready` локального API возвращает `ready`, БД доступна; процессы API и web существуют.
- Локальный runtime manifest указывает `live-managed-v7`, `live`, fallback `false`, тот же HEAD. Все 1441 файла candidate manifest совпадают с рабочими исходниками. Это подтверждает соответствие файлов, но не заменяет проверку эффективного окружения каждого процесса на сервере.
- Локальный ledger содержит 95 миграций, включая `0000`, последняя — `0094_optional_transcript_public_copy.sql`.
- Текущие provider usage и история подготовок прочитаны агрегатами, без выгрузки текстов разговоров, телефонов, ключей или адресов пользователей.

Удаленный VPS, текущие счета провайдеров, доставку email и новые реальные звонки в этом исследовании не проверяли. Исторические owner-reported deployment records не объявляются сегодняшним состоянием production. Все численные наблюдения ниже относятся к локальной БД и небольшой выборке, содержащей разные предыдущие версии runtime. Новые provider requests, рассылки, звонки, миграции и изменения настроек не выполнялись. Проверки lint/typecheck/test на этом этапе не запускались заново; прежние отчеты не выдаются за новый результат.

## Подтвержденные находки

Приоритет P1 означает исправление до публичного запуска; P2 — значимый пробел диагностики/эксплуатации, который входит в этот план. Отсутствие production evidence обозначено отдельно от дефекта исходников.

| ID | Приоритет | Находка и следствие | Доказательство |
| --- | --- | --- | --- |
| C1 | P1 | Общий usage estimate, представляемый как OpenAI, включает оценки Twilio AMD/voicemail. Провайдерная разбивка и reconciliation могут вводить в заблуждение. | `apps/api/src/admin-operations.ts:247–296`; `apps/web/components/admin-expense-explorer.tsx:52,81` |
| C2 | P1 | `expenseCategory` не знает `realtime_session`, `answering_detection`, `voicemail_tts`: строки операций не полностью соответствуют расходам/usage. | `apps/web/lib/admin-costs.ts:17` |
| C3 | P1 | `live_application_synthesis` классифицируется как realtime text, хотя это синтез аудио. TTS-запрос начинается до durable записи операции: сбой процесса может оставить расход без операции. | `apps/api/src/admin-operations.ts:279–340`; `apps/api/src/voice/unified-live-call.ts:367–414` |
| T1 | P1 | Экспорт каждому transcript segment присваивает `legacy_unattributed`, `attemptId:null`, хотя уже выгружает дополнительные поля связи/времени. Manifest также содержит устаревшее предупреждение. | `apps/api/src/telemetry-export/sources.ts:119`; `archive.ts:75–82` |
| T2 | P1 | Allowlist экспорта отстает от Live v7: отсутствуют важные capture diagnostics, история assessment/terminal decisions, frozen summary context и часть связей retry/ASR. Анализ решения по архиву неполон. | `apps/api/src/telemetry-export/sources.ts:15–51`; migrations `0090–0093` |
| T3 | P2 | Аудиобайлы намеренно исключены. Текущий архив ограничен 250 MiB и 60 секундами snapshot; просто добавить скачивание WAV в ту же DB transaction нельзя. | `apps/api/src/telemetry-export/archive.ts:7,40,79` |
| P1 | P1 | Хвост подготовки связан с повторными запросами и примерно 60-секундными ошибками. Все исключения transport, включая timeout, записываются как `network_error`; точную причину нельзя восстановить из одного outcome. | `apps/api/src/brief-compiler/brief-compiler.ts:24–33,408–503`; локальные агрегаты ниже |
| P2 | P2 | Generation и отдельный языковой audit имеют одинаковую stage `compilation`; не видны разные виды repair. Общий worker последовательно обслуживает подготовку и другие классы jobs. | compiler `:233,398`; `apps/api/src/jobs/durable-job-worker.ts:171–185`; `call-service.ts:193–236` |
| S1 | P1 | Immutable policy decisions и telemetry есть, но отдельного списка отклоненных revisions, triage и соответствующего email event нет. Safety сейчас содержит только ограничения получателей. | `postgres-call-repository.ts:7944–8040`; `apps/web/app/admin/(console)/safety/page.tsx:9`; `packages/contracts/src/admin-notifications.ts:3` |
| S2 | P1 | `blocked + high` не означает доказанную атаку: fact/constraint integrity failures тоже получают high, хотя относятся к технической подготовке. | compiler `:721–760`; `packages/contracts/src/plan-preparation.ts:4–6` |
| B1 | P1 | Signup grant равен 3 в PostgreSQL и memory; периодической квоты нет. Общий lifetime ledger не поддерживает безопасный reset и возврат в исходный период. | `postgres-call-repository.ts:2065–2110,4946,7772–7804`; `in-memory-call-repository.ts:1324` |
| B2 | P2 | Registration options не содержат доступность/остаток мест. «3 кредита» зашиты также в auth sidebar, landing и terms/CMS. | `packages/contracts/src/registration.ts:10`; `apps/web/lib/i18n/design-messages.ts:8`; `apps/api/src/content/seed-content.ts:133,364,403` |
| D1 | P1 | Release helper разрешает новые SQL только `0085–0089`; текущий код требует `0090–0094` и будущие миграции этой работы. Обычный deploy также запрещает изменение каталога. | `scripts/shprohli-vps-release.sh:113–131` |
| D2 | P2 | README продолжает называть Realtime default и каталог до 0088; код по умолчанию выбирает Live/fallback=false. Runbook смешивает исторические инструкции и новые дополнения. | `README.md:12,179,258,273`; `apps/api/src/config/voice-runtime.ts:2–11`; `docs/deployment-preflight.md` |
| L1 | P2 | Корневого LICENSE, license metadata собственных четырех manifests и license check в CI нет. | корневой и три workspace `package.json`; `.github/workflows/ci.yml` |

### Измеренные задержки подготовки

Период выборки: с 25 сентября по 1 октября 2026 года включительно, срез на момент исследования. SQL группирует время по UTC; интерфейс должен форматировать даты в выбранной локали и явно обозначать зону.

| Метрика | Наблюдение |
| --- | --- |
| Успешные preparations | 39 |
| Failed preparations | 4 |
| Успешные, p50 / p95 / max от создания до completed | 14,79 / 124,10 / 187,56 с |
| Успешные длительностью более 45 с | 13; в каждом есть хотя бы один `network_error` |
| Начальное ожидание очереди у этих 13 | 0,02–0,03 с |
| Ошибки compilation stage | 19; p50 60,01 с, максимум 60,02 с |
| Успешные compilation-stage requests | 78; p50 6,41 с, p95 20,58 с, максимум 28,77 с |
| Последний preparation в выборке | 76,42 с, пять provider requests, один network_error |

Это подтверждает влияние таймаутов/повторов, но не доказывает причину зависания у провайдера: текущий outcome скрывает различие timeout, сети и чтения ответа. Начальная очередь не объясняет длинные случаи этой выборки. Изоляция worker pools нужна для надежности под нагрузкой, но не объявляется измеренным решением нынешнего хвоста. Перевод review — дополнительный этап, поэтому эти числа не равны полному ожиданию до готовой локализованной страницы.

### Наблюдения по расходам и данным

В локальной выборке последних 14 дней найдено 45 операций Twilio AMD. Их оценка $0,3375 по текущей карточке тарифа попадает в смешанную сумму с названием OpenAI. У 45 Live sessions сохранена длительность; 43 имеют successful outcome, две — неполный результат. Эти числа не являются сверкой со счетом провайдера.

Все 4211 сохраненных transcript segments имеют `call_attempt_id`, однако часть исторических связей могла быть вычислена миграцией 0093 по времени ближайшей предшествующей попытки. Нельзя автоматически назвать каждую такую связь точной native attribution. Нужно различать прямую связь, исторически выведенную связь и неизвестную.

Имеются 25 native capture records (19 complete, 6 incomplete), четыре assessment revisions, три terminal decisions, четыре frozen text artifact contexts, десять retry-source links. Эти данные подтверждают практическую значимость расширения export allowlist. В БД 32 доступные и 24 удаленные записи аудио; доступных записей с прошедшим deadline в срезе не было. Скачать их и проверить содержимое в рамках этого этапа не пытались.

## Инварианты реализации

1. Стабильный `unified_live` остается рабочим runtime: согласие, запуск записи, утвержденные полномочия, playback и завершение принадлежат приложению. Массовый рефакторинг оркестрации не входит в эту работу.
2. Live остается основным транскриптом; recording ASR запускается по явному запросу. Экспорт и диагностика не запускают ASR, перевод, summary или повторную компиляцию.
3. Пользовательские кредиты, резервы бюджета в USD, оценки стоимости и счета провайдера — разные сущности. Возврат пользовательского кредита не обнуляет реальный расход.
4. Неизвестные расходы/usage обозначаются неизвестными; исторические данные и решения не переписываются ради красивой отчетности.
5. Старые SQL migrations, immutable revisions/hashes, legal acceptances и ledger сохраняются. Изменения схемы — только новые forward migrations.
6. Нельзя добавлять в экспорт удаленные/истекшие данные или речь до согласия. Экспорт не продлевает retention и не восстанавливает недоступное аудио.
7. Нельзя ускорять план удалением safety checks или разрешением approval промежуточного результата.
8. Все новые операции администрирования используют существующие RBAC, CSRF, reason, optimistic revision и audit. Скрытая кнопка не заменяет проверку API.

## Этап 0 Подготовка воспроизводимого основания

- Зафиксировать SHA, migration catalog, конфигурационные имена и версии providers/compiler/runtime без секретных значений; составить матрицу local / release candidate / production.
- Проверить текущие tests и сборку на отдельной disposable test DB. Сохранить новые результаты отдельно от старых 2026-09 отчетов.
- Сверить реальные production SHA, migration ledger, эффективные API/worker flags, worker heartbeats, budget и notification settings чтением доступного operational interface. При отсутствии доступа оставить конкретный обязательный preflight, не объявлять его выполненным.
- Сохранить воспроизводимые read-only aggregate queries для расходов, подготовки, незавершенных provider operations, очередей и экспорта; пользовательские тексты/секреты не включать.
- Создать общий реестр новых contracts/tables/fields, которые должны одновременно попасть в admin, экспорт, deletion, encryption rotation и документацию. Это предотвращает повторение нынешнего отставания allowlist.

Результат: baseline и согласованный список миграций. Production deploy на этом этапе не выполняется.

## Этап 1 Расходы и их интерпретация

### Модель учета

- Утвердить один источник расчета operation-level estimate с явными `provider`, `operationType`, `stage`, `model`, `pricingVersion`, единицами и основанием стоимости.
- Разделить OpenAI (Live duration, delegation, disclosure/application TTS, preparation, translations, summaries, optional ASR), Twilio (voice leg, AMD, voicemail, Verify/SMS при наличии учета) и прочие account-level расходы. Для email, recordings/storage, аренды номера, налогов/скидок явно указать покрытие или его отсутствие.
- Разделить provider-reported cost, usage estimate, budget reservation и account billing snapshot. Snapshot служит сверкой, а не дополнительной строкой расходов звонка. Учесть поздно пришедшую цену, разные валюты, временные зоны, даты оказания услуги и даты получения счета.
- Исправить C1–C3 и все представления Overview, Expenses, Calls/Preparation inspector. Категория должна исчерпывающе обрабатывать каждый operation type; неизвестный тип видим как отдельная категория с предупреждением, а не исчезает.
- Строить Requests от provider operations с left joins и pagination, а не только от `effective_provider_usage`: сегодня операции без usage не попадают в детализацию (`postgres-call-repository.ts:3406`). Расширить completeness accounting на Live sessions и Twilio add-ons; успешная session без usage тоже должна быть видна как неполная.
- Сохранять версионность тарифов. Проверить актуальность используемых моделей и ставок по официальной документации и реальному billing scope перед релизом. Новая ставка получает новую версию/effective date; старые usage не пересчитывать сегодняшней ставкой. Отдельно проверить версионирование Twilio add-ons, которое сейчас обрабатывается специальной веткой.
- Исправить конкретную историческую нестабильность Twilio: текущая ветка pricing игнорирует сохраненную версию и считает voicemail по сегодняшнему `neutralVoicemailText`. Использовать зафиксированный issued character count и provider-specific rate snapshot; изменение текста не должно менять стоимость прошлого звонка (`provider-pricing-policy.ts:102–110`, `answering-usage.ts`).
- Для timeout/cancel/crash отсутствие usage означает «расход неизвестен/возможен», а не бесплатный запрос. Не смешивать отказ до dispatch, подтвержденную ошибку без списания и запрос, который провайдер мог выполнить.

### Надежность и UI

- TTS: до outbound request сохранить operation/reservation и корреляцию с attempt/parent; после ответа отдельно записать outcome/usage. Проверить crash между любыми двумя шагами. In-session cache не должен создавать повторный расход или повторную строку.
- Проверить весь путь каждого платного запроса: reserve → dispatch → outcome → usage/cost → reconciliation → release. Повторы и late callbacks идемпотентны; старые suspended operations не освобождают бюджет необоснованно.
- В UI дать отдельно «оценка операций», «подтверждено провайдером», «ожидает данных», «зарезервировано» и «счет аккаунта». Рядом — currency, период, единица агрегации, дата обновления и coverage.
- На карточке звонка показывать полный lifecycle expense, включая preparation до звонка и ASR/translation после него, с разграничением attempts и повторного использования compilation. В периодном отчете расходы относятся к заявленному временному срезу, без незаметного смешения scopes.
- Исправить классификацию application TTS и drilldown Live sessions; сохранить отдельные view Cost / Usage / Requests.

Приемка: fixtures и интеграционные тесты для смешанных OpenAI/Twilio затрат, unknown/zero, разных currencies, повторных callbacks/reconciliation, cache, partial Live session, TTS crash, позднего ASR. Суммы overview, детали и экспорт сходятся на одной выборке; invoice reconciliation не содержит затрат другого провайдера и не удваивает account billing.

## Этап 2 Полнота телеметрии и экспорт аудио

### Инвентаризация и версия экспорта

- Составить матрицу «событие/поле → где создается → persisted source → API/UI → экспорт → удаление». Проверить preparation, immutable compilation/review, consent/disclosure, AMD, recording, Live capture, playback, interruptions, tools и refusals, terminal decision, transcript sources/revisions, summary/assessment, credit settlement, provider usage, jobs и retry.
- Выпустить новую версию export schema/manifest с описанием совместимости. Исправить envelope attribution и stale warnings; исторически выведенную связь маркировать явно. Не придумывать отсутствующие timing, reasoning или точный deployment SHA старого звонка.
- Расширить allowlist: native capture status/gaps, ingestion sequence/received timestamps, application playback receipts, source/quality/completeness, оба transcript sources, recording transcript requests и provenance, ASR chunks/cache metadata без секретов, frozen summary context/hash, assessment revisions, terminal decisions и retry-source links. Новые safety cases и allowance provenance добавляются после их реализации.
- Включить budget reservations `postcall:<attempt>`: текущий scope выбирает только call/provider prefixes и теряет защищенный post-call резерв (`sources.ts:46`). Оставить raw/effective usage и account billing явно неаддитивными источниками.
- Добавить в admin coverage: неполный capture, отсутствующий usage, stale operation, unpriced model, pending artifact, число доступных audio. Метрику `conversation.first_audio` подписать как время первой отправки приложением: текущая точка измерения предшествует Twilio playback acknowledgment и не доказывает, когда звук услышал получатель (`unified-live-call.ts:1028–1037`).
- Для новых попыток сохранять deployment/runtime/compiler/policy/prompt version или hash в bounded metadata. Полные runtime instructions не реконструировать задним числом; если нужны для анализа, сохранять отдельный шифрованный versioned snapshot по тому же sensitive-access/retention режиму. Системные промпты и пользовательский контекст не писать в общие логи.
- Сохранить строгий allowlist. Тест должен замечать новые значимые таблицы/поля, оставшиеся без решения export/exclude, а не только выполнять `LIMIT 0` для уже перечисленных колонок.

### Аудио

В существующем `/admin/calls` → Telemetry export добавить «Включить доступные аудиозаписи»; предложенный default — включено для нового export. «Все аудио» означает все доступные записи **выбранных звонков/истории в scope экспорта**, а не выгрузку всего аккаунта провайдера.

1. В snapshot выбрать recording IDs и consent/retention/deletion metadata. Получать медиа через существующий server-side provider adapter, без provider credentials/публичных recording URL в архиве.
2. После короткого DB snapshot скачивать потоково с ограничением concurrent downloads, размера, таймаутов и повторов. Текущий provider helper буферизует запись целиком, а service accessor ориентирован на последнюю запись; нужен streaming adapter по recording ID для всех выбранных attempts (`twilio-telephony-provider.ts:153–172`). Не держать долгую SQL transaction во время сети. Продлевать lease и повторно проверять generation/разрешение на доступ; нынешний фиксированный lease нельзя считать достаточным для большого audio export.
3. Сохранять оригинальный формат и каналы, по возможности WAV для анализа; не превращать два канала в mono молча. Если конкретный формат недоступен, отметить это в manifest.
4. Использовать безопасные пути `audio/<callId>/<attemptId>/<recordingId>.<ext>`. В manifest указать hash, bytes, MIME, channels, duration, источник и timestamps, deadline, статус `included / deleted / expired / unavailable / fetch_failed` и bounded reason.
5. Увеличение лимитов обосновать нагрузочным тестом. Для больших объемов предусмотреть несколько скачиваемых частей/томов с общим manifest. Нельзя молча отрезать записи при достижении 250 MiB или выдавать неполный экспорт за полный.
6. Сохранить encrypted artifact storage, lease fencing, audited access и максимум 24 часа жизни. Для аудио срок доступности ограничить также исходным recording deadline; короткий остаток явно виден пользователю. Проверка перед download/выдачей каждой части и revocation закрывают гонку с удалением.
7. Добавить зависимости export↔recording: manual deletion, retention deletion и account/call deletion отзывают архивы с соответствующим содержимым и удаляют их части. Нынешняя privacy invalidation из migration 0079 не охватывает отдельное удаление recording; это обязательная часть реализации audio export. Не продлевать срок исходного аудио. Уже скачанный пользователем файл отозвать технически невозможно — это граница локального архива, а не обещание UI.
8. Не запускать ASR для удобства экспорта. Retention 0 продолжает означать немедленную допустимость удаления; отсутствующее аудио отражается в manifest.

Приемка: полный ZIP/parts распаковывается, hashes верны, все eligible recordings либо включены, либо имеют явную причину пропуска. Проверить несколько attempts, два канала, provider 404/429/timeouts, большие файлы, worker crash/retry, отмену, истечение lease, одновременное удаление во время snapshot/download, отзыв роли, TTL и отсутствие pre-consent audio. Проверить совпадение provenance с сохраненными источниками, включая legacy inference.

## Этап 3 Ускорение и предсказуемость подготовки плана

Текущий путь: input moderation → generation → локальная проверка → отдельный language audit → при необходимости repairs → output moderation → публикация → перевод для review. Нормальный путь уже достаточно быстрый; основная цель — убрать необъяснимый длинный хвост и сделать отказ управляемым.

- Разделить stages generation/language audit/repair/moderation/review translation. Сохранять queue wait, provider elapsed, header/body/overall timeout, HTTP status, attempt/repair number, reason, remaining deadline, policy/compiler/model version и bounded input/output size. Не логировать содержимое.
- Отделить общую длительность preparation от deadline одной попытки и одного provider request. Существующий 120-секундный deadline одного compile invocation не ограничивает весь lifecycle с durable retries.
- По traces определить зависание до headers, во время body, при output generation или повторе. Проверить runtime transport/proxy/connection reuse и обработку 429/Retry-After; текущий generic `network_error` не является диагнозом сети.
- Ввести согласованный end-to-end budget автоматической подготовки и retry policy; повтор запускать только при достаточном оставшемся времени. Abort не считать доказательством отмены биллинга у провайдера. Не добавлять параллельные speculative requests, удваивающие расходы.
- По размеру результатов и причинам repairs оптимизировать prompt, JSON schema и output ceiling. `max_output_tokens:20000` — верхняя граница, не доказательство фактического расхода; уменьшать только после измерений и проверок неполного JSON.
- Сохранить moderation, fact integrity, policy и language audit. Возможную более быструю модель для отдельного audit/translation или generation выбрать только после сравнения на одинаковых multilingual fixtures и проверки официальной доступности/цены. Смена модели не является предпосылкой первой оптимизации.
- Развести bounded обработчики compilation, длительного ASR и задач звонка с deadline. Удержать общий бюджет, ограничения конкуренции, lease heartbeat, fair scheduling и restart recovery. Не допустить, чтобы платный текстовый запрос блокировал answering timeout/retention.
- Показать в public UI настоящую стадию и повтор, сохранить submit idempotency и восстановление после reload. Готовность для approval наступает только после всех проверок и обязательного review translation. Не показывать фальшивый процент прогресса.
- Добавить waterfall и p50/p95 по версиям в Preparation inspector; в System — queue age по классам работ.

Предложенные ориентиры приемки: p50 не хуже текущих 15 с и p95 до 45 с для согласованного healthy-provider набора, отдельно измерять translated review. Для деградации утвердить конечный лимит автоматических retries после диагностики, с видимым recoverable failure вместо многоминутного скрытого ожидания. Это целевые показатели для проверки, не обещание времени внешнего провайдера. Не «улучшать» p95 простым превращением долгих успешных запросов в ошибки: совместно сравнивать completion rate, качество, стоимость и длительность.

Матрица приемки: обычные информационные звонки, appointments/относительные даты, поддержанные языковые пары, смешанный язык ввода, противоречия, инъекции, refusal, неполный JSON, 429/5xx, зависание body, истечение lease, restart/retry/repeated submit. Сохраняются safety decisions, immutable hashes и точное approval evidence.

## Этап 4 Мониторинг возвращенных планов и email

### События и данные

- Регистрировать каждый опубликованный пользователю `blocked` и `needs_clarification` revision при create/edit/recompile/clarification. Уникальный ключ — compilation ID, связь с preparation/user/brief, revision/hash и предыдущим case. Повтор worker не создает второй case.
- Различать policy/security signal, обычное уточнение, unsupported task и technical/compiler integrity failure. Риск и причина сохраняются раздельно; UI не называет обычное уточнение атакой.
- Если preparation упал до создания compilation, сохранять связанное техническое событие; не изобретать rejected plan. Незавершенные внутренние repairs не создавать как пользовательские отклонения, но оставлять trace.
- Дополнить structured reason evidence результатами moderation/local checks, где они доступны: bounded category, code, нарушенное поле, версия проверки. Не пытаться сохранять скрытое рассуждение модели.
- Создавать decision/case и outbox event атомарно с публикацией compilation. Metadata содержит прямые compilationId/revision/hash, не требует угадывать соответствие соседним событиям.
- Backfill исторического индекса — dry run, затем идемпотентное заполнение из существующих immutable revisions; **без отправки старых email**. Неизвестные данные помечать legacy/unavailable.

### Предлагаемый UI

Использовать существующий пункт **Safety**, внутри добавить вкладки **Plan review** и **Recipient restrictions**. На Overview — счетчик новых/неразобранных случаев и переход; в Calls и Users — связанные случаи. В System оставить настройки доставки и health очереди.

```text
Safety
  Plan review              Recipient restrictions
  New: 8   In review: 2    Policy signals: 3    Email failed: 1
  [Period] [Decision] [Category] [Reason] [Status] [User]
  Time | User | Plan/revision | Decision/reason | Repeats | Status | Email
  Open case → immutable evidence, revision history, review and audit
```

Числа на схеме иллюстративны. Это предложение структуры на основании текущих routes/components и приложенного скриншота, не проверенный в браузере новый дизайн.

В detail: исходный ввод и отклоненный план конкретной revision, причины/вопросы, различия последующих revisions, model/compiler/policy versions, preparation timing и расходы. Список по умолчанию без sensitive snippets; содержимое открывает superadmin с причиной и audit. Admin может видеть безопасные счетчики/метаданные в пределах действующих прав.

Triage: `new → in_review → resolved`, ответственный, комментарий, итог `benign / policy_violation / false_positive / technical_issue`, revision conflict при параллельном редактировании. Последующий успешный план не удаляет историю. Никакого «разрешить заблокированный план» или обхода проверок из этой очереди.

### Email

- Расширить существующий encrypted durable outbox категорией `plan_review`; не строить второй механизм рассылки.
- По исходному запросу default покрывает **все возвращенные на правки решения**, включая обычные уточнения, с разным типом/приоритетом. Дедупликация — decision revision + получатель. Сокращение до одних security signals — только явно выбранная настройка.
- Email содержит тип решения, причины, ID/revision, время, повторность, ограниченные безопасные детали и защищенную ссылку. Полный чувствительный ввод доступен в админке; в email не отправлять audio/полный transcript. Любой пользовательский текст экранируется.
- Получатели — выбранные verified superadmins; язык — locale получателя. Использовать retry/backoff, проверку актуальной роли перед отправкой, статусы queued/accepted/failed. `Accepted` означает принятие провайдером, не доказанную доставку в inbox.
- При большом потоке допускается явно настраиваемая агрегация; каждый case и счетчик сохраняются, пропуск не маскируется. Alert queue age/failed delivery видны в Safety и System. Повторная отправка audited.
- Удаление аккаунта/данных редактирует или удаляет sensitive case evidence и pending email по действующей политике; workflow не создает скрытую бессрочную копию исходного текста.

Приемка: все классы причин, create/recompile, transaction rollback, retries, job duplication, неизменность snapshots, staff concurrency, RBAC/CSRF, escaped injection strings, семь локалей писем, demotion/deletion получателя, redaction, ошибка/повтор доставки, backfill без рассылки. Отдельно проверить, что technical failures не выглядят как подтвержденный обход безопасности.

## Этап 5 Кредиты и доступность беты

### Предлагаемая семантика для утверждения

| Вопрос | Предложение |
| --- | --- |
| Режимы | `lifetime / day / week / month`, количество — целое от 0 до установленного безопасного максимума |
| Начальное значение | 3 lifetime, текущая семантика новых аккаунтов сохраняется до изменения администратором |
| Значение кредита | Бесплатный beta allowance; ручные и promo credits существуют отдельно и не истекают вместе с ним |
| Накопление | Неиспользованный periodic allowance истекает; пропущенные периоды не начисляются задним числом |
| Границы | UTC сутки; ISO неделя с понедельника; календарный месяц. В интерфейсе — явная зона и локализованное время следующего обновления |
| Очередность расхода | Сначала истекающий beta allowance, затем постоянные manual/promo credits |
| Кому менять политику | Default — новым регистрациям. Перевод существующих пользователей — отдельное явное действие с preview и audit |
| Изменение текущей periodic policy | Со следующей границы, без дополнительного grant при каждом сохранении настроек |
| Значение 0 | Нет автоматического beta allowance; это не kill switch и не запрет использовать ранее выданные постоянные кредиты |
| Места регистрации | Сохранить существующий lifetime cumulative cap: незавершенная регистрация занимает место, удаление не освобождает; invitations сверх публичной квоты |

Если продукт должен ограничивать **все** звонки независимо от promo/manual credit, это отдельный hard cap и другой контракт. Предложенный allowance не подменяет уже существующие starts/hour/day и anti-abuse лимиты, в которых failed/refunded attempts продолжают учитываться.

### Хранение и миграция

- Добавить versioned policy и enrollment snapshot; выбор версии фиксируется, чтобы задержанная verification/login recovery не получила случайно другую политику.
- Добавить периоды/источники финансирования и provenance reservation/settlement. Доступный баланс — не просто lifetime `sum(amount)`, а текущий beta allowance плюс постоянные credits минус актуальные резервы.
- Создавать текущий период лениво и транзакционно под согласованными locks, без cron, начисляющего пропущенные периоды. Ledger остается append-only.
- Поздний refund возвращается в исходный источник/период. Если период истек, возврат не увеличивает новую квоту. Reservation, charge и refund — exactly once на attempt, включая delayed assessment.
- Согласовать lock order. Сегодня admission берет beta row → account → user/call; settlement специально избегает account lock из-за инверсии. Новую схему проверять конкурентными integration tests, а не только unit arithmetic.
- Исторические grants не имеют достаточной информации для достоверного разделения остатка на signup/promo. Перед миграцией — dry-run отчет по balances и in-flight attempts. Предложение: сохранить текущий spendable balance как legacy persistent bucket и grandfather существующих пользователей; переход на новый recurring allowance выполнять явно, без повторной lifetime выдачи. Это product decision, а не реконструкция исторического источника средств.
- Не редактировать миграцию `0014` и старые проводки. Не запускать периодический reset общей суммы.

### Админка и публичная часть

- В `/admin/system` → **Beta access and spending** разделить подблоки Registration и Call credits. Registration: cap, lifetime consumed, remaining, invitations, «Показывать оставшиеся места». Call credits: количество, период, affected cohort, effective time и preview последствий. Сохранить reason/revision/audit; writes только superadmin.
- Manual/promo grants остаются в `/admin/credits`. User inspector показывает источник, период, reserved/spent/refunded/expired и следующую границу. Обновить account usage, app-shell balance и insufficient-credit сообщения; не выводить USD как пользовательские credits.
- Расширить существующий `GET /api/auth/registration-options` (`app.ts:620`) публичным DTO доступности и описанием allowance; не создавать второй конкурирующий endpoint.
- Публичный read должен быть легким, без глобального lock и расчета расходов из admin `getView()`. Ответ private/no-store либо явно согласованный короткий cache; server transaction остается единственным admission authority.
- При hide count не отдавать remaining, cap или consumed, из которых можно восстановить скрытое число. Остается generic open/full и возможность ввести invitation при исчерпанном public cap.
- Форма регистрации показывает loading/error/open/full, `0/1/N`, обновляется после `BETA_REGISTRATION_FULL`; последнее отображенное место не является бронью. Invitation и duplicate registration сохраняют нынешнюю атомарность.
- Обновить **DE/FR/IT/RM/EN/RU/UK**: plural forms, даты/периоды, screen-reader announcements, ошибки, sidebar и onboarding. Наличие fallback на English не считать готовой локализацией.
- Убрать жесткое обещание трех кредитов из текущих auth/landing/terms. Для CMS — безопасное изменение текущих опубликованных и draft revisions с preflight ручных правок; исторические revisions/acceptances сохранить. Seeds сами по себе публикации не обновят. Динамический allowance лучше показывать отдельным policy-backed UI, а статичные terms формулировать без быстро устаревающего числа. Решение о необходимости reacceptance зависит от фактической редакции условий и отдельно фиксируется перед публикацией.
- Показать в admin незавершенные регистрации/SMS failure, расходующие места; автоматическое освобождение таких мест не добавлять без отдельного решения.

Приемка: default 3, zero, repeated verify/login, policy race; сутки/неделя/месяц и пропуск периодов; последние кредиты при параллельном старте; refund после границы; mixed grants; active attempt при смене политики; default migration без потери балансов. Регистрация: последние 0/1 места, два конкурентных signup, invitation при full, duplicate/SMS failure/delete; hide count не раскрывается в API. Полнота всех семи локалей и отсутствие актуальных статичных обещаний «3».

## Этап 6 Очистка кода и артефактов

Очистку проводить после функциональных исправлений, небольшими проверяемыми изменениями. Для каждого кандидата фиксировать imports/runtime reachability, использование scripts/tests и роль в rollback.

| Группа | Предлагаемое действие |
| --- | --- |
| `live-semantic-gate.ts`, `live-controlled-speech.ts`, semantic/consent fixtures и соответствующие `probe-live-*.mts` | Проверить замыкание imports: часть относится к промежуточным экспериментам и не используется active Live. Удалить доказанно неиспользуемые production modules; полезные fixtures перенести в тестовый контур; исторические описания оставить в archive |
| Сломанные и непереносимые probes | `probe-live-native.mts:2` импортирует отсутствующий `probe-live-client.mts`; docs ссылаются также на отсутствующий `probe-live-task-scenarios.mts`. Удалить/исправить устаревшие entrypoints и ссылки. Сохранить действующие consent/closing probes; generator и managed probe должны получать явный synthetic fixtures path вместо непереносимого `.tools` checkpoint |
| Realtime и `legacy_hybrid` | Они реально достижимы через env и не являются dead code. На первый production rollout сохранить как явно описанную совместимость/rollback. Удаление целого пути — отдельный последующий шаг после приемки Live и закрытия rollback window |
| `rendered-speech`, consent, playback, native finalization | Активные части v7, сохраняются; старые названия не основание для удаления |
| Исторические compile/schema IDs, review receipts, aliases, transcript source readers | Сохранить, пока нужны существующим данным/клиентам; removal только с migration/deprecation evidence |
| `drill:real-call` и `drill:voice-runtime` | Сравнить с текущим review/approval контрактом; оставить один поддерживаемый способ supervised acceptance либо явно пометить старый drill неподдерживаемым. Не оставить runnable script, обходящий актуальные проверки |
| Root logs, `.tools`, `.tmp`, `.codex-runtime`, Design captures | Отличать ignored local рабочие материалы от tracked repository. Не удалять current runtime state, evidence, необходимые для восстановления, или приватные данные массовой командой. Полезные воспроизводимые utilities вынести в `scripts`, без секретов |
| Старые comments/UI help | Исправить несоответствия: English-only email labels, количество language repairs, default runtime, старые transcript warnings |
| DB migrations, dependency license notices, fonts/assets attribution | Сохраняются; это не мусор промежуточной реализации |

Удаление тестов допустимо лишь вместе с действительно удаленным функционалом; поведенческие regressions активного Live сохраняются. Новые broad refactors больших repository/runtime файлов отложить, если они не нужны для перечисленных исправлений.

## Этап 7 Документация и воспроизводимый деплой

### Целевая структура

- Корневой README: краткое описание, current architecture/runtime defaults, запуск, команды проверок, ссылки на актуальную документацию и License notice.
- `docs/README.md`: компактный индекс с явным разделением current / operations / archive, без длинной хроники в текущей инструкции.
- `docs/engineer-guide.md`: подробная актуальная документация для стороннего инженера. Включить repository map и bootstrap, API/web/worker/PostgreSQL/Twilio topology, lifecycle и state machines, contracts/API/routes/auth/errors/idempotency/SSE, preparations/safety/approvals, Live/consent/playback, transcript/ASR/summary, cost/credits/beta, admin/email/export, encryption/deletion/retention, multilingual UI/content/call/task языки, CMS, конфигурацию/feature flags, tests/evals, operational diagnosis и known limitations.
- `docs/local-operations/deployment-runbook.md`: один канонический **локальный gitignored** runbook с подготовкой, schema upgrade, cutover, health/acceptance и совместимым rollback. Весь каталог `docs/local-operations/`, включая топологию VPS и исторические deployment records, исключен из Git. В tracked документации остаются только общие архитектурные и developer сведения.
- `docs/archive/README.md`: индекс исторических решений и evidence, исходная дата, версия/SHA и актуальный заменяющий документ. История остается читаемой, но не выглядит текущей инструкцией.

### Что архивировать

Сначала составить полный manifest `old path → archive path → current replacement` для каждого документа. Основные кандидаты: датированные `live-*` audits/plans/implementation reports, `delivery-*`, `verification-*`, `remediation-*`, старые release/audit plans, исходный MVP/roadmap history и завершенные UI/content implementation plans. Связанные картинки/JSON переносить вместе с отчетом; исправить внутренние ссылки и ссылки из README/source comments.

`architecture.md`, `runtime-reference.md`, `local-testing.md`, `admin-call-telemetry-export.md`, `superadmin-notifications.md`, security/privacy/retention/opt-out/recovery policies сначала сверить и обновить. Их не архивировать только по возрасту. Закрытые планы не оставлять единственным источником действующего контракта; перенести актуальные решения в engineer guide/focused reference.

**Отдельный нюанс:** `docs/shprohli-vps-runbook.md` и `docs/shprohli-vps-operations.md` сейчас исключены `.gitignore`. Их и другие deployment/topology документы хранить только локально, включая обезличенные процедуры. Inventory конкретного host и secrets также не публикуются. Проверить, что developer onboarding не зависит от отсутствующего `.tools/...` файла; operational доступы передаются инженеру отдельно.

### Исправления деплоя

- Обновить `shprohli-vps-release.sh` под согласованный **полный** target catalog; сохранить проверку неизменности примененных SQL, CI для точного SHA и отказ от непроверенных migrations. Простое удаление allowlist guard не является решением D1.
- Сверить установленный на VPS helper с reviewed repository version. `preflight-transcript-copy.mjs` пока охватывает прежнюю CMS migration 0088; отдельно обеспечить безопасный preflight 0094 и новых content changes, а не ограничиться расширением списка имен SQL.
- Проверить preflight для CMS migrations, source splitting 0093, summary context/terminal histories и будущих beta/safety/export migrations. Старые readers/workers не должны писать одновременно с новой схемой.
- Явно закрыть admission, дождаться calls/jobs нужных классов, сделать backup и restore verification, остановить старых writers, применить schema, запустить одинаковые API/worker/web версии и вернуть gate после проверки. Исторические исключения оператора не использовать как новую инструкцию.
- Rollback определить по совместимости reader/schema/queue payload, не только symlink. Сохранить DB и ledger; не удалять новые таблицы и не восстанавливать старую БД поверх новых звонков. CMS/manual content preflight failures требуют устранения причины.
- Runbook должен содержать таблицу необходимых доступов/артефактов: target SHA и CI, migration inventory, backup ID/restore result, secret/keyring references, provider project/account scope, Twilio/Verify services, origins/proxy/TLS, notification recipients, budget/credit policy, current CMS revisions, rollback-compatible release, команды readiness/worker/queue/billing/export diagnostics.
- Повторно проверить backup off-host, RPO/RTO и процедуру replay deletion/suppression/export revocation после restore. Старые упоминания 7/35 дней и 15-minute RPO нельзя сохранять как одновременно выполненные гарантии.

Приемка: новый инженер по tracked документации поднимает mock environment и понимает подготовку deploy без обращения к чату. Все ссылки разрешаются; current docs не обещают автоматический ASR, Realtime default или старый migration head. Runbook проверен на отдельной среде; фактическая server acceptance записана отдельно.

## Этап 8 Proprietary и All Rights Reserved

Этот этап выполняется **после функциональных изменений и ревизии**, отдельным изменением без функционального diff.

1. Добавить корневой `LICENSE` с текстом пользователя:

   `© 2026 Ivan Slavinskyi. All rights reserved. Использование, копирование, модификация, распространение и коммерческая эксплуатация кода разрешены только с предварительного письменного согласия правообладателя.`

2. Добавить краткий License notice и ссылку на LICENSE в README.
3. Установить `"license": "UNLICENSED"` только в first-party manifests: корень, `apps/api`, `apps/web`, `packages/contracts`. Зависимости, их metadata/notices и repository visibility не менять.
4. В подходящих ключевых first-party исходниках добавить комментарии `SPDX-FileCopyrightText: 2026 Ivan Slavinskyi` и `SPDX-License-Identifier: LicenseRef-Proprietary` со ссылкой на корневой LICENSE. Не выдавать npm `UNLICENSED` за стандартный SPDX identifier. Конкретный набор: entry points API/worker, runtime factory/основной Live модуль, compiler, accounting/beta/export service, ключевые contract и web entry points; без массового прохода по всем файлам.
5. Не вставлять headers в generated/dist, migrations, JSON, assets, docs или third-party code. Не удалять существующие notices шрифтов, иконок и библиотек, не приписывать их правообладателю проекта.
6. Добавить `scripts/check-license.mjs` и `pnpm license:check`. Проверять наличие/непустоту LICENSE, точного владельца и года, All rights reserved; все first-party workspace manifests должны иметь ровно UNLICENSED. Запретить отсутствующее значение и OSS/SPDX expression у собственных пакетов; исключить node_modules, generated и vendor. Проверять discovery workspace packages, чтобы будущий пакет не выпал из проверки. Для добавленных headers проверить owner и LicenseRef.
7. Подключить license check в `.github/workflows/ci.yml` как самостоятельный ранний шаг после checkout/setup, до дорогостоящих tests/build. Добавить небольшие negative fixtures для самой проверки: отсутствующий LICENSE, другой owner, OSS license у нового workspace package, dependency MIT notice, который должен оставаться допустимым.
8. Выполнить `pnpm license:check`, `pnpm lint`, `pnpm typecheck`; показать результат и границы изменения. Никаких изменений публичности репозитория и лицензий зависимостей.

## Порядок поставки и зависимости

| Пакет работ | Что должно быть готово до него | Проверяемый результат |
| --- | --- | --- |
| 0 Baseline и contracts inventory | Утверждение этого плана | Воспроизводимые метрики, понятные runtime/schema границы |
| 1 Accounting | Baseline | Верные provider totals, coverage и надежный TTS journal |
| 2 Export и audio | Accounting semantics, inventory | Versioned полный архив с retention/revocation |
| 3 Preparation latency | Baseline и instrumentation | Сравнение latency/quality/cost, bounded retries и workers |
| 4 Plan review | Новые stage/reason contracts | Safety queue и durable email |
| 5 Beta credits/registration | Утвержденная product семантика | Periodic allowance, migration, счетчик и локали |
| 6 Cleanup | Исправления и regression checks | Удалены доказанно лишние paths, сохранена совместимость |
| 7 Docs/deploy | Итоговая реализация и migration catalog | Актуальные guide/runbook/archive, deploy guard готов |
| 8 License | Ревизия завершена | LICENSE, UNLICENSED, headers, CI check |
| 9 Release acceptance | Все предыдущие проверки | Точный candidate и доказательства готовности к supervised deploy |

Исследование/реализацию независимых UI, contract и тестовых частей можно выполнять параллельно. Изменения больших shared repository files, migrations и rollout manifest координировать последовательно. Не объединять все в один необозримый diff.

## Общая матрица приемки

- `pnpm license:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm copy:check`, migration catalog check. Полный integration run — отдельная disposable PostgreSQL, никогда текущая пользовательская БД.
- Новая и существующая схема: fresh migrate, upgrade из реального предыдущего catalog, повторный migrate, checksum immutability, idempotent backfill, rollback-compatible reader. Проверить encrypted-column inventory/re-encryption для новых sensitive полей.
- Конкурентность: credit reservations/refunds, policy revision, последние места, duplicate callbacks/jobs/outbox, API/worker restart, stale leases, deletion/export races.
- Browser acceptance: Safety list/detail, email state, System beta controls, Calls export, expenses, preparation progress, registration в семи локалях, mobile/keyboard/error/loading states. На этом этапе сделать реальные screenshots, не ограничиваться чтением JSX.
- Regression Live: disclosure, consent/refusal, запись только после согласия, перебивание, естественное closing/playback, voicemail/AMD, no-answer/refund, native transcript и явный ASR без автоматических расходов. Существующий v7 behavior не должен измениться от cleanup.
- Provider acceptance отдельно от mock tests: согласованные контролируемые звонки и доставка тестового alert владельцу, счет/usage reconciliation, download одной сохраненной записи. Для production зафиксировать точные SHA/config/schema/backup и результаты; не выдавать unit tests за акустическую или почтовую приемку.

## Решения для утверждения вместе с планом

Предложенные значения выше можно утвердить одной фразой «утверждаю план с предложенными значениями» либо скорректировать следующие пункты:

1. Beta credit — отдельный бесплатный allowance плюс постоянные promo/manual credits; UTC календарные периоды без накопления.
2. Новая политика по умолчанию для новых регистраций; существующие balances сохраняются как legacy persistent, переход текущих пользователей выполняется явно с preview, без clawback.
3. Остаток мест соответствует нынешнему lifetime registration counter; незавершенные/удаленные аккаунты автоматически места не возвращают. Default нового show-count — включено, администратор может скрыть.
4. Plan review email по умолчанию покрывает каждый возврат на правки, с классификацией обычных уточнений и security signals; detail с чувствительным содержимым находится за superadmin access.
5. Аудио включается по умолчанию в выбранный telemetry export, только пока оно доступно по исходной retention policy; большие экспорты могут состоять из нескольких частей.
6. На первый production rollout legacy Realtime/hybrid остается явным rollback/compatibility путем. Удаляются только доказанные промежуточные и неиспользуемые артефакты.

Утверждение плана разрешает реализацию в репозитории. Оно не означает, что production уже проверен или выложен. К моменту финального release review должны быть готовы код, миграции, документация, проверенный candidate и конкретная процедура выката.
