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

- `apps/web` — Next.js-пульт создания задания и наблюдения за mock-звонком.
- `apps/api` — Fastify API, PostgreSQL или in-memory storage, SSE-события и запрос подтверждения.
- `packages/contracts` — общие Zod-контракты, включая обязательный язык звонка и опциональный резервный язык.

Сейчас звонок симулируется локально, но задания, попытки, транскрипты, подтверждения и аудит уже могут сохраняться в PostgreSQL. Разрешённые факты шифруются AES-256-GCM перед записью. Подключение Twilio и OpenAI Realtime — следующий этап.

## Локальный запуск

Требуется Node.js 22 или новее.

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
