# Итоговый план стабилизации GPT-Live

Дата: 29 сентября 2026. Ветка: `codex/live-unified-runtime`.

Статус: пункты реализации выполнены в текущем рабочем дереве; типы и автоматические
voice-тесты проходят. Открыт только ручной handset-тест после перезапуска локального API.

## Цель

Использовать GPT-Live как владельца естественного full-duplex разговора, managed
Responses — как reasoning/backend полного утверждённого плана, а приложение — как
владельца разрешений, защищённых действий, воспроизведения и физического завершения
звонка.

Результат должен быть общим для всех утверждённых типов планов, языков и естественных
формулировок, без runtime-словарей согласия/прощания и без отдельного сценарного FSM
для каждого вида звонка.

## Зафиксированные продуктовые решения

1. Динамический дисклеймер, содержащий имя и фамилию представляемого человека,
   формирует приложение и заранее рендерит Speech API тем же утверждённым голосом.
   GPT-Live не сочиняет, не перефразирует и не повторяет этот текст.
2. Входящий PCMU всегда поступает в Live немедленно. Буфера «до конца дисклеймера»
   нет. Акустическое перебивание сразу очищает очередь Twilio; частично услышанный
   дисклеймер не открывает consent gate и целиком повторяется после окончания реплики.
3. Если дисклеймер прозвучал полностью, непонимание или просьба повторить трактуется
   семантически через `report_consent` как `unclear` и один раз повторяет полный клип
   из памяти; следующая неопределённость добавляет короткое локализованное уточнение и
   DTMF recovery. Ответ во время прерванного текста не переиспользуется как согласие.
   Поздно пришедший transcript проверяется по той же временной границе и также не
   может превратить реплику до mark в согласие.
4. Согласие определяется семантически backend-моделью в языке звонка через
   `report_consent`; приложение не содержит списков слов или фраз согласия.
5. Managed Responses delegation сохраняется. Переход на client delegation не входит
   в объём работ.
6. Обычные реплики формулирует GPT-Live. Приложение не запускает Responses decision
   после каждого recipient turn.
7. Акустическое начало речи может немедленно очистить очередь воспроизведения, но не
   изменяет task revision, не отменяет closing authorization и не инвалидирует
   backend work. Семантическое изменение начинается с непустого recipient transcript.
8. Нормальное завершение содержит краткий фактический итог и одно прощание. Backend
   передаёт итог структурированно; GPT-Live выбирает естественную формулировку.
9. Semantic pre-playback проверка остаётся только для реально значимого appointment
   commitment. Для дисклеймера источником истины служит переданный Speech API текст,
   а фактом полного воспроизведения — matching Twilio mark без barge-in.

## Целевая ответственность

| Компонент | Ответственность |
| --- | --- |
| GPT-Live | Слушать и говорить, уступать при перебивании, уточнять, задавать вопросы и естественно вести разговор |
| Responses backend | Читать полный план, оценивать прогресс и ограничения, вызывать consent/action/end tools, возвращать краткое проверенное состояние |
| Приложение | Consent/recording gate, immutable authorization, идемпотентность действий, Twilio playback/mark, хранение и физический hangup |

## Изменения реализации

### 1. Дисклеймер и согласие

- Рендерить полный динамический текст через Speech API в PCM 24 kHz, локально
  преобразовывать его в PCMU 8 kHz и начинать эту работу параллельно с Live prewarm
  во время дозвона.
- Не отправлять дисклеймер через `session.instructions.append` и не применять к нему
  semantic speech classifier/retry/watchdog.
- Не передавать task context до принятого согласия и успешного старта записи.
- Считать дисклеймер доставленным только после matching Twilio mark, если во время
  воспроизведения не было barge-in. Старый или очищенный mark ничего не разрешает.
- Всегда передавать входящее аудио в Live без задержки. При barge-in немедленно
  очищать очередь и после acoustic stop повторять полный клип из memory cache.
- Включать consent backend только после полного mark. Запись начинать только после
  нового законченного ответа и принятого affirmative.
- Настроить consent backend на единственный доступный `report_consent` с
  `tool_choice=auto`, low reasoning и коротким output. Если backend один раз
  завершился без tool call, повторить решение один раз; затем перейти к штатному
  clarification. Application-triggered decision разрешён только на consent boundary.
- Ошибка/таймаут Speech API или отсутствие matching playback mark завершают звонок
  fail closed без записи. Повтор после реального barge-in не ограничивается
  словарями или конкретными фразами: основанием служит только acoustic boundary.

### 2. Один владелец обычного разговора

- Удалить task-wide `requestDecision()` и связанные coverage/requested revisions.
- Не вызывать `response.create` после каждого settled recipient turn.
- Сохранить native delegation и обычный function-result continuation.
- Оставить только bounded liveness recovery, который направляет GPT-Live продолжить
  или делегировать, но не запускает конкурирующий backend decision.

### 3. Prompt и контекст

- Сократить Live prompt до роли, языка/тона, representation invariant, backchannels,
  interruptions и concrete delegation policy.
- Явно передавать `representedPerson`, `recipientName` и `resultHandling`.
- Не позволять ассистенту присваивать себе просьбы, предпочтения и обязательства
  представляемого человека.
- Передавать Live план логическими самодостаточными секциями, а не отдельным append
  на каждый JSON leaf.
- Полный structured plan оставить в backend instructions.
- Исправить compiler opening: нейтральная цель или действие от имени представляемого
  человека вместо `I want` / `Хочу` от лица ассистента.

### 4. Перебивания

- Использовать local PCMU activity только для немедленного transport clear и
  определения паузы.
- Не увеличивать semantic epoch и не отменять closing на одном energy event.
- Непустой recipient transcript инвалидирует устаревший backend result и при
  необходимости возвращает closing в conversation.
- Поздние assistant/transcript events не должны оживлять завершённый звонок.

### 5. Завершение

- Расширить `end_call` кратким `resultSummary` в языке звонка.
- Backend отделяет наблюдаемый результат от обещаний и внешних действий.
- После `closing_authorized` GPT-Live говорит один краткий итог и прощается без нового
  вопроса.
- Заменить semantic closing classifier на playback tracker: backend continuation,
  voiced audio, output idle, Twilio mark, mark acknowledgement.
- Recipient transcript до mark отменяет текущий closing; один raw energy event только
  останавливает проигрывание.
- После matching mark и перехода в ending разговор не открывается снова.
- При отсутствии closing output использовать один bounded fallback; не запускать
  новый task decision.

### 6. Appointment

- Сохранить immutable authorization, proposal validation, durable action journal и
  subsequent recipient confirmation.
- Оставить semantic pre-playback проверку только для appointment commitment.
- Не применять этот gate к обычным вопросам и подтверждениям.

## Не делаем

- Runtime-словари `yes/no/goodbye`.
- FSM на каждый task type.
- Отдельный classifier каждой пользовательской или assistant-реплики.
- Client delegation или второй разговорный runtime.
- Локальные правила для отчётов, email или конкретного последнего звонка.
- Изменения исторических approved snapshots без необходимости.

## Проверка

1. Unit/integration invariants: consent + mark, recording gate, stale tools,
   interruption generations, one closing, irreversible final mark.
2. Native provider matrix по всем task types, языкам, refusal/unknown/correction,
   overlap, noise, interruption и closing correction.
3. Отдельный semantic consent corpus без использования его фраз в runtime.
4. Реальные handset calls на тихой и шумной линии.
5. Метрики: delegations per call, useful-response latency p50/p95, accepted end calls,
   closing-to-hangup latency, duplicated openings/disclosures, reopen after goodbye.

## Порядок поставки

1. Удалить конкурирующий task decision loop и acoustic semantic invalidation.
2. Сократить prompts и исправить plan projection/representation.
3. Ввести structured closing summary и упростить closing playback tracking.
4. Ужесточить whole-utterance disclosure verification.
5. Сохранить appointment-only protected path.
6. Обновить тесты, provider probes и handset acceptance.
