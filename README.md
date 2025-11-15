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

Заполните `.env` данными из Supabase:

```
VITE_SUPABASE_URL=https://yktrciuznnagegrhkfhm.supabase.co
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Дальше:

```bash
npm run dev      # локальная разработка
npm run lint     # ESLint + Prettier
npm run test     # Vitest (unit)
npm run build    # prod-сборка (Netlify)
npm run smoke    # интеграционная проверка Supabase (нужен service role key)
```

## Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref yktrciuznnagegrhkfhm
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

`netlify.toml` указывает `command = "npm run build"` и `publish = "dist"`. В настройках Netlify добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`, чтобы продакшн имел доступ к базе. Continuous deployment уже включён через GitHub.

## Smoke test

Для проверки bootstrap-логики есть сценарий `npm run smoke`. Требуется задать переменные:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=... # service key из Supabase Settings → API
```

Скрипт создаёт временного пользователя через service key, выполняет `bootstrapDashboard` и удаляет созданные данные.
