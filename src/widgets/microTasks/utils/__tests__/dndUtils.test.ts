import { describe, expect, it } from 'vitest';

import type { MicroTaskGroup, MicroTaskRecord } from '../../../../features/microTasks/types';
import {
  buildFlatList,
  computeReorderFromFlatList,
  isGroupId,
  isTaskId,
  toGendId,
  toGroupId,
  toTaskId,
} from '../dndUtils';

const baseTask = (id: string, order: number, groupId?: string, groupOrder?: number): MicroTaskRecord => ({
  id,
  widget_id: 'w1',
  user_id: 'u1',
  title: `Task ${id}`,
  is_done: false,
  order,
  group_id: groupId ?? null,
  group_order: groupOrder ?? null,
  elapsed_seconds: 0,
  timer_state: 'never',
  last_started_at: null,
  archived_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const baseGroup = (id: string, order: number): MicroTaskGroup => ({
  id,
  widget_id: 'w1',
  user_id: 'u1',
  name: `Group ${id}`,
  order,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe('dndUtils', () => {
  describe('ID helpers', () => {
    it('creates and detects task IDs', () => {
      expect(isTaskId(toTaskId('abc'))).toBe(true);
      expect(isGroupId(toTaskId('abc'))).toBe(false);
    });

    it('creates and detects group IDs', () => {
      expect(isGroupId(toGroupId('abc'))).toBe(true);
      expect(isTaskId(toGroupId('abc'))).toBe(false);
    });
  });

  describe('buildFlatList', () => {
    it('builds flat list for tasks only', () => {
      const tasks = [baseTask('t1', 1), baseTask('t2', 2), baseTask('t3', 3)];
      const result = buildFlatList(tasks, []);
      expect(result).toEqual([toTaskId('t1'), toTaskId('t2'), toTaskId('t3')]);
    });

    it('builds flat list with group header, tasks, and gend', () => {
      const groups = [baseGroup('g1', 2)];
      const tasks = [
        baseTask('t1', 1),
        baseTask('tg1', 2, 'g1', 1),
        baseTask('tg2', 2, 'g1', 2),
        baseTask('t2', 3),
      ];
      const result = buildFlatList(tasks, groups);
      expect(result).toEqual([
        toTaskId('t1'),
        toGroupId('g1'),
        toTaskId('tg1'),
        toTaskId('tg2'),
        toGendId('g1'),
        toTaskId('t2'),
      ]);
    });

    it('handles two groups interleaved with tasks', () => {
      const groups = [baseGroup('g1', 2), baseGroup('g2', 4)];
      const tasks = [
        baseTask('t1', 1),
        baseTask('tg1a', 2, 'g1', 1),
        baseTask('t2', 3),
        baseTask('tg2a', 4, 'g2', 1),
        baseTask('t3', 5),
      ];
      const result = buildFlatList(tasks, groups);
      expect(result).toEqual([
        toTaskId('t1'),
        toGroupId('g1'),
        toTaskId('tg1a'),
        toGendId('g1'),
        toTaskId('t2'),
        toGroupId('g2'),
        toTaskId('tg2a'),
        toGendId('g2'),
        toTaskId('t3'),
      ]);
    });

    it('handles empty group', () => {
      const groups = [baseGroup('g1', 1)];
      const result = buildFlatList([], groups);
      expect(result).toEqual([toGroupId('g1'), toGendId('g1')]);
    });
  });

  describe('computeReorderFromFlatList', () => {
    it('computes correct payload for tasks only', () => {
      const flat = [toTaskId('t1'), toTaskId('t2'), toTaskId('t3')];
      const result = computeReorderFromFlatList(flat);
      expect(result.taskUpdates).toEqual([
        { id: 't1', order: 1, group_id: null, group_order: null },
        { id: 't2', order: 2, group_id: null, group_order: null },
        { id: 't3', order: 3, group_id: null, group_order: null },
      ]);
      expect(result.groupUpdates).toEqual([]);
    });

    it('computes correct payload with groups (gend closes group)', () => {
      const flat = [
        toTaskId('t1'),
        toGroupId('g1'),
        toTaskId('tg1'),
        toTaskId('tg2'),
        toGendId('g1'),
        toTaskId('t2'),
      ];
      const result = computeReorderFromFlatList(flat);
      expect(result.groupUpdates).toEqual([{ id: 'g1', order: 2 }]);
      expect(result.taskUpdates).toEqual([
        { id: 't1', order: 1, group_id: null, group_order: null },
        { id: 'tg1', order: 2, group_id: 'g1', group_order: 1 },
        { id: 'tg2', order: 2, group_id: 'g1', group_order: 2 },
        { id: 't2', order: 3, group_id: null, group_order: null },
      ]);
    });

    it('task after gend is root, not in group', () => {
      const flat = [
        toGroupId('g1'),
        toTaskId('tg1'),
        toGendId('g1'),
        toTaskId('t1'),
      ];
      const result = computeReorderFromFlatList(flat);
      expect(result.taskUpdates).toContainEqual({
        id: 't1', order: 2, group_id: null, group_order: null,
      });
    });

    it('handles task moved into group (between header and gend)', () => {
      const flat = [
        toGroupId('g1'),
        toTaskId('tg1'),
        toTaskId('t1'),
        toGendId('g1'),
        toTaskId('t2'),
      ];
      const result = computeReorderFromFlatList(flat);
      expect(result.groupUpdates).toEqual([{ id: 'g1', order: 1 }]);
      expect(result.taskUpdates).toContainEqual({
        id: 't1', order: 1, group_id: 'g1', group_order: 2,
      });
      expect(result.taskUpdates).toContainEqual({
        id: 't2', order: 2, group_id: null, group_order: null,
      });
    });

    it('handles task moved above group header', () => {
      const flat = [
        toTaskId('tg1'),
        toGroupId('g1'),
        toTaskId('tg2'),
        toGendId('g1'),
      ];
      const result = computeReorderFromFlatList(flat);
      expect(result.taskUpdates).toContainEqual({
        id: 'tg1', order: 1, group_id: null, group_order: null,
      });
      expect(result.taskUpdates).toContainEqual({
        id: 'tg2', order: 2, group_id: 'g1', group_order: 1,
      });
    });
  });
});
