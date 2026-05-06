import { describe, expect, it } from 'vitest';

import { parseActionPlan } from '../llm';

describe('parseActionPlan', () => {
  const fallback = 'fallback transcript';

  it('parses Phase 2 multi-action plan', () => {
    const raw = {
      actions: [
        { intent: 'undo_last', payload: {} },
        {
          intent: 'start_microtask',
          payload: { mode: 'create', new_task_title: 'Обед' },
        },
      ],
      confidence: 'high',
      raw_user_phrase: 'Отмена, начни обед',
    };
    const plan = parseActionPlan(raw, fallback);
    expect(plan).not.toBeNull();
    expect(plan!.actions).toHaveLength(2);
    expect(plan!.actions[0].intent).toBe('undo_last');
    expect(plan!.actions[1].intent).toBe('start_microtask');
    expect(plan!.confidence).toBe('high');
    expect(plan!.raw_user_phrase).toBe('Отмена, начни обед');
  });

  it('parses single-action plan as length-1 array', () => {
    const raw = {
      actions: [{ intent: 'pause_current', payload: {} }],
      confidence: 'medium',
    };
    const plan = parseActionPlan(raw, fallback);
    expect(plan).not.toBeNull();
    expect(plan!.actions).toHaveLength(1);
    expect(plan!.actions[0].intent).toBe('pause_current');
    expect(plan!.confidence).toBe('medium');
    // raw_user_phrase falls back to transcript
    expect(plan!.raw_user_phrase).toBe(fallback);
  });

  it('caps actions to MAX_ACTIONS_PER_COMMAND (3)', () => {
    const raw = {
      actions: [
        { intent: 'a', payload: {} },
        { intent: 'b', payload: {} },
        { intent: 'c', payload: {} },
        { intent: 'd', payload: {} },
        { intent: 'e', payload: {} },
      ],
    };
    const plan = parseActionPlan(raw, fallback);
    expect(plan!.actions).toHaveLength(3);
    expect(plan!.actions.map((a) => a.intent)).toEqual(['a', 'b', 'c']);
  });

  it('skips entries without an intent string', () => {
    const raw = {
      actions: [
        { intent: 'good', payload: {} },
        { payload: {} }, // missing intent
        { intent: '', payload: {} }, // empty
        null,
        'not-an-object',
        { intent: 'also_good', payload: {} },
      ],
    };
    const plan = parseActionPlan(raw, fallback);
    expect(plan!.actions.map((a) => a.intent)).toEqual(['good', 'also_good']);
  });

  it('returns null when actions array is empty after filtering', () => {
    expect(parseActionPlan({ actions: [] }, fallback)).toBeNull();
    expect(parseActionPlan({ actions: [{ intent: '' }] }, fallback)).toBeNull();
  });

  it('falls back to Phase 1 single-intent shape', () => {
    const raw = {
      intent: 'start_microtask',
      payload: { mode: 'create', new_task_title: 'X' },
      confidence: 'high',
      raw_user_phrase: 'X',
    };
    const plan = parseActionPlan(raw, fallback);
    expect(plan).not.toBeNull();
    expect(plan!.actions).toHaveLength(1);
    expect(plan!.actions[0].intent).toBe('start_microtask');
    expect(plan!.actions[0].payload).toEqual({ mode: 'create', new_task_title: 'X' });
  });

  it('rejects non-object input', () => {
    expect(parseActionPlan(null, fallback)).toBeNull();
    expect(parseActionPlan('string', fallback)).toBeNull();
    expect(parseActionPlan(42, fallback)).toBeNull();
  });

  it('rejects object without actions and without intent', () => {
    expect(parseActionPlan({ confidence: 'high' }, fallback)).toBeNull();
  });

  it('coerces invalid confidence to "medium"', () => {
    const plan = parseActionPlan(
      { actions: [{ intent: 'x', payload: {} }], confidence: 'wat' },
      fallback,
    );
    expect(plan!.confidence).toBe('medium');
  });
});
