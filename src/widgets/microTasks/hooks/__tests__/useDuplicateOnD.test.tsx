import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MicroTaskRecord } from '../../../../features/microTasks/types';
import { __test__, useDuplicateOnD } from '../useDuplicateOnD';

const { isDuplicateKey, isEditable } = __test__;

const baseTask: MicroTaskRecord = {
  id: 'task-1',
  widget_id: 'w-1',
  user_id: 'u-1',
  title: 'Hello',
  is_done: false,
  order: 1,
  group_id: null,
  group_order: null,
  elapsed_seconds: 0,
  timer_state: 'never',
  last_started_at: null,
  archived_at: null,
  created_at: '',
  updated_at: '',
  categories: [],
};

function fireKey(opts: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: EventTarget;
}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    repeat: opts.repeat ?? false,
  });
  if (opts.target) {
    Object.defineProperty(ev, 'target', { value: opts.target });
  }
  window.dispatchEvent(ev);
  return ev;
}

describe('isDuplicateKey', () => {
  it('matches latin and cyrillic d/D/в/В', () => {
    for (const k of ['d', 'D', 'в', 'В']) {
      expect(isDuplicateKey(new KeyboardEvent('keydown', { key: k }))).toBe(true);
    }
  });

  it('rejects modifier combos', () => {
    expect(isDuplicateKey(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }))).toBe(false);
    expect(isDuplicateKey(new KeyboardEvent('keydown', { key: 'd', metaKey: true }))).toBe(false);
    expect(isDuplicateKey(new KeyboardEvent('keydown', { key: 'd', altKey: true }))).toBe(false);
  });

  it('shift alone is fine (covers caps lock, fast typing)', () => {
    expect(isDuplicateKey(new KeyboardEvent('keydown', { key: 'D', shiftKey: true }))).toBe(true);
  });

  it('rejects auto-repeat', () => {
    expect(isDuplicateKey(new KeyboardEvent('keydown', { key: 'd', repeat: true }))).toBe(false);
  });

  it('rejects unrelated keys', () => {
    for (const k of ['e', 'a', 'Enter', 'Escape', 'd1', '']) {
      expect(isDuplicateKey(new KeyboardEvent('keydown', { key: k }))).toBe(false);
    }
  });
});

describe('isEditable', () => {
  it('flags inputs/textarea/select', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const el = document.createElement(tag);
      expect(isEditable(el)).toBe(true);
    }
  });

  it('flags contentEditable nodes', () => {
    // JSDOM honours `contenteditable` as an HTML attribute but doesn't always
    // wire `isContentEditable` through the property setter, so set the
    // attribute and append to the document like a real browser would.
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    expect(isEditable(el)).toBe(true);
    document.body.removeChild(el);
  });

  it('does not flag plain elements or null', () => {
    expect(isEditable(document.createElement('div'))).toBe(false);
    expect(isEditable(document.createElement('button'))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe('useDuplicateOnD', () => {
  let onDuplicate: ReturnType<typeof vi.fn>;
  let resolveTaskAtPointer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDuplicate = vi.fn();
    resolveTaskAtPointer = vi.fn(() => baseTask);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires onDuplicate when D pressed over a task', () => {
    renderHook(() =>
      useDuplicateOnD({
        resolveTaskAtPointer: () => resolveTaskAtPointer(),
        onDuplicate,
      }),
    );
    fireKey({ key: 'd' });
    expect(resolveTaskAtPointer).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledWith(baseTask);
  });

  it('also fires for cyrillic в', () => {
    renderHook(() =>
      useDuplicateOnD({
        resolveTaskAtPointer: () => resolveTaskAtPointer(),
        onDuplicate,
      }),
    );
    fireKey({ key: 'в' });
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it('skips when no task is under the cursor', () => {
    resolveTaskAtPointer.mockReturnValue(null);
    renderHook(() =>
      useDuplicateOnD({
        resolveTaskAtPointer: () => resolveTaskAtPointer(),
        onDuplicate,
      }),
    );
    fireKey({ key: 'd' });
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('skips when focus is in an input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    renderHook(() =>
      useDuplicateOnD({
        resolveTaskAtPointer: () => resolveTaskAtPointer(),
        onDuplicate,
      }),
    );
    fireKey({ key: 'd', target: input });
    expect(onDuplicate).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('skips when Ctrl/Cmd is held', () => {
    renderHook(() =>
      useDuplicateOnD({
        resolveTaskAtPointer: () => resolveTaskAtPointer(),
        onDuplicate,
      }),
    );
    fireKey({ key: 'd', ctrlKey: true });
    fireKey({ key: 'd', metaKey: true });
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('does not bind listeners when disabled', () => {
    renderHook(() =>
      useDuplicateOnD({
        enabled: false,
        resolveTaskAtPointer: () => resolveTaskAtPointer(),
        onDuplicate,
      }),
    );
    fireKey({ key: 'd' });
    expect(resolveTaskAtPointer).not.toHaveBeenCalled();
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('detaches listener on unmount', () => {
    const { unmount } = renderHook(() =>
      useDuplicateOnD({
        resolveTaskAtPointer: () => resolveTaskAtPointer(),
        onDuplicate,
      }),
    );
    unmount();
    fireKey({ key: 'd' });
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('reads the latest resolveTaskAtPointer (no stale closure)', () => {
    const taskA = { ...baseTask, id: 'a' };
    const taskB = { ...baseTask, id: 'b' };
    let current: MicroTaskRecord | null = taskA;
    const { rerender } = renderHook(
      ({ resolve }) =>
        useDuplicateOnD({
          resolveTaskAtPointer: resolve,
          onDuplicate,
        }),
      { initialProps: { resolve: () => current } },
    );
    fireKey({ key: 'd' });
    expect(onDuplicate).toHaveBeenLastCalledWith(taskA);

    current = taskB;
    rerender({ resolve: () => current });
    fireKey({ key: 'd' });
    expect(onDuplicate).toHaveBeenLastCalledWith(taskB);
  });
});
