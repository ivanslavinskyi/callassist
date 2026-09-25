# AMD, voicemail и GPT-Live: план реализации для беты

Статус: согласованный объём беты, реализация ещё не начата. Ветка: `feat/gpt-live-pilot`.
Проверенная исходная ревизия: `2d7ae0d`. Дата: 25 сентября 2026.
Merge и production deploy — после локальных проверок и утверждения владельцем.

## 1. Подтверждённая проблема

- Twilio сообщил техническое соединение, хотя пользователь отклонил звонок.
- AMD не запрашивался; `AnsweredBy` отсутствовал. Кто ответил, приложение не установило.
- В утверждённом snapshot исследованной попытки было `voicemailAction=hang_up`.
- Общий Realtime-контроллер проиграл запрос согласия и уточнение. Native Live не запускался.
- Локальная расшифровка предоставленного AMR обнаружила вторую реплику согласия.
  Декодированная длительность 29,02 с: тишина до примерно 13,4 с, реплика до 18,4 с, затем тишина.
  Первый дисклеймер в файле не обнаружен. Файл не содержит входящего приветствия автоответчика.
- Согласия, записи средствами приложения и основного разговора не было; кредит возвращён.
- Файл подтверждает попадание реплики на принимающую сторону. Голосовая почта правдоподобна,
  но конкретный механизм сохранения AMR по одному файлу не установлен.

Личное аудио, номера, секреты и полные тексты реального разговора в Git не включать.

## 2. Границы беты и инварианты

1. Синхронный Twilio AMD выполняется до Media Stream, OpenAI, дисклеймера и consent timers.
2. AMD применяется одинаково к `live` и `realtime`; переключение runtime не обходит проверку.
3. `human` — оценка провайдера, не согласие, не проверка личности и не доказательство достижения цели.
4. Разрешение на voicemail берётся только из утверждённого snapshot конкретной попытки.
5. При машине/unknown/fax/error нет consent prompt, recording, основной беседы или business tools.
6. Для voicemail разрешён только фиксированный предварительно показанный нейтральный текст.
7. Техническое соединение, классификация ответа, согласие, playback и результат задачи — отдельные факты.
8. Нормальное завершение по voicemail policy не превращается в generic «Остановлен» или provider failure.
9. Provider charges и возврат пользовательского кредита учитываются отдельно.
10. Не обещаем безошибочную классификацию, сохранение сообщения почтовым ящиком или прослушивание человеком.
11. Не выводим намеренный отказ человека из `busy`, `no-answer`, SIP-кода или длительности гудков.
    «Получатель отказался от разговора» требует явного отказа в разговоре; отклонение вызова
    на телефоне не тождественно отказу от consent и не создаёт `consent_declined`.

### Уточнение об отклонении входящего вызова

В текущем коде Twilio не получает команды перенаправить отклонённый вызов на voicemail.
Переадресация сетью принимающей стороны — объяснение исследованного случая, а не доказанный
по callback факт. Для выбора ветки используется фактически полученный ответ/AMD, не предполагаемое
нажатие кнопки на телефоне. При одинаковом AMD политика одинакова после сброса, ожидания или
автоматической переадресации.

Добавить доступный `SipResponseCode` terminal status callback в диагностику попытки и Admin Inspector.
Поле опционально: валидировать числовой SIP-код, сохранять источник/время и привязку к попытке,
не сохранять произвольный текст. Отсутствующее или невалидное дополнительное поле не должно
ломать обработку валидного CallStatus. Дубли/поздние SIP-данные не меняют consent, AMD, разрешение
на сообщение, retry eligibility или credit settlement. Не выводить пользовательский статус
«Получатель отклонил звонок» на основании этого поля, включая код отказа телефонной сети.

Не сокращать ringing timeout ради угадывания отказа. Voice Insights Advanced и отдельное
распознавание намеренного нажатия Reject в объём этой беты не входят.

Бета не включает прохождение IVR и постоянный аудиодетектор после допуска к разговору.
Начальный AMD не обнаруживает надёжно перевод на voicemail посреди разговора. Если это станет
обязательным сценарием, потребуется отдельный аудиодетектор с пересматриваемой классификацией.
Результат модели `end_call(reason=voicemail)` сам по себе не является подтверждением AMD
и не разрешает отправку сообщения; это отдельный источник сигнала в диагностике.

## 3. Политика определения и озвучивания

- `hang_up`: `MachineDetection=Enable`, `AsyncAmd=false`.
- `leave_neutral_message`: `MachineDetection=DetectMessageEnd`, `AsyncAmd=false`.
- Начальные пороги — документированные defaults провайдера, с ограниченными и валидируемыми
  настройками на сервере. Не подбирать глобальные пороги по одному номеру.
- Timeout AMD и ожидание callback входят в бюджет попытки. Consent timer начинается только
  после воспроизведения соответствующего запроса, не во время AMD.
- Отдельный durable deadline завершает зависшую проверку; он учитывает установленный AMD timeout
  и ограниченный запас на доставку webhook. Поздний callback не может вновь открыть речь.
- До классификации телефонная линия молчит. Не проигрывать hold greeting: он тоже может
  записаться в voicemail. Возможная пауза для живого человека — принимаемый компромисс,
  подлежащий измерению на мобильных и бизнес-номерах.

| Ответ провайдера | Решение беты | Пользовательский результат при нормальном завершении |
| --- | --- | --- |
| `human` | Consent → recording → opening → выбранный runtime | Существующий результат разговора/согласия |
| `machine_start` | Завершение без речи | Ответила автоматическая система |
| `machine_end_beep` + утверждённое сообщение | Однократное проигрывание → завершение | Обнаружен автоответчик + состояние сообщения |
| `machine_end_silence` | Без сообщения: для первой версии нет достаточного основания разрешить playback | Обнаружен автоответчик; сообщение не проиграно |
| `machine_end_other` | Без речи; не считать готовностью почтового ящика | Ответила автоматическая система |
| `fax` | Без речи | Ответил факс |
| `unknown` | Без речи, повтор доступен после завершения | Не удалось определить, кто ответил |
| Результат отсутствует/невалиден, ошибка AMD | Без речи, завершение и reconciliation | Ошибка проверки ответа |
| `busy` / `no-answer` / отмена до ответа | Существующий сценарий | Занято / Нет ответа / Отменён |

Неожиданное сочетание режима и результата не даёт права на речь: сохранить диагностический код
и завершить консервативно. Даже `machine_end_beep` никогда не разрешает сообщение при `hang_up`.
`machine_end_silence` можно поддержать позже после отдельной проверки; это изменение версии policy.

Название «Обнаружен автоответчик» относится к классификации провайдера. В деталях показывать источник.
`machine_start` не доказывает наличие почтового ящика, поэтому для него шире формулировка
«Ответила автоматическая система» с пояснением «Это может быть автоответчик или телефонное меню».

## 4. Модель состояния и отображение

Не расширять низкоуровневый `CallBrief.status` значением `voicemail`: транспорт остаётся
`dialing/in_progress/completed/failed/stopped`. Расширить lifecycle/result и проекцию активности.

Нормализованные факты на попытку:

- Detection: `not_requested`, `pending`, `resolved`, `failed`; режим, версия настроек,
  raw `AnsweredBy`, нормализованная классификация, источник, `observedAt`, provider duration если есть.
- Message: `not_requested`, `not_attempted`, `issued`, `playback_completed`, `interrupted`, `unknown`;
  причина пропуска/сбоя, template version/hash, playback command ID и связанные времена.
- Consent: дополнить значением `not_requested` для новых попыток, остановленных перед запросом.
  Историческое `not_recorded` сохраняет прежний смысл; не создавать фиктивный `consent.failed`.
- Finish reason: решение policy, unknown/error, user stop, limit/recovery, provider disconnect.

Состояние выводить из сохранённых событий одной попытки. События содержат разрешённые enum/ID,
не приветствия автоответчиков, имена, номера или свободный provider error text.
Времена провайдера и время получения не смешивать; отсутствующую длительность не выдумывать.

Активные фазы: набор → «Определяем, кто ответил» → запрос согласия → разговор;
либо «Проигрываем нейтральное сообщение» → завершение. При sync DetectMessageEnd отдельное
событие начала приветствия недоступно: не показывать выдуманный этап «ждём сигнал».
SSE reconnect обозначает состояние обновлений, а не отменяет известные факты о звонке.

Приоритет отображения:

- Во время завершения сохранять фазу остановки; terminal подтверждается провайдером/reconciliation.
- Явная остановка пользователем — основной результат «Остановлен вами», AMD и сообщение — детали.
- Технический сбой завершения не скрывать автоматическим результатом; известный AMD остаётся деталями.
- Нормальное завершение по machine policy показывает автоответчик/автосистему, даже если транспорт `completed`.
- Полученное согласие/начатый разговор не стираются поздним или противоречивым AMD.
- Сохранять существующую оценку состоявшегося разговора; обнаружение машины не означает выполненную задачу.

Статус сообщения:

- Не отправлялось по настройке.
- Не проиграно: готовность автоответчика не подтверждена.
- Проигрывание сообщения завершено.
- Воспроизведение прервано — только при наличии соответствующего факта.
- Воспроизведение не подтверждено — при потере callback/соединения или неоднозначном исходе.

Не использовать «доставлено», «сохранено», «прослушано» и не создавать финальную расшифровку из шаблона.

## 5. Форма, review и immutable approval

- Сохранить одно существующее поле voicemail и default `hang_up`.
- Понятные варианты: «Завершить при обнаружении автоответчика» / «Оставить короткое нейтральное сообщение».
- Для второго варианта показывать точный текст на языке звонка; пояснить, что сообщение возможно
  только при распознанной готовности автоответчика. Не обещать оставление в каждой попытке.
- Шаблон сообщает, что звонил ИИ-ассистент SHPROHLI; не содержит имени заказчика, адресата,
  организации, цели, медицинских/appointment сведений, обещания перезвонить или просьбы звонить
  на исходящий номер, пока входящие звонки не поддерживаются продуктом.
- Шаблон локализованный, версионируемый, без LLM-генерации; language/voice сопоставляются
  только с проверенными возможностями TTS. При отсутствии поддержки — запрет start с ясной причиной,
  без незаметной замены языка или выдуманного голоса.
- UI locale (`de/fr/it/rm/en/ru/uk`) и call locale — разные реестры. Проверить обе матрицы.
- Ввести новую версию execution snapshot, сохранив чтение старых: точные initial disclosure,
  neutral message, policy version, язык и выбранный способ озвучивания фиксируются при approval.
- Review receipt/approval должен связывать показанный текст и policy digest, а не только старый
  compilation hash. Изменение шаблона между review и approval требует обновить review.
- Новые попытки из старого approval требуют нового review текущих речевых условий без новой
  LLM-компиляции неизменённого плана. Старые approvals и snapshots не перезаписывать.
- При изменении задачи применяется существующая компиляция; смену только voicemail policy
  реализовать детерминированно с новой проверкой/approval, не запускать LLM ради фиксированного текста.

Убрать имя заказчика из начального consent announcement; разрешённое представление перенести
в mandatory opening после согласия. Проверить, что оно не теряется и не дублируется.
Нейтральная первая реплика снижает последствия false-human; абсолютной защиты от записи
на чужой стороне она не даёт. Существующий consent classifier не считать проверкой личности.

## 6. Backend и безопасность доставки

Точки изменения: `telephony-provider.ts`, `twilio-telephony-provider.ts`, `call-service.ts`,
voice/status webhooks в `app.ts`, memory/PostgreSQL repository, runtime admission.

1. Передавать в startCall данные зарезервированной попытки и её snapshot; не читать voicemail
   из изменяемого brief после reservation. Фиксировать техническую AMD policy на попытку.
2. Связать voice/status/completion URLs с attempt ID и подписанной привязкой snapshot.
   Проверять Twilio signature, AccountSid, CallSid и принадлежность попытке/владельцу.
3. Обработать callback раньше attachProviderCall: атомарное сопоставление подписанной
   зарезервированной попытке, сверка последующего REST результата, запрет подмены CallSid.
   Нельзя брать просто latest attempt при обработке старого callback.
4. В отдельной чистой policy-функции выбрать `start_consent`, `play_neutral_message`, `hang_up`.
   Решение и право на side effect фиксировать транзакционно до ответа webhook.
5. При `start_consent` выдавать прежний подписанный Media Stream. В обработчике stream.start
   повторно проверять сохранённый допуск; повторное подключение не перезапускает disclosure.
6. Для voicemail использовать `<Say>` с точным текстом и проверенной voice/language pair,
   затем подписанный `<Redirect>` на completion endpoint, возвращающий `<Hangup>`.
   XML строить SDK, не конкатенацией пользовательского текста. Здесь нет Media Stream/OpenAI.
7. Completion фиксирует только прохождение провайдером команды воспроизведения, а не сохранение
   почтовым ящиком. Не устанавливать completion сразу после генерации TwiML.
8. Выдавать команду сообщения не более одного раза: durable claim под блокировкой + уникальный
   idempotency key. После claim и потерянного ответа повтор не воспроизводит текст; исход unknown.
   Это сознательный выбор защиты от дублей, не обещание exactly-once доставки по сети.
9. При Stop/deadline использовать stop/reconciliation существующего провайдера. Нет автоматического
   повторного звонка, переотправки сообщения или открытия сессии после завершения.
10. Поздние факты могут уточнить диагностику завершённой попытки, но не дать новое разрешение
    на речь/recording/tools и не пересчитать уже возвращённый кредит в неожиданное списание.

Не хранить raw audio до согласия, не запускать app recording ради оценки AMD. Админ получает
метаданные классификации, а не скрытую запись приветствия. Новые данные включить в существующие
правила доступа, экспорта, удаления и retention; секреты callback не писать в логи.

## 7. Live, consent и playback

- После AMD сохранить существующую цепочку consent → recording started → mandatory opening mark
  → native GPT-Live. Текущий bounded Realtime-контроллер не переписывать целиком ради AMD.
- GPT-Live остаётся `gpt-live-1`, Responses — `gpt-6-luna`, `parallel_tool_calls=false`.
- Разрешение речи проверяется в приложении перед отправкой аудио в Twilio, а не только в prompt.
- PCMU/G.711 8 kHz для основного разговора сохраняется без дополнительного transcoding.
- Не использовать backend `response.done`, transcript pause или instructions acknowledgment
  как окончание Live audio. Native input/output transcripts сохраняют свои интервалы и speaker.
- При clear инвалидировать ожидающие marks соответствующего поколения, включая consent/opening;
  clear-returned mark не может открыть разговор или подтвердить полное воспроизведение.
- Сохранить authorization, appointment confirmation, immutable execution, end_call,
  interrupted closing и rejection stale/duplicate tool calls.
- Fallback разрешён только на существующей безопасной точке запуска Live; он сохраняет AMD/consent.
  Ошибка AMD не включает fallback и не открывает Realtime. После начавшегося Live разговор
  не воспроизводится заново через другой runtime.
- Реальные тесты Live выполнять с fallback=false и подтверждать фактическую native Live сессию.
- Post-call recording/transcription pipeline сохраняется для разговоров после согласия.

## 8. Повтор, feedback, история и админка

- Повтор доступен после provider terminal + settlement для machine/unknown/fax/pre-consent error,
  если нет consent grant/explicit refusal, разговора, записи или внешнего действия.
- Сообщение на voicemail само по себе не является выполненным business action; повтор можно предложить,
  но на review показать прошлый результат сообщения, чтобы избежать случайных одинаковых сообщений.
- Повтор создаёт один новый review draft на исходную попытку. Не переносит consent, AMD,
  transcript, playback claim, результаты tools или старый approval.
- Лимиты на пользователя/адресата, блокировки, credits и concurrency проверяются заново.
  Возврат кредита не обнуляет лимиты числа попыток. Проверять просроченные appointment windows.
- Кнопка находится в основном блоке результата на мобильном и desktop; не только в деталях.
- Страница звонка, история, последние звонки, уведомления, экспорт/PDF при наличии используют
  единую проекцию результата. Везде сохраняется существующая цель звонка.
- Если разговора не было, не предлагать оценивать качество несуществующей расшифровки и не
  превращать voicemail в автоматически выставленную оценку цели «Нет». Исторический feedback
  сохраняется; существующий edit feedback для состоявшихся разговоров не меняется.
- AMD/voicemail без записи показывается как карточка результата + шаблон сообщения и его статус,
  без пустых Final/Provisional transcript tabs. Старые реальные consent segments остаются доступными.
- Admin Calls/Inspector: новый технический result/filter, raw classification, mode, version,
  длительность, причина завершения, попытка, message status, доступный SIP-код, расходы и история событий.
- Имеющийся semantic outcome `voicemail` — ручная оценка с provenance. Не переписывать его
  системным AMD: существующая schema прямо запрещает такой вывод из technical state.
- Admin Operations: раздельно technical connections, AMD machine/unknown/error, consenting
  conversations, message playback. Не удваивать conversation/goal success метрики.
- Для новых публичных строк — полное покрытие семи UI локалей, без незаметного English fallback.

## 9. Схема, ledger и стоимость

Для переходов использовать существующий `call_events`: append-only, unique idempotency key,
транзакционная блокировка родительской записи в одинаковом порядке. Отдельная таблица AMD
не требуется по умолчанию. Решения admission и message claim должны быть обязательной durable
операцией, а не best-effort telemetry после side effect.

Нужны additive изменения CHECK для новых событий и provider operation types, а также versioned
contracts/snapshot. Точные тексты хранить в существующем encrypted snapshot; в events — ID/hash.
Если для индексации метрик потребуется projection/index, добавлять после проверки query plan,
не создавать второй независимый источник истины. Memory repository повторяет те же transitions.

- Отдельная provider operation AMD, parent telephony leg, один результат/usage на попытку.
- Разделять requested, observed execution, unknown usage. Не считать каждый busy/no-answer
  выполненной платной AMD-операцией без оснований; отсутствие billing evidence не означает ноль.
- Для `<Say>` — отдельный учёт реально выбранного TTS и версия тарифов; estimate отдельно от invoice.
- Call.price нельзя считать включающим все add-ons. В Twilio billing sync добавить category
  `answering-machine-detection` и применимую TTS category, без суммы parent+child.
- Не суммировать aggregate invoice и per-call estimates как две разные траты.
- Admission/spend reserve учитывает AMD и возможную озвучку; неизвестные расходы остаются
  неопределёнными до reconciliation, а не молча исчезают.
- Для machine/unknown/fax без состоявшегося разговора beta credit возвращается ровно один раз,
  в том числе при разрешённом нейтральном сообщении. Фактические расходы провайдеров сохраняются.

## 10. Матрица сценариев и проверок

| Сценарий | Обязательное ожидание |
| --- | --- |
| Живой человек: короткое hello, повторное hello, длинное деловое приветствие | AMD не превращается в согласие; корректный consent/opening/Live |
| Человек молчит / фон / плохая связь | unknown не начинает дисклеймер; честная причина и повтор |
| Ответ другого человека | human не подтверждает личность; прежние ограничения раскрытия/подтверждений |
| Явный отказ от записи / ответа | Отказ сохраняется, без записи и быстрого repeat обхода |
| Пользователь отклонил, оператор включил voicemail, policy hang_up | Ни одного assistant media/consent запроса при machine; refund |
| Не взяли, линия занята, отменили до ответа, ошибка номера | Старые provider results сохраняются; AMD не выдумывается |
| SIP-код отказа/занятости, отсутствующий или невалидный SipResponseCode | Диагностика не утверждает намеренный отказ; валидный status callback обрабатывается |
| Короткое voicemail hello с паузой | Измерить false-human; generic disclosure без имени, никакого ложного human/goal статуса |
| Длинное/многоязычное приветствие, beep | Только разрешённое сообщение после допустимого результата |
| Silence-ending / нестандартный тон / timeout greeting | Сообщение пропущено с причиной, не «успешно оставлено» |
| IVR / call screening / fax / ошибочный machine | Без утверждения, что почтовый ящик существует; понятный технический результат |
| False human, запись содержит yes/okay | Не объявлять AMD гарантией согласия; проверить текущий classifier на опасные примеры |
| Человек поднимает во время voicemail / перевод после consent | Зафиксировать ограничения initial AMD; запрет новой свободной беседы в message branch |
| Stop во время ringing/AMD/consent/Say | Нет продолжения; точные actor/reason и сообщение interrupted либо unknown |
| Отключение после claim, до/во время/после Say | Нет повторного проигрывания; нет ложного completion |
| Два одинаковых webhook одновременно, поздний callback старой попытки | Один side effect; новая попытка не меняется |
| Callback раньше REST, несовпадающий CallSid/AccountSid/token/hash | Корректная атомарная привязка либо отказ, без утечки речи |
| Crash API/worker, пропавший callback, stop API failure | Durable deadline/reconciliation, bounded charges, честный terminal |
| Clear → запоздалый mark; Live overlapping speech | Нет ложного consent/opening/farewell completion; full-duplex работает |
| Live startup fail, mid-call fail, Responses error | Только разрешённый fallback; никакого повторения действий |
| Повтор из двух вкладок, expired appointment, поменявшийся шаблон | Один draft, fresh review, no LLM без правки задачи, stale approval rejected |
| Reload/SSE reconnect, семь локалей, mobile/desktop | Состояние восстанавливается из БД; одинаковые result/CTA/admin |
| Запоздалая цена, duplicate settlement, расходы без разговора | Нет двойного usage/charge; refund не скрывает provider cost |
| Старые snapshots/events/feedback и новая версия | Чтение без переписывания исторических фактов |

Опасное ложное consent на записанном приветствии является release blocker, а не поводом
объявить classifier безошибочным. Если реалистичные fixtures воспроизводят ошибку, усилить
consent gate (например, обязательным DTMF для выбранного beta сценария) и отдельно утвердить
изменение UX до выпуска; не скрывать дефект tuning или текстом интерфейса.

Unit: policy table, result precedence, approvals, template locale mapping, mark invalidation,
classifier negatives, retries, costs. Integration: реальные PostgreSQL transactions, webhook
security/order/duplicates, memory parity, recovery, runtime admission и post-call pipeline.
Web tests: result card, transcript/feedback visibility, repeat, translations, admin filters/counts.

## 11. Порядок реализации и приёмка

1. Contracts и чистая policy/state projection, versioned review/snapshot, таблица тестов.
2. Durable repository operations, idempotency, additive migrations, cost operation contracts.
3. Twilio AMD + подписанные callbacks + terminal/recovery + runtime admission.
4. Message branch, exact template review, нейтральный pre-consent disclosure, caller identity в opening.
5. UI/history/repeat/admin/notifications/exports и семь локалей.
6. Billing/admission/reconciliation, read compatibility и security/privacy review.
7. Unit/integration/regression tests; исправить обнаруженные ошибки до ручного теста.
8. Полные `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm copy:check`,
   проверка migrations и deployment config. Integration tests должны реально использовать
   выделенную локальную test БД; отсутствие БД не считается успешной проверкой PostgreSQL.
9. Расширить существующий `drill:voice-runtime` сценарными профилями. Текущий verifier требует
   consent/recording/Live usage для каждого звонка и поэтому непригоден для voicemail as-is.
   Для machine/unknown профиль обязан проверять отсутствие voice sessions/recording/tools,
   а для human-live — наличие native transcripts, Live usage и Responses usage.
10. Реальные тесты на согласованных номерах: Live human, reject+hang_up, reject+neutral message,
    busy/no-answer, человеческое бизнес-приветствие, длинный greeting; Realtime human и voicemail
    как regression, fallback отдельно. Нужны согласованные тестовые входящие приветствия для AMD;
    текущий AMR не является такой fixture. Не имитировать реальные результаты unit mocks.
11. Проверить в браузере локализованные страницы и админку, задержку AMD, состояние после reload,
    credit/provider ledger и completion evidence. Сохранить обезличенный отчёт с pass/fail.
12. Финальный self-review на regression/security/privacy/billing/races, затем ручное утверждение владельца.

Локальная приёмка: `VOICE_RUNTIME_DRIVER=live`, Live fallback выключен. Production default
не менять до успешной приёмки. Режим AMD показывать в deployment diagnostics/admin runtime facts.
Недоступная/ошибочная AMD config не должна тихо отключать проверку в активном beta rollout.

Документация при реализации: README, `.env.example`, `docs/gpt-live-pilot.md`,
`docs/local-testing.md`, `docs/deployment-preflight.md`, provider ledger и этот acceptance record.
Документировать точную матрицу call locale → TTS voice, таймауты и версию policy.

Перед выкладкой: остановить новые старты, дождаться завершения активных звонков, применить migrations,
обновить API/workers/web согласованно, затем включить новые попытки. Не смешивать старые strict
readers и новые event/snapshot writers. Runtime rollback на Realtime в этой же ревизии сохраняет
AMD. Откат к старому коду требует отдельной проверки совместимости: additive SQL сам по себе
не делает старые enum/schema readers совместимыми с новыми данными. Не удалять аудит для отката.

## 12. Официальные основания

- [Twilio AMD](https://www.twilio.com/docs/voice/answering-machine-detection): режимы и результаты.
- [Twilio AMD FAQ](https://www.twilio.com/docs/voice/answering-machine-detection-faq-best-practices):
  задержка, ошибки классификации, ограничения machine_end_other и настройка по разным направлениям.
- [Twilio Say](https://www.twilio.com/docs/voice/twiml/say) и
  [Redirect](https://www.twilio.com/docs/voice/twiml/redirect): управляемая ветка сообщения.
- [Twilio Media Streams messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages):
  PCMU, mark и clear.
- [Twilio Usage Records](https://www.twilio.com/docs/usage/api/usage-record): категории AMD/TTS.
- [Twilio Call resource](https://www.twilio.com/docs/voice/api/call-resource): неоднозначность
  `no-answer`, технический смысл `completed` и `SipResponseCode` в terminal status callbacks.
- [OpenAI Live migration](https://developers.openai.com/api/docs/guides/live-migration):
  аудиозависимые решения, отдельный detector и application-owned playback.
- [OpenAI Live sessions](https://developers.openai.com/api/docs/guides/live-conversations):
  native transcripts, exact clips и отсутствие turn-based completion для Live audio.

Это проектное решение приложения на основе проверенных API. Названия новых внутренних
типов/событий уточняются при реализации; существующие provider event names не подменяются ими.
