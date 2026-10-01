# Подробный план: устойчивое завершение Live и достоверный итог звонка

Дата: 1 октября 2026 года. **Реализовано на текущей ветке; акустическая приёмка новым звонком остаётся открытой.**
Результат, проверки и порядок активации: [отчёт об имплементации](live-stabilization-implementation-2026-10-01.md).
Ниже сохранена исходная спецификация. Шаги 1–8 выполнены; автоматическая часть шага 9 проверена,
ручная матрица голосов/языков и метрики задержки шага 10 требуют новых звонков.
Фактические файлы контекста — `summary-source.ts`; старый `live-closing-speech.ts` удалён.
Миграции 0090/0091, runtime `live-managed-v5`, summary `summary-v4:grounded-v3`.
Основание: [аудит Live v4 и календарной ошибки](live-runtime-completion-audit-2026-10-01.md).
Исходный код: `55f2ca1`, активная версия `live-managed-v4`.

## Решение и границы

Исправить существующие границы данных, проверки и lifecycle. Для календаря использовать
утверждённые конкретные окна, доверенные timestamps и чистые календарные функции.
Смысл разговора извлекает тот же существующий summary-запрос. Новых LLM-этапов,
календарных tools, агентов, очередей и дополнительного realtime-контроллера не вводить.
Работы runtime ниже заменяют ошибочные ветви существующего владельца звонка,
а не добавляют параллельного координатора.

Завершение звонка и post-call summary — разные потребители одних типов фактов.
Звонок не ждёт post-call обработки. Определение calendar eligibility не доказывает
booking; слова получателя не доказывают исполнение journal action; Twilio completed
не доказывает достижение цели или проигрывание прощания.

Новые звонки должны давать лаконичный устный итог и прощание, затем отключаться после
подтверждения их доставки, если получатель не завершил связь раньше. При требовании
немедленно остановиться полный итог необязателен. При физическом разрыве или отказе
аудиоканала произнести прощание невозможно; результат должен честно отражать это.

## 1. Зафиксировать регрессии и исходную конфигурацию

До изменения поведения:

- Перенести synthetic эквиваленты семи runtime-диагностик из `.tools` в штатные suites,
  инвертировав assertions на желаемое поведение. Не переносить реальные персональные данные.
- Добавить fixture: звонок 01.10.2026, зона Europe/Zurich, следующий 14-дневный период
  без пятниц, 09:00–18:00; собеседник подтвердил 03.10.2026, 11:00.
  Известное calendar eligibility не может быть unknown.
- Раздельно проверить reported booking, journal confirmation и delivered farewell.
- Сохранить manifest, runtime flags, rollback baseline и результаты тестов.

Исходная диагностика: 7 runtime reproductions + 1 control, 7 calendar diagnostics/controls,
188 текущих voice tests и 194 текущих calendar/text tests прошли на неизменённом коде.
Это исходная точка; diagnostic pass означает воспроизведение, а не устранение дефекта.

## 2. Сформировать контекст результата из исходной попытки

Изменяемые файлы:

- `apps/api/src/text-processing/summary-input.ts`
- `apps/api/src/text-processing/text-processor.ts`
- `apps/api/src/text-processing/text-artifact-service.ts`
- `apps/api/src/storage/call-text-repository.ts` и обе реализации storage
- `packages/contracts/src/call-text-artifact.ts`

Добавить versioned, server-built `SummarySourceContext` с минимальными полями:

```ts
type SummarySourceContext = {
  version: 1;
  callAttemptId: string;
  compilationId: string;
  compilationSnapshotHash: string;
  transcriptRevisionId: string;
  transcriptSourceHash: string;
  callCreatedAt: string;
  callConnectedAt: string | null;
  callEndedAt: string | null;
  approvedAt: string | null;
  appointmentAuthorization: AppointmentAuthorization | null;
  actionEvidence: AttemptBoundActionEvidence | null;
};
```

Названия новых типов предварительные; поля должны иметь строгую схему, limits и
source binding. `null` означает отсутствие факта, а не разрешение вывести его из prose.
Timestamp для даты подключения брать из события подключения именно этой попытки.
Не подставлять время генерации artifact, время записи/обновления строки или часы браузера.
При отсутствии подключения хранить известный attempt-created timestamp с отдельным
provenance; не объявлять его доказанным моментом ответа получателя.

Цепочка чтения: `artifact → transcriptRevision.callAttemptId → attempt.compilationId →
immutable approved snapshot`. Проверить совпадение call ID, attempt, compilation,
snapshot hash и transcript revision. Не использовать текущую редактируемую форму,
последнюю попытку другого звонка или новую compilation того же brief.

`appointmentAuthorization.windows` передавать полностью в пределах уже действующего
лимита 31 окна. Локальную дату/weekday получать из её IANA zone; `appointmentCalendar`
вычислять существующим `calendarDateDetails`. Label не является расширением полномочий.
Raw contact facts, не нужные отчёту, не добавлять.

Контекст формируется одинаково для одночастного summary, каждого chunk, compaction,
retry и второго языка. `validateTextProcessingInput` должен проверять и учитывать его
размер, вместо бесконтрольного расширения лимита входа. Контекст закрепляется за artifact,
чтобы поздний callback или повтор worker не менял основание уже начатой оценки.

**Приёмка:** перехваченный fixture provider request содержит approved window, call binding
и доверенные timestamps; изменение чужого brief/attempt не влияет на результат.

## 3. Выделить календарную проверку без model orchestration

Файлы:

- `apps/api/src/realtime/appointment-authorization.ts`
- новый чистый модуль рядом, например `apps/api/src/appointments/appointment-calendar.ts`
- `packages/contracts/src/calendar-date.ts`, `packages/contracts/src/appointment.ts`
- tests текущего authorization и нового helper

Из существующего validator выделить сравнение slot с frozen windows и преобразование
local date/time в допустимый instant. Realtime validator вызывает этот helper, сохраняя
все прежние проверки полномочий, деталей, услуги, адресата и финансовых условий.
Не вызывать старый validator из summary с искусственным `detailsConfirmed=true`:
это смешало бы календарный факт с семантическим подтверждением.

Контракт чистой функции:

```ts
evaluateAppointmentCalendar({ authorization, candidate, referenceAt })
// eligibility: within | outside | unknown | not_applicable
// reason: exact_window | outside_window | missing_date | missing_time |
//         conflicting_candidates | zone_conflict | invalid_date |
//         nonexistent_local_time | ambiguous_local_time | missing_authority
// matchedWindow: exact source window or null
// startsAt: unambiguous instant or null
// pastAtReference: true | false | null
```

Невалидная дата и неоднозначный instant не считаются eligible. Отсутствующая authority
не разрешает booking; для обычного information task соответствующая проверка not_applicable.
Входы strict; результат не принимает никаких supplied-by-model разрешений.

Семантическое извлечение конкретного slot остаётся в **том же** summary Structured Output:
нормализованные дата/время, источник часового пояса, cited segment IDs, статус
`offered/reported_confirmed/conditional/corrected/ambiguous`, связи с исправлениями.
Возвращать кандидаты и их связи, а не объявленный моделью calendar verdict.
ISO-normalization — техническое представление, не переписывание исторического transcript.
Проверять calendar schema и наличие cited evidence; смысл связи и допустимость
нормализации покрывать evals, не выдавая их за полностью детерминированное распознавание речи.

При нескольких датах нельзя брать первое вхождение или последнее число: учитывать
явное исправление, условие и отрицание. Если финальный кандидат не выделяется уверенно,
unknown относится к выбору даты; при однозначном slot принадлежность окну считает код.

Для проверки «было ли время уже в прошлом» использовать время этой попытки/соответствующей
реплики с указанной точностью. Никогда не использовать `Date.now()` worker: повторная
генерация через месяц не должна сделать корректную прошлую договорённость недопустимой.
Членство в frozen windows вообще не требует повторного расчёта относительного периода.

Периоды трактовать так:

- Пользовательские «следующие N дней» разрешает существующий compiler один раз;
  concrete windows после approval остаются authority при любом времени исполнения.
- Сегодняшняя compiler-policy: offset 1 для следующих N дней, offset 0 при включении
  сегодня; next_calendar_week — ближайший следующий понедельник–воскресенье в зоне.
  Для двух недель в fixture offset 1/count 14 и исключение пятниц дают 03–15 октября
  с пропусками 9 октября и остальных неразрешённых дат. Первый день периода 2 октября
  исключён как пятница. Не превращать это в произвольные «две календарные недели».
- Относительное слово в речи получателя привязано к дате соответствующей реплики,
  а не автоматически к дате компиляции. Около полуночи при недостаточной точности —
  реальная неоднозначность. Не подменять смысл простым timestamp subtraction.
- `compiledAt` сейчас фиксируется после выполнения compiler; это не гарантированно
  тот же timestamp, что `#now()` в его prompt. Если сохранять provenance относительного
  selector для будущих планов, сохранять именно исходный `scheduleReferenceAt`, selector
  и resolver version. Это additive provenance в существующей компиляции, без нового вызова;
  оно не является обязательным условием исправления текущего случая с готовыми windows.

**Приёмка:** 03.10.2026, 11:00 → within; пятница 02.10, 18:01 и дата вне списка → outside.
Обе границы 09:00/18:00 разрешены, поскольку окна ограничивают START включительно.
Часовой пояс хоста, смена месяца/года, високосный день, DST gap/fold и дата повторной
генерации не меняют корректный ответ. Один календарный helper обслуживает оба пути.

## 4. Разделить доказательства речи и вычисленные факты в summary

Файлы:

- `packages/contracts/src/call-text-artifact.ts`, `call-assessment.ts`
- `apps/api/src/text-processing/openai-text-processor.ts`, `text-validation.ts`
- `summary-input.ts`, `text-artifact-service.ts`
- `apps/api/src/credits/final-assessment.ts`

Добавить совместимый новый summary payload version, сохранив чтение schemaVersion 2.
Разделить provider extraction и итоговый сохраняемый payload: computed facts создаёт
сервер после существующего provider request. Модель не может прислать их как доверенные.

В references использовать различимые источники: transcript segment, approved-plan window,
attempt timestamp, application action, server-computed fact. Каждый reference разрешается
по контексту **этой** попытки, а не по произвольному ID/строке из model output.
Не создавать фиктивные transcript segments с «системными» датами.

Для календарного результата хранить candidate ID, matched window reference,
algorithm version, основание и verdict. Наличие reported confirmation остаётся отдельным
полем с recipient citations; `within` никогда не повышает его до journal confirmed.
Старое поле certainty, описывающее слова собеседника, не переиспользовать как признак
проверки сервером. UI может показывать «соответствует утверждённому плану» с provenance.

Проверки успеха сейчас являются произвольными строками. Нельзя найти календарный
критерий по индексу `criterion.1`, русской фразе или regex для «недель». В существующем
semantic extraction добавить decomposition каждой проверки на conversation evidence
и ссылку на applicable structured condition (например, выбранный appointment slot).
Приложение проверяет, что condition существует в утверждённом плане и относится к
тому же кандидату. Составной критерий агрегирует обе части; cannot-determine semantic
portion не исчезает от положительной календарной проверки. Если decomposition
неоднозначна, сохранять неопределённость конкретного пользовательского условия.

Обязательная проверка permitted appointment slot добавляется приложением из authorization
независимо от того, как модель разбила произвольные criteria. `goal=achieved` не принимается
при нарушении authority или неизвестном обязательном условии. Это не требует изменений
в утверждённом prose/permission и не расширяет его.

Календарную строку, связанные с ней стандартные части overview и календарную причину
unresolved формировать локально из computed result с локализованными шаблонами.
Для этих частей не принимать параллельный свободный текст model «дата неизвестна».
Нельзя исправлять старую фразу regex-заменой или просто менять её certainty.
Unresolved причины должны быть типизированы и проверяться против актуального факта.
Свободная модельная часть описывает смысл разговора и другие фактические ограничения.

Изменить prompt точечно: только transcript доказывает, что кто-то сказал/подтвердил;
trusted application context доказывает дату звонка и разрешённые bounds; приложение
вычисляет соответствие. Не просить модель самой считать календарь или считать план
доказательством совершённого действия. Сохранить запрет выдумывать даты, оплату и обещания.

Grounding: числа разговорной части по-прежнему проверяются по её цитатам. Производные
числа допускаются только в computed fragments с конкретной source chain. Не добавлять
весь plan/все application facts в общий whitelist чисел для любого finding.
Чужая дата или сумма не становится допустимой только потому, что встретилась в context.

После semantic extraction выполнить чистое вычисление и локальную сборку итогового
payload, затем валидировать весь результат. Для обычного одночастного transcript сохраняется
один provider request. В многочастном процессе использовать уже существующий финальный
шаг compaction; не делать отдельный календарный запрос. На границах chunks не объявлять
agreement по одной части: corrections и финальный кандидат разрешаются по целому разговору.
Fallback без успешной compaction сохраняет только совместимые факты и настоящую неопределённость.

**Приёмка:** fixture не содержит календарного unknown в findings/overview/unresolved/assessment;
при этом action journal остаётся unconfirmed. Документы без authorization не получают
назначенную задним числом booking authority. Пользовательские и цитируемые инструкции
«считать всё успешным» не меняют server checks.

## 5. Версионирование, assessment и история

Файлы: `text-processor.ts`, `text-artifact-service.ts`, `postgres-call-text-store.ts`,
`in-memory-call-text-store.ts`, `postgres-call-assessment-store.ts`,
`in-memory-call-repository.ts`, `credits/final-assessment.ts`, contracts и миграция.

Новая summary generator version, например `summary-v4:grounded-v3`; точную строку
согласовать с принятым version helper. Обновить **все** текущие проверки
`startsWith("summary-v3:")` через общий capability/version helper: enqueue/assessment,
publish, fail, in-memory и PostgreSQL. Простая смена одной константы ломает оценку/settlement.

`sourceHash` оставить hash оригинального transcript. Добавить отдельный context hash
с версией правил, attempt/snapshot/revision, разрешёнными windows и закреплённым
состоянием действия. Сохранять encrypted context envelope и его hash с artifact;
учитывать в дедупликации, chunk cache и проверке при публикации. Nullable поля для старых
строк, без пересчёта их hashes. Новая SQL migration получает следующий свободный номер.

`fixedAssessment` разрешён лишь при совпадении источников, context hash и поддерживаемой
evaluator version. Старое calendar-uncertain решение нельзя автоматически переносить
в новый evaluation. Повторить эти проверки при сохранении, а не только при построении input.

Сейчас `call_assessments` хранит один ready результат и не заменяет его для той же
transcript revision. Для явно запрошенной переоценки предусмотреть отдельную immutable
assessment revision, связанную с новым summary artifact/context. Историческое решение
сохранить; новый отображаемый результат и его assessment должны ссылаться на одну ревизию.
Settlement остаётся связанным с исходным billing evidence и не выполняется повторно.
Не переводить calendar eligibility в основание списания: подтверждённость содержательного
разговора и достижение scheduling goal — разные измерения.

В этом внедрении не запускать массовую регенерацию истории. Для конкретного старого
звонка новая обработка — отдельная операция/ревизия, без перезаписи transcript, approval,
старого summary и credit ledger. До неё старый результат остаётся явно историческим.
Очередь старой версии при rollout либо дренируется до активации, либо обслуживается явным
legacy adapter; не запускать новый decoder поверх старых chunks под прежним ключом.

**Приёмка:** новый результат не наследует ложный calendar unknown; повторный worker,
второй язык и ручная регенерация не создают новый debit/refund; rollback читает старые
артефакты, а новый output не выдаётся за старую схему.

## 6. Привести завершение звонка к одному владельцу

Файлы: `voice/unified-live-call.ts`, `live-closing-speech.ts`, `live-managed-tools.ts`,
`live-conversation.ts`, `live-controlled-speech.ts`, общий call-event/telemetry contract.

В существующем lifecycle заменить implicit closing на сохраняемый TerminalDecision:
revision, reason, source references, factual summary, unresolved facts, action state,
locale. Временный `unconfirmed_details` даёт уточнение или status check, а не автоматический
`cannot_proceed`. Причина refusal/stop не должна зависеть от полного appointment success.

Обычный native output, принятый до terminal decision, никогда не подтверждает terminal
playback. Убрать зависимость от `response.completed + nonempty text + 1s quiet`.
Подготовить один короткий финальный audio unit существующим renderer; native output
на время его владения выходом заглушён. Mark выдаётся после последнего известного фрейма.
Принятый exact mark актуальной generation разрешает durable hangup preparation и закрытие.

Summary не теряется при переходе к fallback; запасной текст не обещает неподтверждённого.
Один bounded retry/резервный финал в общем 30-секундном budget. При недоставке сохранять
incomplete, при технической невозможности — завершать без вымышленного playback receipt.
Смена TTS/Live должна пройти акустическую проверку обоих голосов. Для generated speech
сохранить корректный recording-ASR fallback до надёжного смешанного transcript.

Прерывание: clear invalidates mark; reciprocal farewell сохраняет decision;
материальная поправка создаёт новую task revision; recipient disconnect отменяет всё.
Никаких проверок goodbye по списку слов. Текущий backend разбирает полный ответ.

**Приёмка:** ordinary address acknowledgement не закрывает вызов даже после завершения
backend; произнесены factual recap + goodbye, actual mark принят, hangup выполнен один раз.
В тестах recipient-first disconnect не превращается в assistant-success.

## 7. Устранить противоречия action, prompts и scheduler

Файлы: `voice/live-conversation.ts`, `unified-live-call.ts`, `live-managed-tools.ts`,
`realtime/appointment-authorization.ts`; существующие tests.

- Собирать полезные backend message items из `response.output_item.done` и deltas;
  пустой финальный `response.output` не означает отсутствия прогресса.
- На новом содержательном ответе сбрасывать expired состояние прошлого ожидания.
  Разделить clocks для полезного прогресса, тишины, provider timeout и общего closing budget.
- Не продлевать recovery из-за silent audio packets или filler. Continuation возвращает
  все tool results до нового recovery; одна application decision на актуальную revision.
- Локальный timeout запрещает старые effects, но не освобождает physical provider run.
  При неопределённом run не наслаивать commands; использовать bounded завершение/ошибку
  сессии, если нет подтверждённого окончания. Не изобретать неподдерживаемую отмену.
- Во время protected commitment удерживать output ownership до playback/cancel;
  rejected request не разрешает озвучить успех. Already-reported booking ведёт к
  status-only проверке того же exact proposal, а не к новому booking.
- Убрать противоречие frontend instruction про retry never-transmitted booking:
  текущий v4 контракт после uncertain — status-only, максимум три попытки reconciliation.
  Никакого нового permission customer при уже утверждённом scope.

**Приёмка:** все семь исходных runtime reproductions становятся desired-behavior
regressions; ошибки старых generations не завершают свежую работу и не открывают
защищённый output. Число model/tool round-trips в обычном сценарии не растёт.

## 8. Отображение, экспорт и наблюдаемость

Файлы: `apps/web/components/call-summary-presentation.tsx`,
`apps/web/lib/call-result-projection.ts`, `derived-transcript-export.ts`,
`final-transcript-export.ts`, `transcript-pdf-layout.ts`, сообщения локализации,
`packages/contracts/src/call-lifecycle.ts`, admin inspector.

UI/копирование/PDF используют одну validated projection. В источниках вычисленной
проверки показать утверждённое окно и проверяемую дату, отдельно от цитат разговора.
Понятные пользователю формулировки вместо IANA identifiers и внутренних state names.
Отображать результат беседы, состояние действия и инициатора окончания раздельно.
`endedBy=assistant` переиспользовать; неизвестный transport end не называть действием получателя.

Для fixture ожидаемые утверждения:

> Получатель подтвердил договорённость на субботу, 3 октября 2026 года, в 11:00.
> Дата и время соответствуют утверждённому расписанию.
> Подтверждение действия в приложении не завершено.

Последняя фраза нужна там, где продукт показывает execution state; она не отменяет
реальное высказывание получателя. Не повторять одинаковую неопределённость в четырёх местах.

Telemetry без персонального текста: version/hash, decision/generation, основание
eligibility, mark issued/cleared/acknowledged, disconnect requested/observed, failure reason.
Текст summary и причинные evidence — encrypted artifacts с существующим доступом.

## 9. Обязательная матрица тестов

| Уровень | Проверки |
| --- | --- |
| Calendar pure | 3 октября, Friday exclusion, exact bounds, split windows, missing/ambiguous slot, timezone mismatch, DST gap/fold, leap day, month/year rollover, host UTC−10/UTC+14 |
| Temporal anchors | Поздний worker; повтор через месяц; звонок после approval; разные даты compilation/call; полуночь; неверный/отсутствующий timestamp; неизменные frozen windows |
| Source binding | Другой attempt с теми же словами; новая compilation; amended transcript; чужой action/window ref; reused artifact/chunk; удалённый источник |
| Extraction | Краткое «всё верно» с правильным antecedent; предложение без подтверждения; условие; отмена; две даты; дата цифрами/словами; weekday conflict; RU/DE/FR/IT/EN |
| Grounding | Дата сервера доступна только computed fact; чужие числа/ID отвергаются; transcript не переписывается; календарный успех не подтверждает booking |
| Summary lifecycle | Один request для короткого transcript; existing chunk/compaction budget; второй язык; old/new schema; fixedAssessment version mismatch; точечная новая ревизия без rebilling |
| Voice lifecycle | Обычная фраза перед end_call; задержка последнего фрейма; silent packets; reciprocal goodbye; correction; recipient disconnect; old/cleared/duplicate mark; TTS/provider failure |
| Product | Один итог в UI/PDF/copy; локализованные источники; historical readability; корректные partial/refusal/unknown; обе voice settings |

Все пять разрешённых типов задач из аудита сохраняют coverage; calendar metadata
не должно создавать appointment permission у информации, документов или neutral message.
Для schedule fixes достаточно unit/workflow tests до provider eval. Затем контролируемые
semantic evals в существующем harness и реальные звонки только с согласными участниками.
По записи проверить, что итог лаконичен, farewell слышен полностью и отключение происходит
после него. Отдельно проверить отказ и ранний разрыв, где полного итогового монолога быть не должно.

## 10. Последовательность поставки и критерии готовности

1. Regression fixtures и pure calendar helper (шаги 1, 3).
2. Summary context, typed evidence/composition, validation и version compatibility
   единым завершённым изменением (шаги 2, 4, 5); затем UI/export (шаг 8).
   Не активировать половину, где prompt знает дату, а validator/assessment ещё не умеют её использовать.
3. Terminal ownership и coherent action/scheduler изменения (шаги 6, 7), с независимыми
   focused suites. Новая версия Live; no-active-call preflight перед перезапуском.
4. Полные затронутые API/contracts/web tests, typecheck/build, PostgreSQL parity и
   миграционная проверка, затем акустическая/handset приёмка и ограниченное наблюдение.

Критерии выпуска:

- У точного slot из утверждённого окна нет ложной календарной неопределённости.
- Число календарных model calls/tools/runtime turns **равно нулю**; существующий
  summary request используется для семантики, чистый код — для вычислений.
- В обычном коротком summary один model request; никакого повторного запроса ради
  проверки даты, нет роста звонковых round-trips от calendar changes.
- Подтверждение получателя, membership в policy, journal action и доставка closing
  остаются отдельными проверяемыми фактами во всех представлениях.
- Нельзя закрыть звонок по хвосту обычной реплики; нельзя принять старый mark.
- Сохраняются privacy/consent, права на действия, ограничения числа booking и финансовые условия.
- История читается, новые результаты воспроизводимы по source/context hash, billing не повторяется.

Цели задержки для проверки: terminal audio starts ≤3 с p95 после принятого решения,
hangup ≤1 с после actual playback mark на здоровом канале; общий ceiling closing 30 с.
Это будущие acceptance targets, не измеренные характеристики текущей версии.
Rollback возвращает runtime/worker версии по manifest; новые stored artifacts сохраняются,
их reader должен поддерживаться. Миграции additive; никаких сбросов базы или переписывания истории.
