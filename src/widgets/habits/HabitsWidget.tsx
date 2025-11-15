import { useMemo, useState } from 'react';
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';

import type { HabitRecord, HabitStatus } from '../../features/habits/types';
import {
  useCreateHabit,
  useDeleteHabit,
  useHabits,
  useUpdateHabit,
} from '../../features/habits/hooks';
import { getNextOrder } from '../../features/habits/utils';

const STATUS_META: Array<{
  key: HabitStatus;
  label: string;
  accent: string;
  pill: string;
}> = [
  {
    key: 'adopted',
    label: 'Внедрено',
    accent: 'border-emerald-400/50',
    pill: 'bg-emerald-400/80 text-emerald-950',
  },
  {
    key: 'in_progress',
    label: 'Внедряется',
    accent: 'border-amber-400/50',
    pill: 'bg-amber-300 text-amber-900',
  },
  {
    key: 'not_started',
    label: 'Не внедрено',
    accent: 'border-rose-400/50',
    pill: 'bg-rose-400 text-rose-50',
  },
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

  const [listHeight, setListHeight] = useState(320);

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

  const adjustHeight = (delta: number) => {
    setListHeight((prev) => Math.max(180, Math.min(540, prev + delta)));
  };

  const handleCreate = async () => {
    if (!widgetId) return;
    const titlePrompt = window.prompt('Название новой привычки', 'Новая привычка');
    if (!titlePrompt || !titlePrompt.trim()) return;
    await createHabit.mutateAsync({ title: titlePrompt.trim(), status: 'not_started' });
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !data) return;
    const activeId = String(active.id);
    const overType = over.data.current?.type as 'card' | 'column' | undefined;
    const targetStatus =
      (over.data.current?.status as HabitStatus | undefined) ??
      STATUS_META.find((meta) => meta.key === over.id)?.key;
    if (!targetStatus) return;

    const activeHabit = data.find((habit) => habit.id === activeId);
    if (!activeHabit) return;

    const targetItems = grouped[targetStatus].filter((habit) => habit.id !== activeId);
    let insertIndex = targetItems.length;
    if (overType === 'card') {
      const overIndex = targetItems.findIndex((habit) => habit.id === over.id);
      if (overIndex >= 0) {
        insertIndex = overIndex;
      }
    }

    const currentIndex = grouped[activeHabit.status].findIndex((habit) => habit.id === activeId);
    if (activeHabit.status === targetStatus && currentIndex === insertIndex) {
      return;
    }

    const prev = targetItems[insertIndex - 1];
    const next = targetItems[insertIndex];
    const newOrder = getNextOrder(prev?.order, next?.order);

    await updateHabit.mutateAsync({
      id: activeHabit.id,
      status: targetStatus,
      order: newOrder,
    });
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
    <section className="glass-panel flex flex-col gap-4 border border-border bg-surface/80 px-4 py-5 shadow-card">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.4em] text-muted">виджет</p>
        <h2 className="text-2xl font-semibold text-text">{title}</h2>
      </header>

      {isLoading && <p className="text-sm text-muted">Загружаем привычки…</p>}
      {isError && (
        <p className="text-sm text-rose-400">
          Не удалось загрузить привычки: {error?.message ?? 'неизвестная ошибка'}
        </p>
      )}

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => adjustHeight(-60)}
          className="flex h-10 w-16 items-center justify-center rounded-full border border-border bg-gradient-to-b from-white/30 to-white/5 text-xl text-muted transition hover:text-text"
          aria-label="Уменьшить высоту"
        >
          ▲
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div
          className="rounded-3xl border border-border/60 bg-background/40 px-3 pb-4 pt-2"
          style={{ maxHeight: listHeight, overflowY: 'auto' }}
        >
          {STATUS_META.map((status) => (
            <Column
              key={status.key}
              status={status.key}
              count={grouped[status.key].length}
              label={status.label}
              accent={status.accent}
            >
              <SortableContext
                items={grouped[status.key].map((habit) => habit.id)}
                strategy={verticalListSortingStrategy}
              >
                {grouped[status.key].length === 0 ? (
                  <p className="text-xs text-muted/70">Нет привычек</p>
                ) : (
                  grouped[status.key].map((habit) => (
                    <HabitCard
                      key={habit.id}
                      habit={habit}
                      pillClass={status.pill}
                      onRename={handleRename}
                      onDelete={() => deleteHabit.mutate(habit.id)}
                      onStatusChange={handleStatusChange}
                    />
                  ))
                )}
              </SortableContext>
            </Column>
          ))}
        </div>
      </DndContext>

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => adjustHeight(60)}
          className="flex h-10 w-16 items-center justify-center rounded-full border border-border bg-gradient-to-t from-white/30 to-white/5 text-xl text-muted transition hover:text-text"
          aria-label="Увеличить высоту"
        >
          ▼
        </button>
        <button
          type="button"
          onClick={handleCreate}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-accent bg-accent/20 text-2xl text-accent transition hover:bg-accent/30"
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
  label: string;
  count: number;
  accent: string;
  children: React.ReactNode;
};

function Column({ status, label, count, accent, children }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: {
      type: 'column',
      status,
    },
  });

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        'flex flex-col gap-3 rounded-2xl border bg-transparent p-3',
        accent,
        isOver && 'border-accent/70 bg-white/20',
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-text">{label}</h3>
        <span className="text-xs text-muted">{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

type HabitCardProps = {
  habit: HabitRecord;
  pillClass: string;
  onRename: (habit: HabitRecord) => void;
  onDelete: () => void;
  onStatusChange: (habit: HabitRecord, status: HabitStatus) => void;
};

function HabitCard({ habit, onRename, onDelete, onStatusChange, pillClass }: HabitCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: habit.id,
    data: {
      type: 'card',
      status: habit.status,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center justify-between rounded-full px-4 py-3 text-sm font-semibold shadow-inner transition',
        pillClass,
      )}
      {...attributes}
      {...listeners}
    >
      <p className="truncate" onDoubleClick={() => onRename(habit)}>
        {habit.title}
      </p>
      <div className="flex items-center gap-1 text-xs text-black/60">
        <button type="button" onClick={() => onRename(habit)} className="transition hover:text-black">
          ✎
        </button>
        <button type="button" onClick={onDelete} className="transition hover:text-black">
          ✕
        </button>
        <select
          value={habit.status}
          onChange={(evt) => onStatusChange(habit, evt.target.value as HabitStatus)}
          className="rounded-md border border-white/60 bg-white/30 px-2 py-1 text-xs text-black/70 outline-none"
        >
          {STATUS_META.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}
