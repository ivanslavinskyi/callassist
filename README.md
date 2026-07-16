# CallAssist

Личный голосовой ассистент для контролируемых исходящих звонков. Пользователь создаёт краткое задание на звонок, наблюдает за разговором в веб-пульте и подтверждает любое раскрытие чувствительных данных.

## Принципы MVP

- Web-first: сначала защищённый веб-пульт, затем PWA; нативное Android-приложение не входит в первый релиз.
- Язык звонка задаётся явно в каждом `CallBrief` как BCP 47 locale, например `de-CH`.
- Агент не получает чувствительные значения до явного подтверждения пользователя.
- По умолчанию аудиозапись выключена; транскрипты и аудит доступны только владельцу.
- Первый транспорт: Twilio Programmable Voice и двунаправленный Media Stream. SIP остаётся последующим адаптером.

Подробности: [архитектура](docs/architecture.md) и [план MVP](docs/mvp-plan.md).

## Текущий вертикальный срез

- `apps/web` — Next.js-пульт создания задания и наблюдения за звонком.
- `apps/api` — Fastify API, PostgreSQL или in-memory storage, SSE-события, Twilio webhooks и запрос подтверждения.
- `packages/contracts` — общие Zod-контракты, включая обязательный язык звонка и опциональный резервный язык.

В режиме `mock` звонок симулируется локально. Режим `twilio` уже создаёт реальный исходящий звонок, проверяет подпись входящих webhook-ов, синхронизирует статусы и позволяет остановить звонок из пульта. Пока Twilio произносит только локализованное тестовое приветствие и завершает вызов; двунаправленный Media Stream и OpenAI Realtime — следующий этап. Задания, попытки, транскрипты, подтверждения и аудит сохраняются в PostgreSQL, а разрешённые факты шифруются AES-256-GCM перед записью.

## Локальный запуск

Требуется Node.js 22.19 или новее. API запускается с системным хранилищем доверенных CA, чтобы HTTPS-запросы работали и в сетях с локальным TLS inspection.

```powershell
corepack enable
pnpm install
pnpm env:init
pnpm db:up
pnpm db:test:prepare
pnpm db:migrate
pnpm dev
```

`env:init` создаёт локальный `.env` и уникальный ключ шифрования, не перезаписывая существующий файл. PostgreSQL слушает `localhost:55432`, чтобы не конфликтовать с локальными установками на стандартном порту.

Веб-пульт откроется на `http://localhost:3000`, API — на `http://localhost:4000`. Для временного запуска без PostgreSQL установите `STORAGE_DRIVER=memory`.

## Тестовый звонок через Twilio

По умолчанию используется безопасный локальный режим `TELEPHONY_DRIVER=mock`. Для реального тестового звонка Twilio должен видеть публичный HTTPS URL, но основной API открывать наружу не требуется. В режиме `twilio` приложение поднимает отдельный webhook-gateway на `127.0.0.1:4001`; на нём зарегистрированы только `/webhooks/twilio/voice` и `/webhooks/twilio/status`, и оба маршрута проверяют подпись Twilio.

Для теста без домена запустите в отдельном терминале Cloudflare Quick Tunnel:

```powershell
pnpm tunnel:twilio
```

Туннель направлен только на gateway-порт `4001`, поэтому `/api/*`, SSE и расшифрованные данные через него недоступны. Скопируйте выданный адрес вида `https://random-name.trycloudflare.com` и укажите в `.env`:

```dotenv
TELEPHONY_DRIVER=twilio
PUBLIC_BASE_URL=https://random-name.trycloudflare.com
TWILIO_WEBHOOK_PORT=4001
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+...
```

Оставьте туннель запущенным, выполните `pnpm db:migrate` и перезапустите API. Quick Tunnel выдаёт новый адрес после перезапуска, поэтому тогда нужно обновить `PUBLIC_BASE_URL` и ещё раз перезапустить API. URL для голосового TwiML и callback-ов статуса передаются Twilio автоматически при создании звонка. Запись звонка отключена. Язык тестового приветствия берётся из `CallBrief`; для `de-CH`, `fr-CH` и `it-CH` используются доступные Twilio TTS-варианты `de-DE`, `fr-FR` и `it-IT`, при этом исходный locale задания не меняется.

Quick Tunnel предназначен только для разработки и не имеет гарантии доступности. Если выданный адрес временно не резолвится, перезапустите туннель позже или используйте `ngrok http 4001` как альтернативу.

Проверки проекта:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

PostgreSQL-интеграционный тест запускается при наличии `TEST_DATABASE_URL`:

```powershell
$env:TEST_DATABASE_URL='postgresql://callassist:callassist-dev@localhost:55432/callassist_test'
pnpm --filter @callassist/api test
```
