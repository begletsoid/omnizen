import { describe, expect, it } from 'vitest';
import { findPendingTriggers, isValidCron } from '../cronUtils';
import type { RecurringGoalRecord } from '../types';

const rg = (overrides: Partial<RecurringGoalRecord> = {}): RecurringGoalRecord => ({
  id: 'rg1',
  widget_id: 'w1',
  user_id: 'u1',
  title: 'Weekly standup',
  value: 5,
  expected_hours: 1,
  cron_expression: '0 9 * * 1',
  last_triggered_at: null,
  created_at: '2026-03-30T00:00:00Z',
  updated_at: '2026-03-30T00:00:00Z',
  ...overrides,
});

describe('isValidCron', () => {
  it('accepts standard 5-field cron', () => {
    expect(isValidCron('0 9 * * 1')).toBe(true);
  });

  it('accepts @daily predefined', () => {
    expect(isValidCron('0 0 * * *')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidCron('not a cron')).toBe(false);
  });
});

describe('findPendingTriggers', () => {
  it('finds one trigger when last_triggered_at is null and one period passed', () => {
    const now = new Date('2026-04-06T12:00:00Z');
    const recurring = rg({
      cron_expression: '0 9 * * 1',
      created_at: '2026-03-30T00:00:00Z',
      last_triggered_at: null,
    });
    const pending = findPendingTriggers([recurring], now);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].recurringGoal.id).toBe('rg1');
  });

  it('returns empty when trigger not yet due', () => {
    const now = new Date('2026-04-07T08:00:00Z');
    const recurring = rg({
      cron_expression: '0 9 * * 1',
      last_triggered_at: '2026-04-06T09:00:00Z',
    });
    const pending = findPendingTriggers([recurring], now);
    expect(pending.length).toBe(0);
  });

  it('returns empty after already triggered', () => {
    const now = new Date('2026-04-06T12:00:00Z');
    const recurring = rg({
      cron_expression: '0 9 * * 1',
      last_triggered_at: '2026-04-06T09:00:00Z',
    });
    const pending = findPendingTriggers([recurring], now);
    expect(pending.length).toBe(0);
  });

  it('skips invalid cron expressions', () => {
    const recurring = rg({ cron_expression: 'invalid' });
    const pending = findPendingTriggers([recurring], new Date());
    expect(pending.length).toBe(0);
  });
});
