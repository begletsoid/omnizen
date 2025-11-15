import type { HabitRecord, HabitStatus } from './types';

export function getNextOrder(prev?: number, next?: number) {
  if (typeof prev === 'number' && typeof next === 'number') {
    return Number(((prev + next) / 2).toFixed(4));
  }

  if (typeof prev === 'number') {
    return Number((prev + 1).toFixed(4));
  }

  if (typeof next === 'number') {
    return Number((next - 1).toFixed(4));
  }

  return 0;
}

type ReorderInput = {
  activeHabit: HabitRecord;
  targetStatus: HabitStatus;
  overId?: string | null;
  overType?: 'card' | 'column' | undefined;
  sourceList: HabitRecord[];
  targetList: HabitRecord[];
};

export function computeHabitReorder({
  activeHabit,
  targetStatus,
  overId,
  overType,
  sourceList,
  targetList,
}: ReorderInput) {
  const isSameColumn = activeHabit.status === targetStatus;
  const sourceIndex = sourceList.findIndex((habit) => habit.id === activeHabit.id);
  if (sourceIndex === -1) return null;

  const sanitizedTarget = targetList.filter((habit) => habit.id !== activeHabit.id);
  let insertIndex = sanitizedTarget.length;

  if (overType === 'card') {
    if (!overId) return null;
    if (isSameColumn && overId === activeHabit.id) {
      return null;
    }

    const overIndexOriginal = targetList.findIndex((habit) => habit.id === overId);
    const overIndexSanitized = sanitizedTarget.findIndex((habit) => habit.id === overId);
    if (overIndexOriginal === -1 || overIndexSanitized === -1) return null;

    const draggingDownward = isSameColumn && overIndexOriginal > sourceIndex;
    insertIndex = Math.min(
      overIndexSanitized + (draggingDownward ? 1 : 0),
      sanitizedTarget.length,
    );
  }

  if (isSameColumn) {
    const adjustedSourceIndex = Math.min(sourceIndex, sanitizedTarget.length);
    if (insertIndex === adjustedSourceIndex) {
      return null;
    }
  }

  const prev = sanitizedTarget[insertIndex - 1];
  const next = sanitizedTarget[insertIndex];
  const newOrder = getNextOrder(prev?.order, next?.order);

  return {
    status: targetStatus,
    order: newOrder,
  };
}
