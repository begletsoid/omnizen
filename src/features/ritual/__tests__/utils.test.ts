import { describe, expect, it } from 'vitest';

import type { RitualSet, RitualState } from '../types';
import {
  getSetState,
  getTodayKey,
  normaliseRitualState,
  reorderItems,
  reorderItemsWithPosition,
} from '../utils';

const sets: RitualSet[] = [
  { id: 'morning', name: 'Утро', steps: [{ id: 's1', type: 'reminder', prompt: 'Hi' }] },
  { id: 'evening', name: 'Вечер', steps: [] },
];

describe('normaliseRitualState', () => {
  it('creates a fresh state when nothing is stored', () => {
    const state = normaliseRitualState(undefined, sets, '2026-04-20');
    expect(state.dayKey).toBe('2026-04-20');
    expect(state.activeSetId).toBe('morning');
    expect(state.answers).toEqual({});
  });

  it('resets answers when stored dayKey is not today, but preserves active set', () => {
    const stored: RitualState = {
      dayKey: '2026-04-19',
      activeSetId: 'evening',
      answers: { evening: { stepIndex: 2, values: { s1: 7 } } },
    };
    const state = normaliseRitualState(stored, sets, '2026-04-20');
    expect(state.dayKey).toBe('2026-04-20');
    expect(state.activeSetId).toBe('evening');
    expect(state.answers).toEqual({});
  });

  it('drops answers for sets that were deleted', () => {
    const stored: RitualState = {
      dayKey: '2026-04-20',
      activeSetId: 'morning',
      answers: {
        morning: { stepIndex: 1, values: { s1: 5 } },
        'deleted-set': { stepIndex: 0, values: {} },
      },
    };
    const state = normaliseRitualState(stored, sets, '2026-04-20');
    expect(Object.keys(state.answers)).toEqual(['morning']);
  });

  it('falls back to the first set when the stored active set no longer exists', () => {
    const stored: RitualState = {
      dayKey: '2026-04-20',
      activeSetId: 'old-set-id',
      answers: {},
    };
    const state = normaliseRitualState(stored, sets, '2026-04-20');
    expect(state.activeSetId).toBe('morning');
  });

  it('returns activeSetId=null when there are no sets', () => {
    const state = normaliseRitualState(undefined, [], '2026-04-20');
    expect(state.activeSetId).toBeNull();
  });
});

describe('getTodayKey (4:30 AM cutoff)', () => {
  // Use local-time constructors — getTodayKey reads Y/M/D in local tz.
  it('14:00 is firmly in today', () => {
    expect(getTodayKey(new Date(2026, 3, 23, 14, 0))).toBe('2026-04-23');
  });

  it('02:00 still belongs to the previous day (before 4:30 cutoff)', () => {
    expect(getTodayKey(new Date(2026, 3, 23, 2, 0))).toBe('2026-04-22');
  });

  it('04:29 still belongs to the previous day', () => {
    expect(getTodayKey(new Date(2026, 3, 23, 4, 29))).toBe('2026-04-22');
  });

  it('04:30 flips to the new day', () => {
    expect(getTodayKey(new Date(2026, 3, 23, 4, 30))).toBe('2026-04-23');
  });
});

describe('getSetState', () => {
  it('returns the stored state', () => {
    const state: RitualState = {
      dayKey: 'd',
      activeSetId: 'morning',
      answers: { morning: { stepIndex: 3, values: { s1: 5 } } },
    };
    expect(getSetState(state, 'morning').stepIndex).toBe(3);
  });

  it('returns a zero default for unknown sets', () => {
    const state: RitualState = { dayKey: 'd', activeSetId: null, answers: {} };
    expect(getSetState(state, 'unknown')).toEqual({ stepIndex: 0, values: {} });
  });
});

describe('reorderItems', () => {
  const items = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
  ];

  it('moves an item to a later position', () => {
    expect(reorderItems(items, 'a', 'c').map((x) => x.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item to an earlier position', () => {
    expect(reorderItems(items, 'd', 'b').map((x) => x.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('no-op when from === to', () => {
    expect(reorderItems(items, 'b', 'b')).toBe(items);
  });

  it('no-op when id is missing', () => {
    expect(reorderItems(items, 'x', 'b')).toBe(items);
  });
});

describe('reorderItemsWithPosition', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('drops before the target', () => {
    expect(reorderItemsWithPosition(items, 'd', 'b', 'before').map((x) => x.id)).toEqual([
      'a',
      'd',
      'b',
      'c',
    ]);
  });

  it('drops after the target', () => {
    expect(reorderItemsWithPosition(items, 'a', 'c', 'after').map((x) => x.id)).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
  });

  it('position=after the last item moves to end', () => {
    expect(reorderItemsWithPosition(items, 'a', 'd', 'after').map((x) => x.id)).toEqual([
      'b',
      'c',
      'd',
      'a',
    ]);
  });

  it('no-op when from === to', () => {
    expect(reorderItemsWithPosition(items, 'b', 'b', 'before')).toBe(items);
  });
});
