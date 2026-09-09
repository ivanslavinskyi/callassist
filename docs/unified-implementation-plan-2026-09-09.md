# Единый план реализации: языки, понятный результат и точный лендинг

Дата: 9 сентября 2026. База реализации: `7b86d3a`; текущая локальная схема — `0067_extensible_content_locales.sql`.

Статус: **основной продуктовый код W00–W08 реализован в рабочем дереве, W09/W10 выполнены в локальной части; публикация и отдельные проверки выпуска остаются открытыми**. Фактические тесты, миграции и ограничения записаны в [verification](verification-language-implementation-2026-09-09.md). Галочки ниже относятся к реализации, а не к развёртыванию или доказанному качеству всех языковых пар.

Это основной рабочий план, объединяющий [расхождения обещаний и реализации](promise-implementation-gap-plan-2026-09-08.md) и [языковую архитектуру](language-workflow-architecture-2026-09-09.md). Эти два документа сохраняются как основания решений. [Аудит](landing-audit-2026-09-08.md) — историческое наблюдение; [release roadmap](mvp-plan.md) — источник условий публичного выпуска.

После пользовательского теста workflow упрощён до одного языка задачи с исправлением до утверждения: [решение и проверка](ui-language-simplification-2026-09-09.md). Независимые selector сводки и перевода убраны, новая auto-задача отдаёт приоритет определённому языку ввода. Отдельно [восстановлен локальный флаг автоматического завершения звонка](hangup-runtime-restoration-2026-09-09.md).

## 1. Результат и границы реализации

После выполнения пользователь задаёт запрос на удобном языке, проверяет понятный план, запускает звонок на независимо выбранном языке и получает понятный итог. Полную расшифровку можно перевести по кнопке. Лендинг показывает этот опыт и описывает фактические возможности.

Включено:

- автоматическое предложение языка помощи и ручной выбор;
- перевод плана и пояснений/уточнений при необходимости, оригинал рядом;
- серверная фиксация конкретной проверенной версии плана;
- автоматическая сводка по исходной расшифровке и её доказательным фрагментам;
- перевод полного transcript по запросу с сохранением оригинала;
- хранение, фоновые задачи, стоимость, экспорт и удаление новых данных;
- независимая архитектура UI, CMS, языка задачи, голоса и производных текстов;
- локализованные названия языков звонка; единственный новый английский вариант — **британский `en-GB`**;
- учебное демо до регистрации, исправление обещаний, уведомлений и условий кредитов;
- сквозные проверки и подготовка пакета к выпуску по действующей roadmap.

Зафиксированные ограничения: UI первоначально остаётся EN/DE; готовим подключение 7–15 языков без изменения call domain. Переводы этих 7–15 словарей — отдельные последующие поставки. Дополнительные разрешения во время звонка, подтверждение записи на приём, перевод живого аудиопотока, новая кредитная политика и переписывание телефонии в объём не входят. Админка сохраняет существующее английское представление.

План можно исполнять с сегодняшнего дня без нового проектирования основного workflow. Полная реализация и проверка всего объёма за один календарный день не подтверждена оценкой. Ниже выделены законченные пакеты и контрольные точки: завершение пакета не выдаётся за завершение всего продукта.

## 2. Решения, которые исполнитель принимает как исходные

| Вопрос | Решение v1 |
| --- | --- |
| Языки UI | Реестр готов к расширению; включены EN/DE |
| Текстовые возможности | Отдельный реестр операций/направлений; начальный технический набор `en`, `de`, `fr`, `it`, `ru`, `uk`. Включение для пользователей зависит от проверки соответствующих направлений |
| Голос | Существующие возможности; для нового выбора исключён `en-US`, остаётся `en-GB`. Немецкие региональные варианты сохраняются |
| Названия голоса | Переводятся UI-словарём по стабильному `callLocale`; английский виден как English / Englisch |
| Язык помощи | Для новой задачи: task override → поддержанное определение compiler → резервный язык аккаунта → поддержанный UI fallback → en; прежний контекст задачи сохраняется |
| Значение аккаунта по умолчанию | Отдельный резервный язык не задан; дополнительная настройка применяется лишь при отсутствии поддержанного определения |
| Перевод плана | Автоматически, если выбран иной язык чтения; отдельная проекция одного исходного плана |
| Уточнения | Следуют выбранному языку помощи; готовые вопросы compiler на нужном языке можно переиспользовать |
| Перевод transcript | По кнопке; целевой язык по умолчанию сохранён для конкретной задачи/попытки |
| Сводка | Автоматически из оригинала на сохранённом языке задачи, без отдельного selector |
| Исторические данные | Старые hashes, approvals и `en-US` остаются читаемыми; массовая генерация переводов истории не запускается |
| Новый UI-язык | Словарь, включение в UI-реестр, маршруты/контент по готовности и проверка отображения; никаких новых колонок `*_ru` или миграций call domain |
| Провайдер | Переиспользовать существующий подход compiler к структурированным текстовым ответам и учёту запросов; отдельный адаптер текстовых преобразований с конфигурируемой моделью |
| Публикация текста | Seed для новой базы плюс новые CMS drafts/revisions для существующей; прежние опубликованные версии не меняются |

Для технического набора текстов не обещается уже доказанное качество всех языковых пар. Реестр должен позволять включить проверенную операцию/направление отдельно, без изменения схемы хранения.

## 3. Пользовательский workflow

1. В общей оболочке пользователь выбирает язык интерфейса. В форме отдельно выбирает язык звонка; названия вариантов локализованы.
2. Вводит objective, контекст и разрешённые сведения. Пока он печатает, отдельные LLM-запросы определения языка не выполняются.
3. Существующий compiler возвращает `sourceLanguage` и исходный план. Resolver предлагает «Язык плана и результата: русский · Изменить». Определение привязано к актуальной версии ввода.
4. При неоднозначности показывается изменяемое предложение. Имена, адреса и вставленные документы не должны автоматически переопределять язык собственной формулировки задачи.
5. Пользователь отвечает на понятные уточнения. Их ID и коды политики сохраняются; перевод не снимает блокировки и не добавляет разрешений.
6. Готовый review открывается на выбранном языке. Доступен «На языке звонка — немецкий». Язык меню и язык самого текста независимы.
7. По явному утверждению сервер фиксирует исходный snapshot и реально выбранный оригинал/перевод. Во время звонка исполняется исходный утверждённый план.
8. После ASR автоматически появляется сводка на языке задачи. Рядом с оригинальной расшифровкой — «Перевести на русский» без меню; после генерации доступны вкладки «Оригинал / Русский» без дублирующей кнопки. Язык задачи исправляется только до утверждения в review.
9. Смена интерфейса или языка просмотра не изменяет утверждённый план, не требует повторного утверждения и не запускает звонок. Правка самой задачи/языка звонка проходит обычную перекомпиляцию и новое утверждение.
10. Экспортируется выбранный вариант текста с обозначением перевода и источника. Удаление звонка/аккаунта охватывает все новые содержательные данные.

## 4. Контракты, данные и API

### 4.1. Независимые значения

В новом модуле `packages/contracts/src/languages.ts` определить нормализованный `LanguageTag`, типы UI-возможностей, текстовых операций и источника выбора. Общий формат тега не означает, что соответствующая функция включена.

- `uiLocale` — текущая оболочка; `preferredContentLanguage: LanguageTag | null` — отдельная настройка аккаунта, null означает auto.
- `detectedInputLanguage` и состояние определения — наблюдение о конкретном input fingerprint/compilation. На первом этапе использовать существующий `sourceLanguage`, включая отсутствие определения; не добавлять новые обязательные поля в исторический compiled payload ради confidence модели.
- `taskContentLanguage`, `selectionSource`, `selectionRevision` — сохранённый выбор задачи.
- `callLocale` и `fallbackLocale` — существующие исполнительные значения.
- `targetLanguage` — язык конкретного артефакта; `viewLanguage` — выбор отображения, который не управляет разрешениями.

Автоматический выбор фиксируется атомарно при первой публикации compilation/clarification вместе с языковым контекстом; ручной выбор фиксируется своей mutation. Это определённые серверные события, они не зависят от предположения, успел ли браузер показать экран. Дальнейшая правка objective может предложить новый язык, но не меняет уже выбранный автоматически. Повторный ответ compiler для старой версии игнорируется.

### 4.2. Совместимые запросы

Для подготовки/перекомпиляции ввести внешний request v2: `{ requestVersion: 2, brief: <существующий CreateCallBriefInput>, languagePreferences: { mode, targetLanguage?, uiLocaleHint? } }`. Старый плоский запрос поддерживается адаптером на период совместимости. Перед compiler и старым hash v1 передаётся только `brief`.

Идемпотентность нового запроса учитывает brief и нормализованные языковые настройки; старый fingerprint сохраняет свой алгоритм/версию. Повтор старого idempotency key с другим языковым intent не должен молча вернуть прежний выбор. UI hint влияет лишь на первоначальный fallback и фиксируется в принятом запросе.

Нельзя добавлять default-поля в `createCallBriefInputSchema`, `compiledCallBriefSchema` или `ApprovedExecutionSnapshot` v1: текущий hash зависит от повторного разбора и порядка сериализации этих схем. Исторические fixtures должны давать прежние hashes.

Текущий публичный `CallCompilation` не содержит ID записи. Добавить вне хешируемой compilation отдельные `planSource` metadata в snapshot/DTO: `compilationId`, `revision`, `snapshotHash`, `reviewPolicyVersion`. Именно их используют новые review-запросы; сервер повторно сверяет их с current compilation.

### 4.3. Предлагаемое хранение

Ниже перечислены реализованные сущности; исходные JSON payload и hash v1 не расширялись default-полями.

| Сущность | Содержимое и ограничения |
| --- | --- |
| `users.preferred_content_language` | Nullable тег; текущий `ui_locale` остаётся отдельным предпочтением |
| `call_preparation_language_contexts` | `preparation_id`, request version/fingerprint, исходные настройки, resolved/detected language и источник; при публикации проверяется актуальность preparation/target revision |
| `call_language_contexts` | Одна текущая запись задачи: выбранный язык, source, selection revision, последнее определение и его compilation/input fingerprint; owner определяется через call |
| `call_compilation_review_policies` | Политика v1/v2, привязанная к конкретной compilation вне её immutable/hash payload. Legacy-исключение допускается только для точной исторической утверждённой версии |
| `final_transcript_revisions` | Неизменяемая завершённая версия оригинала: transcript/attempt ID, revision, source hash, зашифрованные текст и сегменты, модель/дата; у текущего transcript — указатель на актуальную revision |
| `call_text_artifacts` | Вид, call/attempt, compilation либо transcript revision, source hash, target language, schema/generator versions, состояние, payload/hash, bounded error code. CHECK проверяет тип источника для каждого вида |
| `call_text_artifact_chunks` | Возобновляемые части длинного transcript: artifact ID, диапазон segment IDs, исходный hash, зашифрованный результат и состояние. Уникальность по artifact и порядку части |
| `call_plan_review_receipts` | Неизменяемая запись явного утверждения: execution approval, compilation identity/hash, original либо artifact ID/hash, review language, выбранная revision, actor/time. У attempt сохраняется receipt ID и язык результата по умолчанию |

Виды артефактов v1: `plan_review`, `clarification_review`, `transcript_translation`, `call_summary`. Типизированные payload-схемы различаются, общие metadata и очередь переиспользуются.

Состояния артефакта: queued / processing / ready / failed / stale / cancelled; terminal failure допускает явный ограниченный retry. Готовое содержимое, особенно использованное в receipt, не перезаписывается. Новый вариант генерации получает новую версию/ID. Изменение ciphertext при ротации и обнуление при удалении — отдельные разрешённые операции.

Ключ дедупликации: owner-scoped source identity + kind + source hash + target language + schema/generator version; для summary также hash утверждённых вопросов/snapshot. Уникальность обеспечивает БД; нажатия в двух вкладках не создают две задачи. Успешный GET не расходует бюджет нового перевода.

В пределах transcript revision назначить стабильные segment IDs. Модель возвращает перевод текста по этим ID; роли, время и порядок переносит сервер. Для plain-text fallback сервер создаёт абзацные source ranges без выдуманных говорящих/времени.

### 4.4. API

| Маршрут | Действие |
| --- | --- |
| `GET /api/language-capabilities` | Независимые включённые текстовые операции/направления и варианты нового голосового выбора; UI использует собственный реестр словарей |
| `PATCH /api/account/language-preferences` | Сохранить `uiLocale` и/или независимое content preference; owner mutation, без изменения существующих задач |
| `POST /api/call-preparations` / `PUT /api/call-briefs/:id` | Поддержать envelope v2 и сохранить языковой intent вместе с подготовкой |
| `PATCH /api/call-briefs/:id/content-language` | Выбор языка задачи до утверждения с `expectedSelectionRevision`; после утверждения для чтения используется targetLanguage артефакта, без изменения receipt |
| `POST /api/call-briefs/:id/plan-review` | Получить готовую проекцию либо 202 по compilation ID/revision/hash и targetLanguage; применяется также к уточнениям |
| `GET /api/call-briefs/:id/text-artifacts` | Список доступных версий/состояний с источником и языком; без раскрытия чужих данных |
| `GET /api/call-briefs/:id/text-artifacts/:artifactId` | Прочитать выбранный артефакт; проверить принадлежность call и artifact |
| `POST /api/call-briefs/:id/final-transcript/translations` | По `sourceRevisionId + targetLanguage` вернуть готовый перевод либо поставить задачу |
| `POST /api/call-briefs/:id/summaries` | Другой язык сводки по запросу; основной итог ставится сервером после ASR |
| `POST /api/call-briefs/:id/text-artifacts/:artifactId/retry` | Повтор допустимой failed-задачи с лимитами; не повтор готового перевода |
| Существующие `/approve`, `/approve-and-start`, `/start` | Review evidence проверяется при утверждении и на любом пути запуска |

Чтение чувствительных данных — `private, no-store`. Mutation — существующие owner/session/origin protections, rate limits и серверная проверка текущего источника. Ответы: 200 ready, 202 processing, 409 stale source/selection/review conflict, 422 unsupported target, 429 budget/rate limit. Недоступный чужой/удалённый источник не раскрывает существование данных.

Approval command v2 включает прежние revision/hash и `review: { mode: original | translated, language, artifactId?, artifactHash?, selectionRevision }`. Для original artifact не нужен; это явный выбор человека, а не автоматический fallback при ошибке перевода.

### 4.5. Серверное утверждение и совместимость

1. В транзакции repository заблокировать текущую compilation; проверить revision/hash, готовность, выбранную проекцию и её источник. Все поля проверяются сервером, а не доверяются клиенту.
2. Создать или переиспользовать существующую execution approval. В БД уже есть UNIQUE на compilation и immutable trigger; вставлять вторую execution approval нельзя.
3. Записать immutable review receipt и сделать её текущей для этого утверждённого источника. Повтор идентичной команды идемпотентен; конфликтующая повторная команда не переписывает прежний receipt.
4. `startAttempt` в одной транзакции проверяет источник и подходящий receipt, затем привязывает его к попытке. Проверка обязательна для прямого `/start` и ветки уже approved в `/approve-and-start`.
5. `viewLanguage`, смена UI и чтение других переводов после approve не инвалидируют receipt. Если изменена сама задача/язык звонка, действует обычная новая compilation и новое явное утверждение.
6. Хранить серверную `review_policy_version` по compilation в отдельной таблице, а не только по call. После включения все новые compilation/recompilation, включая перекомпиляцию старой задачи, используют v2. Старые ещё не утверждённые версии также требуют review v2. Старый формат клиента не обходит проверку отсутствием поля review.
7. На cutover записать исключение v1 только для точных уже утверждённых исторических compilation, не создавая вымышленных translated receipts. Эти версии читаются и работают по сохранённой legacy-политике; новая версия/скопированная задача следует v2. Отсутствующая policy-запись после cutover не считается разрешением на v1. Выключение feature flag не понижает v2 до v1.

## 5. Последовательность реализации и проверяемые пакеты

### W00 — зафиксировать базу и контракты

- [x] Проверить HEAD, рабочие изменения и последовательность миграций. Не включать чужое изменение `apps/web/tsconfig.json` в этот пакет автоматически.
- [x] Создать новые контрактные модули `languages.ts` и `call-text-artifact.ts`, export в `packages/contracts/src/index.ts`; определить envelope/receipt DTO и error codes.
- [x] Зафиксировать неизменность hash v1 на существующих исторических fixtures и `en-US` snapshot.
- [x] Подготовить mock-адаптер структурированного переводчика/summary для воспроизводимых интеграционных сценариев.

Готово: API, UI и worker могут разрабатываться по одним DTO; старые планы читаются без изменения hashes.

### W01 — реестры и выбор языка звонка

- [x] Развести accepted/historical call locales и selectable-new-call locales. Сохранить полный legacy enum; отдельная политика нового ввода допускает только `en-GB` среди английских.
- [x] Добавить EN/DE названия всех основных и fallback вариантов в общий UI-словарь. Исторический `en-US` имеет отличимую подпись.
- [x] Обновить оба селектора формы, отображение в review/live/history и список языков лендинга. Новая задача из истории со сменой `en-US` проходит обычную компиляцию; прежний snapshot не редактируется.
- [x] При смене UI обновляются подписи, но сохраняется выбранный код. Admin/history filters могут сохранять оба английских значения для поиска старых звонков.

Файлы: `packages/contracts/src/call-brief.ts`; `apps/web/lib/i18n/messages.ts` и общий lookup; `components/create-call-form.tsx`, `live-call.tsx`, `public-home.tsx`; API-проверка новых preparation/recompilation.

Готово: немецкие подписи во всех селекторах, один новый английский вариант, legacy чтение/повтор не сломаны. Это первый небольшой законченный результат.

### W02 — независимые настройки и язык задачи

- [x] Добавить account preference, request envelope и хранение языкового контекста preparation/call. Идемпотентность v2 проверяет весь intent.
- [x] Реализовать resolver, нормализацию `sourceLanguage`, fallback при неподдержанном/неопределённом языке, version checks для поздних ответов.
- [x] При первой публикации compilation/clarification атомарно зафиксировать auto-selection; ручной выбор применяется отдельной mutation. Старое завершение preparation не отменяет новый выбор.
- [x] После компиляции показать одну строку «Язык плана и результата · Изменить» с раскрываемым исправлением до утверждения. В основной форме и в истории selector отсутствует. Настройку аккаунта использовать как дополнительный резервный язык.
- [x] Для авторизованного UI-переключения сохранять `uiLocale`, затем cookie/route; ошибка сохранения видима. Гостю достаточно cookie. Открытие чужой локализованной ссылки не переписывает account preference.
- [x] Явный выбор гостя отмечать отдельно от автоматического выбора по URL/браузеру. При входе сохранить этот явный выбор в аккаунт; если его не было, для дальнейшей app-навигации использовать сохранённое предпочтение аккаунта. Явный локализованный URL определяет язык текущей страницы, но не изменяет предпочтение сам по себе. Регистрация сохраняет явно выбранный текущий UI-язык.
- [x] Сохранить несохранённый draft при переходе между `[locale]`: поднять user/draft-scoped client store выше locale boundary. Включить поля формы, ещё не разобранный `factsText`, язык задачи/звонка и preparation identity. Очищать при logout/смене пользователя/завершении или отмене черновика; чувствительный draft не складывать в localStorage. Серверные уже созданные задачи восстанавливаются по ID.
- [x] У email собственный набор готовых шаблонов EN/DE и явный fallback: будущий UI-язык не отправляет провайдеру неподдержанную локаль.

Файлы: `apps/api/src/app.ts`, `call-service.ts`, `storage/call-repository.ts` и оба repository; `auth/auth-service.ts`, оба auth repository; `apps/web/lib/api.ts`, `components/app-shell.tsx`, `account-console.tsx`, `create-call-form.tsx`.

Готово: EN UI + RU ввод + DE-CH звонок дают RU task language; UI switch/перезагрузка/старый compiler response не меняют это значение; manual override имеет приоритет.

### W03 — миграции, артефакты и фоновые задачи

- [x] Создать таблицы из §4.3 и операции обоих repository implementations. Методы публикации возвращают результат только при совпадении source/lease/generation и доступном call.
- [x] Добавить durable job type `text_artifact_generation`, target `text_artifact_id`, корректные CHECK/unique для целей, mapping/select, admin DTO и worker handler. Dispatcher выбирает типизированный processor по artifact.kind.
- [x] Добавить provider operation types `text_translation` и `call_summary`, привязку к artifact/job/source, reservation и учёт каждой платной попытки, включая invalid response/timeout. Подключить pricing/reporting и операции worker, а не только UI-лог.
- [x] Ограничить размер входа, токены/число запросов, число целевых языков на источник и пользовательскую частоту. Повтор уже готового результата не резервирует новый provider request. Для чанков бюджет определяется до запуска и ограничивается общим cap.
- [x] Использовать ограниченные retries и lease renewal. Длинные transcript разбивать по source segment boundaries, сохранять завершённые chunks, не обрезать текст молча. Повтор продолжает работу с незавершённой части.
- [x] Не допустить, чтобы длительная текстовая задача блокировала обработку критичных existing jobs: проверить текущий drain и выделить ограниченную обработку текстовых jobs при сохранении worker topology.
- [x] Добавить status updates с refetch после reconnect. Можно использовать текущую модель событий; клиент всегда проверяет актуальность через API.

Новые файлы: `apps/api/src/text-processing/{text-processor,openai-text-processor,mock-text-processor,text-artifact-service}.ts` и схемы/validators. Существующие: `jobs/durable-job.ts`, `jobs/durable-job-worker.ts`, `call-service.ts`, `worker.ts`, `storage/*`, `config/endpoint-rate-limit-policy.ts`, provider pricing/reporting и runtime env.

Готово: один запрос из двух вкладок создаёт одну логическую задачу; после crash работа возобновляется; старый worker не публикует текущий результат. Точное однократное списание провайдером при неопределённом сетевом исходе не обещается — каждая попытка учитывается.

### W04 — понятный review и серверная привязка утверждения

- [x] Создать field-preserving translation исходного плана: цель, вопросы, факты, критерии, условия/запреты. Сохранять ключи, порядок, числа, имена и отрицания. Не исполнять инструкции, встретившиеся в переводимом тексте.
- [x] Для clarification/blocked compilation создать projection вопросов и пояснений; существующий compiler уже выдаёт blocking questions на языке objective. Ручной язык помощи применяется к ним при необходимости.
- [x] Автоматически поставить review-задачу при готовой compilation и отличии языка; explicit original path сохраняется. Показать loading/failed/retry без скрытого перехода к звонку.
- [x] Добавить original/translated tabs и selection review DTO; реализовать receipt и проверки всех start paths из §4.5 в обоих repository.
- [x] Повторный approve-and-start для уже утверждённого плана проверяет receipt; изменение источника в другой вкладке возвращает stale, без звонка.

Файлы: `components/compilation-review.tsx`, `lib/api.ts`, `apps/api/src/app.ts`, `call-service.ts`, `storage/*`; новый text-processing слой. `brief-compiler/compilation-integrity.ts` и execution snapshot v1 сохраняют прежнюю семантику.

Готово: сквозной сценарий подготовка → понятное уточнение → перевод плана → approve → mock call. Прямой API start не обходит review v2. Просмотр другого языка после approve не меняет историческую запись.

### W05 — версия оригинала, сводка и перевод расшифровки

- [x] В завершении ASR атомарно создать immutable transcript revision и указатель current. Хешировать нормализованный текст, сегменты/роли/время; ID сегментов относятся к конкретной revision.
- [x] В той же транзакции создать основной summary artifact и durable job. Падение между завершением ASR и уведомлением UI не теряет задачу.
- [x] Summary получает оригинал и вопросы утверждённого snapshot конкретной попытки. Ответ: по каждому вопросу сведения/неизвестность, названные следующие шаги, условность и ссылки на original segments. Проверять существование refs, числа и структуру; человеческие примеры проверяют смысл/отрицания.
- [x] Summary не изменяет call status, credits, semantic outcome или пользовательский feedback. Неполный источник/противоречие отражаются как неизвестность, а не автоматически «успех».
- [x] Добавить кнопку перевода transcript только на сохранённый язык задачи. После готовности оставить переключатель оригинал/перевод. Переводить всегда оригинал; mixed-language source не отождествлять с callLocale.
- [x] При новой ASR прежние артефакты обозначать предыдущими/устаревшими; позднее завершение старой job не становится current. Сохранённые ссылки ведут к своей исходной revision.
- [x] Для исторических звонков создавать source revision/перевод/сводку только при запросе, с лимитами. Не пересчитывать всю историю миграцией.

Файлы: post-call completion в `call-service.ts`, оба `storage/*call-repository.ts`, `packages/contracts/src/call-brief.ts` для совместимой проекции final transcript, новый text-processing слой, `components/live-call.tsx` и новые read-only компоненты результата.

Готово: оригинал доступен независимо от сбоя перевода/итога; готовый перевод переиспользуется; новая версия оригинала не смешивается со старым итогом.

### W06 — жизненный цикл данных и экспорт

- [x] Включить новые ciphertext columns в `db/encrypted-columns.ts`, rotation и recovery inventory. Immutable payload разрешает штатную ротацию/удаление, но не произвольную правку истории.
- [x] При удалении звонка/аккаунта отменить jobs, очистить содержимое source revisions/artifacts/chunks/receipts и новые языковые данные согласно существующей политике. Метаданные аудита удерживаются только по действующим основаниям.
- [x] Публикация provider response после удаления отвергается транзакционно. Проверка только перед запросом недостаточна.
- [x] Обновить owner account export и его schema version: языковой контекст, оригинальные версии, переводы/сводки и evidence собственного review. Не добавлять чувствительное содержимое в обычные admin lists/logs.
- [x] Copy/PDF экспортируют выбранный оригинал или перевод; подписи берутся из UI-словаря, metadata языка — из содержимого. Проверить русские/украинские символы; поддержку направления текста/шрифта не выводить из одной лишь доступности перевода.
- [x] Сохранить audioRetentionDays=0: аудио удаляется после финальной ASR; текстовые задачи не продлевают хранение записи.

Файлы: `account-data-export-service.ts`, соответствующий контракт account export, `db/{encrypted-columns,recovery-drill,reencrypt-data}.ts`, deletion methods обоих repository; `apps/web/lib/{final-transcript-export,download-transcript-pdf}.ts`.

W06 реализуется вместе с W03–W05; это условие готовности функций, а не необязательная последующая уборка.

### W07 — подготовить UI/CMS к 7–15 языкам

- [x] Общий UI registry задаёт словарь, форматирование и направление. Убрать повторяющиеся бинарные EN/DE проверки в routing, selector, account/render/export. Существующий `[locale]` route сохраняется.
- [x] Однократно расширить DB locale columns (включая нынешние varchar(8)) и убрать CHECK со списком EN/DE; валидный тег и включённые возможности проверяются раздельно. Следующий UI-язык не требует смены схемы call domain.
- [x] В CMS заменить жёсткие локализованные `{en,de}` и `.max(2)` на language-keyed records с отдельным набором обязательных локализаций. Старые JSON/revisions остаются валидными для compatible reader, не переписываются.
- [x] Publication readiness проверяет required locales конкретной страницы/editorial release, а не все UI-языки. Отсутствующий optional перевод не блокирует выпуск EN/DE.
- [x] Явно разрешать fallback опубликованного контента. Для onboarding v1 выбрать общую реально опубликованную локаль Terms/AUP, показать оба документа на ней и записать её в существующее acceptedLocale. Произвольный разный язык двух документов потребовал бы отдельного расширения acceptance и не включён.
- [x] Canonical/hreflang/sitemap показывают только реально опубликованные локализации. UI может иметь иной язык, чем CMS-контент; у самого текста правильные language/direction атрибуты.
- [x] Тестовая третья UI-локаль проходит routing/render без добавления voice/text capabilities и без новой DB-миграции. Тестовая локаль не публикуется как готовый перевод продукта.

Файлы: `packages/contracts/src/{languages,account,content}.ts`; `apps/web/lib/i18n/*`, `middleware.ts`, layouts/metadata, `components/{ui-locale-provider,app-shell,onboarding-form}.tsx`; auth/content repositories и `content-service.ts`.

Готово: очередной UI-словарь подключается данными реестра; английские email/CMS fallback не выдаются за переведённые; прежние acceptances сохраняют значения и версии.

### W08 — учебное демо и тексты лендинга

- [x] Выделить из review чистый read-only `CallPlanPresentation`, пригодный для приложения и демонстрации; создать typed fixture `apps/web/lib/landing-demo.ts` без поддельных реальных IDs и обработчиков звонка.
- [x] В hero заменить повтор `how_it_works` конкретными вопросами/разрешёнными сведениями. Добавить вторичное действие «Посмотреть пример» к подробному блоку.
- [x] Показать одну цепочку: запрос → план → фрагмент разговора → результат. Обозначить пример учебным. До готовности W05 показывать «Что можно узнать»; после него использовать общий компонент сводки с учебными source refs.
- [x] Уточнить P05–P07: сведения утверждаются до звонка; неизвестное можно уточнить; абсолютного «не угадывает» нет; сценарий записи описывает выяснение вариантов/документов. Не показывать mock live approvals как функцию настоящего звонка.
- [x] Уточнить P09: три промокредита, резерв при старте и расход при подтверждённом соединении. При отсутствии соединения действует существующее освобождение/возврат; отказ после соединения не обещать бесплатным. При нуле показать имеющийся ввод промокода без обещания пополнения.
- [x] Описать языки по всей цепочке и фактическую стадию доступа. Новые функции рекламируются после их включения, а не только после появления ветки кода.

Файлы: `components/{public-home,compilation-review,landing-draft-preview}.tsx`, новые presentation/demo components, `lib/i18n/{design-messages,credit-messages,messages}.ts`, `apps/api/src/content/seed-content.ts`.

Готово: гость понимает продукт до регистрации; демо не вызывает provider/start API; EN/DE и мобильный layout проверены; ограничения не подменяют демонстрацию пользы.

Опорные формулировки для первого EN/DE draft:

| Место | EN | DE |
| --- | --- | --- |
| Контроль | Before the call, you review the plan and the information the assistant may share. During the conversation, SHPROHLI uses that information as needed. You can follow the transcript and stop the call. | Vor dem Anruf prüfen Sie den Plan und die Angaben, die der Assistent weitergeben darf. Während des Gesprächs nutzt SHPROHLI diese Angaben nach Bedarf. Sie können das Transkript verfolgen und den Anruf beenden. |
| Пример обращения в приёмную | Ask about available appointment times or which documents to bring. | Nach verfügbaren Terminen fragen oder klären, welche Unterlagen Sie mitbringen müssen. |
| Неизвестные сведения | The assistant is instructed to use the information approved before the call and to ask for clarification or explain when information is missing. AI conversations can contain errors. | Der Assistent ist angewiesen, die vor dem Anruf freigegebenen Angaben zu verwenden und bei fehlenden Informationen nachzufragen oder darauf hinzuweisen. KI-Gespräche können Fehler enthalten. |
| Короткая подпись пробы | 3 promotional call credits | 3 Anrufguthaben |
| Условия расхода | A credit is reserved when a call starts and used once the connection is confirmed, even if the recipient declines or the task remains unresolved. Unconnected attempts are refunded. No payments during the beta. | Beim Start wird ein Anrufguthaben reserviert und nach bestätigter Verbindung verbraucht, auch wenn die angerufene Person ablehnt oder das Anliegen offen bleibt. Ohne Verbindung wird das Guthaben zurückgebucht. Während der Beta gibt es keine Zahlungen. |

Дополнительно просмотреть сценарии landlord/repair: обещание «договориться о следующем шаге» заменить на «уточнить следующий шаг», если оно подразумевает обязательство. Новые подписи про перевод плана и итог использовать только после готовности соответствующих функций.

### W09 — согласовать уведомления и подготовить CMS-публикацию

Локальный результат: seed и release candidate согласованы; manifest учитывает исходные revision IDs и необходимость reacceptance. После указания аккаунта пользователем CLI создал пять новых двуязычных drafts через ContentService: Privacy, Terms, FAQ page, Imprint и FAQ collection. Проверка подтвердила неизменность опубликованных версий, acceptances и имеющихся AUP/Landing drafts. По решению пользователя manifest и машинные результаты с идентификаторами удалены из репозитория; [процесс локальной генерации и staging](public-content-staging-2026-09-09.md) сохраняет их только в `.tools/public-content/`. Согласование этих двух drafts и финальная preview/publication остаются открытыми.

- [x] В публичных текстах и onboarding описать реальную последовательность: AI представляется; ответ о согласии распознаётся AI; основная беседа и запись начинаются после согласия. Не обещать отсутствие любой обработки до согласия. Голосовое вступление остаётся кратким по решению пользователя от 09.09.2026.
- [x] Согласовать Landing, обе FAQ-поверхности, Privacy, Terms/AUP, onboarding и голосовые тексты. В Privacy отразить новые текстовые операции и фактических провайдеров, включая существующий email-провайдер.
- [x] По подтверждённому решению пользователя от 09.09.2026 вернуть голосовое вступление дословно к прежнему тексту: представление как AI, от имени кого звонок и вопрос о согласии на запись/автоматическую расшифровку. Убрать два добавленных предложения об AI-обработке ответа и сроке хранения во всех действующих call locales, включая legacy en-US. Сохранить действующий способ согласия, negative precedence, recording/opening playback gates.
- [x] Вернуть проверки краткого вступления без retention; сохранить ограничения на persona/assistance reason/DTMF. Подробности обработки и фактического хранения оставить в публичных уведомлениях, включая временную запись при 0 днях.
- [x] Подготовить EN/DE payload/manifest с исходными revision IDs, новыми значениями, reason и перечнем затронутых surfaces. Для существующей БД создать новые drafts через имеющийся ContentService/admin API; не перезаписывать чужой draft. Созданы пять; существующие AUP/Landing сохранены.
- [x] Учесть, что FAQ существует и как page, и как editorial collection. Seed заполняет обе только для новой базы; существующая база требует двух согласованных изменений.
- [ ] Просмотреть drafts, зафиксировать необходимость повторного принятия Terms/AUP как отдельное решение по реальному изменению. Прежние acceptances не изменять. Финальная публикация и её запись следуют существующему workflow.

Файлы: `content/{seed-content,content-service,postgres-content-repository,in-memory-content-repository}.ts`, `telephony/twilio-copy.ts`, `realtime/openai-realtime-bridge.ts`, `apps/web/lib/i18n/onboarding-messages.ts`, документы о согласии/удалении/провайдерах.

Готово локально: согласованный manifest/drafts и пройденная регрессия согласия. Публикация считается выполненной только после проверки реально опубликованных revisions. Откат контента — новый rollback draft/revision.

Опорный публичный текст о согласии:

> EN: SHPROHLI identifies itself as an AI assistant and asks the recipient whether the conversation may be recorded and transcribed. Their answer is processed by AI to recognise the choice. The main conversation and recording start only after consent.
>
> DE: SHPROHLI stellt sich als KI-Assistent vor und fragt, ob das Gespräch aufgezeichnet und transkribiert werden darf. Die Antwort wird durch KI verarbeitet, um die Entscheidung zu erkennen. Das eigentliche Gespräch und die Aufzeichnung beginnen erst nach der Zustimmung.

Этот подробный текст предназначен для публичных уведомлений. По решению пользователя от 09.09.2026 голосовое вступление использует прежний краткий текст без дополнительных предложений об AI-распознавании ответа и выбранном retention. Решение меняет только произносимый текст, сохраняя фактический сценарий согласия и хранения. Публичный текст остаётся draft для сопоставления с реализованным поведением и R07, а не отметкой о выполненном внешнем согласовании.

### W10 — интеграция, документация и решение о выпуске

Команды и результаты сохранены в [verification](verification-language-implementation-2026-09-09.md). Матрица остаётся открытой в части авторизованного браузера и текущего real-call drill; HTTP smoke и публичные screenshots не заменяют эти проверки.

- [ ] Выполнить матрицу §7; сохранить команды, результаты и commit в новом verification-документе.
- [x] Обновить `architecture.md`, `runtime-reference.md`, `data-deletion-policy.md`, описание consent и операции восстановления/экспорта согласно реально написанному коду.
- [x] Сверить README/лендинг/CMS и release scope. В R08 формально отразить выбранную модель предварительного утверждения сведений; не возвращать исключённую разработку live approvals.
- [x] Зафиксировать открытые внешние пункты R06–R12 и применимую R13/R14 отдельно от локальных тестов. Не отмечать unrestricted public beta готовой только по завершению этого пакета.

## 6. Миграции, переключение и откат

Фактическая разбивка после `0062`, проверенная на чистой fixture БД и применённая к локальной dev БД:

| Миграция | Содержимое |
| --- | --- |
| `0063_account_language_preferences.sql` | Account preference и расширяемый user UI tag |
| `0064_call_language_context.sql` | Отдельные контексты preparation/call и нормализованный языковой intent |
| `0065_text_artifacts_and_jobs.sql` | Transcript revisions/current pointer, artifacts/chunks, durable target/type и provider operations constraints |
| `0066_call_plan_review_receipts.sql` | Policy по compilation, receipt и attempt binding; совместимость точных legacy approvals |
| `0067_extensible_content_locales.sql` | CMS/acceptance/admin locale columns и constraints; required localization metadata |

Изменение уже применённых миграций запрещено. Все пять миграций созданы и применены локально; массовых LLM-запросов по истории нет. Старые transcript rows получают source revision лениво при запросе.

Порядок включения: совместимые migrations → repository/worker/API, понимающие новые данные → UI → text capabilities для проверенных направлений → cutover policy v2 для новых compilation и ещё не утверждённых версий с точными legacy-исключениями → проверенная CMS-публикация. Перед включением проверять, что API и внешний worker используют совместимые версии.

Ввести отдельные настройки включения новых review/result функций и model/budget configuration в API и worker. Для локального deterministic smoke — mock processor; для проверки смысла — реальный текстовый processor с ограниченным бюджетом. Название модели задаётся конфигурацией; по умолчанию допустимо переиспользовать уже настроенную модель compiler после проверки поддерживаемого формата ответа.

Откат отключает создание новых текстовых задач/включение направлений, но сохраняет reader готовых артефактов и enforcement policy v2. Нельзя откатить сервер на версию, которая игнорирует review receipt для существующих v2-задач. Если нужна остановка запуска — использовать действующий механизм отключения outbound calls; не ослаблять утверждение ради отката.

## 7. Проверки и критерии завершения

| Область | Минимальная содержательная проверка |
| --- | --- |
| Совместимость | Golden hash v1; старый en-US/fallback/approval; уже существующие CMS JSON/acceptance читаются без переписывания |
| Независимые языки | EN UI + RU задача + DE-CH звонок; DE UI + UK задача + FR-CH звонок; UI switch сохраняет draft/selection/receipt/attempt default |
| Определение | Manual override; неоднозначный/смешанный ввод; неподдержанный target; старый compiler response; retry того же preparation intent |
| Выбор звонка | Немецкие подписи основных/fallback вариантов; ровно один английский в новом выборе; legacy не теряется |
| Review | Точность имён/чисел/отрицаний/запретов; переведённые уточнения; stale/foreign/failed artifact; recompilation в другой вкладке; явный original |
| Запуск | `/approve`, `/approve-and-start`, уже approved branch, прямой `/start`, repository transaction; перекомпиляция legacy/старая неутверждённая версия требуют v2; view-language toggle после approve не требует нового разрешения |
| Transcript | Тот же transcript ID с новой revision; смешанная речь; unknown roles; полнота chunks; старый worker не делает старый перевод current |
| Summary | «Нет», «да, если», противоречия, неизвестность, предложение без подтверждения; refs к оригиналу; неизменность outcome/credits |
| Jobs/стоимость | Две вкладки; retry/lease expiry/crash; bounded budgets; rate limits; повтор готового результата без нового запроса |
| Данные | Удаление во время ответа провайдера; rotation/restore inventory; owner export; audio retention 0; отсутствие сырого текста в логах |
| UI/CMS | Тестовая третья UI-локаль без нового voice/text языка; draft/factsText при смене URL; login с явным выбором гостя и без него; required/optional CMS локали; fallback Terms/AUP сохраняет реальный acceptedLocale; email fallback |
| Экспорт | Выбранный текст и язык; пометка перевода; source revision/сегменты; кириллица в PDF |
| Демо/контент | Гостевой сценарий без provider API; EN/DE; две FAQ-поверхности; preview/public revisions; copy/credits/consent согласованы |
| Браузер | 390 и 1280 px, контроль 320 px длинных DE строк; светлая/тёмная темы; клавиатура, фокус, loading/retry/stale; переключение и перезагрузка |

Сначала целевые тесты по каждому изменённому пакету, затем один общий прогон после интеграции. Для одних редакционных строк не добавлять тесты, повторяющие текст; проверять фактические состояния/поведение и опубликованный контент.

Команды, уже предусмотренные репозиторием:

```powershell
corepack pnpm db:migrate:check
corepack pnpm --filter @callassist/contracts test
corepack pnpm --filter @callassist/api test
corepack pnpm --filter @callassist/web test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm copy:check
git diff --check
```

PostgreSQL integration suites запускать с отдельной `TEST_DATABASE_URL`; успешный прогон с пропущенными integration tests не считается проверкой БД. Подготовка тестовой базы при необходимости — существующий `corepack pnpm db:test:prepare`; перед использованием проверить, что тестовая и рабочая БД различаются. Новые миграции проверить на чистой тестовой БД и на копии прежней схемы с историческими fixtures.

Основные существующие suites для расширения: `brief-compiler/compilation-integrity.test.ts`, `storage/postgres-call-repository.integration.test.ts`, `jobs/durable-job-worker.test.ts`, auth/content integration tests, `account-data-export-service.integration.test.ts`, web routing и `final-transcript-export.test.ts`. Для consent: `telephony/twilio-copy.test.ts`, `realtime/consent-flow.test.ts`, `realtime/consent-classifier.test.ts`, `realtime/openai-realtime-bridge.test.ts`. Отдельные новые тесты processors проверяют смысловые fixtures и строгую привязку к источникам.

Реальный текстовый перевод можно проверить без телефонного звонка. Полная голосовая приёмка проводится существующим двухэтапным real-call drill с разрешённым получателем и актуальным commit; mock не считается доказательством реальной речи.

## 8. Как исполнять план сегодня

**Первая контрольная точка:** W00–W02 — локализованный выбор с одним en-GB и сохраняемый независимый язык задачи. Это первый законченный пакет для проверки в приложении.

**Основная контрольная точка:** W03–W06 — рабочая цепочка переводимого review с серверным утверждением, оригинальной расшифровки, автоматического итога и перевода по кнопке, включая данные и экспорт. Её нельзя объявлять готовой после одной работающей кнопки без persistence/start checks.

**Завершение пользовательского пакета:** W07–W10 — расширяемый UI/CMS, демонстрация, уведомления, публикационный manifest и интеграционная приёмка. Внешние release-подтверждения фиксируются отдельно.

После фиксации W00 можно вести параллельно:

- backend: W02 storage → W03 → W04/W05, с W06 в каждом изменении;
- frontend: W01 → W02 UI → review/result UI по готовым DTO;
- UI/CMS: W07, затем W08/W09; demo итог подключается после готовности компонента W05.

Один интегратор владеет migration numbering, `packages/contracts`, центральными `app.ts`/`call-service.ts`, финальным merge и общими проверками. Shared-файлы не редактируются конкурирующими исполнителями без разделения владения. Зависимые пакеты не считаются завершёнными по mock-контракту, если реальный backend ещё не интегрирован.

Если рабочий день заканчивается между контрольными точками, оставить совместимую сборку, выключенные незавершённые функции и точный список открытых W-пунктов. Старый диапазон 17–29 инженерных дней не является обещанием для расширенного объёма этого документа.

## 9. Итоговый Definition of Done

- [ ] Весь включённый scope §1 реализован, W00–W10 отмечены по фактическому результату.
- [ ] Полная пользовательская цепочка проходит в приложении; EN/DE UI и независимый RU/UK текст проверены.
- [x] Legacy hashes/approvals/en-US и опубликованные CMS/acceptances сохранены.
- [x] Для будущего UI-языка не требуется изменение архитектуры задания, звонка или результата.
- [x] Проверены реальные текстовые преобразования выбранных направлений, а не только mock; ограничение семи примеров записано в verification.
- [x] PostgreSQL/memory, безопасность источников, удаление/экспорт/rotation, расходы и targeted regression подтверждены.
- [ ] Демо и публичные обещания соответствуют фактически включённым функциям; публикационные revision IDs записаны, если публикация выполнена.
- [x] Verification содержит базовый commit и статус рабочего дерева, команды, результаты, доступные браузерные доказательства и открытые ограничения. Release roadmap не закрыта автоматически.

В ходе реализации выполнены код, пять SQL-миграций, ограниченная проверка реального текстового provider и локальная регрессия. CMS-публикация, текущая голосовая приёмка и публичное включение направлений не выполнялись. Авторизованный браузерный сценарий остаётся непроверенным из-за недоступности browser surface; успешные HTTP/unit проверки приведены отдельно.
