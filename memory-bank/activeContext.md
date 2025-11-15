# Active Context

## Состояние
- Vite + React структура развернута, Tailwind/React Query/Zustand подключены, есть базовый дашборд-плейсхолдер.
- Supabase CLI связан, Docker настроен, выполнен `db pull`.
- Схема БД разработана, миграция `20251115124215_20251115_init_schema.sql` задеплоена (enum, таблицы, индексы, RLS).

## В работе
- Supabase auth подключён (AuthProvider + AuthButton), есть юнит-тесты на UI.
- Реализованы bootstrap дашборда/виджетов и API/хуки для `habits` + `layout`.
- Впереди — подключение данных к UI и реализация драг-н-дропа.

## Следующие шаги
1. Интегрировать `useHabits` и `useDashboardLayout` в виджеты, обеспечить CRUD + reorder.
2. Добавить drag-and-drop, обновление порядка/статусов привычек и покрыть тестами.
3. Аналогично реализовать API/виджеты для problems/tasks/images.

