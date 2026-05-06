import { describe, expect, it } from 'vitest';

import { INTENT_REGISTRY } from '../intents';

describe('INTENT_REGISTRY.start_microtask.validatePayload', () => {
  const spec = INTENT_REGISTRY.start_microtask;
  const validate = spec.validatePayload;

  it('rejects non-object input', () => {
    expect(() => validate(null)).toThrow();
    expect(() => validate('not an object')).toThrow();
    expect(() => validate(42)).toThrow();
  });

  it('rejects missing or empty title', () => {
    expect(() => validate({})).toThrow(/new_task_title/);
    expect(() => validate({ new_task_title: '' })).toThrow(/non-empty/);
    expect(() => validate({ new_task_title: '   ' })).toThrow(/non-empty/);
    expect(() => validate({ new_task_title: 42 })).toThrow();
  });

  it('accepts a minimal valid payload', () => {
    const result = validate({
      new_task_title: 'Code review',
      goal_id: null,
      similar_task_id: null,
      category_ids: [],
    });
    expect(result).toEqual({
      new_task_title: 'Code review',
      goal_id: null,
      similar_task_id: null,
      category_ids: [],
    });
  });

  it('coerces missing optional fields to null / empty', () => {
    const result = validate({ new_task_title: 'Lunch' }) as Record<string, unknown>;
    expect(result.goal_id).toBe(null);
    expect(result.similar_task_id).toBe(null);
    expect(result.category_ids).toEqual([]);
  });

  it('strips non-string elements from category_ids', () => {
    const result = validate({
      new_task_title: 'Sport',
      category_ids: ['uuid-1', 42, null, 'uuid-2', { foo: 'bar' }],
    }) as Record<string, unknown>;
    expect(result.category_ids).toEqual(['uuid-1', 'uuid-2']);
  });

  it('trims and caps long titles to 200 chars', () => {
    const longTitle = '   ' + 'A'.repeat(500) + '   ';
    const result = validate({ new_task_title: longTitle }) as Record<string, unknown>;
    expect((result.new_task_title as string).length).toBe(200);
    expect((result.new_task_title as string).startsWith('A')).toBe(true);
  });

  it('treats non-string goal_id / similar_task_id as null (defensive)', () => {
    const result = validate({
      new_task_title: 'X',
      goal_id: 42,
      similar_task_id: { foo: 'bar' },
    }) as Record<string, unknown>;
    expect(result.goal_id).toBe(null);
    expect(result.similar_task_id).toBe(null);
  });
});

describe('INTENT_REGISTRY shape', () => {
  it('has start_microtask intent', () => {
    expect(INTENT_REGISTRY).toHaveProperty('start_microtask');
  });

  it('every intent has the required fields', () => {
    for (const [key, spec] of Object.entries(INTENT_REGISTRY)) {
      expect(typeof spec.description).toBe('string');
      expect(typeof spec.payloadShape).toBe('string');
      expect(typeof spec.validatePayload).toBe('function');
      expect(typeof spec.apply).toBe('function');
      expect(spec.description.length).toBeGreaterThan(10);
      // Sanity: key matches a name an LLM would emit (no spaces, lowercase).
      expect(key).toMatch(/^[a-z_]+$/);
    }
  });
});
