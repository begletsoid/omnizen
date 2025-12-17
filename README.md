# Omnizen Dashboard

Персональный дашборд в тёмной теме. UI строится на React + Vite, данные живут в Supabase (Postgres + Storage), деплой выполняется на Netlify.

## Стек

- React 19 + TypeScript + Vite (SWC)
- TailwindCSS + CSS variables
- Zustand (UI state) и React Query (серверное состояние)
- Supabase JS SDK + Supabase CLI
- Vitest + Testing Library + MSW

## Быстрый старт

```bash
npm install
cp .env.example .env
```

Заполните `.env` данными из Supabase (подставьте значения своего проекта):

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Дальше:

```bash
npm run dev      # локальная разработка
npm run lint     # ESLint + Prettier
npm run typecheck # строгая проверка типов
npm run test     # Vitest (unit)
npm run build    # prod-сборка (Netlify)
npm run check    # lint + test + build (используется локально и в CI)
npm run smoke    # интеграционная проверка Supabase (нужен service role key)
```

### Перед пушем

Перед тем как отправлять код в репозиторий или просить ревью, обязательно выполните:

```bash
npm run check
```

Команда последовательно запускает `lint`, `test`, `build` и гарантирует, что Vite/SWC не упадёт на синтаксисе. Тот же шаг крутится в GitHub Actions (workflow `CI`), поэтому коммиты, которые не проходят `npm run check`, не попадут в `main`.

### После `git pull`

1. Примените все новые миграции Supabase:

```bash
npx supabase db push
```

2. Перезапустите локальный Supabase (если используете Docker) или сделайте `supabase db reset`, чтобы schema cache подхватил новые RPC.
3. Запустите `npm run smoke` — скрипт проверит, что критичные RPC (`reorder_habits`, `start_micro_task_timer` и т.д.) доступны. Если RPC не найден, скрипт упадёт с инструкцией.

Иначе вы можете увидеть ошибки вида `PGRST202: Could not find the function ... in the schema cache` и NaN в UI из‑за отсутствующих полей.

## Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase migration new <name>
npx supabase db push
npx supabase db pull   # требует Docker Desktop
```

Миграции и снапшоты лежат в `supabase/migrations`.

## Структура каталогов

```
src/
  app/        # App.tsx и провайдеры
  widgets/    # Виджеты дашборда
  lib/        # Supabase client и утилиты
  stores/     # Zustand store'ы
  styles/     # Tailwind + тема
  hooks/, types/  # заготовки под будущие модули
```

## Netlify

`netlify.toml` указывает `command = "npm run build"` и `publish = "dist"`. В настройках Netlify добавьте `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Так как значения `VITE_*` внедряются в клиентский бандл, добавьте также переменную `SECRETS_SCAN_OMIT_KEYS=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY`, чтобы secrets-scanner не останавливал билд. Continuous deployment уже включён через GitHub.

## Smoke test

Для проверки bootstrap-логики есть сценарий `npm run smoke`. Требуется задать переменные:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=... # service key из Supabase Settings → API
```

Скрипт создаёт временного пользователя через service key, выполняет `bootstrapDashboard` и удаляет созданные данные.
