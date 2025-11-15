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
    makeHabit('e', 'in_progress', 5),
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

  it('inserts item directly after the target card when dragging downward', () => {
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

  it('drops deeper in the list without skipping positions', () => {
    const result = computeHabitReorder({
      activeHabit: sourceList[0],
      targetStatus: 'in_progress',
      overType: 'card',
      overId: 'd',
      sourceList,
      targetList: sourceList,
    });

    expect(result).not.toBeNull();
    expect(result?.order).toBeGreaterThan(sourceList[3].order);
    expect(result?.order).toBeLessThan(sourceList[4].order);
  });

  it('inserts item before the target card when dragging upward', () => {
    const result = computeHabitReorder({
      activeHabit: sourceList[3],
      targetStatus: 'in_progress',
      overType: 'card',
      overId: 'b',
      sourceList,
      targetList: sourceList,
    });

    expect(result).not.toBeNull();
    expect(result?.order).toBeGreaterThan(sourceList[0].order);
    expect(result?.order).toBeLessThan(sourceList[1].order);
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

  it('returns rebalance payload when neighbouring orders collide', () => {
    const zeroList = sourceList.map((habit) => ({ ...habit, order: 0 }));
    const result = computeHabitReorder({
      activeHabit: zeroList[0],
      targetStatus: 'in_progress',
      overType: 'card',
      overId: 'b',
      sourceList: zeroList,
      targetList: zeroList,
    });

    expect(result).not.toBeNull();
    expect(result?.rebalance).toHaveLength(zeroList.length);
    const uniqueOrders = new Set(result?.rebalance?.map((item) => item.order));
    expect(uniqueOrders.size).toBe(zeroList.length);
  });
});

