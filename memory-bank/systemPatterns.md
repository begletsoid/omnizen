# System Patterns

## Архитектура фронтенда
- **Vite + React + TypeScript** (шаблон react-swc-ts).
- Базовая структура на старте: `src/app`, `src/widgets`, `src/lib`, `src/stores`, `src/styles`. Папку `features` добавляем позже, чтобы не плодить пустые директории.
- **Состояние**:
  - React Query хранит все серверные данные (habits, tasks, problems, images, layout).
  - Zustand отвечает только за auth/session и локальные UI-настройки (например, временный layout до синхронизации).
  - Запрещено дублировать серверные данные в Zustand, чтобы избежать гонок.
- **Drag-and-drop**: используем только `@dnd-kit/core` + `@dnd-kit/sortable`. При необходимости пересмотреть решение, если реализации сетки окажется слишком сложным — рассмотреть `react-grid-layout`.
- **Стили**: Tailwind + CSS-переменные тёмной темы в `src/styles/theme.css`. Без CSS Modules параллельно.

## Интеграция с Supabase
- Клиент `src/lib/supabaseClient.ts` читает `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.
- Auth: `supabase.auth.onAuthStateChange` → Zustand `authStore`.
- `AuthProvider` (в `src/app/AuthProvider.tsx`) подписывается на сессию и кладёт user/session в Zustand; `AuthButton` вызывает `signInWithOAuth('google')` / `signOut`.
- API-слой появляется по мере реализации фич (напр., `src/features/habits/api.ts`).
- Миграции через Supabase CLI (`supabase migration new`, `supabase db push`). SQL храним в `supabase/migrations`.

## Хранение данных и layout
- Таблицы: `profiles` (зеркало auth.users), `dashboards`, `widgets`, `widget_layouts`, `habits`, `problems`, `problem_solutions`, `micro_tasks`, `images`.
- Поля `order` типа `numeric(10,4)` для drag-and-drop. Нужен периодический ресет порядка (добавим utility позже).
- Layout в `widget_layouts` как JSON массив `{widget_id,type,x,y,width,height,z}`. На клиенте `useDashboardLayout` делает debounced optimistic updates, сохраняет целиком массив.
- Поддержка нескольких dashboard'ов уже есть (таблица `dashboards`), MVP использует один `is_default = true`.

## Drag-and-drop риски
- Реализация сетки на dnd-kit требует контроля коллизий и авторасстановки. Если MVP буксует, позволяется перейти на `react-grid-layout`. Решение фиксируем в README.

## Supabase Storage
- Bucket `widget-images` (public read, owner write). В таблице `images.storage_path` храним путь, при удалении записи нужно вызывать storage API для очистки.
- Клиент ограничивает форматы (png/jpg/webp) и размер (<5MB).

## RLS и безопасность
- Для каждой таблицы прописываем политики SELECT/INSERT/UPDATE/DELETE вида `auth.uid() = user_id`.
- `problem_solutions` проверяет принадлежность через join на проблему.
- Тестируем политики через Supabase CLI (`supabase test` или `psql`).
- Env vars: `.env` (dev) и Netlify env (prod). `.env.example` коммитим.

## Ошибки и offline
- Все мутации используют optimistic update (React Query) + rollback при ошибке.
- UI уведомляет о провале (toast). Сети: retry с экспоненциальной задержкой, при offline показываем баннер.

## Тестирование
- Vitest + React Testing Library.
- Есть первый тест `DashboardShell` (проверяет кнопки входа/выхода через Zustand store). Дальше — при добавлении функционала добиваем покрытие.
- Supabase API мокируем через MSW.
- Для drag-and-drop используем util'ы dnd-kit (KeyboardSensor/PointerSensor) и пишем интеграционные тесты для виджетов.

