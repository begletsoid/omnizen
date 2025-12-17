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
- `micro_tasks` держат таймер: `elapsed_seconds bigint`, `timer_state enum (never/paused/running)`, `last_started_at timestamptz`. Частичный индекс `micro_tasks_running_unique` гарантирует один запущенАный таймер на виджет.
- Для drag-and-drop есть RPC: `reorder_habits` (статусы) и `reorder_micro_tasks` (линейный порядок). Клиент отправляет финальный список `[{id, order}]`, сервер нормализует значения.
- После каждого `git pull` нужно выполнять `supabase db push` и перезапускать локальный Supabase, чтобы schema cache увидел новые RPC (иначе PGRST202). Перед деплоем/ручным тестом прогоняем `npm run smoke`, который вызовет новые RPC и отловит ошибки типа «функция не найдена».
- Layout в `widget_layouts` как JSON массив `{widget_id,type,x,y,width,height,z}`. На клиенте `useDashboardLayout` делает debounced optimistic updates, сохраняет целиком массив.
- Поддержка нескольких dashboard'ов уже есть (таблица `dashboards`), MVP использует один `is_default = true`.

## Теги и категории микрозадач
- Схема: `task_tags` (уникальные имена на пользователя), `task_categories` (включают `is_auto` и `source_tag_id`), `category_tags` (tag ↔ category), `task_category_links` (task ↔ category), `task_category_buffers` (массив последне-использованных категорий).
- RPC функции в `20251116181623_20251117_micros_tags_categories.sql`: `create_task_tag_with_category`, `delete_task_tag_and_associated_data`, `attach_tag_to_category`, `detach_tag_from_category`, `attach_categories_to_task`, `detach_category_from_task`. Все проверяют `auth.uid` и принимают `p_user_id`.
- Клиентский слой (`features/microTasks/api|hooks.ts`) работает через React Query: отдельные хуки для тегов, категорий, буфера и привязок к задаче. Новый таск автоматически получает категории из буфера (сохраняем через `useSetTaskCategoryBuffer` при каждом изменении привязок).
- UI виджета микрозадач использует `@floating-ui/react` для поповеров: глобальный менеджер тегов/категорий с инлайновым CRUD и поповер на карточке задачи для быстрого назначения категорий.

## Drag-and-drop риски
- Основной layout работает на сетке 12×N, но каждая ячейка делится на 3 под-ячейки (subgrid). `x/y` храним в дробях (0, 1/3, 2/3...), а физический шаг dnd равен ширине/высоте под-ячейки, поэтому виджеты можно смещать на треть стандартной ширины/высоты.
- Реализация сетки на dnd-kit требует контроля коллизий и авторасстановки. Если MVP буксует, позволяется перейти на `react-grid-layout`. Решение фиксируем в README.
- Внутренние списки (привычки, микрозадачи) используют `@dnd-kit` + оптимистичные обновления React Query; при savings мы всегда приводим order к 1..N, чтобы не копить float-значения.

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

## Оптимистичные мутации (UI)
- Для всех быстрых действий в виджетах (микрозадачи: done/undo, архив, add/remove тег/категория, создание; привычки: создание/перетаскивание/счётчики) обязательно `onMutate` → мгновенное обновление кэша React Query и локального UI; `onError` откатывает снапшот, `onSettled` делает invalidate.
- Добавление/удаление тегов и привязка категорий к задаче обновляют кэш `microTasks`/`taskTags` сразу, чтобы клики не ждали ответа бэкенда.
- Перетаскивания/реордеры сохраняют порядок сразу в кэше и потом отправляют RPC; на ошибках возвращаем предыдущий порядок.
- Не забываем импортировать нужные типы (например, `CSSProperties` из `react`) и синхронизировать пропы компонентов с фактическими вызовами, иначе CI/Netlify может упасть на строгом TS.

## Тестирование
- Vitest + React Testing Library.
- Есть юнит-тесты для утилит drag-and-drop (`habits`, `microTasks`) и smoke-сценарии (habits reorder, micro task timers/layout).
- Supabase API мокируем через MSW.
- Для drag-and-drop используем util'ы dnd-kit (KeyboardSensor/PointerSensor) и пишем интеграционные тесты для виджетов.
- Перед пушем обязательно `npm run check` (lint + test + build). Тот же шаг выполняется в GitHub Actions (`.github/workflows/ci.yml`), поэтому синтаксические ошибки (SWC) ловятся до ревью.

