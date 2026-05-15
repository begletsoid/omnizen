import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useFloating,
  type ReferenceType,
} from '@floating-ui/react';
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
  addDays,
  getDateKeys,
  getMonthKey,
  getMoscowWeekdayIndex,
  getWeekStartDate,
  toMoscowDateString,
  toUtcEndOfMoscowDay,
  toUtcStartOfMoscowDay,
} from '../../features/analytics/utils';
import { deleteMicroTask, updateMicroTask } from '../../features/microTasks/api';
import {
  useAttachCategoryToTask,
  useDetachCategoryFromTask,
  useTaskCategories,
  useTaskTags,
} from '../../features/microTasks/hooks';
import { parseDurationInput } from '../../features/microTasks/utils';
import { ConfirmDeleteButton } from '../../components/ConfirmDeleteButton';
import {
  CATEGORY_COLOR_PRESETS as SHARED_COLOR_PRESETS,
  getCategoryColorPreset as sharedGetCategoryColorPreset,
  pickFirstFreePresetId,
  resolveColorHex,
} from '../microTasks/utils/constants';
import { useAuthStore } from '../../stores/authStore';

type AnalyticsWidgetProps = {
  widgetId: string | null;
};

const PAGE_SIZE = 100;
const X_STEP = 280; // width per bucket for readability
const CHART_LEFT_PADDING = 8;
const CHART_RIGHT_PADDING = 60;
const CHART_HEIGHT = 360;
const TAXONOMY_DROPDOWN_SELECTOR = '[data-taxonomy-dropdown="true"]';

type Granularity = 'day' | 'week' | 'month';
type Metric = 'sum' | 'avg' | 'percent';

type SeriesPoint = { key: string; label: string; value: number };
type AnalyticsTasksCache = { pages: CompletedTaskWithCategories[][]; pageParams: unknown[] };

// Reuse the shared category palette so analytics timers, tags and categories all
// share one single table of 7 colors. MAX_TIMERS derives from its length — cap
// is automatic if the palette ever grows.
const CATEGORY_COLOR_PRESETS = SHARED_COLOR_PRESETS;
const MAX_TIMERS = CATEGORY_COLOR_PRESETS.length;
const getCategoryColorPreset = sharedGetCategoryColorPreset;

type LabelBox = { x1: number; y1: number; x2: number; y2: number };

function boxesOverlap(a: LabelBox, b: LabelBox) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function approxTextWidth(text: string, fontSize: number) {
  return Math.max(6, text.length * fontSize * 0.55);
}

function getBucketDateRange(key: string, granularity: Granularity) {
  if (granularity === 'day') {
    return { start: key, end: key };
  }
  if (granularity === 'week') {
    const start = key;
    const end = addDays(key, 6);
    return { start, end };
  }
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) {
    return { start: key, end: key };
  }
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const end = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(
    endDate.getUTCDate(),
  ).padStart(2, '0')}`;
  return { start, end };
}

function getBucketKeyForTask(task: CompletedTaskWithCategories, granularity: Granularity) {
  const day = toMoscowDateString(task.created_at);
  if (granularity === 'week') {
    return getWeekStartDate(task.created_at);
  }
  if (granularity === 'month') {
    return getMonthKey(task.created_at);
  }
  return day;
}

function getWeekdayLabel(dateStr: string) {
  const weekday = getMoscowWeekdayIndex(`${dateStr}T00:00:00Z`);
  return ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][weekday] ?? '';
}

function countDaysInRangeByMask(start: string, end: string, mask: boolean[]) {
  const startTime = new Date(`${start}T00:00:00Z`).getTime();
  const endTime = new Date(`${end}T00:00:00Z`).getTime();
  let count = 0;
  for (let t = startTime; t <= endTime; t += 86_400_000) {
    const weekday = getMoscowWeekdayIndex(new Date(t).toISOString());
    if (mask[weekday]) count += 1;
  }
  return count;
}

function countBucketDays(key: string, daysMask: string, period?: { start: string; end: string }, granularity: Granularity = 'day') {
  const mask = decodeDaysMask(daysMask);
  const bucketRange = getBucketDateRange(key, granularity);
  const range = period
    ? {
        start: bucketRange.start < period.start ? period.start : bucketRange.start,
        end: bucketRange.end > period.end ? period.end : bucketRange.end,
      }
    : bucketRange;
  if (range.start > range.end) return 0;
  return countDaysInRangeByMask(range.start, range.end, mask);
}

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
  const queryClient = useQueryClient();
  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => deleteMicroTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: analyticsTasksQueryKey,
      });
    },
  });
  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CompletedTaskWithCategories> }) => {
      const { data, error } = await updateMicroTask(id, patch);
      if (error) throw error;
      return data;
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({
        queryKey: analyticsTasksQueryKey,
      });
      const previous = queryClient.getQueryData<AnalyticsTasksCache>(analyticsTasksQueryKey);
      queryClient.setQueryData<AnalyticsTasksCache | undefined>(analyticsTasksQueryKey, (old) => {
        if (!old?.pages) return old;
        const nextPages = old.pages.map((page) =>
          page.map((task) => (task.id === id ? { ...task, ...patch } : task)),
        );
        return { ...old, pages: nextPages };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(analyticsTasksQueryKey, context.previous);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: analyticsTasksQueryKey,
      });
    },
  });

  const [granularity, setGranularity] = useState<Granularity>('day');
  const [metric, setMetric] = useState<Metric>('sum');
  const [hideEmptyBuckets, setHideEmptyBuckets] = useState(false);
  const [isCumulative, setIsCumulative] = useState(false);
  const MIN_X_SCALE = 0.016;
  const MAX_X_SCALE = 0.5;
  const SCALE_STEP = 0.01;
  const [xScale, setXScale] = useState(MAX_X_SCALE);
  const [filterTimerId, setFilterTimerId] = useState<string | null>(null);
  const [openTimerCategoryId, setOpenTimerCategoryId] = useState<string | null>(null);
  const [openTimerTagId, setOpenTimerTagId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  const [editingTimeTaskId, setEditingTimeTaskId] = useState<string | null>(null);
  const [timeDraft, setTimeDraft] = useState('');
  const [isTimeInvalid, setIsTimeInvalid] = useState(false);
  const [openTimerColorId, setOpenTimerColorId] = useState<string | null>(null);
  const tasksScrollRef = useRef<HTMLDivElement | null>(null);
  const dayRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  const analyticsTasksQueryKey = ['analyticsCompletedTasksInfinite', userId, period?.start, period?.end] as const;

  // Infinite tasks fetch (completed only)
  const { data: pages, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<
    CompletedTaskWithCategories[]
  >({
    queryKey: analyticsTasksQueryKey,
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
  }, [pages]);

  const filteredTimers: AnalyticsTimer[] = useMemo(() => timers ?? [], [timers]);
  const nonAutoCategories = useMemo(
    () =>
      (categories ?? [])
        // Hide archived: voice/UI should not let users attach archived
        // categories to new things. Archived categories are still listed
        // (with restore) only inside the Taxonomy Manager popover.
        .filter((c) => !c.is_auto && !c.archived_at)
        .map((cat) => ({
          ...cat,
          color: cat.color ?? null,
          tags: (cat.tags ?? []).map((tag) => ({ ...tag })),
        })),
    [categories],
  );
  const filterTimer = useMemo(
    () => (filterTimerId ? filteredTimers.find((timer) => timer.id === filterTimerId) ?? null : null),
    [filterTimerId, filteredTimers],
  );

  const displayTasks = filterTimer ? tasks.filter((task) => timerMatchesTask(filterTimer, task)) : tasks;

  const groupedTasks = (() => {
    const buckets = new Map<string, CompletedTaskWithCategories[]>();
    displayTasks.forEach((task) => {
      const day = toMoscowDateString(task.created_at);
      if (!buckets.has(day)) buckets.set(day, []);
      buckets.get(day)?.push(task);
    });
    return Array.from(buckets.entries())
      .map(([day, list]) => ({ day, list: list.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)) }))
      .sort((a, b) => b.day.localeCompare(a.day));
  })();

  const groupedTasksAsc = [...groupedTasks].sort((a, b) => a.day.localeCompare(b.day));

  const optimisticUpdateTaskCategories = (
    taskId: string,
    updater: (categories: CompletedTaskWithCategories['categories']) => CompletedTaskWithCategories['categories'],
  ) => {
    const previous = queryClient.getQueryData<AnalyticsTasksCache>(analyticsTasksQueryKey);
    queryClient.setQueryData<AnalyticsTasksCache | undefined>(analyticsTasksQueryKey, (old) => {
      if (!old?.pages) return old;
      const nextPages = old.pages.map((page) =>
        page.map((task) =>
          task.id === taskId ? { ...task, categories: updater(task.categories ?? []) } : task,
        ),
      );
      return { ...old, pages: nextPages };
    });
    return previous;
  };

  const restoreOptimisticTasks = (snapshot: unknown) => {
    if (snapshot) {
      queryClient.setQueryData(analyticsTasksQueryKey, snapshot);
    }
  };

  const buildDayTimerContributions = (list: CompletedTaskWithCategories[]) => {
    const totalSeconds = list.reduce((sum, task) => sum + (task.elapsed_seconds ?? 0), 0);
    if (totalSeconds <= 0) return [];
    return filteredTimers
      .map((timer) => {
        const seconds = list.reduce((sum, task) => (timerMatchesTask(timer, task) ? sum + (task.elapsed_seconds ?? 0) : sum), 0);
        if (seconds <= 0) return null;
        const percent = (seconds / totalSeconds) * 100;
        return {
          timer,
          timeLabel: formatDuration(seconds),
          percentLabel: `${percent.toFixed(1)}%`,
        };
      })
      .filter(Boolean) as { timer: AnalyticsTimer; timeLabel: string; percentLabel: string }[];
  };

  const startEditingTask = (task: CompletedTaskWithCategories) => {
    setEditingTaskId(task.id);
    setEditingTaskTitle(task.title);
  };

  const cancelEditingTask = () => {
    setEditingTaskId(null);
    setEditingTaskTitle('');
  };

  const commitEditingTask = (task: CompletedTaskWithCategories) => {
    const trimmed = editingTaskTitle.trim();
    if (!trimmed || trimmed === task.title) {
      cancelEditingTask();
      return;
    }
    updateTaskMutation.mutate({ id: task.id, patch: { title: trimmed } });
    cancelEditingTask();
  };

  const startEditingTime = (task: CompletedTaskWithCategories) => {
    setEditingTimeTaskId(task.id);
    setTimeDraft(formatDuration(task.elapsed_seconds));
    setIsTimeInvalid(false);
  };

  const cancelEditingTime = () => {
    setEditingTimeTaskId(null);
    setTimeDraft('');
    setIsTimeInvalid(false);
  };

  const commitEditingTime = (task: CompletedTaskWithCategories) => {
    if (editingTimeTaskId !== task.id) return;
    const seconds = parseDurationInput(timeDraft);
    if (seconds === null) {
      setIsTimeInvalid(true);
      return;
    }
    // Completed tasks here are already paused (is_done=true), so just overwrite
    // elapsed_seconds — no need to touch timer_state/last_started_at.
    updateTaskMutation.mutate({ id: task.id, patch: { elapsed_seconds: seconds } });
    cancelEditingTime();
  };

  const handleTimeKeyDown = (event: KeyboardEvent<HTMLInputElement>, task: CompletedTaskWithCategories) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEditingTime(task);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditingTime();
    }
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, task: CompletedTaskWithCategories) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEditingTask(task);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditingTask();
    }
  };

  const handleChartPointClick = (key: string) => {
    const container = tasksScrollRef.current;
    const range = getBucketDateRange(key, granularity);
    const targetDay = groupedTasksAsc.find((entry) => entry.day >= range.start && entry.day <= range.end)?.day;
    if (!targetDay) return;
    const targetNode = dayRefs.current[targetDay];
    if (!targetNode) return;
    if (container) {
      const offset = targetNode.offsetTop - container.offsetTop;
      container.scrollTo({ top: offset, behavior: 'smooth' });
    } else {
      targetNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

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
    if ((timers?.length ?? 0) >= MAX_TIMERS) return;
    const sortOrder = (timers?.length ?? 0) + 1;
    const color = pickFirstFreePresetId((timers ?? []).map((t) => t.color));
    createTimer.mutate({
      name: `Таймер ${sortOrder}`,
      sort_order: sortOrder,
      color: color ?? null,
    });
  };

  /** Preset ids already taken by OTHER timers — used to grey out chips in the picker. */
  const colorUsageByTimer = useMemo(() => {
    const usedByOthers = new Map<string, Set<string>>();
    for (const target of timers ?? []) {
      const used = new Set<string>();
      for (const other of timers ?? []) {
        if (other.id === target.id) continue;
        if (other.color && !other.color.startsWith('#')) used.add(other.color);
      }
      usedByOthers.set(target.id, used);
    }
    return usedByOthers;
  }, [timers]);

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

  function timerMatchesTask(timer: AnalyticsTimer, task: CompletedTaskWithCategories) {
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
  }

  const filteredByTimer = filteredTimers.map((timer) => ({
    timer,
    tasks: tasks.filter((t) => timerMatchesTask(timer, t)),
  }));

  const buildSeries = (
    timer: AnalyticsTimer,
    timerTasks: CompletedTaskWithCategories[],
    allTasks: CompletedTaskWithCategories[],
  ): SeriesPoint[] => {
    const buckets = new Map<string, { seconds: number }>();
    const mask = decodeDaysMask(timer.days_mask);
    const bucketTotals = new Map<string, number>();

    allTasks.forEach((task) => {
      const weekday = getMoscowWeekdayIndex(task.created_at);
      if (!mask[weekday]) return;
      const key = getBucketKeyForTask(task, granularity);
      bucketTotals.set(key, (bucketTotals.get(key) ?? 0) + (task.elapsed_seconds ?? 0));
    });

    timerTasks.forEach((task) => {
      const key = getBucketKeyForTask(task, granularity);
      if (!buckets.has(key)) buckets.set(key, { seconds: 0 });
      const bucket = buckets.get(key)!;
      bucket.seconds += task.elapsed_seconds ?? 0;
    });

    const entries = Array.from(buckets.entries()).map(([key, value]) => {
      const base = value.seconds;
      if (metric === 'percent') {
        const divisor = bucketTotals.get(key) ?? 0;
        const val = divisor > 0 ? (base / divisor) * 100 : 0;
        return { key, label: key, value: val };
      }
      if (metric === 'avg') {
        const divisor = Math.max(1, countBucketDays(key, timer.days_mask, period ?? undefined, granularity));
        return { key, label: key, value: base / divisor };
      }
      return { key, label: key, value: base };
    });

    return entries.sort((a, b) => a.key.localeCompare(b.key));
  };

  const chartSeries = (() => {
    const periodKeys = period ? getDateKeys(period, granularity) : [];
    return filteredByTimer.map(({ timer, tasks: timerTasks }) => {
      const seriesPoints = buildSeries(timer, timerTasks, tasks);
      const map = new Map(seriesPoints.map((p) => [p.key, p]));
      let points = periodKeys.map((key) => map.get(key) ?? ({ key, label: key, value: 0 } as SeriesPoint));
      if (metric === 'sum' && isCumulative) {
        let running = 0;
        points = points.map((point) => {
          running += point.value;
          return { ...point, value: running };
        });
      }
      if (hideEmptyBuckets) {
        points = points.filter((p) => p.value > 0);
      }
      return { timer, points };
    });
  })();

  const xKeys = (() => {
    if (!period) return [];
    const keys = getDateKeys(period, granularity);
    if (hideEmptyBuckets) {
      const nonEmpty = new Set<string>();
      chartSeries.forEach(({ points }) => points.forEach((p) => nonEmpty.add(p.key)));
      return keys.filter((k) => nonEmpty.has(k));
    }
    return keys;
  })();

  const maxValue = (() => {
    let m = 0;
    chartSeries.forEach(({ points }) => {
      points.forEach((p) => {
        m = Math.max(m, p.value);
      });
    });
    return m || 1;
  })();
  const chartTextScale = Math.min(1, Math.max(0.7, 1 - (1 - xScale) / 3.5));
  const chartWidth = Math.max(360, CHART_LEFT_PADDING + xKeys.length * X_STEP * xScale + CHART_RIGHT_PADDING);
  const axisLabelBoxes: LabelBox[] = [];
  const pointLabelBoxes: LabelBox[] = [];

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            fetchNextPage().catch(() => {});
          }
        });
      },
      { root: tasksScrollRef.current ?? undefined },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, tasksScrollRef]);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const timer = window.setInterval(() => {
      fetchNextPage().catch(() => {});
    }, 200);
    return () => window.clearInterval(timer);
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (!filterTimerId) return;
    if (!filteredTimers.some((timer) => timer.id === filterTimerId)) {
      setFilterTimerId(null);
    }
  }, [filterTimerId, filteredTimers]);

  if (!widgetId) {
    return <p className="p-4 text-sm text-muted">Нет данных: виджет не инициализирован.</p>;
  }

  return (
    <section className="flex h-full flex-col gap-4 rounded-3xl border border-white/10 bg-background/60 p-4">
      <header className="flex flex-wrap items-center gap-3">
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
        <div className="ml-auto flex items-center gap-2" />
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px,1fr]">
        <aside className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Таймеры</p>
          {filteredTimers.length === 0 && (
            <p className="text-sm text-muted">Добавьте первый таймер для аналитики.</p>
          )}
          <div className="flex flex-col gap-3 overflow-y-auto pr-1 max-h-[520px]">
            {filteredTimers.map((timer) => {
              const mask = decodeDaysMask(timer.days_mask);
                  const isFilter = filterTimerId === timer.id;
              const usedByOthers = colorUsageByTimer.get(timer.id) ?? new Set<string>();
              return (
                <div key={timer.id} className="rounded-xl border border-white/10 bg-background/70 p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenTimerColorId((prev) => (prev === timer.id ? null : timer.id))}
                        aria-label="Выбрать цвет таймера"
                        aria-haspopup="menu"
                        aria-expanded={openTimerColorId === timer.id}
                        className="h-7 w-7 rounded-full border border-white/20 shadow-inner transition hover:border-white/50"
                        style={{ backgroundColor: resolveColorHex(timer.color) }}
                      />
                      {openTimerColorId === timer.id && (
                        <>
                          <div
                            aria-hidden
                            className="fixed inset-0 z-10"
                            onClick={() => setOpenTimerColorId(null)}
                          />
                          <div
                            role="menu"
                            className="absolute left-0 top-9 z-20 grid w-max grid-cols-7 gap-1 rounded-xl border border-white/10 bg-background/95 p-1.5 shadow-2xl backdrop-blur"
                          >
                            {CATEGORY_COLOR_PRESETS.map((preset) => {
                              const taken = usedByOthers.has(preset.id);
                              const selected = timer.color === preset.id;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  disabled={taken && !selected}
                                  onClick={() => {
                                    updateTimerField(timer, { color: preset.id });
                                    setOpenTimerColorId(null);
                                  }}
                                  title={taken && !selected ? `${preset.label} — занят другим таймером` : preset.label}
                                  aria-label={preset.label}
                                  className={clsx(
                                    'h-6 w-6 rounded-full border transition',
                                    selected ? 'border-white ring-2 ring-white/50' : 'border-white/20 hover:border-white/60',
                                    taken && !selected && 'cursor-not-allowed opacity-30',
                                  )}
                                  style={{ backgroundColor: preset.hex }}
                                />
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                    <input
                      type="text"
                      defaultValue={timer.name}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value && value !== timer.name) {
                          updateTimerField(timer, { name: value });
                        }
                      }}
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm font-semibold text-white"
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
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setFilterTimerId((prev) => (prev === timer.id ? null : timer.id))}
                          className={clsx(
                            'rounded-md border px-2 py-1 text-[11px] transition',
                            isFilter ? 'border-white/60 text-white' : 'border-white/15 text-white/70',
                          )}
                        >
                          {isFilter ? 'Фильтр включён' : 'Сделать фильтром'}
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
                    <p className="text-[11px] uppercase tracking-[0.15em] text-muted">Категории</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {timer.category_ids.length === 0 && (
                        <span className="text-[11px] text-muted">Нет выбранных категорий</span>
                      )}
                      {timer.category_ids
                        .map((id) => nonAutoCategories.find((cat) => cat.id === id))
                        .filter(Boolean)
                        .map((cat) => {
                          const preset = getCategoryColorPreset(cat?.color);
                          return (
                            <span
                              key={cat!.id}
                              className={clsx('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs', preset.chipClass)}
                            >
                              {cat!.name}
                              <button
                                type="button"
                                onClick={() => toggleArray(timer, 'category_ids', cat!.id)}
                                className="text-white/80 transition hover:text-rose-300"
                                aria-label={`Удалить категорию ${cat!.name}`}
                              >
                                ✕
                              </button>
                            </span>
                          );
                        })}
                    </div>
                    <div className="mt-2">
                      {openTimerCategoryId === timer.id ? (
                        <div className="flex items-center gap-2">
                          <TaxonomySelect
                            placeholder="Добавить категорию"
                            ariaLabel="Добавить категорию к таймеру"
                            options={nonAutoCategories.map((cat) => ({ value: cat.id, label: cat.name }))}
                            disabled={nonAutoCategories.length === 0}
                            className="w-full"
                            enableSearch
                            autoFocus
                            onSelectOption={(option) => {
                              toggleArray(timer, 'category_ids', option.value);
                              setOpenTimerCategoryId(null);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setOpenTimerCategoryId(null)}
                            className="text-xs text-white/60 underline-offset-2 hover:text-white"
                          >
                            Скрыть
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (nonAutoCategories.length === 0) return;
                            setOpenTimerCategoryId(timer.id);
                          }}
                          className={clsx(
                            'text-xs underline-offset-2',
                            nonAutoCategories.length === 0
                              ? 'cursor-not-allowed text-white/40'
                              : 'text-white/70 hover:text-white',
                          )}
                        >
                          Добавить категорию
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="text-[11px] uppercase tracking-[0.15em] text-muted">Теги</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {timer.tag_ids.length === 0 && <span className="text-[11px] text-muted">Нет выбранных тегов</span>}
                      {timer.tag_ids
                        .map((id) => tags.find((tag) => tag.id === id))
                        .filter(Boolean)
                        .map((tag) => (
                          <span
                            key={tag!.id}
                            className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white"
                          >
                            {tag!.name}
                            <button
                              type="button"
                              onClick={() => toggleArray(timer, 'tag_ids', tag!.id)}
                              className="text-white/80 transition hover:text-rose-300"
                              aria-label={`Удалить тег ${tag!.name}`}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                    </div>
                    <div className="mt-2">
                      {openTimerTagId === timer.id ? (
                        <div className="flex items-center gap-2">
                          <TaxonomySelect
                            placeholder="Добавить тег"
                            ariaLabel="Добавить тег к таймеру"
                            options={tags.filter((tag) => !tag.archived_at).map((tag) => ({ value: tag.id, label: tag.name }))}
                            disabled={tags.filter((tag) => !tag.archived_at).length === 0}
                            className="w-full"
                            enableSearch
                            autoFocus
                            onSelectOption={(option) => {
                              toggleArray(timer, 'tag_ids', option.value);
                              setOpenTimerTagId(null);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setOpenTimerTagId(null)}
                            className="text-xs text-white/60 underline-offset-2 hover:text-white"
                          >
                            Скрыть
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (tags.length === 0) return;
                            setOpenTimerTagId(timer.id);
                          }}
                          className={clsx(
                            'text-xs underline-offset-2',
                            tags.length === 0 ? 'cursor-not-allowed text-white/40' : 'text-white/70 hover:text-white',
                          )}
                        >
                          Добавить тег
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addTimer}
            disabled={(timers?.length ?? 0) >= MAX_TIMERS}
            title={(timers?.length ?? 0) >= MAX_TIMERS ? `Достигнут лимит таймеров (${MAX_TIMERS})` : undefined}
            className="rounded-lg border border-dashed border-white/30 px-3 py-2 text-xs text-muted transition hover:border-white/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/30 disabled:hover:text-muted"
          >
            + Таймер
          </button>
        </aside>

        <div className="grid gap-3 lg:grid-cols-[max-content,minmax(0,1fr)]">
          <section className="flex min-h-[620px] w-max flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
            {groupedTasks.length === 0 && (
              <p className="text-sm text-muted">За выбранный период нет завершённых задач.</p>
            )}
            <div ref={tasksScrollRef} className="flex w-full flex-col gap-3 overflow-y-auto pr-2 max-h-[640px]">
              {groupedTasks.map(({ day, list }) => (
                <div
                  key={day}
                  ref={(node) => {
                    dayRefs.current[day] = node;
                  }}
                  className="w-full rounded-xl border border-white/10 bg-background/70 p-3"
                >
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">{formatDayLabel(day)}</p>
                    {(() => {
                      const entries = buildDayTimerContributions(list);
                      return (
                        <div
                          className={clsx(
                            'grid w-fit items-start gap-2 text-[13px] text-white/80',
                            entries.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
                          )}
                        >
                          {entries.map((entry) => (
                        <span
                          key={entry.timer.id}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: resolveColorHex(entry.timer.color) }}
                          />
                          <span className="font-normal">{entry.timer.name}</span>
                          <span className="font-semibold text-white">{entry.timeLabel}</span>
                          <span className="text-white/50">{entry.percentLabel}</span>
                        </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="mt-2 space-y-2">
                    {list.map((task) => (
                      <div
                        key={task.id}
                        className={clsx(
                          'flex w-full flex-col gap-2 rounded-2xl border px-4 py-3 text-sm text-text',
                          getCategoryColorPreset(
                            [...(task.categories ?? [])].reverse().find((category) => category.color)?.color,
                          ).cardClass,
                        )}
                      >
                        <div className="flex flex-col gap-2">
                          {editingTaskId === task.id ? (
                            <textarea
                              value={editingTaskTitle}
                              rows={1}
                              onChange={(event) => setEditingTaskTitle(event.target.value)}
                              onBlur={() => commitEditingTask(task)}
                              onKeyDown={(event) => handleEditKeyDown(event, task)}
                              autoFocus
                              className="w-full resize-none rounded-xl bg-white/80 px-3 py-1 text-sm text-black outline-none"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditingTask(task)}
                              className="max-w-[40ch] text-left font-medium text-white whitespace-normal break-words"
                            >
                              {task.title}
                            </button>
                          )}
                          <div className="flex items-center gap-2 text-sm text-white/70">
                            {editingTimeTaskId === task.id ? (
                              <input
                                type="text"
                                value={timeDraft}
                                onChange={(event) => {
                                  setTimeDraft(event.target.value);
                                  setIsTimeInvalid(false);
                                }}
                                onBlur={() => commitEditingTime(task)}
                                onKeyDown={(event) => handleTimeKeyDown(event, task)}
                                autoFocus
                                aria-invalid={isTimeInvalid || undefined}
                                aria-label="Редактировать потраченное время"
                                placeholder="ч:мм:сс"
                                className={clsx(
                                  'w-24 rounded-xl bg-white/80 px-2 py-0.5 text-center font-medium tabular-nums text-black outline-none',
                                  isTimeInvalid && 'ring-1 ring-rose-400',
                                )}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => startEditingTime(task)}
                                className="font-medium tabular-nums text-white/80 transition hover:text-white"
                                aria-label="Редактировать потраченное время"
                              >
                                {formatDuration(task.elapsed_seconds)}
                              </button>
                            )}
                            <ConfirmDeleteButton
                              onConfirm={() => deleteTaskMutation.mutate(task.id)}
                              label="Удалить задачу"
                              className="h-4 w-4 text-white/60"
                            />
                          </div>
                        </div>
                        <CategoryEditor
                          task={task}
                          nonAutoCategories={nonAutoCategories}
                          attachCategoryToTask={attachCategoryToTask}
                          detachCategoryFromTask={detachCategoryFromTask}
                          onOptimisticUpdate={optimisticUpdateTaskCategories}
                          onOptimisticRollback={restoreOptimisticTasks}
                        />
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
          </section>

          <section className="flex min-h-[620px] min-w-0 flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
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
              {metric === 'sum' && (
                <label className="flex items-center gap-1 rounded-full border border-white/15 bg-background/80 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={isCumulative}
                    onChange={(e) => setIsCumulative(e.target.checked)}
                  />
                  Накопленная
                </label>
              )}
              <label className="flex items-center gap-1 rounded-full border border-white/15 bg-background/80 px-2 py-1">
                <input
                  type="checkbox"
                  checked={hideEmptyBuckets}
                  onChange={(e) => setHideEmptyBuckets(e.target.checked)}
                />
                Скрывать пустые
              </label>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>Масштаб</span>
              <button
                type="button"
                onClick={() => setXScale((prev) => Math.max(MIN_X_SCALE, Number((prev - SCALE_STEP).toFixed(3))))}
                className="h-7 w-7 rounded-full border border-white/15 text-white/80 transition hover:border-white/40 hover:text-white"
                aria-label="Уменьшить масштаб"
              >
                -
              </button>
              <input
                type="range"
                min={MIN_X_SCALE}
                max={MAX_X_SCALE}
                step={SCALE_STEP}
                value={xScale}
                onChange={(event) =>
                  setXScale(
                    Math.min(MAX_X_SCALE, Math.max(MIN_X_SCALE, Number(event.target.value))),
                  )
                }
                className="w-48"
              />
              <button
                type="button"
                onClick={() => setXScale((prev) => Math.min(MAX_X_SCALE, Number((prev + SCALE_STEP).toFixed(3))))}
                className="h-7 w-7 rounded-full border border-white/15 text-white/80 transition hover:border-white/40 hover:text-white"
                aria-label="Увеличить масштаб"
              >
                +
              </button>
            </div>
            <div className="relative overflow-x-auto rounded-xl border border-white/10 bg-background/70 p-3">
              {chartSeries.every((s) => s.points.length === 0) ? (
                <p className="text-sm text-muted">Нет данных для графика.</p>
              ) : (
                <div style={{ width: `${chartWidth}px` }}>
                  <svg
                    role="img"
                    aria-label="График таймеров"
                    className="min-w-full"
                    viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
                    preserveAspectRatio="xMinYMin slice"
                  >
                    <g transform={`translate(0,${CHART_HEIGHT - 40})`}>
                      {xKeys.map((key, idx) => {
                        const x = CHART_LEFT_PADDING + idx * X_STEP * xScale;
                        const axisFontSize = Math.max(10, (32 * chartTextScale) / 1.5);
                        if (granularity === 'day') {
                          const dateLabel = formatDayLabelShort(key);
                          const weekdayLabel = getWeekdayLabel(key);
                          const width = Math.max(
                            approxTextWidth(dateLabel, axisFontSize),
                            approxTextWidth(weekdayLabel, Math.max(9, axisFontSize - 6)),
                          );
                          const box: LabelBox = {
                            x1: x,
                            x2: x + width,
                            y1: 10 - axisFontSize,
                            y2: 28,
                          };
                          if (axisLabelBoxes.some((existing) => boxesOverlap(existing, box))) {
                            return null;
                          }
                          axisLabelBoxes.push(box);
                          return (
                            <g key={key}>
                              <text x={x} y={10} fill="#9CA3AF" fontSize={axisFontSize} textAnchor="start">
                                {dateLabel}
                              </text>
                              <text
                                x={x}
                                y={28}
                                fill="#6B7280"
                                fontSize={Math.max(9, axisFontSize - 6)}
                                textAnchor="start"
                              >
                                {weekdayLabel}
                              </text>
                            </g>
                          );
                        }
                        const label = formatLabel(key, granularity);
                        const width = approxTextWidth(label, axisFontSize);
                        const box: LabelBox = {
                          x1: x,
                          x2: x + width,
                          y1: 20 - axisFontSize,
                          y2: 20,
                        };
                        if (axisLabelBoxes.some((existing) => boxesOverlap(existing, box))) {
                          return null;
                        }
                        axisLabelBoxes.push(box);
                        return (
                          <text
                            key={key}
                            x={x}
                            y={20}
                            fill="#9CA3AF"
                            fontSize={axisFontSize}
                            textAnchor="start"
                            transform={`rotate(0 ${x} ${20})`}
                          >
                            {label}
                          </text>
                        );
                      })}
                    </g>
                    {chartSeries.map(({ timer, points }) => {
                      if (!points.length) return null;
                      const color = resolveColorHex(timer.color);
                      const pointMap = new Map(points.map((p) => [p.key, p]));
                      let path = '';
                      xKeys.forEach((key, idx) => {
                        const p = pointMap.get(key);
                        if (!p) return;
                        const x = CHART_LEFT_PADDING + idx * X_STEP * xScale;
                        const y = CHART_HEIGHT - 80 - (p.value / maxValue) * (CHART_HEIGHT - 120);
                        path += `${path ? ' L' : 'M'} ${x} ${y}`;
                      });
                      return (
                        <g key={timer.id}>
                          <path d={path} stroke={color} strokeWidth={2} fill="none" />
                          {xKeys.map((key, idx) => {
                            const p = pointMap.get(key);
                            if (!p) return null;
                            const x = CHART_LEFT_PADDING + idx * X_STEP * xScale;
                            const y = CHART_HEIGHT - 80 - (p.value / maxValue) * (CHART_HEIGHT - 120);
                            const valueFontSize = Math.max(10, 28 * chartTextScale);
                            const valueLabel = formatValue(p.value, metric);
                            const labelWidth = approxTextWidth(valueLabel, valueFontSize);
                            const box: LabelBox = {
                              x1: x + 6,
                              x2: x + 6 + labelWidth,
                              y1: y - 6 - valueFontSize,
                              y2: y - 6,
                            };
                            const shouldRenderValue = !pointLabelBoxes.some((existing) => boxesOverlap(existing, box));
                            if (shouldRenderValue) {
                              pointLabelBoxes.push(box);
                            }
                            return (
                              <g
                                key={key}
                                onClick={() => handleChartPointClick(key)}
                                className="cursor-pointer"
                              >
                                <circle cx={x} cy={y} r={3} fill={color} />
                                {shouldRenderValue && (
                                  <text x={x + 6} y={y - 6} fill="#e5e7eb" fontSize={valueFontSize}>
                                    {valueLabel}
                                  </text>
                                )}
                              </g>
                            );
                          })}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-2xl text-muted">
                {chartSeries.map(({ timer }) => (
                  <span key={timer.id} className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: resolveColorHex(timer.color) }} />
                    {timer.name}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function formatDuration(sec: number) {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDayLabel(day: string) {
  const [y, m, d] = day.split('-');
  if (!y || !m || !d) return day;
  return `${d}.${m}.${y}`;
}

function formatDayLabelShort(day: string) {
  const [, m, d] = day.split('-');
  if (!m || !d) return day;
  return `${d}.${m}`;
}

function formatValue(value: number, metric: Metric) {
  if (metric === 'percent') return `${value.toFixed(1)}%`;
  // seconds -> hours
  const hours = value / 3600;
  if (metric === 'avg') return `${hours.toFixed(1)}ч/день`;
  return `${hours.toFixed(1)}ч`;
}

function formatLabel(key: string, granularity: Granularity) {
  if (granularity === 'week') return getWeekStartDate(key);
  return key;
}

const getReferenceElement = (reference: ReferenceType | null): Element | null => {
  if (!reference) return null;
  if (reference instanceof Element) {
    return reference;
  }
  return reference.contextElement ?? null;
};

type CategoryEditorProps = {
  task: CompletedTaskWithCategories;
  nonAutoCategories: NonNullable<CompletedTaskWithCategories['categories']>;
  attachCategoryToTask: ReturnType<typeof useAttachCategoryToTask>;
  detachCategoryFromTask: ReturnType<typeof useDetachCategoryFromTask>;
  onOptimisticUpdate: (
    taskId: string,
    updater: (categories: CompletedTaskWithCategories['categories']) => CompletedTaskWithCategories['categories'],
  ) => unknown;
  onOptimisticRollback: (snapshot: unknown) => void;
};

function CategoryEditor({
  task,
  nonAutoCategories,
  attachCategoryToTask,
  detachCategoryFromTask,
  onOptimisticUpdate,
  onOptimisticRollback,
}: CategoryEditorProps) {
  const [open, setOpen] = useState(false);
  const selected = new Set(task.categories?.map((c) => c.id) ?? []);

  const toggle = async (categoryId: string) => {
    const snapshot = onOptimisticUpdate(task.id, (current) => {
      const next = new Set(current?.map((cat) => cat.id) ?? []);
      if (next.has(categoryId)) {
        return (current ?? []).filter((cat) => cat.id !== categoryId);
      }
      const nextCategory = nonAutoCategories.find((cat) => cat.id === categoryId);
      if (!nextCategory) return current ?? [];
      return [...(current ?? []), { ...nextCategory, is_auto: false }];
    });
    if (selected.has(categoryId)) {
      try {
        await detachCategoryFromTask.mutateAsync({ taskId: task.id, categoryId });
      } catch (error) {
        onOptimisticRollback(snapshot);
        throw error;
      }
    } else {
      try {
        await attachCategoryToTask.mutateAsync({ taskId: task.id, categoryId });
      } catch (error) {
        onOptimisticRollback(snapshot);
        throw error;
      }
    }
  };

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {task.categories?.map((cat) => {
          const preset = getCategoryColorPreset(cat.color);
          return (
            <span
              key={cat.id}
              className={clsx('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs', preset.chipClass)}
            >
              {cat.name}
              <button
                type="button"
                onClick={() => toggle(cat.id)}
                className="text-white/80 transition hover:text-rose-300"
                aria-label={`Удалить категорию ${cat.name}`}
              >
                ✕
              </button>
            </span>
          );
        })}
        {task.categories?.length === 0 && <span className="text-xs text-muted">Нет категорий</span>}
      </div>
      {open ? (
        <div className="mt-2 flex items-center gap-2">
          <TaxonomySelect
            placeholder="Добавить категорию"
            ariaLabel="Добавить категорию к задаче"
            options={nonAutoCategories.map((cat) => ({ value: cat.id, label: cat.name }))}
            disabled={nonAutoCategories.length === 0}
            className="w-full"
            enableSearch
            autoFocus
            onSelectOption={(option) => {
              void toggle(option.value);
              setOpen(false);
            }}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-white/60 underline-offset-2 hover:text-white"
          >
            Скрыть
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs text-white/70 underline-offset-2 hover:text-white"
          >
            Добавить категорию
          </button>
        </div>
      )}
    </div>
  );
}

type TaxonomySelectOption = {
  value: string;
  label: string;
};

type TaxonomySelectProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder: string;
  options: TaxonomySelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  enableSearch?: boolean;
  searchPlaceholder?: string;
  emptyStateLabel?: string;
  onSelectOption?: (option: TaxonomySelectOption) => void | Promise<void>;
  clearOnSelect?: boolean;
  autoFocus?: boolean;
};

function TaxonomySelect({
  value,
  onChange,
  placeholder,
  options,
  disabled,
  ariaLabel,
  className,
  enableSearch = false,
  searchPlaceholder = 'Поиск…',
  emptyStateLabel = 'Нет доступных вариантов',
  onSelectOption,
  clearOnSelect = true,
  autoFocus = false,
}: TaxonomySelectProps) {
  const [internalValue, setInternalValue] = useState('');
  const currentValue = value ?? internalValue;
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [floatingWidth, setFloatingWidth] = useState<number | null>(null);
  const selectId = useId();
  const listId = `${selectId}-listbox`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(8), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
    placement: 'bottom-start',
  });

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) ||
        refs.floating.current?.contains(target) ||
        (target instanceof HTMLElement && target.closest(TAXONOMY_DROPDOWN_SELECTOR))
      ) {
        return;
      }
      setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const referenceEl = getReferenceElement(refs.reference.current);
    const nextWidth = Math.max(referenceEl?.getBoundingClientRect().width ?? 0, 256);
    setFloatingWidth(nextWidth);
    if (enableSearch) {
      setSearchQuery('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, enableSearch]);

  const filteredOptions = useMemo(() => {
    if (!enableSearch) return options;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }, [options, searchQuery, enableSearch]);

  const selectedOption = options.find((option) => option.value === currentValue);
  const inputDisplayValue = isOpen && enableSearch ? searchQuery : selectedOption?.label ?? '';
  const inputPlaceholder = isOpen && enableSearch ? searchPlaceholder : placeholder;

  const commitValue = (nextValue: string) => {
    if (onChange) onChange(nextValue);
    else setInternalValue(nextValue);
  };

  const handleSelect = async (option: TaxonomySelectOption) => {
    if (disabled) return;
    commitValue(option.value);
    if (onSelectOption) {
      try {
        await onSelectOption(option);
      } catch (error) {
        console.error(error);
      }
    }
    if (clearOnSelect) {
      commitValue('');
    }
    setIsOpen(false);
    setSearchQuery('');
  };

  const openDropdown = () => {
    if (disabled) return;
    setIsOpen(true);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!enableSearch) return;
    if (!isOpen) {
      openDropdown();
    }
    setSearchQuery(event.target.value);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
    }
    if ((event.key === 'Enter' || event.key === 'ArrowDown') && !isOpen) {
      event.preventDefault();
      openDropdown();
    }
  };

  const assignReference = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    refs.setReference(node);
  };

  return (
    <div ref={assignReference} data-taxonomy-dropdown="true" className={clsx('relative', className)}>
      <div
        className={clsx(
          'flex items-center rounded-full border border-white/20 px-3 py-1.5 transition focus-within:ring-2 focus-within:ring-accent/40',
          disabled ? 'cursor-not-allowed bg-white/5 text-muted opacity-60' : 'bg-white/10 text-text hover:border-white/40',
        )}
        onMouseDown={(event) => {
          if (event.target === inputRef.current) return;
          event.preventDefault();
          if (disabled) return;
          openDropdown();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-label={ariaLabel ?? placeholder}
          placeholder={inputPlaceholder}
          value={inputDisplayValue}
          onFocus={openDropdown}
          onClick={() => {
            if (!isOpen) openDropdown();
          }}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          readOnly={!enableSearch}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          className={clsx('flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted', disabled && 'cursor-not-allowed text-muted')}
        />
        <button
          type="button"
          aria-label={isOpen ? 'Свернуть список' : 'Развернуть список'}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            if (disabled) return;
            setIsOpen((prev) => !prev);
            inputRef.current?.focus();
          }}
          className={clsx(
            'ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[0.65rem] transition',
            disabled ? 'text-muted/50' : isOpen ? 'rotate-180 text-accent' : 'text-muted',
          )}
        >
          ▾
        </button>
      </div>
      {isOpen && !disabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            data-taxonomy-dropdown="true"
            style={{ ...floatingStyles, width: floatingWidth ?? undefined }}
            className="z-[1200] mt-2 max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-background/90 p-2 text-sm text-text shadow-2xl backdrop-blur"
          >
            <ul role="listbox" id={listId} aria-labelledby={selectId} className="max-h-56 overflow-y-auto pr-1">
              {filteredOptions.map((option) => (
                <li key={option.value} className="py-0.5">
                  <button
                    type="button"
                    role="option"
                    aria-selected={currentValue === option.value}
                    onClick={() => {
                      void handleSelect(option);
                    }}
                    className={clsx(
                      'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition',
                      currentValue === option.value ? 'bg-accent/20 text-accent' : 'text-text hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <span>{option.label}</span>
                    {currentValue === option.value && <span aria-hidden="true">✓</span>}
                  </button>
                </li>
              ))}
              {filteredOptions.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-muted">{emptyStateLabel}</li>
              )}
            </ul>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
