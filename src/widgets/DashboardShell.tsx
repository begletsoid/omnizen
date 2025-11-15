import { AuthButton } from '../components/AuthButton';
import { useBootstrapDashboard } from '../features/dashboards/hooks';
import { useAuthStore } from '../stores/authStore';
import { HabitsWidget } from './habits/HabitsWidget';

import { WidgetPlaceholder } from './WidgetPlaceholder';
import type { WidgetPlaceholderProps } from './WidgetPlaceholder';

const placeholderBlueprints: WidgetPlaceholderProps[] = [
  {
    title: 'Проблемы / Решения',
    description: 'Таблица проблем и альтернативных решений с редактированием по месту.',
    accent: 'amber',
  },
  {
    title: 'Микрозадачи',
    description: 'Быстрый todo-лист с чекбоксами и сортировкой мышью.',
    accent: 'cyan',
  },
  {
    title: 'Виджет-картинка',
    description: 'Загрузка изображений, перемещение и изменение размеров.',
    accent: 'pink',
  },
];

export function DashboardShell() {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id ?? null;
  const {
    data: bootstrap,
    isLoading: isDashboardLoading,
    isError,
    error,
  } = useBootstrapDashboard(userId);
  const userLabel =
    user?.user_metadata?.full_name ?? user?.email ?? (user ? `id: ${user.id}` : 'Гость');
  const habitsWidget = bootstrap?.widgets.find((widget) => widget.type === 'habits');

  return (
    <div className="min-h-screen bg-background text-text">
      <header className="flex flex-col gap-5 px-6 pb-8 pt-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-muted">omnizen</p>
          <h1 className="text-3xl font-semibold">
            {bootstrap?.dashboard.title ?? 'Персональный дашборд'}
          </h1>
          <p className="text-sm text-muted">
            Вход через Google, данные хранятся в Supabase. Дальше здесь появится drag-and-drop сетка
            с живыми виджетами.
          </p>
          {isDashboardLoading && user ? (
            <p className="text-xs text-muted">Загружаем ваши виджеты…</p>
          ) : null}
          {isError ? (
            <p className="text-xs text-red-400">
              Не удалось загрузить дашборд: {error?.message ?? 'неизвестная ошибка'}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-4 text-sm text-muted sm:items-end">
          <div className="flex gap-4">
            <div className="text-left sm:text-right">
              <p className="font-semibold text-text">Netlify</p>
              <p>CI / CD готов</p>
            </div>
            <div className="text-left sm:text-right">
              <p className="font-semibold text-text">Supabase</p>
              <p>Schema snapshot подтянут</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-left text-xs uppercase tracking-widest text-muted sm:text-right">
              <p className="text-[0.65rem]">Пользователь</p>
              <p className="text-base font-semibold normal-case tracking-normal text-text">
                {userLabel}
              </p>
            </div>
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="grid gap-6 px-6 pb-16">
        <HabitsWidget widgetId={habitsWidget?.id ?? null} />
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {placeholderBlueprints.map((widget) => (
            <WidgetPlaceholder key={widget.title} {...widget} />
          ))}
        </div>
      </main>
    </div>
  );
}
