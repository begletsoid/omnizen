import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import clsx from 'clsx';

import {
  useAnalyticsSettings,
  useAnalyticsTimers,
  useCreateAnalyticsTimer,
  useDeleteAnalyticsTimer,
  useUpdateAnalyticsTimer,
  useUpsertAnalyticsSettings,
} from '../../features/analytics/hooks';
import { listCompletedTasksWithCategories } from '../../features/analytics/api';
import type { AnalyticsTimer, CompletedTaskWithCategories } from '../../features/analytics/types';
import {
  clampRange,
  decodeDaysMask,
  encodeDaysMask,
  getIsoWeekKey,
  getMonthKey,
  getMoscowWeekdayIndex,
  toMoscowDateString,
  toUtcEndOfMoscowDay,
  toUtcStartOfMoscowDay,
} from '../../features/analytics/utils';
import {
  useAttachCategoryToTask,
  useDetachCategoryFromTask,
  useTaskCategories,
  useTaskTags,
} from '../../features/microTasks/hooks';
import { useAuthStore } from '../../stores/authStore';

type AnalyticsWidgetProps = {
  widgetId: string | null;
};

const PAGE_SIZE = 100;

type Granularity = 'day' | 'week' | 'month';
type Metric = 'sum' | 'avg' | 'percent';

type SeriesPoint = { key: string; label: string; value: number };

export function AnalyticsWidget({ widgetId }: AnalyticsWidgetProps) {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id ?? null;
  const { data: settings } = useAnalyticsSettings();
  const upsertSettings = useUpsertAnalyticsSettings();
  const { data: timers = [] } = useAnalyticsTimers();
  const createTimer = useCreateAnalyticsTimer();
  const updateTimer = useUpdateAnalyticsTimer();
  const deleteTimer = useDeleteAnalyticsTimer();
  const { data: tags = [] } = useTaskTags();
  const { data: categories = [] } = useTaskCategories();
  const attachCategoryToTask = useAttachCategoryToTask();
  const detachCategoryFromTask = useDetachCategoryFromTask();

  const [activeTab, setActiveTab] = useState<'tasks' | 'charts'>('tasks');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [metric, setMetric] = useState<Metric>('sum');

  // Initialize default period if missing
  useEffect(() => {
    if (!userId) return;
    if (settings) return;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    const toISODate = (d: Date) => d.toISOString().slice(0, 10);
    upsertSettings.mutate({ period_start: toISODate(start), period_end: toISODate(end) });
  }, [settings, upsertSettings, userId]);

  const period = useMemo(() => {
    if (!settings) return null;
    return clampRange({ start: settings.period_start, end: settings.period_end });
  }, [settings]);

  // Infinite tasks fetch (completed only)
  const { data: pages, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<
    CompletedTaskWithCategories[]
  >({
    queryKey: ['analyticsCompletedTasksInfinite', userId, period?.start, period?.end],
    enabled: Boolean(userId && period),
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId || !period) return [];
      const from = toUtcStartOfMoscowDay(period.start);
      const to = toUtcEndOfMoscowDay(period.end);
      return listCompletedTasksWithCategories({
        userId,
        from,
        to,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage) return undefined;
      return lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined;
    },
  });

  const tasks: CompletedTaskWithCategories[] = useMemo(() => {
    if (pages?.pages?.length) {
      return pages.pages.flat();
    }
    return [];
  }, [pages?.pages]);

  const totalPeriodSeconds = useMemo(
    () => tasks.reduce((sum, t) => sum + (t.elapsed_seconds ?? 0), 0),
    [tasks],
  );

  const filteredTimers: AnalyticsTimer[] = timers ?? [];
  const nonAutoCategories = useMemo(
    () => (categories ?? []).filter((c) => !c.is_auto),
    [categories],
  );

  const groupedTasks = useMemo(() => {
    const buckets = new Map<string, CompletedTaskWithCategories[]>();
    tasks.forEach((task) => {
      const day = toMoscowDateString(task.created_at);
      if (!buckets.has(day)) buckets.set(day, []);
      buckets.get(day)?.push(task);
    });
    return Array.from(buckets.entries())
      .map(([day, list]) => ({ day, list: list.sort((a, b) => b.created_at.localeCompare(a.created_at)) }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [tasks]);

  const timerByTaskId = useMemo(() => {
    const map = new Map<string, AnalyticsTimer>();
    tasks.forEach((task) => {
      const match = filteredTimers.find((timer) => timerMatchesTask(timer, task));
      if (match) map.set(task.id, match);
    });
    return map;
  }, [filteredTimers, tasks]);

  const handlePeriodChange = (field: 'start' | 'end') => (event: ChangeEvent<HTMLInputElement>) => {
    if (!settings) return;
    const next = {
      period_start: field === 'start' ? event.target.value : settings.period_start,
      period_end: field === 'end' ? event.target.value : settings.period_end,
    };
    if (!next.period_start || !next.period_end) return;
    upsertSettings.mutate(next);
  };

  const addTimer = () => {
    if (!userId) return;
    const sortOrder = (timers?.length ?? 0) + 1;
    createTimer.mutate({ name: `Таймер ${sortOrder}`, sort_order: sortOrder });
  };

  const updateTimerField = (timer: AnalyticsTimer, patch: Partial<AnalyticsTimer>) => {
    updateTimer.mutate({ id: timer.id, ...patch });
  };

  const toggleDay = (timer: AnalyticsTimer, idx: number) => {
    const mask = decodeDaysMask(timer.days_mask);
    mask[idx] = !mask[idx];
    updateTimerField(timer, { days_mask: encodeDaysMask(mask) });
  };

  const toggleArray = (
    timer: AnalyticsTimer,
    field: 'tag_ids' | 'category_ids',
    value: string,
  ) => {
    const current = new Set(timer[field] ?? []);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    updateTimerField(timer, { [field]: Array.from(current) } as Partial<AnalyticsTimer>);
  };

  const timerMatchesTask = (timer: AnalyticsTimer, task: CompletedTaskWithCategories) => {
    // Day filter
    const mask = decodeDaysMask(timer.days_mask);
    const weekday = getMoscowWeekdayIndex(task.created_at);
    if (!mask[weekday]) return false;

    const tagsInTask = new Set<string>();
    const categoriesInTask = new Set<string>();
    task.categories?.forEach((cat) => {
      categoriesInTask.add(cat.id);
      cat.tags?.forEach((tag) => tagsInTask.add(tag.id));
    });

    const tagMatch = (timer.tag_ids ?? []).some((id) => tagsInTask.has(id));
    const categoryMatch = (timer.category_ids ?? []).some((id) => categoriesInTask.has(id));
    const hasFilters = (timer.tag_ids?.length ?? 0) > 0 || (timer.category_ids?.length ?? 0) > 0;
    if (!hasFilters) return true;
    return tagMatch || categoryMatch;
  };

  const filteredByTimer = useMemo(() => {
    return filteredTimers.map((timer) => ({
      timer,
      tasks: tasks.filter((t) => timerMatchesTask(timer, t)),
    }));
  }, [filteredTimers, tasks]);

  const buildSeries = (timerTasks: CompletedTaskWithCategories[]): SeriesPoint[] => {
    const buckets = new Map<string, { seconds: number; days: Set<string> }>();

    timerTasks.forEach((task) => {
      const day = toMoscowDateString(task.created_at);
      let key = day;
      if (granularity === 'week') {
        key = getIsoWeekKey(task.created_at);
      } else if (granularity === 'month') {
        key = getMonthKey(task.created_at);
      }
      if (!buckets.has(key)) buckets.set(key, { seconds: 0, days: new Set<string>() });
      const bucket = buckets.get(key)!;
      bucket.seconds += task.elapsed_seconds ?? 0;
      bucket.days.add(day);
    });

    const entries = Array.from(buckets.entries()).map(([key, value]) => {
      const base = value.seconds;
      const divisor =
        metric === 'avg'
          ? Math.max(1, value.days.size)
          : metric === 'percent'
            ? Math.max(1, totalPeriodSeconds)
            : 1;
      const val =
        metric === 'percent'
          ? (base / divisor) * 100
          : base / divisor;
      const label = key;
      return { key, label, value: val };
    });

    return entries.sort((a, b) => a.key.localeCompare(b.key));
  };

  const chartSeries = useMemo(() => {
    return filteredByTimer.map(({ timer, tasks }) => ({
      timer,
      points: buildSeries(tasks),
    }));
  }, [buildSeries, filteredByTimer]);

  const xKeys = useMemo(() => {
    const all = new Set<string>();
    chartSeries.forEach(({ points }) => points.forEach((p) => all.add(p.key)));
    return Array.from(all).sort((a, b) => a.localeCompare(b));
  }, [chartSeries]);

  const maxValue = useMemo(() => {
    let m = 0;
    chartSeries.forEach(({ points }) => {
      points.forEach((p) => {
        m = Math.max(m, p.value);
      });
    });
    return m || 1;
  }, [chartSeries]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          fetchNextPage().catch(() => {});
        }
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (!widgetId) {
    return <p className="p-4 text-sm text-muted">Нет данных: виджет не инициализирован.</p>;
  }

  return (
    <section className="flex h-full flex-col gap-4 rounded-3xl border border-white/10 bg-background/60 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('tasks')}
            className={clsx(
              'rounded-full px-3 py-1 transition',
              activeTab === 'tasks' ? 'bg-white text-black' : 'text-white/70 hover:text-white',
            )}
          >
            Задачи
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('charts')}
            className={clsx(
              'rounded-full px-3 py-1 transition',
              activeTab === 'charts' ? 'bg-white text-black' : 'text-white/70 hover:text-white',
            )}
          >
            Графики
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <label className="flex items-center gap-2">
            Период с
            <input
              type="date"
              value={period?.start ?? ''}
              onChange={handlePeriodChange('start')}
              className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-white"
            />
          </label>
          <label className="flex items-center gap-2">
            по
            <input
              type="date"
              value={period?.end ?? ''}
              onChange={handlePeriodChange('end')}
              className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-white"
            />
          </label>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={addTimer}
            className="rounded-lg border border-dashed border-white/30 px-3 py-1 text-xs text-muted transition hover:border-white/60 hover:text-white"
          >
            + Таймер
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px,1fr]">
        <aside className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Таймеры</p>
          {filteredTimers.length === 0 && (
            <p className="text-sm text-muted">Добавьте первый таймер для аналитики.</p>
          )}
          <div className="flex flex-col gap-3">
            {filteredTimers.map((timer) => {
              const mask = decodeDaysMask(timer.days_mask);
              return (
                <div key={timer.id} className="rounded-xl border border-white/10 bg-background/70 p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={timer.color ?? '#7dd3fc'}
                      onChange={(e) => updateTimerField(timer, { color: e.target.value })}
                      className="h-8 w-10 rounded-md border border-white/10 bg-transparent p-0"
                    />
                    <input
                      type="text"
                      defaultValue={timer.name}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value && value !== timer.name) {
                          updateTimerField(timer, { name: value });
                        }
                      }}
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white"
                      placeholder="Название таймера"
                    />
                    <button
                      type="button"
                      onClick={() => deleteTimer.mutate(timer.id)}
                      className="text-white/60 transition hover:text-rose-300"
                      aria-label="Удалить таймер"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label, idx) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleDay(timer, idx)}
                        className={clsx(
                          'rounded-md px-2 py-1 text-[11px]',
                          mask[idx] ? 'bg-white/15 text-white' : 'border border-white/15 text-white/60',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2">
                    <p className="text-[11px] uppercase tracking-[0.15em] text-muted">Теги</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {tags?.map((tag) => (
                        <label
                          key={tag.id}
                          className={clsx(
                            'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]',
                            timer.tag_ids.includes(tag.id) ? 'border-white/40' : 'border-white/15 text-white/70',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={timer.tag_ids.includes(tag.id)}
                            onChange={() => toggleArray(timer, 'tag_ids', tag.id)}
                          />
                          {tag.name}
                        </label>
                      ))}
                      {tags?.length === 0 && <span className="text-[11px] text-muted">Нет тегов</span>}
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="text-[11px] uppercase tracking-[0.15em] text-muted">Категории</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {nonAutoCategories.map((cat) => (
                        <label
                          key={cat.id}
                          className={clsx(
                            'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]',
                            timer.category_ids.includes(cat.id)
                              ? 'border-white/40'
                              : 'border-white/15 text-white/70',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={timer.category_ids.includes(cat.id)}
                            onChange={() => toggleArray(timer, 'category_ids', cat.id)}
                          />
                          {cat.name}
                        </label>
                      ))}
                      {nonAutoCategories.length === 0 && (
                        <span className="text-[11px] text-muted">Нет категорий</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="flex min-h-[620px] flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          {activeTab === 'tasks' ? (
            <div className="flex flex-col gap-3">
              {groupedTasks.length === 0 && (
                <p className="text-sm text-muted">За выбранный период нет завершённых задач.</p>
              )}
              {groupedTasks.map(({ day, list }) => (
                <div key={day} className="rounded-xl border border-white/10 bg-background/70 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">{day}</p>
                  <div className="mt-2 space-y-2">
                    {list.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-white/5 p-2 text-sm"
                        style={{
                          borderLeft: `4px solid ${timerByTaskId.get(task.id)?.color ?? '#7dd3fc'}`,
                        }}
                      >
                        <div className="flex-1">
                          <p className="font-medium text-white">{task.title}</p>
                          <p className="text-xs text-muted">
                            {formatSeconds(task.elapsed_seconds)} · создано {toMoscowDateString(task.created_at)}
                          </p>
                          <CategoryEditor
                            task={task}
                            nonAutoCategories={nonAutoCategories}
                            attachCategoryToTask={attachCategoryToTask}
                            detachCategoryFromTask={detachCategoryFromTask}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div ref={sentinelRef} />
              {hasNextPage && (
                <p className="text-center text-xs text-muted">
                  {isFetchingNextPage ? 'Загружаем...' : 'Прокрутите ниже для подгрузки'}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1 rounded-full border border-white/15 bg-background/80 p-1">
                  {(['day', 'week', 'month'] as Granularity[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGranularity(g)}
                      className={clsx(
                        'rounded-full px-2.5 py-1',
                        granularity === g ? 'bg-white text-black' : 'text-white/70',
                      )}
                    >
                      {g === 'day' ? 'Дни' : g === 'week' ? 'Недели' : 'Месяцы'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 rounded-full border border-white/15 bg-background/80 p-1">
                  {(['sum', 'avg', 'percent'] as Metric[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMetric(m)}
                      className={clsx(
                        'rounded-full px-2.5 py-1',
                        metric === m ? 'bg-white text-black' : 'text-white/70',
                      )}
                    >
                      {m === 'sum' ? 'Сумма' : m === 'avg' ? 'Среднее' : '%'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative overflow-x-auto rounded-xl border border-white/10 bg-background/70 p-3">
                {chartSeries.every((s) => s.points.length === 0) ? (
                  <p className="text-sm text-muted">Нет данных для графика.</p>
                ) : (
                  <svg
                    role="img"
                    aria-label="График таймеров"
                    className="min-w-full"
                    viewBox={`0 0 ${Math.max(400, xKeys.length * 160)} 280`}
                    preserveAspectRatio="xMinYMin slice"
                  >
                    <g transform="translate(0,240)">
                      {xKeys.map((key, idx) => (
                        <text
                          key={key}
                          x={40 + idx * 140}
                          y={20}
                          fill="#9CA3AF"
                          fontSize="11"
                          textAnchor="start"
                          transform={`rotate(0 ${40 + idx * 140} ${20})`}
                        >
                          {key}
                        </text>
                      ))}
                    </g>
                    {chartSeries.map(({ timer, points }) => {
                      if (!points.length) return null;
                      const color = timer.color ?? '#7dd3fc';
                      const pointMap = new Map(points.map((p) => [p.key, p]));
                      let path = '';
                      xKeys.forEach((key, idx) => {
                        const p = pointMap.get(key);
                        if (!p) return;
                        const x = 40 + idx * 140;
                        const y = 200 - (p.value / maxValue) * 160;
                        path += `${path ? ' L' : 'M'} ${x} ${y}`;
                      });
                      return (
                        <g key={timer.id}>
                          <path d={path} stroke={color} strokeWidth={2} fill="none" />
                          {xKeys.map((key, idx) => {
                            const p = pointMap.get(key);
                            if (!p) return null;
                            const x = 40 + idx * 140;
                            const y = 200 - (p.value / maxValue) * 160;
                            return (
                              <g key={key}>
                                <circle cx={x} cy={y} r={3} fill={color} />
                                <text x={x + 6} y={y - 6} fill="#e5e7eb" fontSize="10">
                                  {formatValue(p.value, metric)}
                                </text>
                              </g>
                            );
                          })}
                        </g>
                      );
                    })}
                  </svg>
                )}
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                  {chartSeries.map(({ timer }) => (
                    <span key={timer.id} className="flex items-center gap-1">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: timer.color ?? '#7dd3fc' }}
                      />
                      {timer.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function formatSeconds(sec: number) {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(`${h}ч`);
  if (m) parts.push(`${m}м`);
  if (!h && !m) parts.push(`${s}с`);
  return parts.join(' ');
}

function formatValue(value: number, metric: Metric) {
  if (metric === 'percent') return `${value.toFixed(1)}%`;
  // seconds -> hours
  const hours = value / 3600;
  if (metric === 'avg') return `${hours.toFixed(2)}ч/день`;
  return `${hours.toFixed(2)}ч`;
}

type CategoryEditorProps = {
  task: CompletedTaskWithCategories;
  nonAutoCategories: { id: string; name: string }[];
  attachCategoryToTask: ReturnType<typeof useAttachCategoryToTask>;
  detachCategoryFromTask: ReturnType<typeof useDetachCategoryFromTask>;
};

function CategoryEditor({
  task,
  nonAutoCategories,
  attachCategoryToTask,
  detachCategoryFromTask,
}: CategoryEditorProps) {
  const [open, setOpen] = useState(false);
  const selected = new Set(task.categories?.map((c) => c.id) ?? []);

  const toggle = async (categoryId: string) => {
    if (selected.has(categoryId)) {
      await detachCategoryFromTask.mutateAsync({ taskId: task.id, categoryId });
    } else {
      await attachCategoryToTask.mutateAsync({ taskId: task.id, categoryId });
    }
  };

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {task.categories?.map((cat) => (
          <span
            key={cat.id}
            className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/80"
          >
            {cat.name}
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-white/70 underline-offset-2 hover:text-white"
      >
        {open ? 'Скрыть категории' : 'Изменить категории'}
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1">
          {nonAutoCategories.map((cat) => (
            <label
              key={cat.id}
              className={clsx(
                'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]',
                selected.has(cat.id) ? 'border-white/40' : 'border-white/15 text-white/70',
              )}
            >
              <input type="checkbox" checked={selected.has(cat.id)} onChange={() => toggle(cat.id)} />
              {cat.name}
            </label>
          ))}
          {nonAutoCategories.length === 0 && (
            <span className="text-[11px] text-muted">Нет категорий</span>
          )}
        </div>
      )}
    </div>
  );
}
