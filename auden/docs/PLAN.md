# Auden — анализ документации и план реализации

Дата: 2026-11-25. Источник требований: `docs/spec/*.md` (оригиналы из архива `Auden_Alpha_Development.zip`), референсы дизайна: `docs/design/*.jpg` (сжатые копии; оригиналы PNG/JPEG не коммитятся из‑за размера ~19 МБ).

## 1. Сводка требований

| Область | Требование (источник) |
|---|---|
| Продукт | RU/EN ИИ‑помощник для проектов; путь к собственным моделям (AUDEN_MASTER, AUDEN_LABS) |
| MVP | Адаптивная PWA, регистрация, чат со streaming, история, проекты, темы, выбор режима, управляемая память (AUDEN_MASTER) |
| Вне MVP | Голос, изображения, агенты, платежи, коннекторы, тарифы — только концепты (AUDEN_MASTER, DESIGN_SYSTEM) |
| Стек | Next.js + TypeScript, серверные routes, Supabase Auth/Postgres/Storage; без FastAPI/Flutter (ARCHITECTURE) |
| API | `POST /api/chat` (SSE), CRUD `/api/conversations`, `/api/projects`, `/api/memory`, `GET /api/usage` |
| Провайдеры | Интерфейс `stream()`, `capabilities()`, `estimateCost()`; mock → OpenRouter (только бесплатные) → позже vLLM |
| Режимы | Air / Core / Prime — маршруты, а не собственные веса; показывать реального поставщика и модель (AI_ENGINE) |
| Надёжность | SSE, отмена, timeout, ограниченные повторы с backoff, журнал использования, понятные ошибки |
| Данные | profiles, projects, conversations, messages, memories, attachments, usage_events, training_consents; UUID, FK, индексы, RLS по `auth.uid()`; SQL‑миграции + тесты RLS (DATABASE) |
| Память | Выключаемая; просмотр/правка/удаление; предложенные записи подтверждает пользователь; provenance + дата; SQL‑поиск (MEMORY_SYSTEM) |
| Безопасность | Секреты только в env; квоты per‑user и глобальный потолок; лимиты размера; rate limit; документы — недоверенные; экспорт/удаление данных (SECURITY) |
| Дизайн | Палитра light `#F8F5F0/#EFEAE3/#22221F/#77785C`, dark `#151515/#202020/#F4F0E8/#B6B69A`; сетка 4/8; радиус 12–20; serif заголовки, sans UI, системные шрифты; ответ ИИ без пузыря; composer внизу; desktop sidebar, mobile drawer (DESIGN_SYSTEM) |
| Приёмка | Изоляция двух аккаунтов; чат на mock и реальном провайдере; история переживает перезагрузку; серверные лимиты; удаление чата и памяти; 360–1440 px; клавиатура и контраст |

## 2. Архитектура (принятая)

```
auden/
  src/
    core/          Auden Core Engine — не зависит от Next.js
      providers/   ModelProvider: mock, openai-compatible, openrouter (+ реестр)
      modes.ts     Air/Core/Prime → цепочки моделей
      context.ts   сборка контекста с бюджетом токенов
      quota.ts     серверные квоты и rate limit
      engine.ts    оркестратор: квота → контекст → stream → retry → usage
    domain/        типы и валидация (без зависимостей от БД)
    persistence/   интерфейс Store + адаптеры: local (dev/test), supabase (prod)
    auth/          интерфейс Auth + адаптеры: local (dev/test), supabase (prod)
    server/        связывание: выбор адаптеров по env, хелперы route handlers
    app/           Next.js App Router: страницы и /api/*
    ui/            компоненты, темы, i18n
  supabase/migrations/   SQL + RLS
  tests/                 unit, integration, rls (Postgres), e2e (Playwright)
```

Принципы:
- **Слои**: UI → API routes → Core Engine / Store. Core не знает про HTTP и БД — получает зависимости через интерфейсы. Это позволяет позже вынести engine в отдельный воркер или сервис.
- **Два бэкенда данных за одним интерфейсом.** `local` — файловое JSON‑хранилище с собственной аутентификацией (scrypt) для разработки, тестов и демо без внешних аккаунтов; **это рабочая реализация, а не заглушка**, но не предназначена для продакшена (один процесс). `supabase` — продакшен (RLS + Auth). Режим явно показывается в интерфейсе.
- **Собственные нейросети**: любой OpenAI‑совместимый сервер (vLLM, Ollama, LM Studio, TGI) подключается провайдером `openai-compatible` через env без изменения кода. OpenRouter — частный случай этого провайдера.
- **Только бесплатные модели**: модель допускается, если её id оканчивается на `:free` или по каталогу OpenRouter цена prompt/completion = 0. Платный fallback отсутствует в коде.

## 3. План реализации (этапы ROADMAP → задачи)

| # | Этап | Результат | Проверка |
|---|---|---|---|
| 0 | Документация | PLAN, TASKS, DEVELOPMENT_LOG, PROJECT_STATE, DECISIONS | — |
| 1 | Scaffold + дизайн‑система | Next.js, токены тем, адаптивный каркас, PWA manifest | typecheck, build |
| 2 | Core Engine | провайдеры mock/OpenRouter/OpenAI‑compatible, режимы, контекст, retry, отмена | unit |
| 3 | Persistence + Auth | Store/Auth интерфейсы, local‑адаптер, SQL‑миграции с RLS, Supabase‑адаптер | unit, RLS на Postgres |
| 4 | API | chat SSE, conversations, projects, memory, usage, profile, export/delete | integration (изоляция аккаунтов) |
| 5 | UI | вход/регистрация, чат со streaming, история, проекты, память, настройки | e2e Playwright 360/768/1440 |
| 6 | CI и документация запуска | GitHub Actions: lint, typecheck, unit, integration, e2e | CI зелёный |
| 7 | Закрытая альфа | Supabase‑проект, хостинг, ключ OpenRouter — **требует решений владельца** | ручная приёмка |
| 8+ | Метрики, вложения (текст/PDF), Labs | по ROADMAP | — |

## 4. Решения, требующие подтверждения владельца
См. `docs/DECISIONS.md`, раздел «Ожидают подтверждения».
