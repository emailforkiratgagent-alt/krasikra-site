# Тестовый стенд в Yandex Cloud

Создан 31.10.2026. Сейчас на стенде заглушка «Тестовый стенд, сайт в разработке» (nginx, noindex). Сайт выкатывается новой ревизией в тот же контейнер — адрес не меняется.

## Адрес

https://bbao7qlt20srpoj954vk.containers.yandexcloud.net/

Адреса возврата после оплаты (заполняются в X.Label, проект «Тест Камчатка», настройки платёжной системы Сбера `webReturnUrl` / `webFailUrl`):

- `https://bbao7qlt20srpoj954vk.containers.yandexcloud.net/order/{order_id}/success`
- `https://bbao7qlt20srpoj954vk.containers.yandexcloud.net/order/{order_id}/fail`

Для боевого проекта (заполнить в день переключения домена): `https://krasikra.ru/order/{order_id}/success` и `/fail`.

## Ресурсы

| Ресурс | Имя | ID |
|---|---|---|
| Облако | — | `b1gjmvahh1mrjmht379l` |
| Каталог | krasikra | `b1ghi207b5unmot9jler` |
| Сервисный аккаунт | krasikra-web-sa (роль `container-registry.images.puller`) | `ajeaghsfme6fi2g3j6es` |
| Реестр образов | krasikra | `crpctlodpodsi49b12cm` |
| Serverless Container | krasikra-web (публичный вызов разрешён) | `bbao7qlt20srpoj954vk` |
| Сервисный аккаунт выкатки | krasikra-ci-sa (создаёт `infra/yc/setup-ci.sh`) | — |
| Федерация удостоверений | krasikra-github (GitHub OIDC) | — |
| Секрет Lockbox | krasikra-web-test | — |

Лишний реестр `crpnle30iqt16eknkls5` (дубль) — удалить, если ещё не удалён.

## Выкатка новой версии

**Автоматически** (после настройки, PR №3): всё, что влито в `main`, GitHub Actions собирает и выкатывает на стенд (workflow `.github/workflows/test-stand.yml`, вкладка Actions → Test stand). Каждый PR собирается и проходит проверку запуска без выкатки. Тег образа: `ГГГГММДД-ЧЧММ-<коммит>`.

- Вход GitHub в Yandex Cloud — федерация удостоверений `krasikra-github` (OIDC, издатель `https://token.actions.githubusercontent.com`, аудитория `https://github.com/emailforkiratgagent-alt`). Доверие выдано только ветке `main`: `repo:emailforkiratgagent-alt/krasikra-site:ref:refs/heads/main`. Ключей и паролей в GitHub нет.
- Сервисный аккаунт выкатки `krasikra-ci-sa`: `serverless-containers.editor`, `functions.editor` (нужна для передачи секретов), `lockbox.viewer` на каталог; `container-registry.images.pusher` на реестр; `iam.serviceAccounts.user` на `krasikra-web-sa`. Его ID вписан в workflow (`CI_SA_ID`).
- Настройка облака — один раз скриптом `infra/yc/setup-ci.sh` (с компьютера, где настроен `yc`). Повторный запуск безопасен: существующее не меняет, значения секрета не перезаписывает.
- Повторить выкатку без нового коммита: Actions → Test stand → Run workflow (ветка `main`).

**Вручную** (запасной вариант, с компьютера с Docker и `yc`):

```
docker build --platform linux/amd64 --provenance=false --sbom=false -t cr.yandex/crpctlodpodsi49b12cm/krasikra-web:<тег> .
docker push cr.yandex/crpctlodpodsi49b12cm/krasikra-web:<тег>
yc serverless container revision deploy --container-name krasikra-web --image cr.yandex/crpctlodpodsi49b12cm/krasikra-web:<тег> --service-account-id ajeaghsfme6fi2g3j6es --cores 1 --memory 512MB --concurrency 4 --execution-timeout 30s \
  --secret environment-variable=PAYLOAD_SECRET,name=krasikra-web-test,key=PAYLOAD_SECRET \
  --secret environment-variable=SETTINGS_ENCRYPTION_KEY,name=krasikra-web-test,key=SETTINGS_ENCRYPTION_KEY
```

- Приложение слушает порт из переменной `PORT` (по умолчанию 8080), отвечает на `/healthz`, отдаёт `X-Robots-Tag: noindex`.
- Флаги `--provenance=false --sbom=false` нужны при сборке в Docker Desktop.
- Облачные сессии Claude к `yc` и к стенду доступа не имеют: изменения в облаке делает человек (скриптом) или GitHub Actions.

## Секреты

Lockbox, секрет `krasikra-web-test` в каталоге `krasikra`; читать содержимое может только `krasikra-web-sa` (`lockbox.payloadViewer`). При выкатке передаётся текущая версия секрета в переменные окружения:

| Ключ | Назначение |
|---|---|
| `PAYLOAD_SECRET` | Подпись сессий и токенов Payload CMS. |
| `SETTINGS_ENCRYPTION_KEY` | Шифрование токена X.Label в настройках интеграции (AES-256, base64). |
| `DATABASE_URI` | Появится вместе с базой данных. |

Новый или изменённый ключ: добавить версию секрета в консоли (Lockbox → секрет → «Новая версия», остальные ключи сохраняются), при необходимости дописать строку в `revision-secrets` workflow и перевыкатить. Смена `SETTINGS_ENCRYPTION_KEY` делает сохранённый токен X.Label нечитаемым — после смены токен надо ввести в админке заново.

## База данных

Пока нет (стартового гранта у облака нет, кода сайта ещё нет). План: вместе с каркасом кода — PostgreSQL на маленькой прерываемой ВМ в той же сети (≈400–500 ₽/мес), перед запуском — Managed PostgreSQL (s3-c2-m8, ≈5,8 тыс. ₽/мес; burstable-классов b1/b2 для новых кластеров больше нет). Контейнер подключается к базе через сеть каталога (`revision-network-id`), адрес базы — в секрете `DATABASE_URI`.

## Что ещё понадобится для сайта

- **PostgreSQL** (см. «База данных»): данные Payload, сессии, токены покупателей, `orderId` Сбера.
- **Триггер-таймер** (Cloud Functions) для фоновой проверки оплат и синхронизации каталога: вызывает служебный эндпоинт сайта.
- **Object Storage** для фото (кеш изображений X.Label, загрузки из CMS).
- Персональные данные покупателей хранятся только в Yandex Cloud (152-ФЗ).
