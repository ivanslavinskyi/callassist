# Гибридное распознавание согласия и безопасное сокращение задержки

Дата исследования: 4 октября 2026. Ветка: `codex/hybrid-consent-feasibility`. Исходный commit: `95bae50`. Этот документ сохраняет результаты первоначального исследования до реализации.

**Последующее решение пользователя от 4 октября 2026:** утверждён первый вариант — Live deltas с коротким таймером; риск позднего отрицательного продолжения явно принят ради снижения задержки. Предложенный ниже запрет включения до появления finality больше не является условием этой реализации. Выбран opt-in hybrid с 200 мс settle, прежним semantic fallback на 900 мс и текущим режимом по умолчанию. Дополнительный ASR не добавляется. Фактическая реализация, проверки и готовность локального окружения описываются отдельно в `hybrid-consent-implementation-2026-10-04.md`.

## Вывод и рекомендуемое решение

Локальная классификация короткого **завершённого** ответа целесообразна: она может убрать отдельный семантический запрос из критического пути. Её можно изолировать от conversation/task runtime, оставить текущую реализацию по умолчанию и выбирать реализацию в админке для новых попыток звонка.

Однако предложенный fast path нельзя безопасно свести к вызову имеющегося `classifyConsent()` и уменьшению 900 мс. В текущем native Live нет события окончательной готовности транскрипта реплики. Полученный `Yes` может быть только префиксом ответа, даже когда локальный детектор уже увидел тишину. Семантический backend получает нативный контекст разговора; локальный классификатор получит только доставленные текстовые фрагменты. Их замена не доказывает сохранение текущих гарантий.

**Рекомендация:** утвердить поэтапную разработку с обязательным первым этапом — контрактом завершённой реплики. Не включать affirmative fast path на одних Live deltas и не сокращать таймер до решения этого вопроса. Если допускается только существующий Live transport, полный набор требований сейчас не реализуется: безопасный режим должен отправлять неподтверждённую полноту в semantic fallback, включая внешне очевидное `Yes`. Это ограничение протокола, а не нехватка фраз в словаре.

Есть три варианта:

| Вариант | Результат | Оценка |
| --- | --- | --- |
| Live deltas плюс короткий таймер | Минимум изменений, вероятное ускорение, возможное согласие по префиксу | Не рекомендован: противоречит требованию не решать по partial transcript |
| Текущий Live и локальная классификация без права grant при неподтверждённой полноте | Стабильный semantic остаётся владельцем решения; можно проверить словарь и метрики | Безопасная подготовка, но цель полного обхода LLM ещё не достигнута |
| Завершённый транскрипт отдельного согласованного аудиофрагмента плюс deterministic classifier | Позволяет убрать semantic consent для однозначных ответов; требует нового источника finality и проверки пауз | Предпочтительный путь к полной цели, если дополнительный механизм оправдан измерениями |

В рамках нынешнего исследования дополнительный ASR не внедрялся. Возможный узкий transcription adapter только для consent — отдельное расширение объёма работ для утверждения. Переключать весь звонок на старый Realtime/legacy hybrid ради final-события не следует.

«Без LLM» здесь означает отсутствие дополнительного semantic Responses/delegation запроса для классификации согласия. Существующая обработка аудио в GPT-Live сохраняется.

## Что работает сейчас

Источником истины служит код на указанном commit. Архивные исследования объясняют прошлые решения, но местами описывают уже заменённый flow. Даже текущая справка содержит исторические детали: например, фактический `play_clarification` сейчас играет короткое clarification, а не обязательно повторяет весь initial disclosure.

| Узел | Подтверждённое поведение | Код |
| --- | --- | --- |
| Выбор runtime | По умолчанию native unified Live; старые Realtime и `legacy_hybrid` — отдельные compatibility paths | [create-voice-runtime.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/create-voice-runtime.ts:9) |
| Initial disclosure | Application TTS воспроизводит `resolveInitialDisclosure()` из approved snapshot | [unified-live-call.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/unified-live-call.ts:281) |
| Playback barrier | Только совпавший действительный mark текущего поколения, без interruption/clear, переводит flow в consent | [unified-live-call.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/unified-live-call.ts:430) |
| Получение ответа | Runtime отмечает наличие текста, но намеренно не собирает pre-consent ответ для локальной классификации | [unified-live-call.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/unified-live-call.ts:521) |
| Акустика | Начало после 100 мс энергии, остановка после 600 мс тишины | [pcmu-activity.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/pcmu-activity.ts:15) |
| Settle | Ещё 900 мс после остановки речи/последнего фрагмента; новый фрагмент перезапускает ожидание | [unified-live-call.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/unified-live-call.ts:590) |
| Semantic consent | `requestConsentDecision()` запрашивает `report_consent`, с контролем revision и занятого backend | [live-conversation.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/live-conversation.ts:203) |
| Семантическая политика | Отказ от записи или транскрипции важнее согласия; условия, вопросы, цитаты и незаконченные ответы — unclear | [live-managed-tools.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/live-managed-tools.ts:21) |
| Recovery | Unclear → clarification → DTMF fallback → отказ по исчерпанию; голос остаётся доступен после clarification и DTMF prompt | [consent-flow.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/realtime/consent-flow.ts:22) |
| Grant | Синхронная смена phase на recording до первого await; запись; затем проверка startedAt и открытие task backend | [unified-live-call.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/unified-live-call.ts:658) |
| Запись | Twilio call создаётся с `record: false`; отдельный recording request идёт после consent transaction | [twilio-telephony-provider.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/telephony/twilio-telephony-provider.ts:73), [call-service.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/call-service.ts:1095) |
| Persistence | Поздние pre-recording фрагменты отбрасываются даже после начала conversation и при final drain | [live-conversation.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/live-conversation.ts:528) |

Существуют ограничители: обычно 12 секунд ожидания ответа, deadline ответа 20 секунд, общий consent deadline 60 секунд, максимум три disclosure attempts, отдельное ожидание записи 15 секунд. Их изменение не требуется. Provider failure сейчас отдельно от semantic unclear: одна ограниченная повторная попытка, затем существующий recovery.

## Почему нельзя назначить безопасные 200 мс

Официальная документация описывает `session.input_transcript.delta` как частичные фрагменты с приблизительными `start_ms/end_ms`. Доставка может запаздывать; completed-turn события и item ID нет. Следовательно, таймстамп последнего фрагмента не является подтверждением транскрибирования всего аудио. [OpenAI Live transcript deltas](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas).

Контрпример: собеседник уже произнёс «Yes, but don't record», локальный VAD увидел конец звука, а по WebSocket пока дошёл только `Yes`. Ни отсутствие новых deltas 200 мс, ни конечная точка, ни совпадение словаря не подтверждают полноту. Даже сохранение 900 мс не устраняет этот класс случаев. Измерение редких задержек полезно, но не превращает отсутствие ошибок в конечном корпусе в гарантию «никогда».

Есть ещё два риска именно при переносе на local classifier:

- Текущая граница disclosure фильтрует каждый фрагмент отдельно. Начало фразы до границы может быть отброшено, а положительное окончание после неё — допущено. Для local affirmative необходимо знать начало всей реплики, а не только разрешённого фрагмента.
- Очень тихий или короткий ответ может не дать акустическое `started`. Значение `speaking=false` само по себе не доказывает закончившуюся реплику.

Реалистичный источник finality — финальный transcript для конкретного committed audio item. Например, отдельный transcription API документирует `conversation.item.input_audio_transcription.completed` и связывание по `item_id`; порядок completed разных items нельзя предполагать. Это другой контракт, отсутствующий у текущих Live deltas. [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription#handle-transcript-events).

Даже final transcript подтверждает полноту конкретного захваченного audio item, а не невозможность будущего «но…». Поэтому сначала нужен явно определённый контракт endpointing: охват всей текущей реплики, паузы внутри ответа, повторное начало речи, отмена устаревшего решения. Не объявлять новое ASR автоматически безопасным; проверить модель, язык, транспорт, качество и privacy/data controls отдельно. Не сохранять pre-consent audio на диск, в Twilio recording, логи или экспорт ради этой проверки.

Для сегодняшнего потока ориентировочная составляющая ожидания при вовремя доставленном тексте — 600 + 900 = 1500 мс, затем semantic backend, БД и Twilio recording startup. Это вывод из таймеров, не измеренный production percentile. Если finality будет подтверждена, deterministic ветка сможет убрать semantic request и лишний post-final settle; semantic ветка сохранит длинное окно. Начальная настройка до измерений: существующие 900 мс, без изменения общего VAD. Нулевое либо короткое дополнительное окно после finality — предмет проверки, не заранее обещанная настройка.

## Предлагаемый flow после решения вопроса завершённости

1. Выбрать и зафиксировать consent strategy для конкретной попытки звонка.
2. Воспроизвести нынешний initial disclosure без изменения текста и дождаться действительного playback mark. Сохранить нынешнюю обработку provisional ответов после расчётного конца аудио до прихода mark, но не принимать их до mark.
3. Собрать текущую consent реплику в ограниченном буфере памяти, отдельно от post-consent transcript/task turns.
4. Проверить полноту реплики, disclosure generation, attempt, отсутствие нового speech/revision и действительность playback. Если полнота неизвестна, deterministic affirmative запрещён.
5. На завершённом коротком ответе вызвать версионированный `classifyConsent()` один раз для текущей revision.
6. `affirmative` → общий `#grant()` с `decisionMethod=deterministic_voice`; `negative` → нынешний reject/hangup, без semantic backend.
7. `unclear` → существующий semantic consent с `decisionMethod=semantic_voice`, без отдельного нового semantic сервиса.
8. Semantic unclear → существующая clarification → DTMF fallback. `1` принимается только там, где это уже разрешает ConsentFlow; метод `dtmf`.
9. При любой смене реплики, replay, timeout, disconnect, DTMF или завершённом решении отменить ожидающие локальные решения и сделать поздние semantic результаты недействительными.
10. Task tools и persistence открываются только после успешного запуска записи и валидной recording boundary.

Частичный текст не вызывает ни grant, ни окончательный reject. Его можно предварительно обработать в памяти, но итоговое действие — только после допустимой границы. Это сохраняет также корректность ответов вида «No problem» и исправленных отказов.

Для дополнительного transcription adapter: единственный владелец решения остаётся у приложения, Live conversation не заменяется; при ошибке/неполноте adapter используются текущий semantic путь и bounded recovery. Никаких «таймер истёк, значит да». Дополнительный аудиоканал нельзя включать скрыто под обычной настройкой словаря.

## Изоляция реализации и переключатель в админке

Предлагаемые значения настройки: `semantic_native` и `hybrid_deterministic_v1`. Первое точно обозначает текущий flow и остаётся default. Название `legacy_hybrid` не использовать: оно уже обозначает другую архитектуру.

В Admin System добавить небольшой блок «Распознавание согласия»: текущий режим, revision, дата/автор изменения, причина изменения и пояснение «для новых попыток звонка». Чтение — по существующим admin permissions, запись — superadmin, с проверкой origin, валидацией enum, optimistic revision и аудитом before/after. Ошибка stale revision возвращает конфликт, а не перетирает настройку.

Лучше отдельная revisioned настройка/таблица. `beta_controls.settings` использует строгую схему, которая может отвергнуть новое поле при откате старой версии; beta controls также optional. Нынешняя `system_controls` ограничена boolean outbound control и не является готовым хранилищем enum. Образцы: [admin-system-console.tsx](C:/Users/slavi/Desktop/www/callassist/apps/web/components/admin-system-console.tsx:106), [beta-controls.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/beta/beta-controls.ts:158), [beta-controls schema](C:/Users/slavi/Desktop/www/callassist/packages/contracts/src/beta-controls.ts:16).

Настройку фиксировать атомарно в новой call attempt до provider warmup: mode, policy/classifier version, settings revision и, если понадобится, finality source. Повторное подключение обязано читать зафиксированное значение. Активные и уже подготовленные attempts не переключаются вслед за глобальной настройкой. Новый retry attempt получает актуальную настройку.

Runtime descriptor дополнить этим выбором. Его существующий first-write-only механизм полезен для аудита, но сам по себе недостаточен: текущий writer возвращает void и может проигнорировать повторную запись. Исполняемая стратегия должна загружаться из сохранённых attempt metadata, иначе реальный код и descriptor могут разойтись. [runtime-descriptor.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/voice/runtime-descriptor.ts:5), [сохранение descriptor](C:/Users/slavi/Desktop/www/callassist/apps/api/src/storage/postgres-call-repository.ts:1315).

Legacy/missing policy означает `semantic_native`; неизвестное значение не включает hybrid. При недоступном хранилище новая попытка не получает незафиксированную experimental policy. Нельзя изменять approved execution snapshot, compilation hash или пользовательское согласование плана ради runtime-настройки.

Rollback режима выполняется этой же настройкой для новых attempts. Это отличается от отката бинарной версии: старые строгие readers могут не понимать новые telemetry events. Нужен сначала совместимый reader/schema release, затем включение новых writers. Не обещать, что старый commit сможет читать новые строки без проверки. Таблицы и исторические данные при rollback не удалять.

## Классификатор и языки

Нынешний [consent-classifier.ts](C:/Users/slavi/Desktop/www/callassist/apps/api/src/realtime/consent-classifier.ts:5) уже содержит все семь locales и большинство запрошенных примеров. Единственный production caller находится в legacy Realtime bridge. Поэтому глобальное изменение defaults этого helper затронет старые runtimes даже при выключенном новом переключателе. Предлагается отдельная policy/version нового словаря или opt-in параметр; прежний caller сохраняет прежнюю policy до отдельного согласованного изменения.

Подтверждённые локальными вызовами результаты текущего helper:

| Вход | Сейчас | Что требуется |
| --- | --- | --- |
| `Klar`, `Jo` для de-CH | unclear | `Klar` добавить; `Jo` включать после проверки ASR/языкового корпуса |
| `не записывайте` | unclear | negative в новой policy |
| `Да, но не записывайте` | unclear | negative после полного ответа |
| `Yes...`, `Да…` | affirmative | unclear из-за незаконченности |
| `Oui, mais sans enregistrement` | unclear | negative для явно распознанного отказа |
| `Okay` для en-US | affirmative | сохранить для полного контекстного ответа |

Причина русского дефекта: NFKD плюс удаление combining marks превращает `й` во входном тексте в `и`, но фразы-кандидаты не нормализуются. Это пропуск deterministic negative, а не подтверждённый false affirmative на полном русском отказе. Новая нормализация должна обрабатывать вход и словарь одинаково и сохранять языковые различия там, где они важны. Многоточие и признаки незавершённости нужно проверять до удаления пунктуации.

| Locale | Базовые affirmative и небольшие расширения | Обязательные отрицательные примеры |
| --- | --- | --- |
| de-CH | Ja; Ja gerne; Ja gern; Klar; Ja klar; Einverstanden; In Ordnung; Natürlich | Nein; lieber nicht; nicht aufnehmen; nicht aufzeichnen; Ja, aber bitte nicht aufnehmen |
| de-DE | Тот же standard German набор; Gerne; Das ist okay | Nein; ohne Aufnahme; Ja, aber bitte nicht aufnehmen |
| fr-CH | oui; bien sûr; d'accord; vous pouvez; oui d'accord; oui vous pouvez | non; n'enregistrez pas; sans enregistrement; Oui, mais sans enregistrement |
| it-CH | sì; certo; va bene; può registrare; sì certo; sì va bene | no; non registrare; non voglio; Sì, ma non registrare |
| en-GB | yes; sure; okay; OK; that's fine; you can; of course; yes please | no; don't record; do not record; Yes, but don't record |
| en-US | Тот же English набор | Отказ от записи, отказ от transcription, You can talk but cannot record |
| ru-RU | да; конечно; хорошо; согласен; согласна; можете; разрешаю; да можете записывать | нет; не записывайте; не записывай; без записи; Да, но не записывайте |

Для Swiss German проверить кандидаты `jo`, `ja/jo gärn`, `isch guet`, `nei`, `nöd/nid ufneh`. Это предлагаемые формы для проверки, а не доказанные наблюдения ASR текущего runtime. Не включать fuzzy/phonetic matching по сходству и не принимать `mhm/aha` автоматически. Начать с synthetic/native-speaker corpus, затем разрешённые тестовые звонки; не извлекать отсутствующие pre-consent записи из реальных звонков.

Правила новой policy:

- Affirmative только по целой короткой фразе из reviewed allowlist. Никаких prefix/startsWith и обрезания до первых слов.
- Явный отказ от записи **или автоматической расшифровки** имеет приоритет. Для коротких рассмотренных сочетаний с affirmative — negative.
- Qualification без явного отказа (`yes, if…`, `да, но…`, вопрос о причине помощи) — unclear. Само `but/aber/mais/ma/но` не означает отказ.
- Длинное, условное, процитированное, гипотетическое, смешанное или незавершённое высказывание — semantic fallback. Не расширять поиск отрицательной подстроки на произвольные длинные рассуждения и двойные отрицания.
- Существующий лимит 10 слов можно оставить как верхнюю границу; дополнительно ограничить размер входа и буфера до нормализации. Переполнение — unclear/recovery, никогда не классифицировать обрезанный положительный префикс.
- Проверять обе формы Unicode, регистр, прямые/типографские апострофы, пробелы, границы слов. Не терять отрицание или смысловой знак при нормализации.

## Disclosure и причина помощи

Рекомендую **вообще не менять wording** в этой работе. Цель находится после ответа собеседника; сокращение initial disclosure не устраняет основную задержку и добавляет риск регрессии approved/legacy текстов.

В [call-brief.ts](C:/Users/slavi/Desktop/www/callassist/packages/contracts/src/call-brief.ts:292) default равен `none`. [initial-disclosure.ts](C:/Users/slavi/Desktop/www/callassist/packages/contracts/src/initial-disclosure.ts:9) строит семь locale templates; frozen script имеет версию `assistance-inline-v1`, legacy adapter — отдельную версию.

- `none`: причина не произносится; отсутствие поля при создании также означает none.
- `speech_impairment`: только явный выбор пользователя добавляет соответствующую причину в initial disclosure.
- `language_barrier`: аналогично, без автоматической смены языка или обязательного объяснения.
- Frozen `runtime.initialDisclosure` всегда приоритетен. Старый `assistanceDisclosure` сохраняется дословно, без угадывания reason enum и без чтения изменившегося профиля.
- Ни одна настройка hybrid не меняет approved snapshots, тексты, hashes, имя представляемого человека или preview/review логику.

Уже есть матрица 7 locales × 3 reasons × 2 voices, то есть 42 комбинации. В обоих режимах она должна сохраниться. В runtime test harness default сейчас `speech_impairment`, хотя продуктовый default — none: добавить отдельный тест реального отсутствующего поля через создание/approval/admission, а не полагаться только на явные параметры harness.

## Аудит без сохранения ответа до согласия

Часть цепочки уже существует: frozen disclosure, application playback transcript с mark/session/timestamps, `consent.granted`, запись со статусом starting, затем provider recording ID и `recording.started`. Сохранение собственного произнесённого disclosure до consent намеренно разрешено; это не сохранение pre-consent recipient transcript. Эту границу не менять.

Пробелы: `method=voice` не различает deterministic и semantic; `disclosure.started` имеет пустую metadata; нет явных связанных `disclosure.completed`, `consent.decision`, `recording.requested`. `recording.started` содержит providerStatus, а SID приходится восстанавливать через другие записи. Application playback persistence поставлена в асинхронную очередь: порядок вызовов не равен доказанному порядку durable событий.

Предлагаемая связанная последовательность:

```text
callAttempt + compilationHash + consentPolicy
  → disclosureReceipt(version, actualTextHash, playbackGeneration, mark, acknowledgedAt)
  → consentDecision(id, receiptId, revision, outcome, decisionMethod)
  → recordingRequested(recordingId, decisionId, requestedAt)
  → recordingStarted(recordingId, providerRecordingId, observedAt, providerReportedAt?)
```

Хешировать именно фактически воспроизведённый текст: runtime может применять уже существующую spoken-identity projection. Compilation hash хранить отдельно. Текст брать из существующего защищённого snapshot/playback evidence, не копировать имя, reason или весь disclosure в открытые technical metadata. Не сохранять recipient answer, его хеш, объяснение модели или audio: хеш короткого «да» легко перебирается и не даёт доказательства акустического согласия.

Совместимость: оставить верхний `method=voice|dtmf` для прежних lifecycle/UI projections, добавить `decisionMethod=deterministic_voice|semantic_voice|dtmf` в новую evidence. Исторические `voice` и `dtmf_1` остаются читаемыми; старый voice не переименовывается задним числом в semantic.

Для решений хранить outcome, locale, classifier/policy version, attempt/receipt/revision IDs, безопасный reason code и timing. Для unclear и negative тоже нужна decision запись. Она описывает решение приложения, а не доказывает дословно сказанное человеком.

Новая affirmative admission должна в одной существующей `beginRecording` transaction закреплять проверенную связь disclosure → decision → recording request. Только после успешного commit обращаться к Twilio. По возможности присоединить нужные записи к существующей transaction, а не добавлять последовательные сетевые round trips. Ошибка сохранения обязательной цепочки до вызова провайдера запрещает запись. Повторная запись event должна быть идемпотентной.

Нынешний `startRecordingAfterConsent(id, evidence?)` допускает отсутствие evidence, а repository подставляет исторический `dtmf_1`. Для новой ветки нужна обязательная валидированная affirmative evidence с точным attempt binding. Сегодня repository выбирает latest attempt по call ID: старый asynchronous grant не должен случайно попасть в новую попытку. Не считать TypeScript тип достаточной проверкой; проверять binding/status/decision внутри transaction. Миграцию legacy callers проводить явно, без переписывания истории.

Важное различие времени: существующий `startedAt` зачастую означает приложение увидело ответ REST; webhook может принести provider start time. Нельзя незаметно заменить им transcript persistence boundary. Сохранить действующую консервативную границу и добавить отдельные диагностические времена. Provider timeout после фактического создания записи требует reconciliation, а не слепого повторного create.

Schema работы: строгие contracts и event formatter, SQL CHECK для имён событий, repository и in-memory parity, deletion/export/retention, lifecycle и admin inspector. Новые IDs и версия policy полезнее свободных строк. Чувствительная причина помощи не должна попасть в технический аудит.

## Защита от гонок

`#grant()` остаётся единственной точкой runtime admission. Синхронное `consent → recording` сохраняется до await. Локальная и semantic ветки не запускаются параллельно для одной revision: semantic разрешён только после local unclear либо невозможности доказать полноту. Нативный unsolicited `report_consent` не обходит этот порядок.

В `configureConsent()` сегодня объединены установка transcript boundary и включение semantic tools. Их нужно разделить только для новой стратегии. Простой `suspendConsent()` как local-only режим не годится. Не переиспользовать task turn accumulator: у него другая длительность, persistence и сортировка фрагментов.

Consent buffer: ограничение размера/времени, привязка к целой акустической реплике и disclosure generation, preservation пробелов/повторов, обработка duplicate IDs и неполных spans. Нельзя сортировкой приблизительных времён незаметно переставить отрицание. Любая неоднозначная сборка — unclear. При disconnect/replay/resolution буфер очищается; не передавать его в SSE/DB/logger/exports.

Перед принятием deterministic решения повторно проверяются phase, attempt, действительный mark, revision, completion contract и отсутствие возобновившейся речи. Для semantic fallback сохраняются нынешние проверки нативного контекста, settle, playback и freshness; Live delta при этом не объявляется финальной репликой. Старый backend может физически ещё работать: сохранить текущие механизмы occupancy, epoch/backendRevision, continuation и provider accounting; логическая отмена не означает освобождения физического запроса.

Existing AMD handoff/stop gates и порядок блокировок call → attempt сохраняются. Уже принятая запись не должна возвращаться в voicemail из-за позднего AMD. Запись в полёте плюс hangup не даёт права открыть task backend после закрытия сокета.

Twilio возвращает mark также при `clear`, поэтому сам факт mark без локальной проверки поколения/прерывания не доказывает проигрывание. [Twilio Media Streams mark](https://www.twilio.com/docs/voice/media-streams/websocket-messages#mark-message).

## План реализации после утверждения

| Этап | Конкретная работа | Критерий завершения |
| --- | --- | --- |
| 0. Контракт завершения | Зафиксировать фактические Live events; выбрать допустимый источник finality и endpointing; оценить отдельный consent ASR только при согласованном расширении | Документированный источник полного audio item; без него affirmative hybrid не активируется |
| 1. Базовые регрессии | Разделить в harness акустику и доставку transcript; добавить delayed suffix, cross-boundary и неполные ответы; сохранить native expectations | Тесты воспроизводят риск, а не притворяются, что delta final |
| 2. Версионированная policy | Новый набор правил/нормализации и corpus для семи locales; legacy default не трогать | Все affirmative точные; отрицания/qualifiers имеют верный приоритет; unknown → unclear |
| 3. Настройка и admission | Contracts, отдельная additive migration, сервис настроек/API, attempt binding, descriptor, Admin System и локализация | Default native, revision audit, переключение только новых attempts, restart/reconnect используют зафиксированный выбор |
| 4. Локальный orchestrator | Ephemeral consent buffer, отдельные evidence/semantic gates, общий ConsentFlow/#grant, finality adapter если утверждён | Ноль semantic requests на завершённых allowlisted ответах; stale/partial не разрешают запись |
| 5. Durable audit | Playback receipt, decision method, transactionally linked recording request, start/SID; совместимые readers/exports | Цепочка восстанавливается для success/negative/unclear/failure, без pre-consent recipient данных |
| 6. Интеграция и регрессия | PostgreSQL races, admin access/revisions, 42 disclosure combinations в обоих режимах, AMD/task/appointment/closing | Все инварианты проходят; поведение native по умолчанию не меняется |
| 7. Проверка задержки | Разрешённые synthetic provider probes и тестовые handset calls; измерения по locale/режиму | Выигрыш и ASR/endpointing ошибки измерены; таймер выбран по контракту и данным, не по предположению |
| 8. Контролируемое включение | Совместимый reader release; native default; hybrid для ограниченных новых тестовых attempts; затем явное включение | Быстрый rollback настройки, старые attempts воспроизводимы, негативные сценарии без записи |

Этап 0 — настоящий stop/go gate. При запрете дополнительного механизма и неизменном Live contract следует остановить affirmative часть, сообщить ограничение и сохранить native. Создание рабочего переключателя само по себе не является выполнением цели ускорения.

Предварительная инженерная оценка, не обязательство по срокам: 1–2 дня на контракт/корпус/измерительный harness; 1–2 на policy; 1–2 на settings/admission/admin; 2–3 на orchestrator и audit; 2–3 на integration/verification. Отдельный ASR adapter добавляет ориентировочно 2–4 дня плюс provider/handset acceptance. Главная неопределённость — завершённость и реальный выигрыш, а не объём словаря. Если дополнительный ASR по задержке/стоимости съедает экономию semantic backend, hybrid нецелесообразен для этой архитектуры.

## Матрица обязательных проверок

| Группа | Проверки и ожидаемый результат |
| --- | --- |
| Все locales | Каждая разрешённая фраза и варианты нормализации для de-CH, de-DE, fr-CH, it-CH, en-GB, en-US, ru-RU; полные ответы проходят local без semantic |
| Отказы | Все пять пользовательских «да, но не записывайте» и аналоги отказа от transcription; negative, ни одного recording request |
| Qualification | Условия удаления записи, частичное разрешение, вопрос, quotation, hypothetical, injection, длинные ответы → unclear; не affirmative |
| Незавершённость | `Yes...`, `Да…`, `Ja, aber`, префикс/первое слово, конец на тире, buffer overflow; ни одного grant |
| Акустика и доставка | Speech frames и deltas независимо; suffix до/после proposed fast window и позже 900 мс; тишина внутри ответа; поздние/дублированные/перекрывающиеся фрагменты |
| Disclosure | Missing/fake/old/cleared mark, barge-in, replay, начало ответа до disclosure и положительное окончание после, provisional после audio end до mark |
| Semantic | Один первоначальный запрос для актуальной unclear revision, без параллельных/дублирующих запусков; существующий bounded retry при infrastructure failure; native context сохраняется; поздний результат после коррекции недействителен |
| Recovery | Clarification → DTMF, голос работает на обеих стадиях, `1` вне разрешённой стадии не даёт consent, `2` отклоняет, silence/deadline завершают bounded flow |
| Grant races | Deterministic/semantic/DTMF одновременно → одна запись; новая речь у timer boundary отменяет старое решение; disconnect/timeout/replay блокируют stale grant |
| Provider races | Callback раньше REST response, duplicate callback, mismatched SID, timeout после create, completed до start response, stop во время startup; никаких duplicate recordings или раннего task admission |
| БД и аудит | Несколько соединений: consent/AMD/stop; точный attempt binding; failure audit до REST → без записи; идемпотентность и causal IDs; старые voice/dtmf_1 строки читаются |
| Privacy | Raw pre-consent audio/text/hash отсутствуют в storage/logs/SSE/export; application disclosure receipt сохраняется; late input и final drain соблюдают прежнюю recording boundary |
| Assistance | Omitted reason → none; 42 locale/reason/voice cases × 2 modes; оба opt-in объяснения до согласия; при none нет причины; legacy/frozen texts и hashes неизменны |
| Admin | Permissions/origin, invalid enum, stale revision, durable audit, restart, prewarm/reconnect, разные API процессы, rollback новых attempts без переключения активных |
| Стабильный runtime | Native default проходит старые suites; legacy caller не получает новую policy; AMD, task, appointment, closing, primary Live transcript и optional recording ASR сохраняются |

В существующих тестах многие ответы backend задаются вручную, а helper делает монотонные 100-миллисекундные текстовые фрагменты. Такие тесты проверяют state machine, но не доказывают полноту реального transcript. Новые tests должны проверять весь порядок событий, факт отсутствия consent `response.create` на fast path и настоящий service/repository → mocked Twilio вызов, а не только spy на `#grant()`.

## Метрики и критерии принятия

Раздельно измерять время последнего голосового кадра, local speech stopped, поступления текста/finality, semantic dispatch/completion, decision, durable recording request, REST acceptance, webhook start и открытия task. Для runtime использовать монотонные интервалы; для аудита хранить UTC и источник времени. Не смешивать approximate Live timeline, wall clock и физическое provider время.

Сравнить p50/p95 по locale, mode и типу решения; долю deterministic, semantic и unclear; частоту clarification/DTMF, stale results, startup failure, duplicate requests и пропущенных audit links. Реальное распределение сейчас не измерено: customer pre-consent аудио отсутствует по дизайну, в этом исследовании звонки не запускались.

Обязательные условия release: ноль grants на отрицательном/условном/неполном тестовом корпусе; ноль pre-consent recordings; ровно один recording request на принятую affirmative; все safety suites зелёные; весь обязательный audit link сохранён; native control без регрессии. Измеримый выигрыш должен оставаться после ASR/finality, БД и Twilio, а не только в микробенчмарке словаря. Числовой latency SLO фиксировать после первого baseline, не выдавать историческую скорость другого semantic сервиса за текущую.

## Выполненная проверка исходного состояния

Без изменения кода выполнены **447 тестов в 14 файлах**, все прошли:

- API, 324 теста: consent classifier/flow, unified Live runtime, Live bridge, execution context, Twilio copy/provider.
- API, 31 тест: call service и runtime descriptor.
- Contracts, 44 теста: initial disclosure, включая 42 комбинации.
- Contracts, 23 теста: brief defaults, telemetry и lifecycle.
- Contracts, 25 тестов: call brief, включая omission → assistanceReason none и opt-in причины.

`pnpm exec vitest` не нашёл Windows shim; существующий установленный runner успешно запущен напрямую через `node node_modules/vitest/vitest.mjs` из соответствующего package. Зависимости не переустанавливались. Пример основной команды из `apps/api`:

```powershell
node node_modules/vitest/vitest.mjs run src/realtime/consent-classifier.test.ts src/realtime/consent-flow.test.ts src/voice/unified-live-call.test.ts src/voice/openai-live-bridge.test.ts src/voice/live-execution-context.test.ts src/telephony/twilio-copy.test.ts src/telephony/twilio-telephony-provider.test.ts --reporter=dot
```

PostgreSQL integration suites **не запускались**: `TEST_DATABASE_URL` не задан; рабочая/production БД не использовалась. Для будущей реализации нужны dedicated `*_test` database и изолированные fixtures. Existing useful suites: live-storage, runtime-descriptor integration, answering-storage, admin-system, beta-controls, twilio-webhooks и optional-recording-transcript integration. Полный build/typecheck и provider/handset acceptance также относятся к проверке будущей реализации, а не считаются выполненными здесь.

## Что предлагается утвердить

1. Сохранение текущего semantic native режима по умолчанию и всех нынешних disclosure/assistance snapshots.
2. Отдельную operational consent policy и переключатель только для новых attempts.
3. Версионированный deterministic classifier, связанный audit trail и перечисленные регрессии.
4. Сначала разрешение вопроса finality; полный affirmative fast path только после этого. Дополнительный consent transcription adapter — явное отдельное архитектурное решение, если остаётся требование обхода semantic backend.

До утверждения исходники, тесты и миграции не изменяются. Этот документ фиксирует выводы и план, а не объявляет предложенную гибридную реализацию безопасной или уже готовой к включению.
