# PROJECT_STATE — Auden

> Точка входа для новой сессии. Читать первым, затем `TASKS.md` и `docs/DECISIONS.md`.

**Обновлено:** 2026-11-25 · **Ветки:** `claude/auden-platform-setup-fjnfvx` (PR #1), `claude/auden-alpha-hardening` (защита входа, закрытая альфа, перегенерация) · **Версия:** Alpha 0.1 (рабочий прототип)

## Где что лежит
- Приложение: `auden/` (корень репозитория — статический сайт NEURO DAILY, не трогать).
- Требования: `auden/docs/spec/`, макеты: `auden/docs/design/`, план: `auden/docs/PLAN.md`, решения: `auden/docs/DECISIONS.md`.
- CI: `.github/workflows/auden-ci.yml` (в корне репозитория).

## Что работает (проверено тестами)
- Регистрация/вход (local‑бэкенд), чат со streaming и отменой, история после перезагрузки, поиск, избранное, проекты с инструкциями, память с подтверждением, персонализация, темы, RU/EN, экспорт и удаление аккаунта, серверные квоты.
- Ответы — **mock‑провайдер**, пока не задан `OPENROUTER_API_KEY` (UI это явно показывает).
- Защита входа от перебора, режимы регистрации для закрытой альфы (allowlist), кнопка «Повторить» перегенерирует ответ.
- Тесты: 56 unit/integration (`npm test`), RLS (`npm run test:rls`), 15 e2e (`npm run build && npm run test:e2e`). Всё зелёное на момент записи.

## Что НЕ проверено
- Supabase‑адаптер против живого проекта (нужен проект владельца).
- Реальные ответы OpenRouter (нужен ключ владельца).

## Следующие шаги
1. Владелец: ревью и merge PR #1, затем PR ветки `claude/auden-alpha-hardening`.
2. Владелец: решения P1–P5 в `docs/DECISIONS.md` (хостинг, Supabase, ключ OpenRouter, репозиторий, юридическое).
3. С ключом OpenRouter: проверить streaming на реальной модели, зафиксировать `AUDEN_MODELS_*`.
4. С Supabase: применить миграцию, прогнать e2e с `AUDEN_BACKEND=supabase`, добавить e2e‑конфиг для него.
5. Затем: вложения текст/PDF, метрики альфы (стоимость, задержка, запросы на пользователя).

## Как продолжить
```bash
cd auden && npm ci
npm run check && npm run test:rls
npm run build && npm run test:e2e
npm run dev
```
