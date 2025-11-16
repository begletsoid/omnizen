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
    not_started: [makeHabit('z', 'not_started', 1)],
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

    expect(findUpdate(updates, 'a')).toMatchObject({ order: 3, user_id: 'user', widget_id: 'widget' });
    expect(findUpdate(updates, 'b')).toMatchObject({ order: 1, user_id: 'user' });
    expect(findUpdate(updates, 'c')).toMatchObject({ order: 2, user_id: 'user' });
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
      user_id: 'user',
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
});

function findUpdate(updates: HabitOrderUpdatePayload[], id: string) {
  return updates.find((update) => update.id === id);
}
