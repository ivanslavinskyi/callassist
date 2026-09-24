# Shprohli: эксплуатация на общем VPS

Этот ранбук описывает проверенную схему на VPS `91.98.167.23`. Команды для
сервера выполняются в SSH-сеансе от `root` либо через `sudo`. Секреты,
пароли, дампы БД и личные данные не пересылаются в чат и не попадают в Git.

## Разделение проектов

| Компонент | Shprohli | OstKompass |
| --- | --- | --- |
| Сайт | `shprohli.ch`, `www.shprohli.ch`, `voice.shprohli.ch` | `ostkompass.ch` |
| Приложение | пользователь `shprohli`, отдельные API/web/worker `systemd` | `ukrainedirekt.service` |
| PostgreSQL | кластер `17/shprohli`, `127.0.0.1:5433` | `16/main`, `127.0.0.1:5432` |
| Релизы | `/opt/shprohli/releases/<SHA>`, ссылки `current` и `previous` | собственный каталог проекта |
| Секреты | `/etc/shprohli/*.env`, доступ только root | собственные настройки |
| Бэкапы | `/var/backups/shprohli` | собственные бэкапы |
| Логи | namespace `shprohli`, `/var/log/shprohli` | собственные логи |

Оба проекта используют общий nginx на портах 80/443, но у Shprohli отдельные
виртуальные хосты и сертификаты. HTTP перенаправляется на HTTPS, а `www` — на
`https://shprohli.ch`. В обычном обновлении Shprohli не перезапускать
`ukrainedirekt.service` или PostgreSQL 16.
Ресурсный `shprohli.slice` задаёт `CPUWeight=200`, `MemoryMax=10G` и
`TasksMax=1024`: Shprohli имеет повышенный приоритет CPU, а ограничение
памяти не даёт ему вытеснить соседний проект.

## Обычное обновление из Git

1. Локально проверить изменение, сделать commit и push в `main`. Дождаться
   успешного GitHub Actions `CI` для **этого SHA**.
2. На VPS выполнить команды ниже. `check` проверяет *текущий* релиз и его CI;
   `deploy` скачивает `main` и самостоятельно проверяет CI целевого SHA.

   ```bash
   sudo shprohli-release status
   sudo shprohli-release check
   sudo shprohli-release deploy
   sudo shprohli-release status
   ```

3. Открыть `https://shprohli.ch/en` в браузере и проверить изменённый сценарий.
   Проверить оба сайта без раскрытия пользовательских данных:

   ```bash
   curl -fsS -o /dev/null -w 'Shprohli %{http_code}\n' https://shprohli.ch/en
   curl -fsS -o /dev/null -w 'OstKompass %{http_code}\n' https://ostkompass.ch/
   systemctl is-active shprohli-api.service shprohli-web.service \
     shprohli-worker.service ukrainedirekt.service
   ```

Скрипт `/usr/local/sbin/shprohli-release` установлен из
[`scripts/shprohli-vps-release.sh`](../scripts/shprohli-vps-release.sh). Он
требует чистый checkout, предка текущего SHA в целевом `main`, успешный CI,
достаточно памяти и места, собирает отдельный каталог с фиксированным
lockfile, проверяет миграции, закрывает приём новых звонков, дожидается
завершения текущей работы, создаёт и проверяет свежий бэкап БД, переключает
`current`, перезапускает только три службы Shprohli и проверяет пути процессов,
API, worker, редиректы, оба сайта и состояние приёма звонков. При ошибке
переключения пытается вернуть прежний релиз; если здоровое состояние не
подтверждено, оставляет новые звонки остановленными.

**Миграции БД:** обычный `deploy` откажется от релиза с изменённым каталогом
SQL. Для него нужен отдельный план совместимости и контролируемый накат с
проверенным восстановлением. Откат кода не откатывает схему и пользовательские
данные. Контент из БД/CMS публикуется через приложение; Git переносит только
код и статические файлы.

## Откат приложения

Если новый релиз сломан, сначала посмотреть `status` и состояние активных
звонков/очереди. Затем выполнить:

```bash
sudo shprohli-release rollback
sudo shprohli-release status
curl -fsS -o /dev/null -w 'Shprohli %{http_code}\n' https://shprohli.ch/en
curl -fsS -o /dev/null -w 'OstKompass %{http_code}\n' https://ostkompass.ch/
```

Помощник переключает на `/opt/shprohli/previous` после тех же проверок,
остановки приёма новых звонков и свежего бэкапа. Успешный реальный откат с
`22a6e06` на `e7d568e` и обратный `deploy` на `22a6e06` проверены
24 сентября 2026 года: CI, бэкапы, worker, call gate и оба сайта прошли
проверку. Если `main` остаётся корректным, вернуться вперёд можно обычным
`sudo shprohli-release deploy`. Восстановление БД — отдельная операция:
нельзя заменять живую БД без оценки потери новых данных и внешних эффектов
Twilio/Resend/OpenAI.

## Бэкапы и проверка восстановления

`shprohli-db-backup.timer` запускает `/usr/local/sbin/shprohli-db-backup`
ежедневно в 04:15 UTC. Он публикует PostgreSQL custom-format dump только
после `pg_restore` archive check и удаляет дампы старше семи суток.
Дополнительный дамп создаётся перед каждым переключением релиза. Каталог
`/var/backups/shprohli` доступен только root.

```bash
systemctl is-active shprohli-db-backup.timer
systemctl list-timers --all shprohli-db-backup.timer --no-pager
systemctl start shprohli-db-backup.service
systemctl show -p Result --value shprohli-db-backup.service
find /var/backups/shprohli -maxdepth 1 -type f -name 'shprohli-*.dump' \
  -printf '%TY-%Tm-%Td %TH:%TM UTC %s bytes %f\n' | sort
```

Восстановление **в отдельную временную БД** на кластере 17/5433 проверено
24 сентября 2026 года на дампе с реальными аккаунтами. Совпали 87 таблиц,
80 миграций и их контрольная сумма, две учётные записи (одна активная
обычная и один полностью подтверждённый суперадмин), настройки беты и
анонимный отпечаток ролей/статусов. Временная БД удалена; оба сайта остались
доступны. При следующем учении сравнивать с фактическим числом пользователей,
а не с зафиксированным в скрипте числом: число меняется после регистрации.
Если восстановление или сравнение не удалось, сохранить временную БД для
диагностики; удалять только проверенное имя `shprohli_restore_<UTC timestamp>`.

Для повторного учения выполнить на VPS одним блоком. Скрипт не требует
заранее известного количества пользователей и никогда не восстанавливает
дамп поверх рабочей БД. При несовпадении временная БД остаётся для разбора.

```bash
bash <<'SH'
set -euo pipefail
systemctl is-active --quiet postgresql@17-shprohli.service \
  shprohli-api.service shprohli-web.service shprohli-worker.service \
  ukrainedirekt.service
systemctl start shprohli-db-backup.service
[[ "$(systemctl show -p Result --value shprohli-db-backup.service)" == success ]]
archive=$(find /var/backups/shprohli -maxdepth 1 -type f -name 'shprohli-*.dump' \
  -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
[[ "$archive" =~ ^/var/backups/shprohli/shprohli-[0-9]{8}T[0-9]{6}Z\.dump$ ]]
[[ -s "$archive" ]]
(( $(date +%s) - $(stat -c %Y "$archive") <= 300 ))
/usr/lib/postgresql/17/bin/pg_restore --list "$archive" >/dev/null
scratch=shprohli_restore_$(date -u +%Y%m%d%H%M%S)
[[ "$scratch" =~ ^shprohli_restore_[0-9]{14}$ ]]
exists=$(sudo -u postgres /usr/lib/postgresql/17/bin/psql -X -p 5433 \
  -d postgres -At -c "SELECT count(*) FROM pg_database WHERE datname='$scratch'")
[[ "$exists" == 0 ]]
sudo -u postgres /usr/lib/postgresql/17/bin/createdb -p 5433 -T template0 "$scratch"
sudo -u postgres /usr/lib/postgresql/17/bin/pg_restore \
  --host=/var/run/postgresql --port=5433 --username=postgres \
  --dbname="$scratch" --single-transaction --exit-on-error < "$archive"

sql=$(cat <<'SQL'
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname='public') || '|' ||
  (SELECT count(*) FROM schema_migrations) || '|' ||
  (SELECT md5(string_agg(name || ':' || checksum_sha256, ',' ORDER BY name))
     FROM schema_migrations) || '|' ||
  (SELECT count(*) FROM users) || '|' ||
  (SELECT md5(coalesce(string_agg(
    id::text || ':' || role || ':' || status || ':' ||
    (phone_verified_at IS NOT NULL)::text || ':' ||
    (email_verified_at IS NOT NULL)::text, ',' ORDER BY id), ''))
   FROM users) || '|' ||
  (SELECT revision FROM beta_controls WHERE id=true) || '|' ||
  (SELECT md5(settings::text) FROM beta_controls WHERE id=true)
SQL
)
live=$(sudo -u postgres /usr/lib/postgresql/17/bin/psql -X -p 5433 \
  -d shprohli -v ON_ERROR_STOP=1 -At -c "$sql")
restored=$(sudo -u postgres /usr/lib/postgresql/17/bin/psql -X -p 5433 \
  -d "$scratch" -v ON_ERROR_STOP=1 -At -c "$sql")
printf 'Live: %s\nRestored: %s\n' "$live" "$restored"
if [[ -z "$live" || "$live" != "$restored" ]]; then
  printf 'Mismatch; scratch database retained: %s\n' "$scratch"
  exit 1
fi
sudo -u postgres /usr/lib/postgresql/17/bin/dropdb -p 5433 "$scratch"
printf 'Restore verified; scratch database removed: %s\n' "$scratch"
curl -fsS -o /dev/null -w 'Shprohli HTTP %{http_code}\n' https://shprohli.ch/en
curl -fsS -o /dev/null -w 'OstKompass HTTP %{http_code}\n' https://ostkompass.ch/
SH
```

Эти дампы находятся на том же VPS: они защищают от ошибочных изменений и
части программных сбоев, но не от потери сервера или диска. При ежедневном
расписании возможна потеря до 24 часов данных. Для защиты от потери VPS
потребуется отдельное внешнее хранилище и план восстановления.

## Логи, TLS и текущая диагностика

Логи API/web/worker находятся в отдельном journald namespace с семидневным
хранением. nginx и PostgreSQL Shprohli имеют отдельные правила logrotate:
ежедневная ротация, семь копий и порог размера. Политика OstKompass не менялась.

```bash
journalctl --namespace=shprohli -u shprohli-api.service -n 100 --no-pager
journalctl --namespace=shprohli -u shprohli-web.service -n 100 --no-pager
journalctl --namespace=shprohli -u shprohli-worker.service -n 100 --no-pager
systemctl is-active nginx.service postgresql@17-shprohli.service \
  postgresql@16-main.service ukrainedirekt.service
nginx -t
```

Certbot обновляет отдельные сертификаты `shprohli.ch` (включая `www`) и
`voice.shprohli.ch` через webroot `/var/www/shprohli-acme`. После обновления
только этих сертификатов hook проверяет конфигурацию и перезагружает nginx.
Оба продления и hook прошли staging dry-run.

```bash
systemctl is-active certbot.timer
certbot certificates
```

## Администратор и ограничения публичной беты

Продовая БД создавалась без локальных пользователей. Владелец прошёл новую
регистрацию с проверкой SMS и email; затем единственную подтверждённую
учётку повысили до суперадмина защищённой одноразовой транзакцией. Локальные
сессии и пользовательские данные не переносились.

Регистрация сначала блокировалась, потому что у нового окружения лимит
расходов был `NULL`. Первоначально установили USD 20 за скользящие 24 часа.
Позже владелец намеренно изменил его в **Admin → System** на USD 30; в
последней проверке БД было `30000000` микродолларов. Перед релизом читать
актуальное значение в админке, не возвращать USD 20 по старой инструкции.
Другие настройки резервов и лимитов также живут в БД, а не в Git.

`/health/ready` проверяет доступность приложения и БД. Для полного допуска
публичной беты отдельно проверить реальный исходящий звонок с Twilio/OpenAI,
WebSocket голосового домена, доставку уведомлений/алертов, расходные резервы
и путь поддержки. Успешная регистрация уже подтвердила рабочий путь SMS и
email для владельца; полная проверка провайдеров ещё не зафиксирована.
