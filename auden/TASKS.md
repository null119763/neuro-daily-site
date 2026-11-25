# TASKS — Auden

Статусы: `[ ]` не начато · `[~]` в работе · `[x]` готово и протестировано · `[!]` блокировано (нужно решение владельца)

## Этап 0. Документация
- [x] Анализ спецификаций и макетов, план (`docs/PLAN.md`)
- [x] Журнал решений (`docs/DECISIONS.md`)
- [x] TASKS.md, DEVELOPMENT_LOG.md, PROJECT_STATE.md, CLAUDE.md

## Этап 1. Scaffold и дизайн‑система
- [ ] Next.js + TS + Vitest, скрипты lint/typecheck/test
- [ ] Токены светлой/тёмной темы, системная тема, без мигания
- [ ] Адаптивный каркас: desktop sidebar, mobile drawer
- [ ] PWA manifest, иконки, service worker (только оболочка)
- [ ] i18n RU/EN

## Этап 2. Auden Core Engine
- [ ] Интерфейс ModelProvider (stream, capabilities, estimateCost)
- [ ] Mock provider
- [ ] OpenAI‑compatible provider (основа для vLLM/Ollama/собственных весов)
- [ ] OpenRouter provider + фильтр бесплатных моделей
- [ ] Режимы Air/Core/Prime и цепочки fallback
- [ ] Сборщик контекста с бюджетом токенов
- [ ] Retry с backoff, timeout, отмена
- [ ] Квоты и rate limit

## Этап 3. Данные и аутентификация
- [ ] Интерфейс Store, local‑адаптер
- [ ] Local auth (scrypt, httpOnly cookie‑сессии)
- [ ] SQL‑миграции Supabase с RLS
- [ ] Тесты RLS на Postgres (изоляция двух пользователей)
- [ ] Supabase‑адаптер Store/Auth

## Этап 4. API
- [ ] POST /api/chat (SSE)
- [ ] CRUD conversations / projects / memory
- [ ] GET /api/usage, профиль, экспорт и удаление данных
- [ ] Интеграционные тесты (два аккаунта не видят данные друг друга)

## Этап 5. UI
- [ ] Вход / регистрация
- [ ] Чат со streaming, отмена, ошибки, метка модели
- [ ] История: поиск, «Все / Проекты / Избранные», переименование, удаление
- [ ] Проекты с инструкциями
- [ ] Память: включение, подтверждение, правка, удаление
- [ ] Настройки: тема, язык, режим, персонализация, данные
- [ ] E2E на 360 / 768 / 1440 px

## Этап 6. CI
- [ ] GitHub Actions: lint, typecheck, unit, integration, rls, e2e

## Этап 7. Закрытая альфа (блокировано решениями)
- [!] Supabase‑проект (P2)
- [!] Ключ OpenRouter (P3)
- [!] Хостинг (P1)
- [!] Политика конфиденциальности / условия (P5)

## Позже
- [ ] Вложения: текст/PDF с лимитами и проверкой (Storage private)
- [ ] pgvector‑поиск по памяти
- [ ] Метрики удержания, качества, стоимости, задержки
- [ ] Auden Labs: eval‑набор, LoRA‑эксперименты
