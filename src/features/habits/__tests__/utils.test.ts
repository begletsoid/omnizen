import { describe, expect, it } from 'vitest';

import type { HabitRecord, HabitStatus } from '../types';
import { buildHabitOrderUpdates } from '../utils';
import type { HabitOrderUpdatePayload } from '../types';

function makeHabit(id: string, status: HabitStatus, order: number): HabitRecord {
  return {
    id,
    widget_id: 'widget',
    user_id: 'user',
    title: id,
    status,
    order,
    created_at: '',
    updated_at: '',
    success_count: 0,
    fail_count: 0,
    success_updated_at: '',
  };
}

function buildGrouped() {
  return {
    adopted: [makeHabit('x', 'adopted', 1)],
    in_progress: [
      makeHabit('a', 'in_progress', 1),
      makeHabit('b', 'in_progress', 2),
      makeHabit('c', 'in_progress', 3),
    ],
    not_started: [
      makeHabit('z', 'not_started', 1),
      makeHabit('y', 'not_started', 2),
    ],
  };
}

describe('buildHabitOrderUpdates', () => {
  it('переставляет внутри одной колонки', () => {
    const grouped = buildGrouped();
    const updates = buildHabitOrderUpdates({
      activeHabit: grouped.in_progress[0],
      targetStatus: 'in_progress',
      insertIndex: 2,
      grouped,
    });

    expect(findUpdate(updates, 'a')).toMatchObject({ order: 3 });
    expect(findUpdate(updates, 'b')).toMatchObject({ order: 1 });
    expect(findUpdate(updates, 'c')).toMatchObject({ order: 2 });
    expect(updates.every((u) => u.status === undefined)).toBe(true);
  });

  it('переносит привычку в другой статус и нумерует обе колонки', () => {
    const grouped = buildGrouped();
    const updates = buildHabitOrderUpdates({
      activeHabit: grouped.in_progress[1],
      targetStatus: 'adopted',
      insertIndex: 1,
      grouped,
    });

    expect(findUpdate(updates, 'b')).toMatchObject({
      order: 2,
      status: 'adopted',
    });
    expect(findUpdate(updates, 'a')?.order).toBe(1);
    expect(findUpdate(updates, 'c')?.order).toBe(2);
    expect(findUpdate(updates, 'x')?.order).toBe(1);
  });

  it('корректно обрабатывает дроп в конец колонки', () => {
    const grouped = buildGrouped();
    const updates = buildHabitOrderUpdates({
      activeHabit: grouped.in_progress[2],
      targetStatus: 'in_progress',
      insertIndex: 10,
      grouped,
    });

    expect(findUpdate(updates, 'c')?.order).toBe(3);
  });

  it('не допускает дубликатов при обмене первых элементов', () => {
    const grouped = buildGrouped();
    const updates = buildHabitOrderUpdates({
      activeHabit: grouped.in_progress[0],
      targetStatus: 'in_progress',
      insertIndex: 1,
      grouped,
    });

    const next = applyUpdates(grouped, updates);
    expect(getOrders(next.in_progress)).toEqual([1, 2, 3]);
  });

  it('сбрасывает порядковые номера после смены статуса', () => {
    const grouped = buildGrouped();
    const updates = buildHabitOrderUpdates({
      activeHabit: grouped.not_started[0],
      targetStatus: 'adopted',
      insertIndex: 0,
      grouped,
    });

    const next = applyUpdates(grouped, updates);
    expect(getOrders(next.not_started)).toEqual([1]);
    expect(getOrders(next.adopted)).toEqual([1, 2]);
  });
});

function findUpdate(updates: HabitOrderUpdatePayload[], id: string) {
  return updates.find((update) => update.id === id);
}

function applyUpdates(
  grouped: Record<HabitStatus, HabitRecord[]>,
  updates: HabitOrderUpdatePayload[],
) {
  const clone = new Map(
    Object.values(grouped)
      .flat()
      .map((habit) => [habit.id, { ...habit }]),
  );
  updates.forEach((update) => {
    const habit = clone.get(update.id);
    if (!habit) return;
    habit.order = update.order;
    if (update.status) {
      habit.status = update.status;
    }
  });
  return {
    adopted: collect(clone, 'adopted'),
    in_progress: collect(clone, 'in_progress'),
    not_started: collect(clone, 'not_started'),
  };
}

function collect(map: Map<string, HabitRecord>, status: HabitStatus) {
  return [...map.values()]
    .filter((habit) => habit.status === status)
    .sort((a, b) => a.order - b.order);
}

function getOrders(habits: HabitRecord[]) {
  return habits.map((habit) => habit.order);
}
