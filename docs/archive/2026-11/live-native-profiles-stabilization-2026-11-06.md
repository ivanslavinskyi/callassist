# Native GPT-Live: профили и стабилизация перед телефонной приёмкой

> **Archived on 2026-11-08.** Historical design, investigation or verification record.
> Original dates, language and acceptance scope are preserved; this is not the current specification.
> Use the [documentation index](../../README.md), [native runtime](../../native-live-runtime.md)
> and [validation guide](../../native-live-validation.md) for maintained behavior and remaining checks.

> Обновление 7 ноября: первый реальный тест выявил отсутствие fallback завершения в профиле general при пропущенной delegation. Подробные доказательства и воспроизведение — [отдельный аудит](live-native-general-hangup-audit-2026-11-07.md). Приведённые ниже 7/7 относятся к синтетической функциональной серии и не закрывают этот дефект.

Рабочая ветка: `codex/live-audit-validation-2026-11-05`. Версия поведения: `live-native-profiles-2026-11-06`. Работа локальная; реальных звонков, внешних бронирований и production rollout в этой проверке нет.

Этот документ продолжает [аудит целостности](live-native-consistency-audit-2026-11-06.md) и [план v2](live-native-v2-implementation-plan-2026-11-06.md). Устранение воспроизводимых ошибок и зелёные тесты не заменяют акустическую приёмку P7/P8.

## Один runtime, составные инструкции

Подготовка уже семантически определяет операцию и предлагает полномочия для утверждения. Runtime выбирает профиль из **утверждённой authority**, без дополнительного классификатора или запроса модели:

| Профиль | Возможности | Специальная инструкция |
| --- | --- | --- |
| general | end_call, stop_and_discard | Ответы из исходных фактов, без полномочий на appointment actions |
| book | Общие + prepare_appointment, record_appointment_result | Одна новая запись в разрешённых пределах |
| confirm_existing | Те же action tools | Только подтверждение существующего приёма |
| reschedule | Те же action tools | Подтверждённая замена; отдельная предварительная отмена запрещена |
| cancel | Те же action tools | Только отмена указанного приёма |

`get_task_context` присутствует только при наличии утверждённых optional sections. Основная цель, исходный контекст, факты, ограничения и условия действий остаются в startup. Профиль уменьшает процедурные инструкции, а не полноту задания.

Короткий Live prompt содержит роль, язык/обращение, вступление, правила перебивания и конкретные условия делегирования. Детальная проверка предложения, буквальных цитат, альтернатив и результата находится в backend prompt. Для передачи работы используется документированный маркер `Generate <|SpawnThinking|>`. Основание: [GPT-Live prompting](https://developers.openai.com/api/docs/guides/live-prompting).

Вступление присутствует в developer startup message и однократно отправляется как commentary после допуска телефонного потока. Содержит выбранную причину помощи, представляемое лицо, AI identity, уведомление о записи и вопрос об удобстве. После ответа — цель без повторной проверки удобства. Семантика подтверждения записи не подменяется согласием на запись разговора.

Заключение — главный результат **для представляемого лица**, благодарность и прощание. В технических инструкциях разделены фиксация результата действия и отключение после уже произнесённого заключения.

## Что исправлено

| Пункт аудита | Реализация и граница проверки |
| --- | --- |
| A1: incomplete блокирует следующие continuations | Pending calls привязаны к response. Для незавершённых функций возвращается явный результат о неисполнении; IDs освобождаются, continuation возобновляется. Частичные аргументы не исполняются. Повторные ошибки ограничены; физически зависший run не разрешает дублировать действие. |
| A2: ответное прощание стирает closing | Новая речь отзывает разрешение на отключение, но сохраняет наблюдавшийся заключительный текст. После новой проверки можно использовать прежнее прощание без повторного произнесения. Старый mark не отключает линию. |
| A3: любое старое аудио считается заключением | end_call требует наблюдавшуюся цитату заключения и цитату последнего ответа. Весь последующий аудиохвост проходит playback drain. Смысл заключения определяет backend; host проверяет наблюдаемость текста и playback, а не семантику отдельной моделью. |
| A4: потеря input во время admission | После проверки stream token ранние кадры буферизуются в пределах 128 KB и передаются по порядку только после полного admission. Повторный start, переполнение и закрытие не выпускают очередь. |
| A5/B1: несовместимые бюджеты | Один builder Responses configuration используется runtime и синтетическим harness. Общий профиль: 2048 output tokens; action profiles: 4096 + 256 на условие, максимум 16384. Transport допускает 425984 символа arguments, включая худший JSON escaping всех schema maxima. Это предел аргументов, не обещание вместить максимальные цитаты в output tokens. |
| B2: перегруженный Live prompt | Общие правила беседы и короткий блок только разрешённой операции. Полные процедуры, проверки цены/времени/альтернатив и recovery находятся в backend. Исходные факты сохранены. |
| B3: opening bootstrap | Одна opening-инструкция в developer input и идентичная commentary после admission. До неё Live ожидает media-ready; после ответа readiness не задаётся повторно. Синтетический general probe отдельно выдерживает prewarm и проверяет отсутствие преждевременной речи. |
| B4: playback_pending без уведомления | Изменения action journal передаются Live и backend сообщением состояния. Быстрое подтверждение ограниченно ждёт playback mark, не удерживая mutation queue; просрочка, interruption и shutdown сохраняют неопределённость. |
| B5: устаревшее продолжение | Старое решение по-прежнему не исполняется. Перед обновлённым continuation backend получает новые transcript fragments; при потере полного буфера требуется новая delegation. Только это восстановление ждёт окончания входной речи и 750 ms тишины транскрипта, чтобы не рассуждать по половине предложения. Обычная речь не задерживается. Stale result объясняет, что это обновление наблюдений, а не запрет операции. |
| B6: задержка из-за accounting | Native v2 отделяет последовательную запись provider usage от очереди transcript evidence. Action journal и terminal decision сохраняются до эффекта. Legacy очередь не изменена. Обычные tools пока исполняются после response.completed; раннее исполнение остаётся только у stop_and_discard. |
| B7: compiler composition | Общие, opening и appointment блоки собираются явно, без regex-редактирования итогового prompt. SHA-256 тесты подтверждают побайтную сохранность всех трёх закреплённых preparation policies. |
| B7: UI/финансы/DTMF | Review явно показывает максимум один приём и отсутствие права на платежи/депозиты/новые условия. Runtime различает цену услуги и платёж. DTMF не превращается неявно в yes/no. |
| B7: identity | Descriptor закрепляет profile, startup/backend/tools hashes, output budget, argument limit, closing/trace/recording policies; локальный sourceDigest покрывает исходники. Восстановление не подменяет сохранённое поведение новой конфигурацией. Старые readers сохраняются. |

Для `first_matching` подходит первое предложенное время, удовлетворяющее условиям. Это не требование искать самое раннее время. `earliest_day`/`earliest_available` требуют отдельных наблюдений. Цитаты — буквальный текст, без пояснений вокруг. Ошибка формата цитаты исправляется по уже известному транскрипту; она не требует повторного вопроса человеку.

Результат действия ссылается на `actionId` и номер `episode`. Backend больше не обязан перепечатывать 64-символьный proposal hash: hash продолжает связывать предложение в durable journal, а ID/episode исключают применение результата к другой операции. Неверная ссылка возвращает текущую для повторной проверки; host не перепривязывает результат автоматически.

`recipientQuote` содержит фактическое подтверждение, `latestRecipientQuote` — последнюю наблюдаемую реплику. Ответное «спасибо» не стирает подтверждение; более поздняя содержательная поправка должна учитываться при `detailsMatch`. Обе цитаты проверяются по наблюдаемому транскрипту. При восстановлении `status_check` того же hash-bound предложения использует ранее сохранённые проверенные данные, не требует прежнего транскрипта в новой сессии и не повторяет обязательство.

### Ограниченная проверка границ действия

В реальных модельных прогонах результат действия иногда фиксировался, Live произносил прощание, но не делегировал `end_call`. Одно сообщение `session.thinking.append` не решило проблему: два повторения снова зависли. Поэтому после **confirmed action**, если завершение ещё не разрешено, input не активен, backend свободен и прошло 2 секунды без новой речи, host однократно запрашивает backend review через `response.item.create` + `response.create`. Это документированный запуск backend в сохранённой конфигурации: [GPT-Live primary WebSocket](https://developers.openai.com/api/reference/resources/live/primary-websocket), [delegation](https://developers.openai.com/api/docs/guides/live-delegation).

Дополнительное повторение cancel выявило вторую границу: запрос уже произнесён, собеседник подтвердил отмену, но Live не делегировал фиксацию результата. Поэтому такая же ограниченная проверка применяется к **delivered action**, только после новой реплики собеседника относительно момента авторизации. Backend проверяет, есть ли фактический результат; host не считает речь подтверждением автоматически. Событие — `appointment.backend_review`. До ответа человека эта проверка не запускается.

Review получает свежий наблюдаемый транскрипт как данные. Он не задаёт текст прощания, не разрешает действие или отключение таймером, не повторяет речь и не применяется на каждом ходе. `record_appointment_result` и `end_call` проходят обычные проверки цитат, актуальности, durable journal/terminal decision и playback. Если вопрос остался открытым, его решает Live. Запрос ограничен **одним на границу delivered и одним на confirmed для каждого action ID/episode**; повторяющегося фонового планировщика нет. Корреляция явного response допускается только по отслеживаемому `client_event_id`, а не по произвольному ответу без delegation ID. При closing в trace записывается `closing.backend_review`.

Поздние backend notes трактуются как обновление состояния: они не должны повторно диктовать уже произнесённый запрос. Live явно получает запрет описывать только авторизованную операцию как уже выполненную. Это усиление инструкций по результатам просмотра транскриптов, а не детерминированная гарантия смысла произнесённой речи; P8 включает отдельную семантическую приёмку.

Схема календарных и ценовых проверок не расширена. Подтверждение в журнале по-прежнему означает `recipient_statement`, `independentlyVerified: false`, а не внешнюю проверку календаря.

## Телеметрия, хранение и совместимость

Подробный Live trace остаётся отдельным ограниченным асинхронным каналом. Audio сохраняется как агрегаты кадров/байтов, payload credentials исключаются, разговорные payloads шифруются хранилищем. Потери очереди отражаются в manifest; полнота не объявляется при потерях или неподтверждённом завершении сессии.

Изменения не добавляют миграций. Проверены существующие privacy/discard/export/descriptor integration cases в отдельной временной PostgreSQL базе: **22/22**. Проверка чтения исторической локальной копии: **142/142 карточки**, **49517 записей / 50 источников экспорта**, ошибок нет. Этот набор содержит compiled schemas 3–7 и approvals 1–6; новые схемы покрываются отдельными fixtures.

Отказ сохраняет приоритетный stop_and_discard. Durable cleanup восстанавливается после перезапуска в обычном режиме и повторяется при поздних callbacks; выключение native режима не выключает cleanup workers/readers.

## Воспроизводимые проверки

Baseline до изменений: `.tools/native-stabilization-baseline-20261106/`. Предыдущие изменения ветки не сбрасывались. Три pinned preparation prompt hashes сохранены в `compiler-instructions.test.ts`.

Проверки выполняются установленными локальными binaries, без обновления зависимостей:

```powershell
# Из apps/api; сетевой тест использует только временный loopback HTTP server.
node node_modules/vitest/vitest.mjs run src/voice src/brief-compiler src/appointments src/text-processing/native-summary-source.test.ts --exclude '**/*.integration.test.ts'
node node_modules/typescript/bin/tsc --noEmit

# Настоящие GPT-Live / Responses, вымышленные данные, in-memory repository,
# синтетический собеседник и эмуляция Twilio playback. Телефон не набирается.
node --use-system-ca --import tsx scripts/probe-native-profiles.mjs general book confirm_existing reschedule cancel refusal complex
```

Harness вызывает production NativeLiveV2Call и общий config builder, проверяет actual tool loop и journal, а не только session.started. TTS используется только для тестового собеседника; голос ассистента генерирует GPT-Live. Windows system CA включена без отключения проверки TLS. Синтетические transcript/trace/audio артефакты находятся в ignored `.tools/native-profiles-provider-results/`.

Промежуточные прогоны нашли ошибки тестового собеседника и реальные недостатки инструкций: повтор readiness, смешение first_matching с earliest, неверную трактовку stale rejection, отсутствие delegation после результата. Неудачные прогоны не считаются acceptance. Они сохранены отдельно от окончательных результатов. Harness ожидает итоговый manifest до 4 секунд, учитывая 2.5-секундный runtime drain; при отказе trace должен удаляться, manifest не требуется.

## Проверки и локальное включение

| Проверка | Результат |
| --- | --- |
| API voice / compiler / appointments / native summary | **818/818**, 37 файлов; окончательная версия |
| PostgreSQL privacy / exports / descriptor | **22/22**, 3 файла; отдельная временная БД |
| Web appointment UI / plan projection | **16/16**, 2 файла |
| TypeScript API и web | Успешно |
| Production build API и web | Успешно; web собран в отдельный `.next-native-profiles-20261106`, действующий dev server не затронут |
| Чтение исторических карточек / export sources | **142/142**, **49517 строк / 50 источников**, без ошибок |

Первый полный модельный прогон `candidate-final-20261106` дал **6/7**: general, book, confirm_existing, cancel, refusal и complex прошли; reschedule зафиксировал результат, но не завершил линию. Попытка исправления пассивным thinking reminder дала **0/2** и была заменена. После явного backend review `candidate-review-20261106` дал **2/2** на book и reschedule. В обоих зафиксированы `confirmed`, один `closing.backend_review`, `mark_acknowledged`, `drained`, hangup; `response.incomplete` не было. Дополнительный `candidate-review-final-20261106` дал **4/5**: cancel остался в delivered, остальные прошли. Это привело к отдельной проверке delivered boundary и повтору всей матрицы, а не к признанию случайного успешного прогона гарантией устойчивости.

Окончательная **функциональная** матрица `candidate-boundaries-20261106`: **7/7 на одной версии исходников**. Критерии — завершение цикла, подтверждённое состояние action либо отказ/удаление; естественность и полнота семантики этим числом не оцениваются.

| Сценарий | Результат | Provider delegations / tool calls | incomplete |
| --- | --- | ---: | ---: |
| general | hangup, включая проверку silent prewarm | 1 / 2 | 0 |
| book | confirmed + hangup | 4 / 6 | 0 |
| confirm_existing | confirmed + hangup | 3 / 4 | 0 |
| reschedule | confirmed + hangup | 3 / 3 | 0 |
| cancel | confirmed + hangup | 4 / 5 | 0 |
| complex | confirmed + hangup; ordered alternatives, Dr Meyer, wheelchair access, CHF limit, finish deadline | 3 / 4 | 0 |
| refusal | discarded + closed | 1 / 1 | 0 |

Все пять action-сценариев использовали по одному `closing.backend_review`. В этой матрице дополнительный delivered review не понадобился; его условия и ограничение покрыты регрессией. В шести сохраняемых trace manifest: `complete: true`, `sessionClosed: true`, `dropped: 0`, `drainTimeout: false`. При отказе trace удалён, manifest отсутствует ожидаемо. Provider delegations не включают явный application review; число tools включает повторные попытки с исправлением аргументов. Эта серия не является оценкой частоты отказов или доказательством ускорения.

Окончательная идентичность API/contracts: `c89a2943e2492c9fbc768785805003bfbed233c779a2fc39b5245dcb465d98c5`. Продолжительность синтетических сценариев включает речь тестового собеседника и не используется как измерение задержки runtime.

Локальные API и worker перезапущены после проверки **0 calls / 0 preparations / 0 jobs**. Digest запуска совпал с указанным выше. Версия `live-native-profiles-2026-11-06`, режим `native_v2`, отдельная локальная БД `callassist_native_v2_20261106`. Web работает в dev-режиме и использует текущие исходники. Проверка 2026-11-06 20:06 UTC: API live/ready и web **200**, приватный маршрут туннеля **404**, неподписанный webhook **403**, подписанный пустой webhook **400** с ожидаемой ошибкой валидации. Звонки этими проверками не создаются.

Логи проверок: `.tools/native-stabilization-domain-tests-final.log`, `native-stabilization-postgres.log`, `native-stabilization-web-tests.log`, `native-stabilization-typecheck-final.log`, `native-stabilization-web-typecheck-final.log`, `native-stabilization-api-build-final.log`, `native-stabilization-web-build-isolated.log`. Модельные receipts — `summary-*.json` в каталогах прогонов `.tools/native-profiles-provider-results/`. Локальный health receipt — `.tools/runtime/native-actions-verification-20261106.json`.

## Что не заменяется автоматическими проверками

- P7/P8: прослушивание начала, перебиваний, результата и конца на настоящем телефонном маршруте; парное сравнение с контрольной сборкой, включая отдельные задержки до итоговой фразы и после прощания.
- Семантическое соответствие произнесённой речи утверждённым условиям. Буквальная цитата и Twilio mark не доказывают смысл и не являются событием окончания хода Live.
- Даже при успешном tool loop в синтетических транскриптах встречаются повторные acknowledgments, повторение запроса, служебные фразы перед проверкой, дополнительный короткий ответ после прощания и перечисление нескольких условий в complex closing. Предыдущий reschedule probe также содержал преждевременную формулировку результата; после него инструкции усилены, в окончательном reschedule запрос предшествует фактическому подтверждению. Это конкретные причины сохранять P7/P8 открытыми. По фрагменту caption нельзя объявлять отсутствие обрыва аудио; нужны WAV и настоящий телефонный маршрут.
- Нагрузочное сравнение latency с trace и без trace, множество одновременных звонков, реальные потери сети. Проверка bounded backpressure подтверждает ограничение памяти, а не отсутствие любого влияния CPU/БД.
- Максимум 120 KB startup — ограничение выделения памяти, не эквивалент документированного input token budget. Provider admission происходит до набора; переполнение не должно приводить к обрезанию фактов. Асинхронная validation Responses остаётся отдельным протокольным риском, поэтому startup-only probe не считается достаточной проверкой конфигурации.
- Публичная бета и изменение production configuration остаются за пределами этой работы.

Протокольные основания: [GPT-Live sessions](https://developers.openai.com/api/docs/guides/live-conversations), [delegation и tool results](https://developers.openai.com/api/docs/guides/live-delegation). Конкретные budgets, persistence fences и критерии приёмки — решения приложения.
