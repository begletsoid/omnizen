import { describe, expect, it } from 'vitest';

import type { HabitRecord, HabitStatus } from '../types';
import { computeHabitReorder } from '../utils';

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

describe('computeHabitReorder', () => {
  const sourceList = [
    makeHabit('a', 'in_progress', 1),
    makeHabit('b', 'in_progress', 2),
    makeHabit('c', 'in_progress', 3),
    makeHabit('d', 'in_progress', 4),
  ];

  it('moves item to the end of the same column when dropping on column area', () => {
    const result = computeHabitReorder({
      activeHabit: sourceList[0],
      targetStatus: 'in_progress',
      overType: 'column',
      sourceList,
      targetList: sourceList,
    });

    expect(result).not.toBeNull();
    expect(result?.order).toBeGreaterThan(sourceList.at(-1)!.order);
  });

  it('inserts item between cards when dropping on another card', () => {
    const result = computeHabitReorder({
      activeHabit: sourceList[0],
      targetStatus: 'in_progress',
      overType: 'card',
      overId: 'b',
      sourceList,
      targetList: sourceList,
    });

    expect(result).not.toBeNull();
    expect(result?.order).toBeGreaterThan(sourceList[1].order);
    expect(result?.order).toBeLessThan(sourceList[2].order);
  });

  it('returns null when dropping on itself', () => {
    const result = computeHabitReorder({
      activeHabit: sourceList[0],
      targetStatus: 'in_progress',
      overType: 'card',
      overId: 'a',
      sourceList,
      targetList: sourceList,
    });

    expect(result).toBeNull();
  });

  it('computes correct order when moving to another status', () => {
    const targetList = [
      makeHabit('x', 'adopted', 10),
      makeHabit('y', 'adopted', 20),
    ];

    const result = computeHabitReorder({
      activeHabit: sourceList[1],
      targetStatus: 'adopted',
      overType: 'card',
      overId: 'x',
      sourceList,
      targetList,
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('adopted');
    expect(result?.order).toBeLessThan(targetList[0].order);
  });
});

