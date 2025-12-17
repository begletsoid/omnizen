import { describe, expect, it } from 'vitest';

import { buildMicroTaskOrderUpdates, formatDuration } from '../utils';
import type { MicroTaskRecord } from '../types';

const baseTask = (id: string, order: number): MicroTaskRecord => ({
  id,
  widget_id: 'widget-1',
  user_id: 'user-1',
  title: `Task ${id}`,
  is_done: false,
  order,
  elapsed_seconds: 0,
  timer_state: 'never',
  last_started_at: null,
  archived_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe('microTasks utils', () => {
  it('buildMicroTaskOrderUpdates produces sequential payload', () => {
    const tasks = [baseTask('a', 10), baseTask('b', 20), baseTask('c', 30)];
    const updates = buildMicroTaskOrderUpdates(tasks);
    expect(updates).toEqual([
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
      { id: 'c', order: 3 },
    ]);
  });

  it('formatDuration renders MM:SS and adds hours when needed', () => {
    expect(formatDuration(undefined)).toBe('0:00');
    expect(formatDuration(null)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(61)).toBe('1:01');
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

