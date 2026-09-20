# Локализация, бренд и Analytics — 20 сентября 2026

Это описание изменений в коде и локальных проверок, а не подтверждение публикации на production или обновления существующей production CMS.

## 1. Архитектура и изменённые части

Сохранены Next.js App Router, Fastify, общие Zod contracts, существующие typed i18n namespaces, JSON CMS с редакциями, cookie выбора языка, `users.ui_locale` и revisioned `beta_controls.settings`. Новых библиотек и параллельного хранилища языка нет.

| Область | Основные файлы |
| --- | --- |
| Registry, contracts, форматирование | `packages/contracts/src/ui-locales.ts`, `languages.ts`, `content.ts`, `analytics.ts`, `beta-controls.ts` |
| Бренд и header | `apps/web/components/brand.tsx`, `app-shell.tsx`, `site-footer.tsx`, `language-switcher.tsx`, `app/emerald-paper.css` |
| UI resources | `apps/web/lib/i18n/*-messages.ts`, `extend-messages.ts`, `resources/{fr,it,rm,ru,uk}.json` |
| Публичные страницы и SEO | `apps/api/src/content/seed-content.ts`, `public-localizations.ts`, `locales/*.json`, `seed-locale-upgrade.ts`; web `public-home.tsx`, `content-page.tsx`, `content-locale-notice.tsx`, `server-content.ts`, `seo-metadata.ts`, `site-config.ts`, `[locale]` routes, OpenGraph и robots |
| Письма | API `auth/communication-locales.ts`, `email-templates.ts`, `auth-service.ts`, `notifications/notification-{messages,details,email}.ts`, `superadmin-notifications.ts` |
| Cookies и Analytics | web `privacy-notice.tsx`, `privacy-preferences.ts`, `analytics-tracker.tsx`, `lib/analytics.ts`, `admin-analytics-settings.tsx`, `security-headers.ts`; API `app.ts`, `beta/beta-controls.ts` |
| Проверки и передача редактору | locale/routing/SEO/email/CMS/analytics/privacy tests, `scripts/export-rm-review.ts`, `docs/rumantsch-review.md` |

Документированная отдельная административная поверхность `/admin` остаётся English-only, как предусмотрено `admin-interface-architecture.md`; новый раздел Analytics использует английский namespace. Семь языков относятся к клиентскому приложению, публичному сайту и письмам. Административные отчёты по email при этом используют сохранённый язык адресата. Полный перевод существующего операционного Admin в эту реализацию не входит.

## 2–3. Языки и единый registry

Ранее клиентский UI и штатный контент страниц были EN/DE. Email уже имел EN/DE/FR/IT/RU/UK; RM использовал английский fallback. Добавлены FR/IT/RM/RU/UK для UI и публичного контента, полноценный RM для email. Ранее только английские административные email-отчёты теперь имеют все семь локализаций.

`uiLocaleRegistry` — source of truth. Порядок: DE, FR, IT, RM, EN, RU, UK. Каждая запись содержит code, shortCode, nativeName, order, group, enabled, ui, pages, fallback, formatLocale, direction, утверждённый slogan и slugs публичных страниц. `uiLocales` выводится из включённых UI capabilities; `contentUiLocales` дополнительно учитывает готовность страниц. Голос звонка, языки генерируемых текстов и SMS остаются отдельными capabilities: включение RM в UI не обещает отсутствующую поддержку провайдера.

Существующие типизированные EN/DE namespaces сохранены. Дополнительные JSON-каталоги расширяют их через `extendMessages`: ключ — полная исходная фраза, параметры — `{0}`, `{1}`. Фразы с параметрами переводятся целиком с возможностью другого порядка слов; куски предложения не переводятся по отдельности. Тест покрытия проверяет клиентские namespaces, динамические сообщения, три demo-сценария и экспорт. В каждом новом UI-каталоге 937 записей, в каждом каталоге публичного контента — 188.

## 4–6. Переключатель, сохранение и fallback

Один `LanguageSwitcher` используется на desktop, tablet и mobile. В закрытом виде показан двухбуквенный код, внутри — неизменяемые нативные названия языков. Швейцарские языки идут первыми, перед English — тонкий разделитель. Активный язык отмечен. Контрол находится рядом с переключателем темы, вне мобильного меню.

Есть touch/click, Tab, Enter/Space, стрелки, Home/End, Escape, возврат фокуса, закрытие после выбора и снаружи, `aria-expanded`, `aria-controls`, `aria-pressed`, ограничение размеров popup. Светлая и тёмная темы используют существующие design tokens. У общего Brand утверждённый слоган курсивом в accent green; header сохраняет прежнюю высоту.

Язык сохраняется существующим cookie `callassist_ui_locale` на год. У авторизованного пользователя тот же выбор записывается в `users.ui_locale` через существующий endpoint preferences. Явный выбор гостя хранится существующим краткосрочным `callassist_explicit_guest_locale`, переносится в профиль после входа и очищается. Нового language storage нет.

Единый fallback — **English (`en`)**. Negotiation может использовать браузерный язык только при отсутствии явного выбора. Email использует профиль в приоритете. Неизвестная locale приводится к fallback через общую функцию.

## 7–9. Добавление языка, CMS и публичный контент

Для новой locale:

1. Добавить запись в `uiLocaleRegistry`, включая нативное название, capabilities, Intl locale, слоган и slugs. Пока тексты не готовы, оставить `enabled: false` или `pages: false`.
2. Добавить UI JSON resource и зарегистрировать его в `additionalUiResources`. Дополнить небольшие типизированные namespaces cookies/email/notifications; TypeScript укажет отсутствующие locale.
3. Добавить JSON публичного контента и его import в `publicLocaleResources`. `seed-content.ts` автоматически создаёт страницы, FAQ, navigation и landing для `contentUiLocales`.
4. В существующей редактируемой CMS добавить локализации в новую редакцию, включить их в `requiredLocales`, проверить и опубликовать. Включить готовую locale в registry и выполнить locale/content tests. Routing, header, switcher, robots и metadata не требуют отдельных компонентов на язык.

Локализованы navigation, hero, benefits/features, CTA, FAQ, founder/About, интерактивное demo, footer, Privacy, Terms, Acceptable Use, Support, FAQ page, Imprint, заголовки и описания SEO, OpenGraph, системные accessibility labels. Большой marketing/legal контент остаётся в CMS resources, короткий интерфейс — в web namespaces.

Неизменённые штатные EN/DE editorial-публикации получают новую полную редакцию автоматически. Изменённые редактором публикации, в том числе частичные вручную добавленные переводы, сохраняются. Для них переводы нужно добавить и опубликовать через существующую CMS: код не заменяет авторский контент. Отдельные штатные page localizations добавляются идемпотентно в исходную revision; более новые CMS revisions сохраняют приоритет. Новая SQL migration не требуется: locale columns и JSON schemas уже расширяемые.

Публикация проверяет обязательные locale. Если выбранный язык недоступен, используется целая английская страница/collection с понятным уведомлением, а не подстановка множества отдельных фраз. Landing, founder и demo получают один фактический язык; FAQ загружается для него же. Canonical/metadata соответствуют фактическому контенту. Выбранный язык глобального интерфейса сохраняется.

## 10–12. Transactional emails и форматирование

Все существующие виды автоматических писем поддерживают DE/FR/IT/RM/EN/RU/UK:

- код подтверждения email и нового email при его изменении;
- предупреждение о запросе изменения email;
- security notices о смене email, телефона и завершённом сбросе пароля;
- административное уведомление о подтверждённой регистрации;
- административный отчёт о завершённом звонке: результат, оценка, исходный summary и расходы.

Отдельных welcome, magic-link, billing/payment писем и пользовательского письма с transcript в репозитории нет; новые события рассылки не добавлялись. Само восстановление пароля использует существующий SMS flow. Для RM SMS остаётся English из-за capability провайдера; это не email fallback.

Приоритет языка письма: валидный сохранённый `user.uiLocale` → locale активного запроса, если она доступна → `en`. Фоновые уведомления используют `uiLocale` адресата. Язык исходного задания/разговора не меняет язык email-оболочки; пользовательские objective/summary/критерии сохраняются в исходном виде с локализованной подписью. Уже сформированное письмо при retry сохраняет payload и язык для идемпотентности.

Subject, preheader, title, body, CTA, footer, подписи и disclaimers используют общие ресурсы и общий HTML renderer, без семи копий HTML templates. Утверждённый слоган также присутствует в письмах.

`Intl.DateTimeFormat` / `Intl.NumberFormat` берут locale из registry: `de-CH`, `fr-CH`, `it-CH`, `rm-CH`, `en-GB`, `ru-RU`, `uk-UA`. Для времени email применяется `Europe/Zurich`; locale-aware числа, валюты и единицы duration используются в отчётах. Продуктовое расписание сохраняет существующую timezone policy. Нужна среда Node с ICU; используемая локальная среда поддерживает `rm-CH`.

## 13. Cookies/statistics notice

Один немодальный `PrivacyNotice` подключён через `UiLocaleProvider`. Текст и короткая CTA есть на семи языках. Подтверждение хранится в localStorage `callassist_privacy_preferences`: `{ version: 1, acknowledgedAt, analyticsConsent: null }`. Изменения синхронизируются между вкладками; при запрещённом storage есть безопасный fallback в памяти вкладки, который не переживает закрытие браузера.

Acknowledgement означает только ознакомление и не считается согласием opt-in. Текущая policy допускает статистику, если нет явного `analyticsConsent: false`; решение изолировано в `analyticsAllowed`. Для будущего opt-in достаточно изменить policy и добавить сбор решения: Admin и интеграцию GA переписывать не потребуется. Компонент уведомления не вызывает GA.

## 14–15. Admin Analytics и page views

Путь: **Admin → System → Analytics**. Ввести Measurement ID вида `G-XXXXXXXXXX`, включить checkbox и сохранить. Читать и менять настройки могут только активные Admin/Superadmin; public endpoint возвращает лишь необходимую конфигурацию загрузчика. Формат проверяется клиентом, API и перед загрузкой script.

Настройки лежат в существующем JSONB `beta_controls.settings.analytics`, используют revision locking и audit. Старые настройки без analytics автоматически дают disabled. Некорректное сохранённое значение безопасно отключает интеграцию. Изменение остальных beta-настроек старым клиентом не сбрасывает Analytics. Отдельная миграция не нужна.

`AnalyticsTracker` наблюдает `usePathname()` Next App Router; `lib/analytics.ts` единолично загружает script, конфигурирует GA и посылает `page_view`. Нет script при disabled/пустом/неверном ID или отказе policy. Инициализация и page views дедуплицированы. Уже открытые вкладки перечитывают настройку при navigation/focus и раз в минуту; отключение выставляет `ga-disable-*` и убирает script.

Отправляются generic page title и путь без query/hash; идентификатор звонка заменяется на `detail`. Admin исключён. Реклама/Google Signals отключены. CSP расширен только для необходимых Google endpoints.

**В GA web data stream следует отключить автоматические page views при browser history changes**: SHPROHLI отправляет их самостоятельно с `send_page_view: false` в config. Эта инструкция также видна в Admin; Measurement ID не позволяет приложению менять настройку самого Google Analytics. См. [официальное руководство по manual pageviews](https://developers.google.com/analytics/devguides/collection/ga4/views).

## 16. Проверки

Проверялся код и mock browser environment; реальные письма, звонки, GA property и production deployment не запускались.

| Команда / проверка | Результат финального запуска |
| --- | --- |
| `corepack pnpm -r --no-bail typecheck` | Все три пакета прошли |
| `corepack pnpm -r --no-bail lint` | Все три пакета прошли |
| `corepack pnpm -r --no-bail build` | Contracts, API и production Next.js build прошли |
| `corepack pnpm -r --no-bail test` — contracts | 122 tests / 18 files прошли |
| Та же команда — web | 274 tests / 53 files прошли |
| Та же команда — API | 933 прошли, 28 failed, 114 skipped; все оставшиеся сбои связаны с `ECONNREFUSED` PostgreSQL на `localhost:55432` |
| `corepack pnpm copy:check` | Прошла, 742 файла |
| `git diff --check` | Прошла |
| Браузер | 320×740: FR light, переход клавиатурой на UK, подтверждение notice и reload; 768×1024: UK dark, popup внутри viewport; 1440×900: RM dark, точный слоган, header 80 px |

Команды запущены рекурсивно напрямую: root Turbo в этой среде не находит отдельный `pnpm` executable. Это те же package scripts, без пропуска пакетов. Проверки покрывают полноту locale resources, routing/native order, интерполяцию, CMS fallback и сохранение редакторских переводов, email на семи языках и приоритет профиля, GA access/validation/deduplication/redaction/disable, cookie persistence.

Локальная БД недоступна; Docker engine не запустился. Поэтому SQL-сохранение Analytics, CMS upgrade и остальные PostgreSQL integration suites **не подтверждены исполнением**. Новые in-memory API и pure policy tests проходят; PostgreSQL-тесты сохранены и должны быть повторены после запуска тестовой БД. Считать весь test suite зелёным нельзя.

## 17–18. Редакторская проверка

Новые FR/IT/RU/UK тексты требуют обычного продуктового review; независимая проверка носителями не проводилась. В затронутых сообщениях исправлены смешанные языки, отсутствующие переводы, EN/DE-only branches и неоднозначный выбор шаблона интерполяции. Swiss German не содержит `ß`. Утверждённые семь слоганов сохранены дословно.

**Для RM естественность всех новых текстов не подтверждена носителем.** Особенно нуждаются в проверке legal, согласие на запись, безопасность аккаунта, терминология звонков и длинные предложения. Полный отдельный список каждой строки и места использования, включая все 937 UI и 188 public entries, email, уведомления и cost labels: [rumantsch-review.md](rumantsch-review.md). Это исчерпывающая передача редактору, а не несколько примеров. Утверждённый слоган исключён из сомнительных строк.

После правок ресурсов список обновляется командой `corepack pnpm locales:review`.
