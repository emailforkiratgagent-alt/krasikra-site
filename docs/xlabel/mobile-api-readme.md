# XLabel Mobile API — версия 1.30

Документация API мобильных приложений (актуальная версия — **1.30**, параметр `latest_api_version` в `config/services.yaml`).

- Машиночитаемая спецификация: [`openapi.yaml`](openapi.yaml) (OpenAPI 3.0.3) — открывается в Swagger UI, Redoc, Postman, Insomnia.
- Источник: контроллеры `src/Controller/API/v1`, нормализаторы `src/Serializer/Normalizer`, формы `src/Form`, маршруты `config/routes.yaml`, безопасность `config/packages/security.yaml`.

Просмотр локально:

```bash
npx @redocly/cli preview-docs docs/api/openapi.yaml
```

## Базовый URL и версии

```
https://<host>/api/v<major>.<minor>/<метод>
```

Пример: `GET https://example.com/api/v1.30/stores`.

- Версия передаётся в пути (`_v` = `\d+\.\d+`). Если указать версию, которой нет, сервер не ругается — поведение определяется сравнением версий (`version_compare`) внутри методов.
- **Версия влияет на состав полей ответа и доступность методов.** Метод, появившийся позже указанной версии, отвечает `404`. В спецификации у таких методов и полей есть пометка «С vX.Y».
- Рекомендуется всегда запрашивать актуальную версию (`1.30`) и учитывать, что новые поля бывают необязательными: **поля со значением `null` в ответе отсутствуют**.

Что нового в 1.30 (по коду):

| Область | Изменение |
|---|---|
| Авторизация | `POST /token/whatsapp/start`, `POST /token/whatsapp` |
| Подтверждение телефона | `token_type`: `whatsapp`, `max`; `POST /people/phone/verify/whatsapp/start`, `/max/start` |
| Заказы | `POST /orders/{id}/payments/init` — создание платежа на сервере (Сбербанк, App2App) |
| Магазин | `city_guid`, `working_hours`, `additional_info`, `timezone` |
| Товар | `old_price`, `recommended_home`, `recommended_cart`, `require_add_to_cart` |
| Способ оплаты | `sber_pay_merchant_login`, `sber_pay_api_key` (для App2App) |

## Авторизация

Двухуровневая, оба заголовка передаются на каждый запрос:

| Заголовок | Значение | Когда |
|---|---|---|
| `X-APP-TOKEN` | `Bearer <app_token>` — токен приложения (проекта) | всегда; без него `401` |
| `Authorization` | `Bearer <access_token>` — токен пользователя | для методов пользователя |

В спецификации (`security` у каждого метода) используются три варианта:

- **оба заголовка** — метод пользователя;
- **только `X-APP-TOKEN`** — публичные данные проекта;
- **`Authorization` необязателен** — с ним ответ персонализируется (например, поле `viewed_at` у новостей и акций).

### Получение токенов

Все методы `POST /token/*` возвращают одинаковый ответ:

```json
{
  "response": {
    "access_token": "…",
    "expires_in": 3600,
    "token_type": "bearer",
    "refresh_token": "…"
  }
}
```

Когда `access_token` истёк (`401`), обновите его через `POST /token/refresh` с `refresh_token`.

Способы входа (набор доступных способов отдаёт `GET /settings` → `auth_providers`):

| Способ | Методы |
|---|---|
| Телефон + пароль | `/token/phone` |
| Карта + пароль | `/token/card` |
| Firebase (SMS) | `/token/firebase` |
| Google | `/token/google` |
| Telegram / Max / WhatsApp | `/token/{provider}/start` → пользователь подтверждает в мессенджере по `url` → `/token/{provider}` с `id_token` |
| Одноразовый пароль SMS.ru | `/token/otp/request` → `/token/otp/check` |

Методы `/token/account_kit` и `/token/facebook` остались как заглушки и всегда возвращают ошибку (в спецификацию не включены).

### Идентификация устройства (`hash_code`)

Начиная с v1.9 методы входа и подтверждения телефона требуют параметр `hash_code` — идентификатор устройства, зашифрованный публичным ключом проекта. Без него — `400 «Ошибка проверки подлинности запроса»`. Если устройство заблокировано — `403` (до v1.10 — `401`) с текстом для пользователя.

## Формат запросов и ответов

- **Успех:** `{"response": <данные>}`.
- **Ошибка:** `{"error": "<сообщение>"}` с HTTP-статусом ошибки. Сообщения предназначены для показа пользователю (на русском).
- Исключение: `POST /orders/{id}/payments/init` возвращает ответ платёжного шлюза «как есть» без обёртки `response`.
- **Тело запроса.** Большинство `POST` читают параметры из query-строки или `application/x-www-form-urlencoded`; JSON-тело (`application/json`) обязательно только у `POST /orders`, `POST /orders/{id}`, `POST /people/addresses/new`, `POST /receipt_rate/rate`. В спецификации поля формы описаны в `requestBody`.
- **Ключи JSON** — `snake_case`.
- **Даты** — ISO 8601 (`2026-10-24T12:00:00+03:00`); дата доставки — `YYYY-MM-DD`; время — `HH:MM`.
- **Деньги** в заказах, товарах и доставке — **строка в рублях с двумя знаками** (`"199.00"`); на запись (создание заказа) суммы передаются в том же формате.
- **Идентификаторы** магазинов, товаров, заказов и т.д. — целые числа; чеки и подарки — UUID.
- **Пагинация:** только `GET /orders` (`page` с 1, `per_page`, по умолчанию 10) и `GET /people/accounts/{id}/transactions` (`limit` до 100 + `time_offset`).
- **Ошибка 200 с `error`.** Часть методов при ошибке валидации отвечает `200` с телом `{"error": …}` — проверяйте наличие поля `error`, а не только статус. В спецификации такие места помечены словами «особый случай».

## Рекомендуемый порядок работы клиента

1. `GET /settings?platform=android|ios` — конфигурация проекта и способы входа.
2. `GET /versions?platform=…&version=X.Y.Z` — даты изменения разделов; загружайте только изменившиеся (stores, news, adverts, banners, products, …). При авторизованном запросе также регистрирует вход и push-токен.
3. Авторизация (`/token/*`), затем `GET /people`, `GET /people/accounts`.
4. Каталог и заказ: `/stores` → `/products?store=` → `/product_mods` → `/shipment_methods` → `/shipment_methods/{id}/calc` → `/payment_methods` → `POST /orders` → оплата (`/orders/{id}/payments` или `/orders/{id}/payments/init`).

## Заказы: как устроено

Поток оплаты:

1. `POST /orders` создаёт заказ (`state`, `payment_state`, `verify_code`).
2. Для онлайн-оплаты (`payment_method.online = true`):
   - **Tinkoff** — платёж проводится через мобильный SDK, затем клиент сообщает идентификатор через `POST /orders/{id}/payments` (`payment_id`).
   - **Сбербанк** — с v1.30 `POST /orders/{id}/payments/init` возвращает `formUrl`/`orderId`; после оплаты — `POST /orders/{id}/payments`.
3. Заказ нельзя изменить после оплаты, отмены или принятия точкой (`400`).

Требования к полям зависят от способа доставки: `require_store`, `require_address` (см. `GET /shipment_methods`), а доступные даты и окна — от `GET /settings` → `orders` и `GET /shipment_time_windows`.

## Другие API проекта (вне этого документа)

| Префикс | Назначение |
|---|---|
| `/guests/api/v1.0/…` | Гостевой режим приложения (вход, push, QR) |
| `/api/admin/…` | Административный API (оценка чеков, устройства POS) — вход по email/паролю администратора |
| `/pos/api/v1/…`, `/evotor/api/v1/…` | Интеграции с кассами (POS, Эвотор) |

## Замечания по коду, обнаруженные при составлении документации

- `POST /people/photo` фактически не загружает фото: метод только проверяет авторизацию и возвращает профиль.
- `POST /feedback/new`, `POST /feedback/password_reset_issue`, `POST /orders`, `POST /people/addresses/new` в ряде случаев возвращают ошибку с кодом `200`; в `POST /orders`/`/people/addresses/new` код `400` по ошибке положен внутрь тела (`json(['error' => '…', 400])`), а не в статус ответа.
- `GET /people/accounts/transactions` удалён с v1.1 и в 1.30 всегда отвечает `404`; `GET /receipt_rate/questions` — с v1.5.
- В `GET /versions` для проекта с идентификатором `f50d11b4-…` зашита проверка минимальной версии приложения.
