import { describe, expect, it } from 'vitest';
import { sortGoals, computeEfficiency } from '../utils';
import type { GoalRecord } from '../types';

const goal = (overrides: Partial<GoalRecord> = {}): GoalRecord => ({
  id: 'g1',
  widget_id: 'w1',
  user_id: 'u1',
  title: 'Test',
  is_done: false,
  is_locked: false,
  is_recurring: false,
  value: 10,
  expected_hours: 2,
  archived_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('sortGoals', () => {
  it('recurring first, then active, then done, then locked', () => {
    const goals = [
      goal({ id: 'locked', is_locked: true }),
      goal({ id: 'done', is_done: true }),
      goal({ id: 'active' }),
      goal({ id: 'recurring', is_recurring: true }),
    ];
    const sorted = sortGoals(goals);
    expect(sorted.map((g) => g.id)).toEqual(['recurring', 'active', 'done', 'locked']);
  });

  it('within a group, higher efficiency comes first', () => {
    const goals = [
      goal({ id: 'low', value: 2, expected_hours: 4 }),
      goal({ id: 'high', value: 10, expected_hours: 1 }),
      goal({ id: 'mid', value: 6, expected_hours: 2 }),
    ];
    const sorted = sortGoals(goals);
    expect(sorted.map((g) => g.id)).toEqual(['high', 'mid', 'low']);
  });

  it('unfilled (value=0 or hours=0) goes to top of their group', () => {
    const goals = [
      goal({ id: 'filled', value: 5, expected_hours: 2 }),
      goal({ id: 'unfilled', value: 0, expected_hours: 0 }),
    ];
    const sorted = sortGoals(goals);
    expect(sorted[0].id).toBe('unfilled');
  });

  it('done+recurring = done group (not recurring)', () => {
    const g = goal({ id: 'done-recurring', is_done: true, is_recurring: true });
    const sorted = sortGoals([g, goal({ id: 'active' })]);
    expect(sorted[0].id).toBe('active');
    expect(sorted[1].id).toBe('done-recurring');
  });
});

describe('computeEfficiency', () => {
  it('returns rounded value/hours', () => {
    expect(computeEfficiency(10, 3)).toBe('3');
  });

  it('returns dash when hours is 0', () => {
    expect(computeEfficiency(10, 0)).toBe('—');
  });

  it('handles zero value', () => {
    expect(computeEfficiency(0, 5)).toBe('0');
  });
});
