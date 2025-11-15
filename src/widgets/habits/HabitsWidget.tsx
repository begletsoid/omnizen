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
import { computeHabitReorder } from '../../features/habits/utils';

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
};

export function HabitsWidget({ widgetId }: HabitsWidgetProps) {
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

    const reorder = computeHabitReorder({
      activeHabit,
      targetStatus,
      overId: over.id ? String(over.id) : undefined,
      overType,
      sourceList: grouped[activeHabit.status],
      targetList: grouped[targetStatus],
    });

    if (!reorder) return;

    await updateHabit.mutateAsync({
      id: activeHabit.id,
      ...reorder,
    });
  };

  if (!ready) {
    return (
    <section className="glass-panel flex flex-col gap-2 px-5 py-6">
        <p className="text-sm text-muted">Виджет пока не готов — обновите страницу.</p>
      </section>
    );
  }

  return (
    <section className="glass-panel mx-auto flex w-full max-w-sm flex-col gap-4 border border-border bg-surface/80 px-3 py-4 shadow-card">
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
          className="rounded-3xl border border-border/40 bg-background/30 px-3 pb-4 pt-2"
          style={{ maxHeight: listHeight, overflowY: 'auto' }}
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
                    onRename={handleRename}
                    onDelete={() => deleteHabit.mutate(habit.id)}
                  />
                ))}
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
      <div className="flex flex-col gap-2 min-h-[1rem]">{children}</div>
    </div>
  );
}

type HabitCardProps = {
  habit: HabitRecord;
  pillClass: string;
  onRename: (habit: HabitRecord) => void;
  onDelete: () => void;
};

function HabitCard({ habit, onRename, onDelete, pillClass }: HabitCardProps) {
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
        'flex items-center justify-between gap-3 rounded-full px-4 py-3 text-sm font-semibold shadow-inner transition',
        pillClass,
      )}
      {...attributes}
      {...listeners}
    >
      <p className="truncate" onDoubleClick={() => onRename(habit)}>
        {habit.title}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onRename(habit)}
          className="text-xs text-black/70 transition hover:text-black"
          aria-label="Переименовать"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-black/70 transition hover:text-black"
          aria-label="Удалить"
        >
          ✕
        </button>
      </div>
    </article>
  );
}
