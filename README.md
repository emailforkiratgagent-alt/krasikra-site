# krasikra-site

Продающий сайт сети магазинов «Хозяин Камчатки» (krasikra.ru).

- Стек: Next.js 16 (App Router) + Payload CMS 3, PostgreSQL, TypeScript. Сайт и админка (`/admin`) — одно приложение и один Docker-контейнер.
- Данные каталога, цены, заказы и оплата — X.Label Mobile API 1.30 (`platform=web`).
- Хостинг тестового стенда: Yandex Cloud Serverless Containers (`docs/infra/test-stand.md`).
- Правила проекта и работы с X.Label — `CLAUDE.md`, решения — `docs/decisions.md`.

## Структура

| Путь | Что там |
|---|---|
| `src/app/(frontend)` | Публичный сайт |
| `src/app/(payload)` | Админка и REST API Payload (файлы сгенерированы Payload) |
| `src/proxy.ts` | `X-Robots-Tag: noindex` по переменной `NOINDEX` во время работы |
| `src/collections`, `src/globals` | Модель CMS: сотрудники, «Интеграция X.Label» |
| `src/lib/xlabel` | Единственный клиент X.Label: запросы, ошибки, `hash_code`, настройки из админки |
| `src/lib/money.ts` | Деньги в копейках, количество в тысячных, сумма позиции как в X.Label |
| `src/lib/crypto` | Шифрование секретов в БД (AES-256-GCM) |
| `src/migrations` | Миграции БД (применяются при старте контейнера) |
| `tests/unit`, `tests/int` | Модульные тесты и тесты на настоящем PostgreSQL |

## Локальный запуск

Нужны Node.js 22+ (лучше 24), pnpm 10, Docker.

```bash
cp .env.example .env            # заполнить PAYLOAD_SECRET и SETTINGS_ENCRYPTION_KEY (openssl rand -base64 32)
docker compose up -d db         # PostgreSQL на 127.0.0.1:5432
pnpm install
pnpm migrate                    # применить миграции
pnpm dev                        # http://localhost:3000, админка — /admin
```

Первый созданный в админке пользователь становится администратором. Затем: «Администрирование → Интеграция X.Label» — адрес сервера, токен сайта, публичный ключ (`docs/xlabel/web_public_test.pem` для «Тест Камчатка») → «Сохранить» → «Проверить подключение».

## Проверки

```bash
pnpm lint && pnpm typecheck
pnpm test:unit
pnpm migrate && pnpm test:int   # нужен DATABASE_URL на пустую тестовую БД
pnpm build
```

CI (`.github/workflows/ci.yml`) делает всё это на каждый PR, плюс запускает собранный сервер и Docker-образ и проверяет noindex, закрытость настроек интеграции и ответ `/healthz`.

## Сгенерированные файлы

`pnpm-lock.yaml`, `src/lib/xlabel/schema.d.ts` (типы из OpenAPI), `src/payload-types.ts`, `src/app/(payload)/admin/importMap.js` и миграции создаются инструментами. CI падает, если они устарели. Обновить:

- локально: `pnpm generate:xlabel-types && pnpm generate:importmap && pnpm generate:types`, для изменений схемы БД — `pnpm payload migrate:create <имя>`;
- без локальной установки: запушить в ветку коммит с `[regen]` в сообщении (и `[migration:<имя>]` для миграции) — workflow `Regenerate` сам закоммитит обновлённые файлы.

## Переменные окружения

См. `.env.example`. На стенде и в бою задаются в ревизии контейнера (секреты — из Lockbox), в образ не попадают.

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `DATABASE_CA_CERT` | CA-сертификат Yandex Managed PostgreSQL (PEM) |
| `PAYLOAD_SECRET` | Подпись сессий админки |
| `SETTINGS_ENCRYPTION_KEY` | Ключ шифрования токена X.Label в БД (32 байта, base64). При смене ключа токен нужно ввести заново |
| `NEXT_PUBLIC_SERVER_URL` | Публичный адрес сайта без `/` на конце |
| `NOINDEX` | `true` (по умолчанию) — закрыть от индексации; в бою `false` |
| `PORT` | Порт (по умолчанию 8080) |

## Docker

```bash
docker build --platform linux/amd64 --provenance=false --sbom=false \
  --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t krasikra-web:local .
docker run --rm -p 8080:8080 --env-file .env -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/krasikra krasikra-web:local
```

Выкатка на стенд — `docs/infra/test-stand.md`.
