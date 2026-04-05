import { describe, expect, it } from 'vitest';

import { getDateKeys, getWeekStartDate } from '../utils';

describe('analytics utils', () => {
  it('builds day keys across range', () => {
    const keys = getDateKeys({ start: '2025-01-01', end: '2025-01-03' }, 'day');
    expect(keys).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
  });

  it('builds week keys as week start dates', () => {
    const keys = getDateKeys({ start: '2025-01-01', end: '2025-01-10' }, 'week');
    expect(keys).toContain('2024-12-30');
    expect(keys).toContain('2025-01-06');
  });

  it('getWeekStartDate handles invalid input safely', () => {
    const key = getWeekStartDate('2025-W52');
    expect(key).toBe('2025-W52');
  });
});
