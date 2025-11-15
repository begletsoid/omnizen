import { useMemo, useState } from 'react';
import clsx from 'clsx';

import type { HabitRecord, HabitStatus } from '../../features/habits/types';
import {
  useCreateHabit,
  useDeleteHabit,
  useHabits,
  useUpdateHabit,
} from '../../features/habits/hooks';

const STATUS_META: Array<{
  key: HabitStatus;
  label: string;
  accent: string;
}> = [
  { key: 'adopted', label: 'Внедрено', accent: 'border-emerald-500/40' },
  { key: 'in_progress', label: 'Внедряется', accent: 'border-amber-500/40' },
  { key: 'not_started', label: 'Не внедрено', accent: 'border-rose-500/40' },
];

type HabitsWidgetProps = {
  widgetId: string | null;
  title?: string;
};

export function HabitsWidget({ widgetId, title = 'Лента привычек' }: HabitsWidgetProps) {
  const ready = Boolean(widgetId);
  const { data, isLoading, isError, error } = useHabits(widgetId ?? null);
  const createHabit = useCreateHabit(widgetId ?? null);
  const updateHabit = useUpdateHabit(widgetId ?? null);
  const deleteHabit = useDeleteHabit(widgetId ?? null);

  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState<HabitStatus>('not_started');

  const grouped = useMemo(() => {
    const initial = STATUS_META.reduce<Record<HabitStatus, HabitRecord[]>>(
      (acc, { key }) => ({ ...acc, [key]: [] }),
      {
        adopted: [],
        in_progress: [],
        not_started: [],
      },
    );

    if (!data) return initial;

    data.forEach((habit) => {
      initial[habit.status].push(habit);
    });

    (Object.keys(initial) as HabitStatus[]).forEach((key) => {
      initial[key] = initial[key].slice().sort((a, b) => a.order - b.order);
    });

    return initial;
  }, [data]);

  const handleCreate = async (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!newTitle.trim() || !widgetId) return;
    await createHabit.mutateAsync({ title: newTitle.trim(), status: newStatus });
    setNewTitle('');
    setNewStatus('not_started');
  };

  const handleRename = async (habit: HabitRecord) => {
    const nextTitle = window.prompt('Новое название привычки', habit.title);
    if (!nextTitle || nextTitle === habit.title) return;
    await updateHabit.mutateAsync({ id: habit.id, title: nextTitle });
  };

  const handleStatusChange = async (habit: HabitRecord, status: HabitStatus) => {
    if (status === habit.status) return;
    await updateHabit.mutateAsync({ id: habit.id, status });
  };

  if (!ready) {
    return (
      <section className="glass-panel flex flex-col gap-2 px-5 py-6">
        <h2 className="text-lg font-semibold text-muted">Лента привычек</h2>
        <p className="text-sm text-muted">Виджет пока не готов — обновите страницу.</p>
      </section>
    );
  }

  return (
    <section className="glass-panel flex flex-col gap-6 border border-border bg-surface/80 px-5 py-6 shadow-card">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-muted">виджет</p>
          <h2 className="text-2xl font-semibold text-text">{title}</h2>
        </div>
        <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            value={newTitle}
            onChange={(evt) => setNewTitle(evt.target.value)}
            placeholder="Новая привычка"
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />
          <select
            value={newStatus}
            onChange={(evt) => setNewStatus(evt.target.value as HabitStatus)}
            className="rounded-md border border-border bg-surface px-2 py-2 text-sm text-text outline-none"
          >
            {STATUS_META.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!newTitle.trim() || createHabit.isPending}
            className="rounded-md bg-accent/20 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/30 disabled:opacity-50"
          >
            Добавить
          </button>
        </form>
      </header>

      {isLoading && <p className="text-sm text-muted">Загружаем привычки…</p>}
      {isError && (
        <p className="text-sm text-rose-400">
          Не удалось загрузить привычки: {error?.message ?? 'неизвестная ошибка'}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {STATUS_META.map((status) => (
          <div key={status.key} className="flex flex-col gap-3 rounded-2xl border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text">
                {status.label}
              </h3>
              <span className="text-xs text-muted">{grouped[status.key].length}</span>
            </div>
            <div className={clsx('flex flex-col gap-2')}>
              {grouped[status.key].length === 0 ? (
                <p className="text-xs text-muted/70">Нет привычек</p>
              ) : (
                grouped[status.key].map((habit) => (
                  <article
                    key={habit.id}
                    className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-text shadow-inner"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{habit.title}</p>
                      <div className="flex items-center gap-1 text-xs text-muted">
                        <button
                          type="button"
                          onClick={() => handleRename(habit)}
                          className="transition hover:text-text"
                        >
                          Изм.
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteHabit.mutate(habit.id)}
                          className="transition hover:text-rose-400"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                      <label className="text-muted">Статус</label>
                      <select
                        value={habit.status}
                        onChange={(evt) =>
                          handleStatusChange(habit, evt.target.value as HabitStatus)
                        }
                        className="rounded-md border border-border bg-transparent px-2 py-1 text-xs text-text"
                      >
                        {STATUS_META.map(({ key, label }) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

