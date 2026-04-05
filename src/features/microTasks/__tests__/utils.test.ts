import { describe, expect, it } from 'vitest';

import { buildGroupReorderUpdates, buildMicroTaskOrderUpdates, buildTemplateTaskPayloads, formatDuration } from '../utils';
import type { MicroTaskGroup, MicroTaskRecord } from '../types';

const baseTask = (id: string, order: number): MicroTaskRecord => ({
  id,
  widget_id: 'widget-1',
  user_id: 'user-1',
  title: `Task ${id}`,
  is_done: false,
  order,
  group_id: null,
  group_order: null,
  elapsed_seconds: 0,
  timer_state: 'never',
  last_started_at: null,
  archived_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const baseGroup = (id: string, order: number): MicroTaskGroup => ({
  id,
  widget_id: 'widget-1',
  user_id: 'user-1',
  name: `Group ${id}`,
  order,
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

  it('buildTemplateTaskPayloads keeps categories and zeroes time', () => {
    const payloads = buildTemplateTaskPayloads({
      items: [
        { title: 'Task A', category_ids: ['cat-1'], order: 2 },
        { title: 'Task B', category_ids: ['cat-2', 'cat-3'], order: 1 },
      ],
      baseOrder: 10,
      groupId: 'group-1',
    });
    expect(payloads[0].insert.title).toBe('Task B');
    expect(payloads[0].insert.group_id).toBe('group-1');
    expect(payloads[0].insert.group_order).toBe(1);
    expect(payloads[0].insert.elapsed_seconds).toBe(0);
    expect(payloads[0].categoryIds).toEqual(['cat-2', 'cat-3']);
  });

  it('buildGroupReorderUpdates inserts task into group by drop position', () => {
    const group = baseGroup('group-1', 1);
    const groupTask = { ...baseTask('g-task', 5), group_id: group.id, group_order: 1 };
    const taskToMove = baseTask('move-task', 2);
    const ungrouped = baseTask('free-task', 3);
    const taskById = new Map([
      [groupTask.id, groupTask],
      [taskToMove.id, taskToMove],
      [ungrouped.id, ungrouped],
    ]);
    const groupById = new Map([[group.id, group]]);
    const nextKeys = ['group:group-1', 'task:g-task', 'task:move-task', 'task:free-task'];
    const overrides = new Map<string, string | null>([[taskToMove.id, group.id]]);

    const result = buildGroupReorderUpdates({
      nextKeys,
      taskById,
      groupById,
      taskGroupOverrides: overrides,
    });

    expect(result.groupUpdates).toEqual([{ id: 'group-1', order: 1 }]);
    expect(result.taskUpdates).toEqual([
      { id: 'g-task', order: 5, group_id: 'group-1', group_order: 1 },
      { id: 'move-task', order: 2, group_id: 'group-1', group_order: 2 },
      { id: 'free-task', order: 2, group_id: null, group_order: null },
    ]);
  });
});

