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

Лишний реестр `crpnle30iqt16eknkls5` (дубль) — удалить, если ещё не удалён.

## Выкатка новой версии

```
docker build --platform linux/amd64 --provenance=false --sbom=false -t cr.yandex/crpctlodpodsi49b12cm/krasikra-web:<тег> .
docker push cr.yandex/crpctlodpodsi49b12cm/krasikra-web:<тег>
yc serverless container revision deploy --container-name krasikra-web --image cr.yandex/crpctlodpodsi49b12cm/krasikra-web:<тег> --service-account-id ajeaghsfme6fi2g3j6es --cores 1 --memory 512MB --concurrency 4 --execution-timeout 30s
```

- Приложение слушает порт из переменной `PORT` (по умолчанию 8080).
- Флаги `--provenance=false --sbom=false` нужны при сборке в Docker Desktop.
- Сборку и выкатку делает человек со своего компьютера (там настроены Docker и `yc`) или CI. Облачные сессии Claude к `yc` и к стенду доступа не имеют.

## Что ещё понадобится для сайта

- **Managed PostgreSQL** в каталоге `krasikra`: данные Payload, сессии, токены покупателей, `orderId` Сбера.
- **Ключ шифрования** настроек интеграции (токен X.Label хранится в БД зашифрованным): секрет Lockbox → переменная окружения `PAYLOAD_SECRET` / `SETTINGS_ENCRYPTION_KEY`; сервисному аккаунту — роль `lockbox.payloadViewer`.
- **Триггер-таймер** (Cloud Functions) для фоновой проверки оплат и синхронизации каталога: вызывает служебный эндпоинт сайта.
- **Object Storage** для фото (кеш изображений X.Label, загрузки из CMS).
- Персональные данные покупателей хранятся только в Yandex Cloud (152-ФЗ).
