import { useCallback, useEffect, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

import type { MicroTaskRecord } from '../../../features/microTasks/types';
import {
  CATEGORY_COLOR_MAP,
  getCategoryColorPreset,
  MAX_EXTRA_TIMERS,
  TIMERS_CONFIG_KEY,
  TIMERS_CONFIG_VERSION,
} from '../utils/constants';

export type TimerMode = 'only' | 'exclude';

export type TimerSettings = {
  id: string;
  tagIds: string[];
  mode: TimerMode;
  colorId?: string | null;
};

export type TimersState = {
  primary: TimerSettings;
  extras: TimerSettings[];
};

type TimersConfigPayload = {
  version: number;
  primary: TimerSettings;
  extras: TimerSettings[];
};

const DEFAULT_PRIMARY_TIMER: TimerSettings = {
  id: 'primary',
  tagIds: [],
  mode: 'only',
  colorId: null,
};

const createDefaultTimersState = (): TimersState => ({
  primary: { ...DEFAULT_PRIMARY_TIMER },
  extras: [],
});

const sanitizeTagIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      )
    : [];

const migrateLegacyTimerSettings = (raw: Record<string, unknown>) => {
  if ('tagIds' in raw) return raw;
  if ('categoryIds' in raw) {
    return { ...raw, tagIds: sanitizeTagIds(raw.categoryIds) };
  }
  return { ...raw, tagIds: [] };
};

const normalizeTimerSettings = (
  raw: unknown,
  fallbackId: string,
): TimerSettings => {
  if (!raw || typeof raw !== 'object') {
    return { id: fallbackId, tagIds: [], mode: 'only', colorId: null };
  }
  const migrated = migrateLegacyTimerSettings(
    raw as Record<string, unknown>,
  ) as Partial<TimerSettings>;
  const tagIds = sanitizeTagIds(migrated.tagIds);
  const mode: TimerMode = migrated.mode === 'exclude' ? 'exclude' : 'only';
  const id = typeof migrated.id === 'string' ? migrated.id : fallbackId;
  const colorId =
    typeof migrated.colorId === 'string' || migrated.colorId === null
      ? migrated.colorId
      : null;
  return { id, tagIds, mode, colorId };
};

const normalizeTimersState = (config: unknown): TimersState => {
  if (!config || typeof config !== 'object') return createDefaultTimersState();
  const payload = config as Partial<TimersConfigPayload>;
  const primary = normalizeTimerSettings(
    payload.primary
      ? migrateLegacyTimerSettings(payload.primary as Record<string, unknown>)
      : null,
    'primary',
  );
  const extrasSource = Array.isArray(payload.extras) ? payload.extras : [];
  const extras: TimerSettings[] = extrasSource
    .slice(0, MAX_EXTRA_TIMERS)
    .map((entry, index) => {
      const fallbackId =
        typeof (entry as TimerSettings)?.id === 'string'
          ? (entry as TimerSettings).id
          : `legacy-${index}`;
      return normalizeTimerSettings(
        migrateLegacyTimerSettings(entry as Record<string, unknown>),
        fallbackId,
      );
    });
  return { primary: { ...primary, id: 'primary' }, extras };
};

const serializeTimersState = (state: TimersState): TimersConfigPayload => ({
  version: TIMERS_CONFIG_VERSION,
  primary: state.primary,
  extras: state.extras,
});

export const describeTimerTags = (
  timer: TimerSettings,
  tagMap: Map<string, string>,
) => {
  if (!timer.tagIds.length) return 'Все теги';
  const names = timer.tagIds
    .map((tagId) => tagMap.get(tagId))
    .filter((name): name is string => Boolean(name));
  if (!names.length) return 'Все теги';
  return timer.mode === 'only'
    ? `Только: ${names.join(', ')}`
    : `Кроме: ${names.join(', ')}`;
};

type UseTimersParams = {
  config?: Record<string, unknown> | null;
  onUpdateConfig?: (patch: Record<string, unknown>) => void;
  tasks: MicroTaskRecord[];
  effectiveRunningId: string | null;
  now: number;
};

export function useTimers({
  config,
  onUpdateConfig,
  tasks,
  effectiveRunningId,
  now,
}: UseTimersParams) {
  const timersFromConfig = useMemo(() => {
    const raw =
      config && typeof config === 'object' && TIMERS_CONFIG_KEY in config
        ? (config as Record<string, unknown>)[TIMERS_CONFIG_KEY]
        : null;
    return normalizeTimersState(raw);
  }, [config]);

  const [timersState, setTimersState] = useState<TimersState>(timersFromConfig);

  const timersStateSignature = useMemo(
    () => JSON.stringify(serializeTimersState(timersState)),
    [timersState],
  );
  const timersConfigSignature = useMemo(
    () => JSON.stringify(serializeTimersState(timersFromConfig)),
    [timersFromConfig],
  );

  useEffect(() => {
    if (timersConfigSignature === timersStateSignature) return;
    setTimersState(timersFromConfig);
  }, [timersConfigSignature, timersFromConfig, timersStateSignature]);

  const applyTimersUpdate = useCallback(
    (updater: (current: TimersState) => TimersState) => {
      setTimersState((current) => {
        const next = updater(current);
        if (onUpdateConfig) {
          onUpdateConfig({ [TIMERS_CONFIG_KEY]: serializeTimersState(next) });
        }
        return next;
      });
    },
    [onUpdateConfig],
  );

  const computeTaskSeconds = useCallback(
    (task: MicroTaskRecord, isRunningOverride?: boolean) => {
      let seconds =
        typeof task.elapsed_seconds === 'number' &&
        Number.isFinite(task.elapsed_seconds)
          ? task.elapsed_seconds
          : 0;
      const isRunning = isRunningOverride ?? task.timer_state === 'running';
      if (isRunning && task.last_started_at) {
        seconds += Math.max(
          0,
          Math.floor((now - new Date(task.last_started_at).getTime()) / 1000),
        );
      }
      return seconds;
    },
    [now],
  );

  const timedTasks = useMemo(
    () =>
      tasks.map((task) => ({
        task,
        seconds: computeTaskSeconds(task, effectiveRunningId === task.id),
      })),
    [tasks, computeTaskSeconds, effectiveRunningId],
  );

  const taskTagIdsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    tasks.forEach((task) => {
      const ids = new Set<string>();
      task.categories?.forEach((category) => {
        category.tags?.forEach((tag) => ids.add(tag.id));
        if (category.source_tag_id) ids.add(category.source_tag_id);
      });
      map.set(task.id, Array.from(ids));
    });
    return map;
  }, [tasks]);

  const taskSecondsMap = useMemo(() => {
    const map = new Map<string, number>();
    timedTasks.forEach(({ task, seconds }) => map.set(task.id, seconds));
    return map;
  }, [timedTasks]);

  const totalElapsed = useMemo(
    () => timedTasks.reduce((acc, entry) => acc + entry.seconds, 0),
    [timedTasks],
  );

  const computeTimerElapsedValue = useCallback(
    (timer: TimerSettings) => {
      if (!timer.tagIds.length) return totalElapsed;
      const tagSet = new Set(timer.tagIds);
      return timedTasks.reduce((sum, entry) => {
        const tagIds = taskTagIdsMap.get(entry.task.id) ?? [];
        const hasMatch = tagIds.some((tagId) => tagSet.has(tagId));
        const include = timer.mode === 'only' ? hasMatch : !hasMatch;
        return include ? sum + entry.seconds : sum;
      }, 0);
    },
    [timedTasks, totalElapsed, taskTagIdsMap],
  );

  const resolveTimerColorPreset = useCallback((timer: TimerSettings) => {
    if (timer.colorId) {
      const preset = CATEGORY_COLOR_MAP[timer.colorId];
      if (preset) return preset;
    }
    return getCategoryColorPreset();
  }, []);

  const buildTimerMetrics = useCallback(
    (timer: TimerSettings) => {
      const elapsed = computeTimerElapsedValue(timer);
      const percent =
        totalElapsed > 0
          ? Math.min(100, Math.round((elapsed / totalElapsed) * 100))
          : 0;
      const colorPreset = resolveTimerColorPreset(timer);
      return { elapsed, percent, colorPreset };
    },
    [computeTimerElapsedValue, resolveTimerColorPreset, totalElapsed],
  );

  const updateTimerSettings = useCallback(
    (
      timerId: string,
      updater: (timer: TimerSettings) => TimerSettings,
    ) => {
      applyTimersUpdate((prev) => {
        if (timerId === prev.primary.id) {
          return { ...prev, primary: updater(prev.primary) };
        }
        if (!prev.extras.some((timer) => timer.id === timerId)) return prev;
        return {
          ...prev,
          extras: prev.extras.map((timer) =>
            timer.id === timerId ? updater(timer) : timer,
          ),
        };
      });
    },
    [applyTimersUpdate],
  );

  const handleTimerDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!active?.id || !over?.id || active.id === over.id) return;
      applyTimersUpdate((prev) => {
        const currentIndex = prev.extras.findIndex(
          (timer) => timer.id === active.id,
        );
        const overIndex = prev.extras.findIndex(
          (timer) => timer.id === over.id,
        );
        if (currentIndex === -1 || overIndex === -1) return prev;
        return { ...prev, extras: arrayMove(prev.extras, currentIndex, overIndex) };
      });
    },
    [applyTimersUpdate],
  );

  const handleAddTimer = useCallback(() => {
    applyTimersUpdate((prev) => {
      if (prev.extras.length >= MAX_EXTRA_TIMERS) return prev;
      const nextTimer: TimerSettings = {
        id: nanoid(),
        tagIds: [],
        mode: 'only',
        colorId: null,
      };
      return { ...prev, extras: [...prev.extras, nextTimer] };
    });
  }, [applyTimersUpdate]);

  const handleRemoveTimer = useCallback(
    (timerId: string) => {
      applyTimersUpdate((prev) => ({
        ...prev,
        extras: prev.extras.filter((timer) => timer.id !== timerId),
      }));
    },
    [applyTimersUpdate],
  );

  const handleTimerModeToggle = useCallback(
    (timerId: string) => {
      updateTimerSettings(timerId, (timer) => ({
        ...timer,
        mode: timer.mode === 'only' ? 'exclude' : 'only',
      }));
    },
    [updateTimerSettings],
  );

  const handleTimerTagAdd = useCallback(
    (timerId: string, tagId: string) => {
      updateTimerSettings(timerId, (timer) =>
        timer.tagIds.includes(tagId)
          ? timer
          : { ...timer, tagIds: [...timer.tagIds, tagId] },
      );
    },
    [updateTimerSettings],
  );

  const handleTimerTagRemove = useCallback(
    (timerId: string, tagId: string) => {
      updateTimerSettings(timerId, (timer) => ({
        ...timer,
        tagIds: timer.tagIds.filter((id) => id !== tagId),
      }));
    },
    [updateTimerSettings],
  );

  const handleTimerColorSelect = useCallback(
    (timerId: string, colorId: string | null) => {
      updateTimerSettings(timerId, (timer) => ({ ...timer, colorId }));
    },
    [updateTimerSettings],
  );

  const extraTimerViews = useMemo(
    () =>
      timersState.extras.map((timer) => ({
        settings: timer,
        metrics: buildTimerMetrics(timer),
      })),
    [timersState.extras, buildTimerMetrics],
  );

  const primaryTimerView = useMemo(
    () => buildTimerMetrics(timersState.primary),
    [timersState.primary, buildTimerMetrics],
  );

  const canAddTimer = timersState.extras.length < MAX_EXTRA_TIMERS;

  return {
    timersState,
    extraTimerViews,
    primaryTimerView,
    canAddTimer,
    computeTaskSeconds,
    taskSecondsMap,
    handleTimerDragEnd,
    handleAddTimer,
    handleRemoveTimer,
    handleTimerModeToggle,
    handleTimerTagAdd,
    handleTimerTagRemove,
    handleTimerColorSelect,
  };
}
