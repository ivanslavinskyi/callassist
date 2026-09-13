# B01/B02 — исправления и локальная приёмка

**13 сентября 2026. B01 и B02 закрыты в рабочей копии на базе `ef36cfa8cd17e740395a4e120be6bbc23f347b4e`.** Изменения не закоммичены и не задеплоены в рамках этой работы. Остальные условия публичного тестирования остаются открытыми: **NO-GO**, текущий backlog — [единый roadmap](mvp-plan.md).

Этот отчёт уточняет пункты 1 и 2 [исходного аудита](public-testing-audit-2026-09-13.md). Его первоначальные результаты сохранены как доказательство состояния до исправлений.

## B01 — production dependencies

В [web package.json](../apps/web/package.json) минимальные версии Next.js и eslint-config-next повышены с `^15.5.21` до `^15.5.24`; [lockfile](../pnpm-lock.yaml) фиксирует оба пакета на **15.5.25**. В [корневом package.json](../package.json) sharp override повышен с `0.35.0` до **0.35.4**. Major-ветка Next.js сохранена; связанные platform/libvips-пакеты обновлены установщиком.

`corepack pnpm security:audit` завершился успешно: **No known vulnerabilities found**. Это свежий результат проверки production dependency graph через npm registry, разрешённой пользователем; он не является гарантией отсутствия ещё неизвестных уязвимостей. Lockfile воспроизводимо установлен с `--frozen-lockfile`; lint, typecheck, tests и production build проходят.

При первой повторной установке ограниченный сетевой доступ прервал восстановление node_modules. Финальная проверка выполнена после успешной установки с `--force --frozen-lockfile --prefer-offline` и системными CA (`NODE_USE_SYSTEM_CA=1`); проверка TLS не отключалась. pnpm оставил штатное предупреждение об ignored build script `unrs-resolver`; это не помешало проверкам и сборке.

## B02 — Admin System и управление новыми звонками

### Причина 500 и исправление

Internal durable job получил `textArtifactId`. Репозитории формировали admin DTO через исключение нескольких полей и остаточный spread, поэтому новый внутренний ключ попал в ответ. `z.strictObject` отклонял его даже для brief job с `textArtifactId: null`; System возвращал 500 при непустой очереди.

Общий [toAdminDurableJob](../apps/api/src/jobs/admin-durable-job.ts) теперь явно перечисляет публичные поля. Его используют [memory](../apps/api/src/storage/in-memory-call-repository.ts) и [PostgreSQL](../apps/api/src/storage/postgres-call-repository.ts). Строгая схема сохранена, внутренние target/lease-поля не публикуются.

### Независимое управление

Добавлен `GET /api/admin/system/outbound-calls`. GET и существующий PUT возвращают минимальный [контракт](../packages/contracts/src/admin-operations.ts):

```json
{
  "outboundCalls": {
    "enabled": false,
    "reason": "Investigating a provider incident",
    "updatedAt": "2026-09-13T12:00:00.000Z"
  }
}
```

Значения выше — иллюстрация контракта. Чтение обращается только к control state, запись возвращает записанное состояние после существующей audited mutation. Ни одна операция не вызывает сборку diagnostics. Сбой контрольного GET также не препятствует отдельному PUT disable.

[Отдельная UI-панель](../apps/web/components/admin-outbound-control.tsx) отображается до диагностики и за пределами её условного блока. У панели собственные loading/error/refresh/mutation состояния. При неизвестном состоянии предлагается только явное отключение; при потерянном ответе записи UI сообщает, что результат не подтверждён, вместо ложного утверждения об отсутствии изменений. Запоздавшие ответы чтения не перезаписывают более новое состояние.

Сохранены обязательная причина, подтверждение, audit actor, проверки авторизации/CSRF и запрет включения для обычного admin. GET/PUT имеют `Cache-Control: private, no-store`. Form element сохраняется до `await`, чтобы успешную запись или retry job не сопровождала ложная ошибка на `event.currentTarget.reset()`.

**Граница:** это запрет новых исходящих звонков, а не завершение активных разговоров. Для работы нужны доступные API, авторизация и БД. При недоступности web/API сохраняется CLI-процедура `calls:disable`; см. [runbook](operations-readiness.md).

### Совместимость развёртывания

Ответ PUT изменён с полного `AdminSystemView` на `{ outboundCalls }`; новый GET отсутствует в прежнем API. **Web и API необходимо выкатывать согласованно**, в контролируемое окно или с совместимой промежуточной версией при rolling deployment. Обновлённый web нельзя направлять на старый API. Миграций БД нет, catalog остаётся 0068. Этот отчёт не подтверждает production rollout или rollback drill.

## Проверки

| Проверка | Результат |
| --- | --- |
| Frozen install | PASS; pnpm 10.12.4, финальная установка завершена без изменения lockfile |
| Production dependency audit | PASS; известных уязвимостей не найдено |
| Полный `pnpm test` | **139 файлов / 1 102 теста**: API 82/821, web 42/189, contracts 15/92; свежая изолированная БД, без skipped DB suites |
| Новые B02 integration tests | **4 теста**, оба storage drivers: queued brief + running/dead-letter text jobs, strict DTO, отказ diagnostics/control GET, успешный stop, реальный отказ `service.start`, role/input gates и superadmin resume |
| Существующая auth/admin suite | 37 тестов проходят; новый read endpoint включён в проверку запрета user role |
| Lint | API/contracts проходят; после исправления единственного предупреждения нового компонента web lint повторён — чисто |
| Typecheck / production build | 3/3 tasks проходят в каждом прогоне; сборка Next.js 15.5.25 |
| Copy check | PASS, 564 файла |
| System на локальной PostgreSQL | Строгий DTO проходит с 20 recent jobs; только чтение, без изменения существующих записей |
| System на memory | Строгий DTO проходит с непустой очередью |
| Browser, изолированная mock-фикстура | Видны восстановленный System, brief job и доступная control form при одновременном отказе diagnostics/control GET |
| Diff / документация | Whitespace и локальные ссылки проверены; runtime inventory обновлён до 100 method/path pairs |

Полный прогон завершён `2026-09-13T11:57:54Z`; это один прогон, а не сумма старых отчётов. После него исправлено только предупреждение effect cleanup в web-компоненте; финальные web lint, typecheck/build и browser smoke выполнены с этим исправлением. Существующая старая test DB с checksum mismatch 0065 сохранена; она не использовалась как основание для зелёного прогона.

**Браузерная граница:** инструмент не смог обработать нативный `window.confirm` после нажатия Disable, поэтому завершённая запись через браузер не засчитана. Сам PUT, его независимость от обоих сломанных GET и блокирование старта звонка подтверждены на memory/PostgreSQL integration tests. До внешних звонков в B12 выполнить операторский smoke: подтвердить disable в обычном браузере, увидеть disabled и отказ новой попытки, затем superadmin resume. Доступность формы уже проверена; полный browser mutation / staging drill остаётся внешней приёмкой.

## Доказательства

Версионируемая [сводка evidence.json](audits/2026-09-13/b01-b02/evidence.json) содержит результаты и SHA-256 исходных локальных логов. Логи остаются в ignored `Design/audit-2026-09-13/`; секреты, cookies, connection strings, реальные пользователи и содержимое звонков не переносятся в evidence.

- [System после исправления](audits/2026-09-13/b01-b02/01-system-restored.png).
- [Непустая очередь](audits/2026-09-13/b01-b02/02-system-jobs.png).
- [Панель при отказе diagnostics и control GET](audits/2026-09-13/b01-b02/03-diagnostics-and-read-failure.png).

Снимки проверены визуально. Это desktop 1440 px, локальная memory-фикстура с вымышленным admin и mock-провайдерами. Реальные звонки, SMS и письма не отправлялись. Временные API/web остановлены, browser viewport восстановлен, временные fault flags и generated TypeScript-path изменения убраны.

Следующий этап по roadmap — **B03 transactional email и B04 SMS Verify**. Дополнительные admin/support проблемы B08 этим исправлением не закрыты.
