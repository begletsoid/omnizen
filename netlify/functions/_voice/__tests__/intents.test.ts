import { describe, expect, it } from 'vitest';

import { INTENT_REGISTRY } from '../intents';

describe('INTENT_REGISTRY shape', () => {
  it('contains all Phase 2 intents', () => {
    expect(INTENT_REGISTRY).toHaveProperty('start_microtask');
    expect(INTENT_REGISTRY).toHaveProperty('pause_current');
    expect(INTENT_REGISTRY).toHaveProperty('add_goal');
    expect(INTENT_REGISTRY).toHaveProperty('undo_last');
  });

  it('every intent exposes a non-empty description and apply function', () => {
    for (const [key, spec] of Object.entries(INTENT_REGISTRY)) {
      expect(typeof spec.description).toBe('string');
      expect(spec.description.length).toBeGreaterThan(10);
      expect(typeof spec.payloadShape).toBe('string');
      expect(typeof spec.validatePayload).toBe('function');
      expect(typeof spec.apply).toBe('function');
      expect(key).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('start_microtask.validatePayload (Phase 2: mode resume|create)', () => {
  const validate = INTENT_REGISTRY.start_microtask.validatePayload;

  it('rejects non-object input', () => {
    expect(() => validate(null)).toThrow();
    expect(() => validate('not an object')).toThrow();
    expect(() => validate(42)).toThrow();
  });

  it('mode=create requires new_task_title', () => {
    expect(() =>
      validate({ mode: 'create', new_task_title: '', resume_task_id: null }),
    ).toThrow(/new_task_title/);
    expect(() => validate({ mode: 'create' })).toThrow(/new_task_title/);
  });

  it('mode=resume requires resume_task_id', () => {
    expect(() => validate({ mode: 'resume', resume_task_id: null })).toThrow(
      /resume_task_id/,
    );
    expect(() => validate({ mode: 'resume' })).toThrow(/resume_task_id/);
  });

  it('accepts a valid mode=create payload', () => {
    const result = validate({
      mode: 'create',
      new_task_title: 'Code review',
      resume_task_id: null,
      goal_id: null,
      category_ids: [],
    }) as Record<string, unknown>;
    expect(result.mode).toBe('create');
    expect(result.new_task_title).toBe('Code review');
    expect(result.resume_task_id).toBe(null);
    expect(result.category_ids).toEqual([]);
  });

  it('accepts a valid mode=resume payload', () => {
    const result = validate({
      mode: 'resume',
      resume_task_id: 'task-uuid',
      new_task_title: null,
      goal_id: null,
      category_ids: [],
    }) as Record<string, unknown>;
    expect(result.mode).toBe('resume');
    expect(result.resume_task_id).toBe('task-uuid');
  });

  it('coerces unknown mode to "create"', () => {
    const result = validate({ mode: 'wat', new_task_title: 'X' }) as Record<string, unknown>;
    expect(result.mode).toBe('create');
  });

  it('strips non-string elements from category_ids', () => {
    const result = validate({
      mode: 'create',
      new_task_title: 'Sport',
      category_ids: ['uuid-1', 42, null, 'uuid-2'],
    }) as Record<string, unknown>;
    expect(result.category_ids).toEqual(['uuid-1', 'uuid-2']);
  });

  it('caps long titles at 200 chars', () => {
    const longTitle = '   ' + 'A'.repeat(500) + '   ';
    const result = validate({ mode: 'create', new_task_title: longTitle }) as Record<
      string,
      unknown
    >;
    expect((result.new_task_title as string).length).toBe(200);
  });
});

describe('pause_current.validatePayload', () => {
  it('accepts empty object', () => {
    expect(INTENT_REGISTRY.pause_current.validatePayload({})).toEqual({});
  });

  it('ignores extra fields', () => {
    const result = INTENT_REGISTRY.pause_current.validatePayload({ stuff: 'whatever' });
    expect(result).toEqual({});
  });
});

describe('add_goal.validatePayload', () => {
  const validate = INTENT_REGISTRY.add_goal.validatePayload;

  it('rejects empty title', () => {
    expect(() => validate({})).toThrow(/title/);
    expect(() => validate({ title: '' })).toThrow(/title/);
    expect(() => validate({ title: '   ' })).toThrow(/title/);
  });

  it('accepts title-only payload', () => {
    const result = validate({ title: 'Освоить Rust' }) as Record<string, unknown>;
    expect(result.title).toBe('Освоить Rust');
    expect(result.value).toBe(null);
    expect(result.expected_hours).toBe(null);
  });

  it('coerces numeric strings for value and expected_hours', () => {
    const result = validate({
      title: 'X',
      value: '50',
      expected_hours: '2.5',
    }) as Record<string, unknown>;
    expect(result.value).toBe(50);
    expect(result.expected_hours).toBe(2.5);
  });

  it('returns null for non-finite numbers', () => {
    const result = validate({
      title: 'X',
      value: 'not-a-number',
      expected_hours: '',
    }) as Record<string, unknown>;
    expect(result.value).toBe(null);
    expect(result.expected_hours).toBe(null);
  });
});

describe('undo_last.validatePayload', () => {
  it('accepts empty object', () => {
    expect(INTENT_REGISTRY.undo_last.validatePayload({})).toEqual({});
  });
});
