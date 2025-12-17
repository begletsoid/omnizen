# Progress

## Сделано
- Инициализирован git, настроен Netlify автодеплой, создан Memory Bank.
- Развёрнут Vite + React + Tailwind проект, добавлены React Query, Zustand, dnd-kit.
- Supabase CLI связан, Docker настроен, выполнен `supabase db pull`.
- Создана миграция `20251115124215_20251115_init_schema.sql` с enum, таблицами (dashboards/widgets/layout/habits/etc.), триггерами и RLS; миграция задеплоена.
- Настроен Supabase auth flow (AuthProvider + AuthButton), добавлены первые юнит-тесты (`DashboardShell`).
- Реализован API bootstrap дашборда/виджетов, создан слой `features/habits` (CRUD + reorder) и `features/layout` (debounce sync).
- Виджет «Лента привычек» подключён к данным, переписан drag-and-drop и серверный RPC `reorder_habits`.
- Добавлен виджет «Микрозадачи»: новые поля/enum в БД, RPC `start/pause/reorder`, React Query слой `features/microTasks`, UI с таймерами и drag-and-drop, smoke-сценарий и юнит-тесты утилит.
- Выпущен «таксономический» релиз микрозадач: миграция с таблицами `task_tags/task_categories/...`, RPC для CRUD, новые API/хуки и UI (popover-менеджер тегов/категорий, кнопка категорий на карточке, буфер наследования + юнит-тест).
- Виджет привычек дополнен счётчиками успехов/провалов (inline-редактирование, скрытие fail при 0, подсветка галочки, если успехи сегодня не фиксировались) и хранит новые поля в Supabase.
- UI виджета привычек переработан: осталась только скролл-зона и строка добавления, высота регулируется drag-хэндлами по краям вместо отдельных кнопок.

## В процессе / План
1. Расширить виджеты problems/tasks/images (CRUD + drag-and-drop).
2. Добавить MSW/интеграционные тесты для RPC (habits/micro tasks).
3. Завершить UX для остальных виджетов (проблемы/решения, картинки) и подготовить smoke-сценарии.

