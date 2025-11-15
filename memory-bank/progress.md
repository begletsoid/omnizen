# Progress

## Сделано
- Инициализирован git, настроен Netlify автодеплой, создан Memory Bank.
- Развёрнут Vite + React + Tailwind проект, добавлены React Query, Zustand, dnd-kit.
- Supabase CLI связан, Docker настроен, выполнен `supabase db pull`.
- Создана миграция `20251115124215_20251115_init_schema.sql` с enum, таблицами (dashboards/widgets/layout/habits/etc.), триггерами и RLS; миграция задеплоена.
- Настроен Supabase auth flow (AuthProvider + AuthButton), добавлены первые юнит-тесты (`DashboardShell`).
- Реализован API bootstrap дашборда/виджетов, создан слой `features/habits` (CRUD + reorder) и `features/layout` (debounce sync).

## В процессе / План
1. Интегрировать реальные данные (`useHabits`, `useDashboardLayout`) в UI, реализовать drag-and-drop.
2. Добавить API/виджеты для остальных доменов (problems/tasks/images).
3. Расширить тесты (MSW, dnd-kit сценарии).

