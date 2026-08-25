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

describe('findPendingTriggers — anti-flood semantics', () => {
  const monthly = '0 0 1 * *'; // 1st of every month, local midnight

  it('never back-fills a never-triggered template from its creation date', () => {
    // Seeded months ago, never fired. Old behaviour returned one trigger per
    // month since creation (the duplicate flood). New behaviour baselines to
    // today, so a mid-month load finds nothing due.
    const now = new Date('2026-07-03T12:00:00Z');
    const recurring = rg({
      cron_expression: monthly,
      created_at: '2026-01-15T00:00:00Z',
      last_triggered_at: null,
    });
    const pending = findPendingTriggers([recurring], now);
    expect(pending.length).toBe(0);
  });

  it('collapses many missed occurrences to a single most-recent trigger', () => {
    // Half a year of 1st-of-month occurrences sit in the window; emit exactly
    // one (the latest), never six.
    const now = new Date('2026-07-03T00:00:00Z');
    const recurring = rg({
      cron_expression: monthly,
      last_triggered_at: '2026-01-15T00:00:00Z',
    });
    const pending = findPendingTriggers([recurring], now);
    expect(pending.length).toBe(1);
    expect(pending[0].triggerTime.getDate()).toBe(1);
    expect(pending[0].triggerTime.getMonth()).toBe(6); // July (0-based)
  });

  it('skips a single occurrence that is already stale (beyond the grace window)', () => {
    const now = new Date('2026-06-10T00:00:00Z');
    const recurring = rg({
      cron_expression: monthly,
      last_triggered_at: '2026-05-20T00:00:00Z', // window holds only Jun 1, 9 days old
    });
    const pending = findPendingTriggers([recurring], now);
    expect(pending.length).toBe(0);
  });

  it('fires the freshly-due occurrence when resuming within the grace window', () => {
    const now = new Date('2026-07-02T12:00:00Z');
    const recurring = rg({
      cron_expression: monthly,
      last_triggered_at: '2026-06-30T00:00:00Z',
    });
    const pending = findPendingTriggers([recurring], now);
    expect(pending.length).toBe(1);
    expect(pending[0].triggerTime.getDate()).toBe(1);
  });

  it('baselines a never-triggered template to today (fires an occurrence due earlier today)', () => {
    const now = new Date('2026-07-03T12:00:00Z');
    // Derive the cron from now's LOCAL date so "today" holds in any timezone.
    const cron = `0 0 ${now.getDate()} ${now.getMonth() + 1} *`;
    const recurring = rg({
      cron_expression: cron,
      created_at: '2026-01-01T00:00:00Z',
      last_triggered_at: null,
    });
    const pending = findPendingTriggers([recurring], now);
    expect(pending.length).toBe(1);
    expect(pending[0].triggerTime.getDate()).toBe(now.getDate());
  });
});
