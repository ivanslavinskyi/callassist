# Исправления и расследования после реального звонка: этапы A–H

> **Archived on 2026-11-08.** Historical design, investigation or verification record.
> Original dates, language and acceptance scope are preserved; this is not the current specification.
> Use the [documentation index](../../README.md), [native runtime](../../native-live-runtime.md)
> and [validation guide](../../native-live-validation.md) for maintained behavior and remaining checks.

Дата: 2026-11-02. Основание: [план после реального звонка](real-call-hardening-plan-2026-11-02.md).
Статус: этапы B/C реализованы и проверены локально; baseline A зафиксирован для
этого объёма. Для D локально исправлен конфликт инструкций, разговорная приёмка
ещё не выполнена. Для E исправлен доказанный дефект привязки continuation,
проверенный paired replay и регрессиями. В F восстановлен механизм повтора
прощания; изменения ограничены тестами и документацией. В G добавлена техническая
диагностика частичного playback с unit/contracts и PostgreSQL export проверками.
В H добавлена необязательная подсказка при подготовке записи в клинику; проверены
локализация, отсутствие автоматических фактов и обычный approval. Production не
обновлялся, новые телефонные звонки не выполнялись.
Изменения остаются в рабочем checkout, отдельный commit пока не создан.

## Рабочая база

- HEAD до изменений: `0e499e8e96f23a33fc9db1689660946f635a2998`.
- До начала реализации изменён только индекс документации и добавлен файл плана.
- Node 24.9.0; установленный Vitest 4.1.11, TypeScript 5.9.3, tsx 4.23.1,
  tsup 8.5.1, zod 4.4.3. Зависимости и lockfile не изменялись.
- `corepack pnpm` не смог получить закреплённый pnpm 10.12.4: DNS `ENOTFOUND`
  для registry.npmjs.org. Проверки выполнены непосредственно установленными
  локальными CLI, без установки новых пакетов.
- Исходный прогон пяти целевых suites: **344 / 344**, все пять файлов успешны.
- Добавленные синтетические проверки до исправлений воспроизвели **11 падений**:
  четыре проверки calendar selection/guards и семь речевых locales; остальные
  23 проверки в этих двух suites прошли. Затем все они прошли на исправленном коде.

Исторический descriptor исследованного звонка: `live-managed-v9`, live
`gpt-live-1`, delegation `gpt-6-luna`, speech `gpt-4o-mini-tts`, voice `cedar`;
consent `hybrid_deterministic_v1`, revision 2, settle 200/900 мс;
prompt hash `c17d0a89525d985e3e1f43ff6783eb45607c7704254279f69b7691ff56bb1375`.
Это зафиксированные значения экспорта, не утверждение о текущей конфигурации сервера.

Release SHA уже поддерживается `liveRuntimeDescriptor` через
`SHPROHLI_RELEASE_SHA`: принимается валидный 40-символьный SHA. Нового поля или
изменения рантайма не требуется; заполнение переменной проверить при будущем
выпуске. В историческом звонке значение отсутствовало.

Параметры ACK timeout, task grace/quiet windows, consent и closing deadlines
не менялись. Их прежнее поведение защищено существующими fake-timer и event-order
тестами. Новая акустическая или сетевая latency не измерялась: это не эксперимент
по ускорению рантайма.

## B. Итоговая оценка

Изменения в `summary-calendar.ts`:

1. Сначала применяются существующие supersedes/corrected связи.
2. Если есть активное подтверждение, простые невыбранные offers исключаются
   только из выбора финального кандидата; в извлечённой истории они сохраняются.
3. Разные подтверждения, активные conditional/ambiguous остаются препятствием
   для успешной оценки, включая условие на тот же слот.
4. Проверки разрешённого окна, прошедшего времени и точного совпадения
   date/time/zone с confirmed action evidence сохранены.
5. Если сохранённое действие существует, но его нельзя сопоставить, текст говорит
   о проблеме сопоставления, а не об отсутствии сохранённого подтверждения.
   Enum projection `unconfirmed` и journal состояния не расширялись.

Новые summaries имеют generator version `summary-v5:grounded-v3:...`.
Структура payload/schema и provider extraction не изменились. Calendar calculation
остаётся `appointment-calendar-v1`: изменён выбор кандидата, а не алгоритм времени.

Совместимость:

- `summary-v4` сохраняет прежнюю projection и проверяется по прежним правилам.
- Queued/retry v4 обслуживается новым worker только при совпадении extraction
  version и полного processor/provider/model suffix. Другие модели не подменяются.
- Готовый v4 результат и существующий job переиспользуются при том же source,
  compilation, языке и совместимом generator; upgrade не запускает скрытую регенерацию.
- Cached chunks остаются pinned к artifact; retry проверен с сохранённым context
  и реальным повторным использованием chunk без вызова процессора.
- v5 включён в обработку assessment; проверены публикация immutable revision,
  отражение результата в lifecycle и отсутствие повторного списания.
- Старые результаты, feedback, transcript revisions и отправленные письма
  не переписывались и не отправлялись повторно.

Проверка непосредственно на локальном экспорте, без копирования персональных данных
в репозиторий:

```text
v4 projection === сохранённый payload: true
v4 publication validator: passed
v5 goal: achieved
v5 criteria: achieved, achieved, achieved, achieved
v5 calendar: within
v5 action: confirmed
v5 extracted candidates: 2
```

## C. Речевой шаблон

В `live-appointment-copy.ts` из request, confirm_existing и status_check убран
добавляемый шаблоном суффикс `(${proposal.timeZone})`.
Сохранены имя, услуга, дата, день недели, время и различия между операциями.
Пример синтетического текста: `Sprechstunde, Freitag, 6. November 2026, 09:45.`

Тесты покрывают все семь call locales, неизменность input proposal/authorization
и фактическое сохранение `Europe/Zurich` в journal после application playback.
Часовой пояс не удалён из structured data и не меняет момент записи.

Этот патч не переписывает факты/услугу, предоставленные в approved plan, и не
фильтрует произвольную native речь: он исправляет конкретный application template.
Не добавлены timezone conversion, выбор города, новые инструменты или вызовы моделей.

## Проверки

Команды выполнялись из `apps/api`, кроме явно указанных других каталогов.

```powershell
# Baseline: 5 suites, 344 tests (до новых тестов и правок production code)
node node_modules/vitest/vitest.mjs run src/text-processing/summary-calendar.test.ts src/text-processing/summary-workflow.test.ts src/voice/live-appointment-copy.test.ts src/voice/unified-live-call.test.ts src/voice/openai-live-bridge.test.ts

# Финальная расширенная проверка: 32 suites, 873 tests
$testPaths = @(rg --files src/voice src/realtime src/text-processing src/appointments src/credits | Where-Object { $_ -match '\.test\.ts$' -and $_ -notmatch '\.integration\.test\.ts$' })
node node_modules/vitest/vitest.mjs run @testPaths src/storage/final-assessment.test.ts src/notifications/user-call-email.test.ts
node node_modules/typescript/bin/tsc --noEmit

# packages/contracts: 25 suites, 254 tests; typecheck и build успешны
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/tsup/dist/cli-default.js src/index.ts --format esm --dts --out-dir dist --clean
```

Итого финальных автоматических проверок: **1127 тестов успешны**.
Новые тесты во время разработки выявили также ошибки собственного fixture retry
(неполные параметры failDurableJob и context-free cached payload); они исправлены,
финальный полный прогон успешен. Проверки не ослаблялись ради прохождения.

API typecheck успешен. Стандартный API build и повторный build в отдельный каталог
встретили Windows `EPERM` на параллельном создании выходных каталогов. Сборка всех
entry points успешно выполнена с исходной tsup-конфигурацией в заранее созданные
каталоги `.tools/real-call-build-2026-11-02/api-precreated`, с `clean:false`.
Миграции и OG assets скопированы в эту отдельную сборку по тем же путям, что в
`scripts/copy-migrations.mjs`. Производственный build config не менялся.
Это подтверждает сборку и упаковку; стандартный clean build в этой среде имеет
отдельное файловое ограничение. Сервисы, worker и DB migration CLI не запускались.

`git diff --check` проверяется после обновления документов. Платные провайдеры,
production БД, PostgreSQL integration suites и сквозная отправка реального письма
не использовались. Для storage выполнены in-memory suites; для письма — unit
проверки шаблона. Слуховая приёмка и новый контролируемый разговор ещё не выполнялись.

## Ограничения и выпуск

На этапе B/C production файлы `unified-live-call.ts`, `live-conversation.ts`, consent,
appointment authorization и closing state machine не изменены. В voice path
изменяется только содержимое application-rendered appointment speech.
Baseline не является гарантией отсутствия любых production регрессий.

B и C можно проверять/выпускать раздельно. Для B единица изменения включает
version recognition, worker compatibility и pinned validator вместе с selector;
эти части нельзя выпускать по одной.

Возврат C — независимый возврат речевого шаблона. При возврате B после выпуска
сначала проверить очередь v5: прежний бинарник не умеет её обслуживать. До
остановки нового worker закончить такие задания либо оставить совместимый worker
и чтение v4/v5. Не менять версии уже созданных artifacts, не пересчитывать историю
и не запускать автоматический resend. При полном rollback следовать runbook и
не обрывать активные звонки. Это ограничение нового versioned формата задач,
а не разрешение на обход старого валидатора.

Этап H не реализован. Необъяснённые ACK-паузы и изменение политики повтора
прощания остаются открытыми. Значения таймеров не изменялись.

## D. Служебная речь: причина, граница каналов и локальное исправление

### Наблюдения и предел доказательств

В native transcript проблемная фраза начинается на 185,4 секунде сессии
(08:33:14.373 UTC), заканчивается на 193,6 секунде. В записи это примерно 2:46.
Ассистент предлагает ждать ответа самой клиники после её вопроса о первом визите.
Это обращение к отсутствующему наблюдателю, а не ответ собеседнику.

В этой окрестности первая делегация завершается в 08:33:13.476, следующая
начинается в 08:33:14.289 и завершается в 08:33:15.229. Фраза начинается через
897 мс после завершения первой и через 84 мс после начала второй. В экспортированных
событиях этого интервала нет application tool result; есть переходы
`ambiguous_backend_start` / `ambiguous_command_settled`. Эти timestamps дают
корреляцию, а не доказывают, какой текст вернула конкретная делегация.

Исходный backend output не сохранён в экспорте; локальные runtime logs по этому
call/session и фразе также не найдены. Исторический release SHA отсутствует.
Нельзя утверждать, что раскрыта цепочка внутренних рассуждений или восстановлен
точный production prompt. Новое логирование скрытых рассуждений не добавлялось.

Проверенный путь в текущем коде:

- `response.event` с `output_text` учитывается как полезный ответ backend;
  приложение не передаёт его в TTS, native transcript или commentary.
- `session.output_transcript.delta` и `session.output_audio.delta` поступают
  отдельно от Live. Проблемная фраза находится в этом native transcript.
- Метод `commentary()` существует, но вызывающих его мест в `apps/api/src` нет.
- Application TTS имеет отдельные явные задачи, включая `end_call.resultSummary`.

Обнаружен конкретный конфликт инструкций: backend должен возвращать внутренние
факты «not a spoken script», но одновременно получает «You are speaking to the
called recipient» и требование «Speakable results». Live запрещено озвучивать
внутреннюю работу в целом, однако роль backend-сообщений отдельно не определена.
Это проверяемый дефект текущего контракта и вероятный фактор эпизода; точную
причинную цепочку исторического ответа доказать имеющимися данными невозможно.

### Минимальная правка

Изменены только инструкции в двух production-файлах:

- `live-managed-tools.ts`: backend явно советует Live внутренне; обычные заметки
  отделены от адресованного собеседнику `end_call.resultSummary`; противоречивое
  «You are speaking» заменено на «Live speaks».
- `live-conversation.ts`: Live использует фактические выводы backend, не читает
  служебные заметки вслух и не предлагает собеседнику ждать собственного ответа.
  Последний вопрос получает ответ из approved facts либо честное «неизвестно»;
  нерешённые условия сохраняются до обязательства.

Сохранены возможность фактического ответа без инструмента, `tool_choice:auto`,
consent gate, protected appointment flow и application-owned closing. Модели,
таймеры, VAD, обработчики событий, schemas инструментов и transport не менялись.
Нет дополнительных сетевых операций, фильтра произносимого текста или нового
blocking gate. Изменение prompt может влиять на выбор модели — отсутствие
изменений управляющего кода не является доказательством отсутствия такого влияния.

### Проверки и незавершённая разговорная приёмка

До правки: **336 тестов / 4 suites** — unified live call, live bridge,
execution context и assistant identity. Добавлены четыре проверки:

1. Фактически отправляемые session.start/session.update содержат отдельные роли
   backend/Live, сохраняют разрешение ответов без tool и речевой resultSummary.
   После исправления ошибки имени события в fixture (`session.start`) тест падал
   на отсутствии нового контракта, затем прошёл после production-правки.
2. Три формы backend output — completed message, streamed text delta и item.done —
   не запускают TTS, не создают native transcript, commentary или лишнюю делегацию.
   Синтетическая последовательность включает отсутствующий ответ о DOB и новый
   вопрос о первом визите. Затем native audio проходит байт-в-байт, явный
   resultSummary озвучивается, closing завершается одним hangup.

Три routing-проверки проходили ещё до production-правки: они подтверждают, что
прямого копирования backend-текста приложением нет. Они не воспроизводят генерацию
проблемной фразы моделью. Тест с заданным native ответом проверяет транспорт,
а не доказывает, что модель самостоятельно выберет именно такой ответ.

После правки целевой набор: **340 / 340**, четыре файла успешны.
Расширенный регрессионный набор по той же команде, что для B/C:
**877 / 877**, 32 файла успешны (29,07 с). API `tsc --noEmit` успешен.
Все 13 entry points API собраны с исходной tsup-конфигурацией в
`.tools/real-call-build-2026-11-02/d-internal-speech`; каталоги предварительно
созданы последовательно, `clean:false`, миграции и OG assets скопированы,
как в предыдущей проверке с учётом Windows EPERM. `git diff --check` успешен.
Contracts на этапе D не изменялись; их предыдущие 254 проверки здесь заново
не запускались и не включены в число 877. Сервис из сборки не запускался.

Команда целевой проверки из `apps/api`:

```powershell
node node_modules/vitest/vitest.mjs run src/voice/unified-live-call.test.ts src/voice/openai-live-bridge.test.ts src/voice/live-execution-context.test.ts src/voice/live-assistant-identity.test.ts
```

Этап D полностью не закрыт: нужен предусмотренный планом paired baseline/candidate
разговорный прогон с фиксированными моделями и таймерами, несколькими формулировками
вопроса о первом визите и контрольным информационным разговором. Проверять ответ
на последний вопрос, отсутствие выдуманных фактов/обещаний и служебной речи,
число делегаций, задержки и сохранность consent/booking/closing. Платные provider
eval и реальные звонки в этом этапе не выполнялись. Локальная правка — кандидат
для этой проверки, а не подтверждение готовности к production.

Rollback D независим от B/C: вернуть только изменения инструкций в двух файлах
и соответствующие prompt assertions. Данные, schema и очередь не изменены.

## E. Известное continuation теряет привязку после нового ответа

### Baseline и историческая хронология

До E целевой набор `unified-live-call.test.ts` + `openai-live-bridge.test.ts`:
**323 / 323**, два файла успешны. Изменения A–D сохранены; HEAD и зависимости
не менялись. Исследован только основной call/attempt, контрольный звонок из
того же экспорта не смешивался с ним.

| ACK timeout, UTC | Наблюдаемый backend рядом с командой | Следующий backend после timeout | Вывод |
| --- | --- | --- | --- |
| 08:31:58.528 | 08:31:43.965–45.139; рядом прерывание request_appointment и rejected tool result | 08:31:58.741, через 213 мс | Совместимо с блокировкой продолжения старой командой |
| 08:33:29.089 | 08:33:14.289–15.229; native речь продолжается до timeout | 08:33:33.818, через 4729 мс | Timeout не означает 15 секунд тишины |
| 08:35:23.794 | 08:35:09.001–10.337; confirm_appointment принят в 08:35:11.181 | 08:35:23.995, через 201 мс | Совместимо с блокировкой очереди старой командой |

Время отправки исходных команд не сохранено; вычитание 15 секунд из timeout —
только оценка по текущему коду. В экспорте нет достаточной привязки
clientEventId → scoped/unscoped → delegationId. Исторический release SHA отсутствует.
Поэтому таблица не доказывает, что один и тот же найденный дефект вызвал все три
паузы. Native timing и время получения transcript различаются; по этой таблице
не измеряется слышимая тишина. Новое прослушивание/ASR не выполнялось.

### Доказанная причина и минимальная правка

Для продолжения после tool result приложение уже хранит `backendScope`:
delegation ID и predecessor response ID. Однако `#acknowledgeBackendStart`
требовал также совпадения текущих epoch/backend/progress revisions. Новый ответ
или прогресс делали ранее отправленную команду устаревшей, и её фактическое
продолжение больше не снимало ожидание `response.create`.

Последствия воспроизведены четырьмя падающими тестами до правки:

- новый ответ уже готов к обработке, но очередь ждёт старого 15-секундного ACK;
- новое готовое continuation блокируется, хотя прежнее фактически завершилось;
- continuation после нового ответа или прогресса получает свежие revisions вместо
  исходных и может ошибочно начать protected booking. В синтетическом сценарии
  journal переходил в `sending` даже после поправки о недоступности времени.

В E production-правка ограничена `live-conversation.ts`:

1. Scoped continuation узнаётся по delegation и точному predecessor response.
   Устаревание содержимого не отменяет причинную привязку физического запуска.
2. Найденная команда передаёт исходные revisions; `progressRevision` также берётся
   из неё. Существующая проверка свежести tools отклоняет старое действие.

После признания запуска физический run всё равно занимает backend до settlement.
Тест держит его дольше 15 секунд и подтверждает отсутствие параллельного запроса.
Поздняя ошибка уже признанной команды не вызывает retry и не затрагивает новую.
Unscoped start по-прежнему не считается причинным ACK. Значения 15/30 секунд,
grace 5 секунд, native quiet 2 секунды и recipient settle 600 мс сохранены.
Consent, booking authorization, closing, модели и prompt на этапе E не менялись.
Новых hooks, telemetry fields, provider requests или записей на audio frame нет.

### Paired replay и проверки

На одинаковых синтетических сценариях с fake timers выполнены baseline/candidate
прогоны. Baseline получен Vite transform, который отменяет только E в памяти;
рабочие файлы не переключались. Проверено, что baseline `live-conversation.ts`
точно равен HEAD + ранее принятой правке D. Остальной код A–D одинаков.

| Сценарий | Baseline | Candidate | Контроль |
| --- | --- | --- | --- |
| От нового transcript до запроса решения после завершения старого continuation | 15001 мс | 5600 мс | Один новый запрос, 0 hangup |
| От завершения старого continuation до отправки уже ожидающего нового | 15000 мс | 0 мс | Один новый запрос, 0 hangup |

5600 мс — прежние 600 мс settlement + 5000 мс native grace; ноль во второй строке —
отсутствие дополнительного ожидания в event loop с fake timers, не нулевая latency
провайдера. Для первого сценария timestamp взят из `Live task decision requested`;
для второго очередь проверялась сразу и затем с шагом 500 мс. Это детерминированная
проверка механизма, не измерение ускорения production и не model eval.

Локальные воспроизводимые файлы, JSON метрики и manifest:
`.tools/real-call-e-replay-2026-11-02/`. SHA-256 `live-conversation.ts` по UTF-8/LF:

- baseline: `1d6ae1851542cbd7aa841a51a50e76f94910e345125c7d2b75e7e99bd96b1308`;
- candidate: `be65a8f60308ce62e8cddeb93758c9f781259ea4daf895e77ca6968c4386c00d`.

Команды из `apps/api` (значение переменной действует только для соответствующего
shell-процесса):

```powershell
$env:REAL_CALL_REPLAY_BASELINE = '1'
node node_modules/vitest/vitest.mjs run --config ../../.tools/real-call-e-replay-2026-11-02/replay.config.mjs -t 'paired E replay measurement'
$env:REAL_CALL_REPLAY_BASELINE = '0'
node node_modules/vitest/vitest.mjs run --config ../../.tools/real-call-e-replay-2026-11-02/replay.config.mjs -t 'paired E replay measurement'
```

Постоянный regression suite дополнен пятью тестами: две задержки, физическая
занятость, stale booking после нового ответа и после нового прогресса.
Целевой набор после правки: **328 / 328**. Расширенный набор по команде B/C/D:
**882 / 882**, 32 файла, 27,14 с. В нём также проходят существующие проверки
unrelated native response, потерянных/поздних ACK/error, announced backend timeout,
disconnect, consent, прерывания booking и closing. API typecheck успешен.

Все 13 API entry points собраны в
`.tools/real-call-build-2026-11-02/e-continuation-ownership`, с исходным config,
предварительным созданием каталогов и `clean:false` для обхода ранее установленного
Windows EPERM; миграции и OG assets скопированы. Production config не менялся.
`git diff --check` успешен. Contracts и DB schema не изменялись; реальная БД,
платные provider eval и звонки не использовались. Production не обновлялся.

### Что остаётся открытым

Исправлен один доказанный механизм, а не все возможные причины задержек.
Для unscoped команд без причинного ACK консервативное поведение сохранено.
Проверка реального поведения candidate и объяснение всех исторических timeout
остаются открытыми. Следующий независимый этап — F, причина повторного closing.

Rollback E: вернуть вместе изменения scoped matching и переноса progress revision,
сохранив D-параграф в `buildLiveInstructions`. Не возвращать весь файл к HEAD,
чтобы не потерять предыдущую правку. Соответствующие regression tests откатываются
вместе с E. Миграции/пересчёт данных не нужны; активные звонки не прерывать.

## F. Повтор прощания после акустического прерывания

### Что произошло в экспортированном звонке

Исследован прежний основной call/attempt. В конце звонка:

| UTC | Событие |
| --- | --- |
| 08:35:25.830 | Closing playback generation 4 requested |
| 08:35:25.834 | Единственный в этом завершении `end_call` принят |
| 08:35:25.828–27.824 | Единственный `live_application_synthesis`, succeeded, 1996 мс |
| 08:35:26.369–27.598 | Backend continuation, succeeded |
| Около 08:35:33.2 | Входящий энергетический всплеск во время исходящего аудио |
| 08:35:34.787 | Closing playback generation 5 requested |
| 08:35:47.237 | Актуальный mark generation 5 подтверждён |
| 08:35:47.241 | `playback_complete`, generation 5 |
| 08:35:47.263 | Завершение `agent_hangup` |

В интервале между двумя playback generation нет нового recipient transcript,
второго `end_call`, `keep_closing`, новой TTS operation или события семантической
отмены closing. TTS сформировал аудио один раз; второе проигрывание использует
существующий результат. Подтверждённая длительность финального клипа — 12350 мс.
Первый прерванный клип не представлен как полностью услышанный transcript.

### Сопоставление записи и алгоритма

WAV: stereo PCM16, 8 кГц, 319,44 с. SHA-256 повторно совпал с audio manifest:
`69db41c9c6bdd2bf2144f97b562cd89a3d0ed47ee1cea4d419b1b263a283c1c9`.
Origin из recording.started_at — 08:30:27.984 UTC. Программно исследованы энергия
каналов и timestamps, без слуховой классификации или ASR. Исходный WAV и тексты
персональных данных в репозиторий не копировались.

Текущий `PcmuActivity` считает активностью 100 мс подряд с RMS ≥ 600, а окончанием
активности — 600 мс ниже порога. В closing событие started вызывает `#pauseClosing`:
оно очищает проигрывание и ждёт интерпретации, сохраняя авторизованный terminal
decision. После stopped при отсутствии текста `#settleRecipientTurn` ждёт ещё
900 мс, затем `#fallbackClosing` заново играет тот же полный клип из кеша.

Расчёт на PCM по 20-мс окнам с тем же энергетическим порогом:

- started: WAV 305,220 с → 08:35:33.204 UTC;
- stopped: WAV 305,900 с → 08:35:33.884 UTC;
- stopped + 900 мс → ожидаемый restart 08:35:34.784 UTC;
- фактически requested generation 5: 08:35:34.787 UTC.

Проверка смещения сетки окон от 0 до 19 мс даёт интервал ожидаемого restart
08:35:34.774–34.793, включающий наблюдаемое значение. На исходящем канале виден
интервал низкой энергии примерно WAV 305,42–307,02 с; это отдельное измерение
с порогом RMS < 150, а не точная граница очистки Twilio playback.

Локальный JSON с параметрами и результатами:
`.tools/real-call-f-2026-11-02/closing-energy-summary.json`.

Это сильное подтверждение механизма acoustic interruption → fallback replay.
Оно не доказывает, чем был входящий звук: шумом, эхом или короткой речью.
PCM из записи не равен исходным PCMU transport frames; точные packet boundaries,
activity events и clear receipt в экспорте отсутствуют, production release SHA
не сохранён. Разница 3 мс при нулевом смещении не означает точность акустической
реконструкции до 3 мс. Отсутствие transcript не доказывает отсутствия речи.

### Решение: не менять защитное поведение без новой политики

Воспроизведённый повтор соответствует существующей политике. Дефект вроде
повторного terminal decision, лишнего TTS запроса или потери идемпотентности
pending render не найден. Поэтому production code, VAD, пороги, таймеры,
prompts и closing state machine на этапе F не менялись.

После clear старый mark не доказывает, что итоговая фраза была услышана полностью.
Подавить повтор или завершить разговор по такому mark небезопасно. Повышение
порога, игнорирование короткого звука, возобновление с середины или сокращённое
прощание меняют политику прерывания и требуют отдельного дизайна, как предусмотрено
планом. Приоритет остаётся за поправкой собеседника и подтверждённым playback.

### Проверки

Baseline до изменений F: **328 / 328** в двух suites. В
`unified-live-call.test.ts` усилен существующий сценарий acoustic-only recovery:
до 900 мс нового mark нет; после 900 мс появляется ровно один новый playback,
без нового TTS, terminal decision и backend request. Старый mark не завершает
звонок; актуальный mark завершает его ровно один раз.

Добавлены три сценария:

1. Всплеск 80 мс без transcript не пересекает текущий порог: нет clear/restart,
   исходный mark остаётся действительным.
2. Существенная поправка приходит через 850 мс после acoustic stop: она отменяет
   автоматический fallback, старый mark не завершает звонок, backend может
   вернуть разговор в работу и native audio снова проходит.
3. Повторные acoustic-only interruptions не продлевают исходный deadline:
   на 30-й секунде срабатывает ограничение, успешный agent hangup не заявляется,
   TTS остаётся один на closing плюс один на disclosure.

Сначала четыре точечных проверки прошли без production-изменений. Затем полный
целевой набор **331 / 331**, оба файла успешны; API `tsc --noEmit` успешен:

```powershell
# Из apps/api
node node_modules/vitest/vitest.mjs run src/voice/unified-live-call.test.ts src/voice/openai-live-bridge.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

Предыдущие 882 теста этапа E здесь заново не запускались; число 331 относится
только к текущему прогону. Повторная сборка не нужна: production-файлы после E
не изменились. `git diff --check` успешен. Реальные звонки, paid provider eval,
деплой и изменения БД не выполнялись.

Механизм повтора исследован; улучшение поведения не объявляется реализованным.
Следующий этап G — диагностика частичного playback. Она поможет обосновать
последующее решение о восстановлении прерванной речи, сохраняя честное ограничение:
точный услышанный префикс без надёжных данных неизвестен.

## G. Диагностика частичного application playback

### Выбранная граница изменения

До правки проверены текущие playback gates, native capture, transcript composer,
telemetry contracts, storage и export. Существующий composer принимает application
текст после актуального mark; прерванный клип оставляет `application_interrupted`
и partial coverage. Эти правила сохранены.

Добавлена optional `playback` metadata существующего `conversation.task`:
`phase:speak`, `cause:application_playback`, `revision:<generation>`. Новое имя
события, таблица или миграция не нужны. На попытку сохраняется одна terminal
snapshot после отмены или принятого mark, вместо отдельных DB writes для каждого
этапа или audio frame.

| Поле | Значение |
| --- | --- |
| `markId` | Техническая связь с application transcript receipt |
| `owner` | appointment / closing / failure |
| `requestedAt` | Создана попытка воспроизведения |
| `renderedAt` | Аудио готово, в том числе при использовании кеша; отсутствует до готовности |
| `releasedAt` | Начата отправка клипа в транспорт; отсутствует, если попытка отменена раньше |
| `endedAt` | Принят актуальный mark либо попытка отменена |
| `durationMs` | Длительность готового клипа; null до готовности |
| `outcome` | acknowledged / interrupted / not_released |
| `reason` | mark, acoustic_activity, recipient_transcript, stale, render_failed, deadline, superseded, closed, action_cancelled |

`interrupted` означает released без принятого completion mark. Он не доказывает,
что весь клип или конкретный префикс был услышан. `acknowledged` использует прежнюю
проверку current/generation/mark; stale и duplicate marks не создают успешную
snapshot. Текст, heard prefix, audio, prompt, ошибки провайдера и имена участников
не включены. Для pre-consent playback diagnostic snapshot вообще не создаётся.

### Защита рабочего runtime

В `unified-live-call.ts` сохранены порядок render/release/clear/resolve/hangup,
порог VAD, timers, gates и callback условия. Добавлены только in-memory timestamps
и классификация причин при уже существующих переходах. Закрытие по исходному
closing deadline помечается `deadline`; disconnect — `closed`.

Дополнительная запись выполняется асинхронно через service с существующим
idempotency key, без await в voice path. Она намеренно не использует обработчик
ошибок основной telemetry, закрывающий звонок: сбой diagnostics даёт только
фиксированный warning `LIVE_PLAYBACK_DIAGNOSTIC_FAILED`, без raw error message.
Зависшая запись не блокирует playback, transcript receipt или hangup. Реальная
добавочная нагрузка — одна небольшая DB insert на попытку, а не нулевой overhead;
production latency под нагрузкой в этом этапе не измерялась.

Это best-effort диагностика. При process crash или failed write terminal snapshot
может отсутствовать. Нет retries, нового worker, ASR или provider calls. Отсутствие
snapshot не реконструируется как успешное воспроизведение.

### Контракт, export и retention

`applicationPlaybackDiagnosticSchema` — строгая схема с enum reasons, bounded
mark, ISO timestamps и конечной неотрицательной длительностью. На export nested
allowlist удаляет лишние playback fields и отклоняет невалидные значения.
Старые события без optional playback сохраняются без добавления полей.

Новый payload проходит существующий PostgreSQL storage без миграций. Проверена
идемпотентность одинакового ключа, сохранение attempt binding и выгрузка ровно
одной записи в ZIP с проверенными manifest checksums.

Следует существующей политике retention `call_events`: технические события без
содержимого могут оставаться после удаления содержимого звонка. Integration test
подтвердил, что transcript revisions/attempt content удалены или исключены,
предыдущие exports отозваны, а техническая playback metadata остаётся. Это не
новая политика хранения и не продление retention аудио/текста. Account deletion
и authorization/revocation проверки существующего export suite также прошли.

### Проверки

Baseline G: **318 / 318**, четыре файла — unified live call, call telemetry,
native transcript storage, export source inventory.

Добавлены девять runtime-сценариев и усилены две существующие pre-consent проверки:

- interrupted closing → cached replay → единственный acknowledged transcript;
- cancellation до render и отмена rendered клипа, ещё удерживаемого за речью;
- render failure → успешный retry с разными честными outcomes;
- pending/rejected diagnostic write не блокирует hangup и не пишет raw error;
- interrupted appointment остаётся uncertain, без повторного действия;
- deadline/disconnect не превращаются в acknowledged;
- отказ в согласии и ошибка запуска записи не создают playback diagnostics.

В первом тестовом прогоне capture-gap assertion был проверен до финализации
native session. Fixture исправлен: проверка выполняется после `session.closed`.
Production capture/composer для прохождения теста не менялись. Диагностика
interrupted сохраняет `application_interrupted`; полный текст появляется только
после актуального mark, ровно один раз. Размер synthetic snapshot < 700 байт.

Финальные наборы:

- API: **915 тестов / 35 файлов**, включая voice, authorization, consent, closing,
  transcript, summary, storage и export mapping; 29,64 с.
- Contracts: **255 тестов / 25 файлов**, включая старые telemetry события,
  запрет текста/аудио и невалидных playback значений.
- PostgreSQL export: **18 / 18**, 10,41 с, случайная отдельная fixture БД.
- API/contracts typecheck и обе сборки успешны; `git diff --check` успешен.
- После общего прогона добавлены assertions об отсутствии diagnostics в двух
  существующих pre-consent тестах; оба отдельно повторены успешно. Production
  code после общего прогона не менялся.

Итого **1188 уникальных тестов успешны**; повторные точечные прогоны не суммируются.

Основная API команда из `apps/api`:

```powershell
$testPaths = @(rg --files src/voice src/realtime src/text-processing src/appointments src/credits | Where-Object { $_ -match '\.test\.ts$' -and $_ -notmatch '\.integration\.test\.ts$' })
node node_modules/vitest/vitest.mjs run @testPaths src/storage/final-assessment.test.ts src/notifications/user-call-email.test.ts src/storage/call-telemetry.test.ts src/storage/native-transcript.test.ts src/telemetry-export/source-inventory.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

PostgreSQL integration сначала не стартовал: sandbox запрещал localhost network,
а разрешённый повтор показал ECONNREFUSED на настроенном порту 55432. Read-only
Docker inspect/list обнаружил существующий healthy local PostgreSQL на 5543.
Для тестового дочернего процесса изменён только порт в проверенном
`TEST_DATABASE_URL`; сам URL/пароль не выводился. `isolatedTestDatabase()` создал
`callassist_fixture_<random>_test`, применил миграции только туда и удалил только
эту БД после suite. Рабочая DB, конфигурация приложения и контейнеры не менялись.

Contracts собраны обычной установленной tsup CLI. Все 13 API entry points собраны
в `.tools/real-call-build-2026-11-02/g-playback-diagnostics` с исходным config,
последовательным созданием каталогов и `clean:false` из-за ранее установленного
Windows EPERM; migration/OG assets скопированы. Production не обновлялся, реальные
звонки и paid provider eval не выполнялись.

### Выпуск и возврат

Reader contract и export allowlist должны выйти вместе с writer либо раньше.
Старые данные совместимы с новым reader; прежний strict reader не понимает новое
optional поле. При rollback сначала отключить emission, сохранив поддержку
чтения уже сохранённых playback metadata. Не удалять аудит и не откатывать весь
checkout с предыдущими A–F исправлениями. Новых схем БД и background jobs нет.

Этап G реализован локально. Диагностика объяснит будущие отмены playback, но не
восстановит отсутствующие события исторического звонка и не исправляет сама по
себе повторы прощания. Результат следующего этапа H описан ниже.

## H. Необязательные сведения перед записью в клинику

### Решение и границы изменения

В исследованном звонке клиника спросила дату рождения и был ли предыдущий визит.
Этих сведений не было, но запись состоялась. Поэтому дополнительные обязательные
поля и новая блокировка подготовки не нужны.

В `apps/web/components/create-call-form.tsx`, рядом с существующей разрешённой
информацией в дополнительных настройках, добавлена свёрнутая подсказка:

- можно указать дату рождения, если пользователь разрешает её сообщить;
- можно указать, был ли представляемый человек в этой клинике раньше;
- оба пункта можно пропустить либо явно написать «не знаю» или «не передавать»;
- медицинские подробности, не относящиеся к записи, добавлять не нужно;
- перед утверждением следует проверить подготовленный план.

Это подсказка к свободному вводу, а не структурированная анкета. Новых полей,
значений по умолчанию, обработчиков отправки, эвристики распознавания клиники и
автоматического переноса текста нет. Сведения, введённые пользователем, остаются
видимыми и редактируемыми в прежнем textarea; далее идут по прежнему пути
`allowedFacts → compiled.approvedFacts → approval → executionSnapshot`.
Пустой ответ не создаёт ни первого визита, ни отказа сообщить данные.

Добавлен `clinic-preparation-messages.ts` с EN/DE и шесть фраз в каждом из
каталогов FR/IT/RM/RU/UK. Новое пространство сообщений включено в общую проверку
полноты локализации. В API изменены только тесты: production compiler, prompt,
контракты, БД, timers, Live/TTS, consent и модели на этапе H не менялись.
Старые утверждённые snapshots не пересчитываются.

### Baseline и проверки

До изменений H на текущем checkout с A–G:

- Web: **405 / 405**, 72 файла, 25,12 с.
- Appointment compilation, brief compiler, compilation integrity: **88 / 88**,
  3 файла, 10,90 с.

Добавлены 14 тестов:

- 7 UI тестов по локалям, каждый проверяет пять состояний фактов для записи и
  обычного запроса информации: пусто, DOB + повторный визит, первый визит,
  неизвестность, запрет передачи. Проверяют текст подсказки, отсутствие новых
  контролов ввода, точное содержимое редактируемого поля, доступную кнопку
  подготовки и неизменность исходного input. Проверка отображения — React SSR;
  отдельный интерактивный браузерный прогон не проводился.
- 5 API тестов этих состояний: production parser/validator с подставленным
  provider response → готовность к review → in-memory repository → обычное
  утверждение → execution snapshot. Проверяются точные факты, отсутствие новых
  blocking issues, hash, сохранение appointment authority и невозможность
  execution snapshot до утверждения.
- 2 отрицательных API теста: добавленные моделью «первый визит» или запрет
  передачи при отсутствующем ответе отклоняются как `fact_integrity_failure`.
  Проверка относится к `approvedFacts`, не ко всем возможным репликам модели.

Финальные команды из `apps/web`:

```powershell
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js components/create-call-form.tsx lib/clinic-preparation.test.tsx lib/i18n/clinic-preparation-messages.ts lib/i18n/localization.test.ts
```

Из `apps/api`:

```powershell
node node_modules/vitest/vitest.mjs run src/brief-compiler src/voice/unified-live-call.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

Итог: **412 web тестов / 73 файла** и **548 API тестов / 12 файлов**, всего
**960 уникальных успешных тестов**. Web/API typecheck, lint затронутых web TS/TSX
и `git diff --check` успешны. Общие suites включают review/approval, frozen legacy
snapshot hashes, язык исполнения, подготовку и голосовой рантайм с consent,
appointment, closing и новой G-диагностикой.

В первом расширенном API прогоне 547 тестов прошли, один существующий тест
`request-diagnostics.test.ts` получил `connect EACCES` к собственному временному
HTTP-серверу на `127.0.0.1`. Причина — сетевое ограничение sandbox. Повтор файла
с разрешённым локальным доступом дал **4 / 4** (1,16 с); внешние сервисы и рабочая
БД не использовались. Повторные тесты не добавлены к числу уникальных.

### Статус и оставшаяся приёмка

H завершён локально. Новых запросов к моделям и изменений пути живого звонка нет.
Тесты compiler используют фиксированный provider output и mock language audit;
они проверяют сохранение фактов и утверждение, а не способность живой модели
правильно обработать каждую неизвестность или запрет. Нельзя по этим проверкам
обещать успешную запись без даты рождения в любой клинике.

Перед выпуском изменений предыдущих этапов остаются контролируемые разговорные
прогоны и сравнение baseline/candidate по правилам плана, особенно приёмка D.
Политика повторного прощания F сознательно не изменена: для неё требуется отдельное
решение с проверкой barge-in и существенных поправок. G добавляет будущую диагностику,
но не восстанавливает отсутствующие исторические данные.

Production rollout, новый телефонный звонок, paid model eval и пересчёт старых
результатов не выполнялись. Откат H — удалить только UI-подсказку и её сообщения;
уже введённые и утверждённые пользователем сведения остаются обычными facts,
миграция или переписывание snapshots не нужны.

## Подготовка контролируемой разговорной приёмки

По следующему поручению подготовлен [протокол](voice-acceptance-protocol-2026-11-02.md),
JSON-каталог 10 сценариев и офлайн-генератор журнала. 17 условий учитывают два consent
режима, de-CH/ru-RU, другой timezone и confirm_existing. По пять пар на условие:
85 пар / 170 попыток полной матрицы. Это расчёт объёма, не разрешённый лимит
платных звонков; первые шесть smoke-пар входят в него. У каждой попытки отдельные
evidence/metrics/checks, исходный статус not_run. Номер получателя отсутствует,
данные синтетические, внешнее выполнение не авторизовано.

Сгенерирован локальный `.tools/voice-acceptance-2026-11-02/worksheet.json` для
вымышленной даты 2026-11-10; перед настоящей сессией проверить актуальность даты.
Генератор не загружает окружение, не вызывает API/БД/провайдеров и не имеет start.
Протокол объясняет границы существующего voice smoke: фиксированный вопрос о
слышимости и обязательный AMD=human не являются общей приёмкой текущего runtime.
Существующий smoke не изменён.

Проверки при подготовке: **781 тест / 21 файл** (voice, realtime, appointments,
summary-calendar, smoke unit; 25,28 с) и **7 / 7** тестов нового генератора.
Запущена реальная генерация локального журнала. Production/runtime code,
процессы, конфигурация, БД и телефония на этом шаге не менялись. Контролируемые
телефонные разговоры, baseline build и paid model eval не выполнялись.
Допуск к выпуску остаётся открытым до сопоставимых разговорных результатов.

## Прогон без телефонных звонков, лимит $5

По прямому разрешению пользователя выполнен платный synthetic model smoke:
16 Luna requests и 6 Live sessions, 3 синтетические TTS-реплики. Подробный
[отчёт](voice-no-call-results-2026-11-02.md) фиксирует scope, evidence, ограничения
и бюджет. Оценка расхода $0.114207; консервативные резервы $1.43 из $5.
Телефонных звонков и исполненных appointment tools нет.

Получены два backend-сигнала: преждевременный request при вопросе о предыдущем
визите у обеих версий и ошибочный confirm_existing в candidate status_check.
На фактических аргументах штатный validator отклонил второе с operation_mismatch.
Голосовой client-handoff стенд дал лишние вступления/обрезание по собственному
deadline; эти попытки не засчитываются как полноценная production voice приёмка.
Решение hold; полная платная серия остановлена после smoke. Production-код не
менялся. 3 budget tests и 389 authorization/runtime tests успешны.

## Исправление двух сигналов после полного runtime replay

Следующим поручением разрешены воспроизведение и минимальные исправления без
телефонных звонков, в остатке того же $5. Оба сигнала подтверждены через полный
in-memory runtime: преждевременная просьба записать пациента действительно создаёт
voice action, а ошибочная смена operation безопасно отвергается и мешает recovery.

Production diff этого шага — только `live-managed-tools.ts`: scoped operation enum
для обеих appointment tools и узкая инструкция отвечать на отсутствующие факты
до записи. При явной невозможности предоставить обязательный факт — корректное
завершение; известные факты отвечаются без нового шага ожидания. Validator, output
fence, journal, consent и таймеры сохранены.

Финальный `fix-4`: по **5/5** корректных candidate решений на обоих исходных
сценариях; известная DOB **5/5**, недоступная обязательная DOB **3/3**. Промежуточные
варианты с лишними уточнениями/ожиданием не приняты. Все **22 candidate outputs**
проверены в in-memory runtime: **27 replays**, включая оба начальных состояния
status check; ещё одна проверка обеспечивает полноту fixture. Полная регрессия —
**947 тестов / 35 файлов**, budget helper **4/4**. Подробности, команды и ограничения:
[дополнение к отчёту](voice-no-call-results-2026-11-02.md#продолжение-воспроизведение-и-минимальные-исправления).

Добавлено 170 ограниченных Responses requests; оценка накопленного расхода всей
серии **$0.143322**, общий не возвращаемый резерв **$4.83/$5**, остаток для новых
резервов **$0.17**. Телефонных вызовов и внешних записей нет. Нет deployment/restart.
Model+runtime replay не закрывает акустическую приёмку: release остаётся hold.

## Закрытие предкоммитного аудита, 4 ноября 2026

Аудит выявил три воспроизводимых дефекта: административные чтения падали на
архивном runtimeVersion; budget test использовал node:test внутри Vitest suite;
baseline loader терял новые импорты. Все три исправлены.

### Административные чтения и архивы

История, административный список, Inspector, operations и outcome metrics
используют общую read-only проекцию телеметрии. Неподдерживаемая диагностика
не участвует в вычислении результата; исходный eventSequence сохраняется.
Inspector показывает, сколько записанных событий отображается, и сообщает о
неподдерживаемых архивных диагностических событиях. Исходные записи не удаляются
и сохраняются в штатном экспорте. Схема API не расширялась: используются уже
имеющиеся eventCount и timeline.length.

Несовместимая assessment revision отображается как unavailable, без подстановки
старого achieved. Флаг совместимости передаётся и в транзакционные чтения.
Исполнение, запись событий, кредитные решения и повторный запуск сохраняют
строгую валидацию. PostgreSQL-регрессия проверяет неизменность ciphertext и
кредитных транзакций после просмотра.

Просмотр чувствительного содержимого администратором также больше не загружает
исполняемый snapshot ради текста: читает только необходимые сохранённые поля,
транскрипцию и комментарий. Проверка доступа на API, требование причины и аудит
доступа сохранены. Native transcript имеет прежний приоритет: отсутствие native
результата не подменяется recording ASR. Эти случаи проверены на временной БД.

Read-only проверка локальных архивов: все 143 административные карточки на двух
страницах открываются; 19 имеют неполную диагностическую ленту. Пользовательская
история: 141 запись на 8 страницах. Последний Inspector содержит 57 событий,
включая 4 playback diagnostic. Все 44 источника экспорта за проверяемый период
проходят штатные sourceQuery/mapExportRow. Это локальная проверка, не проверка
содержимого production БД.

### Тестовый стенд

Budget tests переведены на Vitest и входят в полный API test command.
Baseline loader переносит полные модули, поддерживает оба вида кавычек и
связывает Live с выбранным baseline tools module. Не создаёт runtime и не
инициирует звонок. Общие вспомогательные модули/contracts по-прежнему текущие:
это сравнение prompt functions, не сборка исторического runtime.

Offline-тесты реально загружают и вызывают обе инструкции для HEAD и текущих
исходников, проверяют сохранение baseline binding и отказ при перезаписи
артефакта другим исходником. Preflight вызывает builders всех десяти контекстов
до платной фазы. Фактический preflight: 0 provider requests, 0 reservations,
0 phone calls. Остаток ранее выделенных $5 не расходовался.

### Итоговые проверки

- Полный API: **2112 тестов / 168 файлов**, все успешно; 402,86 с.
- После последней правки просмотра архивного содержимого повторены PostgreSQL
  repository, history и telemetry export: **46 тестов / 3 файла**, все успешно.
  Они входят в число API-тестов выше и не суммируются повторно.
- Полный web: **415 тестов / 74 файла**, все успешно.
- Contracts: **255 тестов / 25 файлов**, все успешно.
- Root Node script tests: **10/10**; budget tests теперь учитываются в API.
- API/web/contracts production builds, API/web typecheck, web lint,
  public copy check, license check и git diff --check — успешны.

API tests выполнялись через scripts/test-isolated.ts на случайной временной
PostgreSQL базе с суффиксом _test. Рабочая база не изменялась. Web собирался в
отдельном NEXT_DIST_DIR. Сгенерированные локальные пути удалены из next-env.d.ts
и tsconfig.json перед коммитом. Подробные логи находятся в игнорируемой .tools:
fix-full-api-tests-20261104.log, fix-admin-final-regression-20261104.log,
fix-full-web-tests-20261104.log, fix-contracts-tests-20261104.log.

### Условия выката и отката

1. Зафиксировать весь согласованный набор исходников, включая новые shared
   instructions, history-read-model, baseline helper и их тесты. Не включать
   .tools, локальные env, временные Next-каталоги или реальные данные звонков.
2. Пройти CI и собрать API, worker, web и contracts из одного commit SHA.
   Новых миграций этот шаг не добавляет. Обновление зависимостей перед выпуском
   зафиксировано в разделе ниже.
3. Перед заменой процессов завершить активные звонки и остановить приём новых
   задач штатным механизмом; не обрывать активный voice runtime перезапуском.
   Выпускать API/worker/web согласованно: readers должны понимать playback
   diagnostics и summary-v5 до поступления новых данных.
4. После запуска проверить readiness, worker heartbeat, историю, админ-список,
   карточку и экспорт. Проверки не должны инициировать новый звонок или запись.
5. При откате голосового поведения сохранить совместимые readers для уже
   записанных playback diagnostics и summary-v5. Возврат целиком к старому HEAD,
   который этих данных не понимает, не является безопасным откатом. Не менять
   утверждённые snapshots и не пересчитывать старые списания.

Предкоммитные дефекты закрыты. Это не заявление, что production уже проверен
или выкат выполнен: commit, deployment, restart, реальные звонки и новые платные
модельные прогоны на данном шаге не выполнялись. Новая инструкция ролей остаётся
в исходниках до отдельного включения. Регрессионные тесты не гарантируют каждую
формулировку реальной модели; ранее описанные границы акустической приёмки
остаются в силе.

## Обновление зависимостей перед выпуском — 2026-11-04

CI коммита `60d72e4` остановился на security audit: 28 уязвимостей, включая
критическую в Next.js. Аудит остался строгим (`--audit-level low`), исключения
для advisories и подавление ошибок не добавлялись.

Зафиксированы Next.js / eslint-config-next **15.5.29**, Fastify **5.12.8**,
Zod **4.6.6**, Vitest **4.1.12** и его Vite peer **7.3.7** во всех трёх
тестируемых пакетах. Точечно обновлены fast-uri, follow-redirects, qs и
зависимости glob/minimatch. Next.js и Fastify включают также исправления,
вышедшие после исходного CI:
[Next.js 15.5.29](https://github.com/vercel/next.js/releases/tag/v15.5.29),
[Fastify 5.12.8](https://github.com/fastify/fastify/releases/tag/v5.12.8).

Совместимость инструментов разработки:

- Существующий scoped alias fast-glob → glob обновлён до glob 14.0.2;
  прежний патч выбора каталогов перенесён на Next ESLint 15.5.29.
- Исправленной старой ветки minimatch нет. Версия 11.0.1 получила только
  совместимые callable CommonJS / default ESM exports; алгоритм сопоставления
  и исправления безопасности не изменены.
- В eslint-plugin-import вызовы удалённого makeRe заменены на кешированные
  Minimatch.match. Для скрытых путей теперь действует стандартная семантика
  match; затронутое правило no-internal-modules в конфигурации проекта не включено.
- Семь новых offline-тестов проверяют реальные правила import/react/jsx-a11y,
  ESM loaders и Next root lookup. Они добавлены отдельным обязательным шагом CI.
  Совместимые exports и патч import можно убрать вместе с override minimatch,
  когда upstream ESLint-потребители перейдут на исправленную совместимую версию.

Бизнес-логика звонков, промпты, контракты приложения и миграции не менялись.
Установленный набор прошёл security audit без известных уязвимостей.
Локальная проверка проводится в `.tools/dependency-validation-20261104`;
API использует отдельную случайную тестовую БД. Проверка архивных данных
принудительно read-only: 51 успешная проверка, включая 141 запись истории,
143 карточки админки и 44 источника экспорта телеметрии.

Локальные результаты на обновлённом lockfile:

- API: **2110 тестов / 167 файлов** из Git; все успешно. Прежние 2112/168
  включали ещё два локальных диагностических теста из игнорируемой `.tools`.
  Они отдельно повторены на новых пакетах и также прошли; тесты не удалялись.
- Web: **415/74**; contracts: **255/25**; root Node tests: **17/17**, включая
  семь новых проверок совместимости зависимостей.
- TypeScript всех пакетов, web lint, production builds contracts/API/worker/web,
  license check, public copy check и `git diff --check` — успешны.
- В основном локальном checkout выполнен `pnpm install --frozen-lockfile`;
  семь проверок совместимости повторены уже на его зависимостях.

Платные модельные запросы, реальные звонки и production deployment не выполнялись.
CI должен подтвердить этот же lockfile на Linux / Node 22.19 перед выпуском.
