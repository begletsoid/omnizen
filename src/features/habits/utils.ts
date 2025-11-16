import type { HabitOrderUpdatePayload, HabitRecord, HabitStatus } from './types';

export function buildHabitOrderUpdates({
  activeHabit,
  targetStatus,
  insertIndex,
  grouped,
}: {
  activeHabit: HabitRecord;
  targetStatus: HabitStatus;
  insertIndex: number;
  grouped: Record<HabitStatus, HabitRecord[]>;
}): HabitOrderUpdatePayload[] {
  const updates: HabitOrderUpdatePayload[] = [];
  const sanitizedTarget = getColumn(grouped, targetStatus).filter(
    (habit) => habit.id !== activeHabit.id,
  );
  const clampedIndex = Math.max(0, Math.min(insertIndex, sanitizedTarget.length));
  sanitizedTarget.splice(clampedIndex, 0, {
    ...activeHabit,
    status: targetStatus,
  });

  updates.push(
    ...sanitizedTarget.map((habit, idx) =>
      toPayload(
        habit,
        idx + 1,
        habit.id === activeHabit.id && activeHabit.status !== targetStatus ? targetStatus : undefined,
      ),
    ),
  );

  if (activeHabit.status !== targetStatus) {
    updates.push(
      ...getColumn(grouped, activeHabit.status)
        .filter((habit) => habit.id !== activeHabit.id)
        .map((habit, idx) => toPayload(habit, idx + 1)),
    );
  }

  return updates;
}

function getColumn(grouped: Record<HabitStatus, HabitRecord[]>, status: HabitStatus) {
  return grouped[status] ?? [];
}

function toPayload(habit: HabitRecord, order: number, nextStatus?: HabitStatus) {
  return {
    id: habit.id,
    widget_id: habit.widget_id,
    user_id: habit.user_id,
    title: habit.title,
    order,
    ...(nextStatus ? { status: nextStatus } : {}),
  } satisfies HabitOrderUpdatePayload;
}
