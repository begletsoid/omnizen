import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCorners,
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  defaultAnimateLayoutChanges,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';

import type { HabitRecord, HabitStatus } from '../../features/habits/types';
import {
  useCreateHabit,
  useDeleteHabit,
  useHabits,
  useSaveHabitOrders,
  useUpdateHabit,
} from '../../features/habits/hooks';
import { buildHabitOrderUpdates } from '../../features/habits/utils';

const STATUS_META: Array<{
  key: HabitStatus;
  accent: string;
  pill: string;
}> = [
  {
    key: 'adopted',
    accent: 'border-emerald-400/50',
    pill: 'bg-emerald-400/80 text-emerald-950',
  },
  {
    key: 'in_progress',
    accent: 'border-amber-400/50',
    pill: 'bg-amber-300 text-amber-900',
  },
  {
    key: 'not_started',
    accent: 'border-rose-400/50',
    pill: 'bg-rose-400 text-rose-50',
  },
];

type HabitsWidgetProps = {
  widgetId: string | null;
  initialHeight?: number | null;
  initialScrollTop?: number | null;
  onHeightChange?: (nextHeight: number) => void;
  onScrollPersist?: (scrollTop: number) => void;
};

const MIN_LIST_HEIGHT = 70;
const MAX_LIST_HEIGHT = 540;
const DEFAULT_LIST_HEIGHT = 240;

export function HabitsWidget({
  widgetId,
  initialHeight,
  initialScrollTop,
  onHeightChange,
  onScrollPersist,
}: HabitsWidgetProps) {
  const ready = Boolean(widgetId);
  const { data, isLoading, isError, error } = useHabits(widgetId ?? null);
  const createHabit = useCreateHabit(widgetId ?? null);
  const updateHabit = useUpdateHabit(widgetId ?? null);
  const saveHabitOrders = useSaveHabitOrders(widgetId ?? null);
  const deleteHabit = useDeleteHabit(widgetId ?? null);
  const queryClient = useQueryClient();
  const habitsQueryKey = useMemo(() => ['habits', widgetId], [widgetId]);
  const startOfTodayMs = useMemo(() => {
    const baseline = new Date();
    baseline.setHours(0, 0, 0, 0);
    return baseline.getTime();
  }, []);

  const getHabitSnapshot = useCallback(
    (habitId: string) => {
      if (!widgetId) return null;
      const list = queryClient.getQueryData<HabitRecord[]>(habitsQueryKey);
      return list?.find((habit) => habit.id === habitId) ?? null;
    },
    [habitsQueryKey, queryClient, widgetId],
  );

  const mutateHabitCounters = useCallback(
    (
      habitId: string,
      patch: Partial<
        Pick<HabitRecord, 'success_count' | 'fail_count' | 'success_updated_at'>
      >,
    ) => {
      if (!widgetId) return;
      updateHabit.mutate({ id: habitId, ...patch });
    },
    [updateHabit, widgetId],
  );

  const updateSuccessCount = useCallback(
    (habitId: string, compute: (current: number) => number) => {
      const snapshot = getHabitSnapshot(habitId);
      if (!snapshot) return;
      const nextValue = normalizeCounterValue(compute(snapshot.success_count));
      if (nextValue === snapshot.success_count) return;
      mutateHabitCounters(habitId, {
        success_count: nextValue,
        success_updated_at: new Date().toISOString(),
      });
    },
    [getHabitSnapshot, mutateHabitCounters],
  );

  const updateFailCount = useCallback(
    (habitId: string, compute: (current: number) => number) => {
      const snapshot = getHabitSnapshot(habitId);
      if (!snapshot) return;
      const nextValue = normalizeCounterValue(compute(snapshot.fail_count));
      if (nextValue === snapshot.fail_count) return;
      mutateHabitCounters(habitId, {
        fail_count: nextValue,
      });
    },
    [getHabitSnapshot, mutateHabitCounters],
  );

  const incrementSuccess = useCallback(
    (habitId: string) => updateSuccessCount(habitId, (current) => current + 1),
    [updateSuccessCount],
  );

  const setSuccessValue = useCallback(
    (habitId: string, nextValue: number) => updateSuccessCount(habitId, () => nextValue),
    [updateSuccessCount],
  );

  const ensureFailVisible = useCallback(
    (habitId: string) => updateFailCount(habitId, (current) => (current > 0 ? current : 1)),
    [updateFailCount],
  );

  const incrementFail = useCallback(
    (habitId: string) => updateFailCount(habitId, (current) => (current > 0 ? current + 1 : 1)),
    [updateFailCount],
  );

  const setFailValue = useCallback(
    (habitId: string, nextValue: number) => updateFailCount(habitId, () => nextValue),
    [updateFailCount],
  );

  const hideFail = useCallback(
    (habitId: string) => updateFailCount(habitId, () => 0),
    [updateFailCount],
  );

  const normalizedInitialHeight =
    typeof initialHeight === 'number' ? initialHeight : undefined;
  const [listHeight, setListHeight] = useState<number>(
    normalizedInitialHeight ?? DEFAULT_LIST_HEIGHT,
  );
  const [userAdjusted, setUserAdjusted] = useState(false);
  const pendingHeightRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
const scrollPersistTimeoutRef = useRef<number | null>(null);
  const lastPersistedScrollRef = useRef<number | null>(
    typeof initialScrollTop === 'number' ? initialScrollTop : null,
  );
  const [scrollRestored, setScrollRestored] = useState(false);
  const pendingScrollTopRef = useRef<number | null>(
    typeof initialScrollTop === 'number' ? initialScrollTop : null,
  );
  const scrollRestoreFrameRef = useRef<number | null>(null);
const [editingHabit, setEditingHabit] = useState<{ id: string; value: string } | null>(null);
const resizeStateRef = useRef<{
  originY: number;
  initialHeight: number;
  direction: 'top' | 'bottom';
} | null>(null);

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
  const totalHabits = data?.length ?? 0;

  const clampHeight = (value: number) =>
    Math.max(MIN_LIST_HEIGHT, Math.min(MAX_LIST_HEIGHT, value));

  const applyHeight = useCallback((nextValue: number) => {
    setListHeight((prev) => {
      const next = clampHeight(nextValue);
      if (next === prev) return prev;
      pendingHeightRef.current = next;
      setUserAdjusted(true);
      return next;
    });
  }, []);

  const handleResizeMove = useCallback(
    (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const delta = event.clientY - state.originY;
      const signedDelta = state.direction === 'bottom' ? delta : -delta;
      applyHeight(state.initialHeight + signedDelta);
    },
    [applyHeight],
  );

  const stopResizing = useCallback(() => {
    if (!resizeStateRef.current) return;
    resizeStateRef.current = null;
    window.removeEventListener('pointermove', handleResizeMove);
    window.removeEventListener('pointerup', stopResizing);
    window.removeEventListener('pointercancel', stopResizing);
  }, [handleResizeMove]);

  const handleResizeStart = useCallback(
    (direction: 'top' | 'bottom', event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizeStateRef.current = {
        originY: event.clientY,
        initialHeight: listHeight,
        direction,
      };
      window.addEventListener('pointermove', handleResizeMove);
      window.addEventListener('pointerup', stopResizing);
      window.addEventListener('pointercancel', stopResizing);
    },
    [handleResizeMove, listHeight, stopResizing],
  );

  useEffect(() => {
    if (typeof normalizedInitialHeight !== 'number') return;
    if (userAdjusted) return;
    setListHeight(normalizedInitialHeight);
  }, [normalizedInitialHeight, userAdjusted]);

  useEffect(() => {
    if (!userAdjusted) return;
    if (pendingHeightRef.current === null) return;
    const next = pendingHeightRef.current;
    pendingHeightRef.current = null;
    onHeightChange?.(next);
  }, [listHeight, onHeightChange, userAdjusted]);

  useEffect(() => {
    const normalized = typeof initialScrollTop === 'number' ? initialScrollTop : null;
    lastPersistedScrollRef.current = normalized;
    pendingScrollTopRef.current = normalized;
    setScrollRestored(false);
  }, [initialScrollTop]);

  useEffect(() => {
    if (pendingScrollTopRef.current === null) return;
    if (scrollRestored) return;

    const attempt = () => {
      const node = listRef.current;
      if (!node) {
        scrollRestoreFrameRef.current = window.requestAnimationFrame(attempt);
        return;
      }

      const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
      if (maxScroll <= 0 && (pendingScrollTopRef.current ?? 0) > 0) {
        scrollRestoreFrameRef.current = window.requestAnimationFrame(attempt);
        return;
      }

      const nextValue = Math.min(pendingScrollTopRef.current ?? 0, maxScroll);
      node.scrollTop = nextValue;
      pendingScrollTopRef.current = null;
      setScrollRestored(true);
    };

    scrollRestoreFrameRef.current = window.requestAnimationFrame(attempt);

    return () => {
      if (scrollRestoreFrameRef.current) {
        window.cancelAnimationFrame(scrollRestoreFrameRef.current);
        scrollRestoreFrameRef.current = null;
      }
    };
  }, [listHeight, scrollRestored, totalHabits]);

  useEffect(
    () => () => {
      if (scrollPersistTimeoutRef.current) {
        window.clearTimeout(scrollPersistTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(
    () => () => {
      stopResizing();
    },
    [stopResizing],
  );

  const [newHabitTitle, setNewHabitTitle] = useState('');
  const handleCreate = async () => {
    if (!widgetId) return;
    const title = newHabitTitle.trim();
    if (!title) return;
    await createHabit.mutateAsync({ title, status: 'not_started' });
    setNewHabitTitle('');
  };

  const startEditingHabit = (habit: HabitRecord) => {
    setEditingHabit({ id: habit.id, value: habit.title });
  };

  const cancelEditingHabit = () => setEditingHabit(null);

  const commitEditingHabit = async () => {
    if (!editingHabit) return;
    const source = data?.find((h) => h.id === editingHabit.id);
    if (!source) {
      setEditingHabit(null);
      return;
    }
    const trimmed = editingHabit.value.trim();
    if (!trimmed || trimmed === source.title) {
      setEditingHabit(null);
      return;
    }
    await updateHabit.mutateAsync({ id: source.id, title: trimmed });
    setEditingHabit(null);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !data || !widgetId) return;
    const activeId = String(active.id);
    const overType = over.data.current?.type as 'card' | 'column' | undefined;
    const targetStatus =
      (over.data.current?.status as HabitStatus | undefined) ??
      STATUS_META.find((meta) => meta.key === over.id)?.key;
    if (!targetStatus) return;

    const activeHabit = data.find((habit) => habit.id === activeId);
    if (!activeHabit) return;

    const targetColumn = grouped[targetStatus] ?? [];
    const sanitizedTarget = targetColumn.filter((habit) => habit.id !== activeId);
    let insertIndex = sanitizedTarget.length;

    if (overType === 'card') {
      const overIndexOriginal = targetColumn.findIndex((habit) => habit.id === over.id);
      const overIndexSanitized = sanitizedTarget.findIndex((habit) => habit.id === over.id);
      if (overIndexOriginal === -1 || overIndexSanitized === -1) return;

      const sourceIndex = targetColumn.findIndex((habit) => habit.id === activeId);
      const draggingDownward =
        targetStatus === activeHabit.status && sourceIndex !== -1 && overIndexOriginal > sourceIndex;
      insertIndex = Math.min(
        overIndexSanitized + (draggingDownward ? 1 : 0),
        sanitizedTarget.length,
      );
    }

    const updates = buildHabitOrderUpdates({
      activeHabit,
      targetStatus,
      insertIndex,
      grouped,
    });

    if (!updates.length) return;
    await saveHabitOrders.mutateAsync(updates);
  };

  if (!ready) {
    return (
      <section className="glass-panel flex flex-col gap-2 px-5 py-6">
        <p className="text-sm text-muted">Виджет пока не готов — обновите страницу.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-sm flex-col gap-3 px-2 py-2">
      {isLoading && <p className="text-sm text-muted">Загружаем привычки…</p>}
      {isError && (
        <p className="text-sm text-rose-400">
          Не удалось загрузить привычки: {error?.message ?? 'неизвестная ошибка'}
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="relative">
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Потяните, чтобы изменить высоту списка"
            className="absolute left-6 right-6 -top-3 z-10 h-3 cursor-ns-resize rounded-full border border-white/20 bg-white/10 transition-colors hover:bg-white/30"
            onPointerDown={(event) => handleResizeStart('top', event)}
          />
          <div
            ref={listRef}
            data-testid="habits-scrollable"
            className="rounded-3xl border border-white/15 bg-white/5 px-2 py-2"
            style={{ maxHeight: listHeight, overflowY: 'auto' }}
            onScroll={(event) => {
              const target = event.currentTarget;
              if (scrollPersistTimeoutRef.current) {
                window.clearTimeout(scrollPersistTimeoutRef.current);
              }
              scrollPersistTimeoutRef.current = window.setTimeout(() => {
                const nextTop = target.scrollTop;
                if (lastPersistedScrollRef.current === nextTop) return;
                lastPersistedScrollRef.current = nextTop;
                onScrollPersist?.(nextTop);
              }, 250);
            }}
          >
            {STATUS_META.map((status) => (
              <Column key={status.key} status={status.key} accent={status.accent}>
                <SortableContext
                  items={grouped[status.key].map((habit) => habit.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {grouped[status.key].map((habit) => (
                    <HabitCard
                      key={habit.id}
                      habit={habit}
                      pillClass={status.pill}
                      onDelete={() => deleteHabit.mutate(habit.id)}
                      isEditing={editingHabit?.id === habit.id}
                      editValue={editingHabit?.id === habit.id ? editingHabit.value : ''}
                      onEditStart={() => startEditingHabit(habit)}
                      onEditChange={(value) =>
                        setEditingHabit((prev) =>
                          prev && prev.id === habit.id ? { ...prev, value } : prev,
                        )
                      }
                      onEditCommit={commitEditingHabit}
                      onEditCancel={cancelEditingHabit}
                      counterHandlers={{
                        incrementSuccess: () => incrementSuccess(habit.id),
                        setSuccess: (value) => setSuccessValue(habit.id, value),
                        ensureFailVisible: () => ensureFailVisible(habit.id),
                        incrementFail: () => incrementFail(habit.id),
                        setFail: (value) => setFailValue(habit.id, value),
                        hideFail: () => hideFail(habit.id),
                      }}
                      highlightSuccess={isSuccessCounterStale(habit, startOfTodayMs)}
                    />
                  ))}
                </SortableContext>
              </Column>
            ))}
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Потяните, чтобы изменить высоту списка"
            className="absolute left-6 right-6 -bottom-3 z-10 h-3 cursor-ns-resize rounded-full border border-white/20 bg-white/10 transition-colors hover:bg-white/30"
            onPointerDown={(event) => handleResizeStart('bottom', event)}
          />
        </div>
      </DndContext>

      <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5">
        <input
          value={newHabitTitle}
          onChange={(event) => setNewHabitTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleCreate();
          }}
          placeholder="Новая привычка"
          className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
        />
        <button
          type="button"
          onClick={handleCreate}
          className="text-xl text-accent transition hover:text-accent/80"
          aria-label="Добавить привычку"
        >
          +
        </button>
      </div>
    </section>
  );
}

type ColumnProps = {
  status: HabitStatus;
  accent: string;
  children: React.ReactNode;
};

function Column({ status, accent, children }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: {
      type: 'column',
      status,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'flex flex-col gap-2 rounded-3xl border border-transparent bg-transparent p-2',
        accent,
        isOver && 'border-accent/70 bg-white/10',
      )}
    >
      <div className="flex flex-col gap-2 min-h-0">{children}</div>
    </div>
  );
}

type HabitCardProps = {
  habit: HabitRecord;
  pillClass: string;
  onDelete: () => void;
  isEditing: boolean;
  editValue: string;
  onEditStart: () => void;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  counterHandlers: HabitCounterHandlers;
  highlightSuccess: boolean;
};

function HabitCard({
  habit,
  onDelete,
  pillClass,
  isEditing,
  editValue,
  onEditStart,
  onEditChange,
  onEditCommit,
  onEditCancel,
  counterHandlers,
  highlightSuccess,
}: HabitCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: habit.id,
    data: {
      type: 'card',
      status: habit.status,
    },
    animateLayoutChanges: (args) => {
      if (args.isSorting || args.wasDragging) {
        return false;
      }
      return defaultAnimateLayoutChanges(args);
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging
      ? 'transform 120ms ease-out'
      : transition ?? 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
    opacity: isDragging ? 0.8 : 1,
    willChange: 'transform',
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter') {
      onEditCommit();
    } else if (event.key === 'Escape') {
      onEditCancel();
    }
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center justify-between gap-3 rounded-full px-4 py-3 text-sm font-semibold shadow-inner transition',
        pillClass,
      )}
      {...attributes}
      {...listeners}
    >
      {isEditing ? (
        <textarea
          style={{ maxWidth: 450 }}
          value={editValue}
          rows={1}
          onChange={(event) => onEditChange(event.target.value)}
          onInput={(event) => {
            const target = event.currentTarget;
            target.style.height = 'auto';
            target.style.height = `${target.scrollHeight}px`;
          }}
          onBlur={onEditCommit}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1 rounded-2xl bg-white/80 px-3 py-1 text-black outline-none resize-none"
        />
      ) : (
        <button
          type="button"
          className={clsx(
            'flex-1 max-w-[450px] cursor-text whitespace-normal break-words text-left',
            habit.status === 'adopted' ? 'text-emerald-950' : 'text-current',
          )}
          onClick={onEditStart}
        >
          {habit.title}
        </button>
      )}
      {habit.status === 'in_progress' && (
        <HabitCounters
          habit={habit}
          handlers={counterHandlers}
          highlightSuccess={highlightSuccess}
        />
      )}
      <button
        type="button"
        onClick={onDelete}
        className="text-xs text-black/70 transition hover:text-black"
        aria-label="Удалить"
      >
        ✕
      </button>
    </article>
  );
}

type HabitCounterHandlers = {
  incrementSuccess: () => void;
  setSuccess: (value: number) => void;
  ensureFailVisible: () => void;
  incrementFail: () => void;
  setFail: (value: number) => void;
  hideFail: () => void;
};

type CounterKind = 'success' | 'fail';

type HabitCountersProps = {
  habit: HabitRecord;
  handlers: HabitCounterHandlers;
  highlightSuccess: boolean;
};

function HabitCounters({ habit, handlers, highlightSuccess }: HabitCountersProps) {
  const [editing, setEditing] = useState<CounterKind | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const startEditing = (kind: CounterKind) => {
    setEditing(kind);
    setDraft(
      String(kind === 'success' ? habit.success_count : habit.fail_count).replace(/\s+/g, ''),
    );
  };

  const cancelEditing = () => {
    setEditing(null);
    setDraft('');
  };

  const commitEditing = () => {
    if (!editing) return;
    const normalized = normalizeCounterValue(Number(draft));
    if (editing === 'success') {
      handlers.setSuccess(normalized);
    } else if (normalized === 0) {
      handlers.hideFail();
    } else {
      handlers.setFail(normalized);
    }
    setEditing(null);
    setDraft('');
  };

  const handleNumberClick = (event: React.MouseEvent, kind: CounterKind) => {
    event.preventDefault();
    event.stopPropagation();
    if (kind === 'fail' && habit.fail_count === 0) return;
    startEditing(kind);
  };

  const showFailCounter = habit.fail_count > 0 || editing === 'fail';

  const renderValue = (kind: CounterKind) => {
    if (editing === kind) {
      return (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
          onBlur={commitEditing}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitEditing();
            } else if (event.key === 'Escape') {
              cancelEditing();
            }
          }}
          inputMode="numeric"
          aria-label={kind === 'success' ? 'Изменить успехи' : 'Изменить провалы'}
          className="w-10 rounded-md bg-white/80 px-1 text-center text-xs font-semibold text-black outline-none"
        />
      );
    }

    const value = kind === 'success' ? habit.success_count : habit.fail_count;
    return (
      <button
        type="button"
        onClick={(event) => handleNumberClick(event, kind)}
        className="min-w-[1.5rem] select-none text-center font-semibold text-black/80 transition hover:text-black"
        aria-label={kind === 'success' ? 'Редактировать успехи' : 'Редактировать провалы'}
      >
        {value}
      </button>
    );
  };

  return (
    <div
      className="flex items-center gap-2 text-xs text-black/80"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {showFailCounter && (
        <div className="flex items-center gap-1 rounded-2xl bg-black/10 px-2 py-0.5">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handlers.incrementFail();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handlers.hideFail();
            }}
            className="rounded-full px-1 text-sm text-black/70 transition hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/40"
            aria-label="Отметить провал"
            title="Отметить провал (ПКМ — скрыть)"
          >
            ✕
          </button>
          {renderValue('fail')}
        </div>
      )}
      <div className="flex items-center gap-1 rounded-2xl bg-black/10 px-2 py-0.5">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handlers.incrementSuccess();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handlers.ensureFailVisible();
          }}
          className={clsx(
            'rounded-full px-1 text-sm transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60',
            highlightSuccess
              ? 'text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.75)]'
              : 'text-black/70',
          )}
          aria-label="Отметить успех"
          title="Отметить успех (ПКМ — показать провалы)"
        >
          ✔
        </button>
        {renderValue('success')}
      </div>
    </div>
  );
}

function normalizeCounterValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function isSuccessCounterStale(habit: HabitRecord, todayStartMs: number) {
  const timestamp = habit.success_updated_at
    ? new Date(habit.success_updated_at).getTime()
    : 0;
  return timestamp < todayStartMs;
}
