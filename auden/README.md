# Auden

Масштабируемая платформа ИИ‑ассистента (Alpha 0.1): адаптивная PWA с чатом (streaming), историей, проектами, управляемой памятью и персонализацией. Модели подключаются через OpenRouter (только бесплатные) или собственный OpenAI‑совместимый сервер.

## Быстрый старт (локально, без внешних сервисов)

Требуется Node.js ≥ 20.9.

```bash
cd auden
npm ci
cp .env.example .env.local   # по умолчанию: локальное хранилище + mock-провайдер
npm run dev                  # http://localhost:3000
```

Без ключа OpenRouter все ответы генерирует **mock‑провайдер** — интерфейс явно это помечает. Данные хранятся в `.data/auden-dev.json` (файл в `.gitignore`).

### Подключение реальной модели (OpenRouter, бесплатные модели)

1. Получите ключ на openrouter.ai (покупать кредиты не требуется).
2. В `.env.local`: `OPENROUTER_API_KEY=...`
3. Необязательно: задайте модели для режимов, например `AUDEN_MODELS_CORE=meta-llama/llama-3.3-70b-instruct:free`. Без этого Auden сам выберет модели из каталога бесплатных. Платные модели отклоняются кодом.

### Собственная модель (vLLM, Ollama, LM Studio)

```env
AUDEN_CUSTOM_BASE_URL=http://localhost:11434/v1
AUDEN_CUSTOM_MODELS=llama3.1:8b
AUDEN_CUSTOM_MODES=prime        # какие режимы сначала идут на свой сервер
```

### Продакшен‑хранилище (Supabase)

1. Создайте бесплатный проект Supabase и примените `supabase/migrations/*.sql` (SQL Editor или `supabase db push`).
2. `AUDEN_BACKEND=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

> Адаптер Supabase написан, а схема и RLS проверены на настоящем Postgres, но сквозная проверка с живым проектом Supabase ещё не выполнялась.

### Закрытая альфа

```env
AUDEN_SIGNUP_MODE=allowlist
AUDEN_ALLOWED_EMAILS=friend@example.com,@mycompany.com
```

С Supabase дополнительно (база блокирует и прямую регистрацию через API):

```sql
update public.app_config set value = 'allowlist' where key = 'signup_mode';
insert into public.signup_allowlist (entry) values ('friend@example.com'), ('@mycompany.com');
```

### Метрики альфы

Страница `/admin` доступна только администраторам: локально — `AUDEN_ADMIN_EMAILS=you@example.com`; в Supabase —
`insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';`

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | dev‑сервер |
| `npm run build && npm start` | production‑сборка и запуск |
| `npm run check` | lint + typecheck + unit/integration |
| `npm test` | Vitest: unit (ядро) и integration (API, изоляция аккаунтов) |
| `npm run test:rls` | миграции + тесты RLS на временном Postgres (нужны бинарники PostgreSQL 15+) |
| `npm run test:e2e` | Playwright (нужна предварительная `npm run build`) |

## Архитектура

```
src/core/         Auden Core Engine (без зависимостей от фреймворка)
  providers/      mock, openai-compatible (свои веса), openrouter (только free)
  engine.ts       маршрутизация по цепочке моделей, retry/backoff, timeout, отмена
  context.ts      сборка контекста: политика → профиль → проект → память → история
  quota.ts        квоты per-user и глобальный потолок (по данным БД)
  router.ts       режимы Air / Core / Prime → цепочки моделей
src/domain/       типы и валидация (zod)
src/persistence/  интерфейс UserStore; local JSON и Supabase адаптеры
src/auth/         локальная аутентификация (scrypt)
src/server/       конфигурация, бэкенды, API (web Request → Response), чат‑сервис
src/app/          Next.js App Router (страницы, /api/* catch-all)
src/ui/           компоненты, i18n RU/EN, клиентский API
supabase/         SQL‑миграции с RLS
tests/            unit, integration, rls; e2e/ — Playwright
```

Документация проекта: `PROJECT_STATE.md` (состояние), `TASKS.md`, `DEVELOPMENT_LOG.md`, `docs/PLAN.md`, `docs/DECISIONS.md`, исходные требования — `docs/spec/`.
