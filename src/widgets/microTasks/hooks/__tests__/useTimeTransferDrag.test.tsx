import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MicroTaskRecord } from '../../../../features/microTasks/types';
import { useTimeTransferDrag } from '../useTimeTransferDrag';

type PartialTask = Partial<MicroTaskRecord> & { id: string };

const makeTask = (init: PartialTask): MicroTaskRecord => ({
  id: init.id,
  widget_id: 'w1',
  user_id: 'u1',
  title: init.title ?? `Task ${init.id}`,
  is_done: false,
  order: 1,
  group_id: null,
  group_order: null,
  elapsed_seconds: init.elapsed_seconds ?? 600,
  timer_state: init.timer_state ?? 'paused',
  last_started_at: init.last_started_at ?? null,
  archived_at: null,
  created_at: '2026-04-25T12:00:00Z',
  updated_at: '2026-04-25T12:00:00Z',
  categories: [],
});

/**
 * The hook attaches its listeners to `window`. To drive it from tests we
 * dispatch real PointerEvent / KeyboardEvent instances against window so
 * the listeners run their handlers exactly as in the browser.
 */
function fireWindow(
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  init: { clientX?: number; clientY?: number; pointerId?: number; button?: number },
) {
  // PointerEvent shim across environments — JSDOM has it, browsers have it,
  // older Node sometimes doesn't, so fall back to MouseEvent.
  const PE: typeof PointerEvent =
    typeof PointerEvent !== 'undefined'
      ? PointerEvent
      : (MouseEvent as unknown as typeof PointerEvent);
  const ev = new PE(type, {
    bubbles: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    pointerId: init.pointerId ?? 1,
  });
  window.dispatchEvent(ev);
}

function fireKey(key: string, opts: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  const ev = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
  });
  window.dispatchEvent(ev);
}

function makePointerReact(
  clientX: number,
  clientY: number,
  pointerId = 1,
): React.PointerEvent {
  return {
    button: 0,
    pointerId,
    clientX,
    clientY,
  } as unknown as React.PointerEvent;
}

describe('useTimeTransferDrag', () => {
  let onCommit: ReturnType<typeof vi.fn>;
  let tasks: Map<string, MicroTaskRecord>;
  let getTaskById: (id: string) => MicroTaskRecord | undefined;

  beforeEach(() => {
    onCommit = vi.fn().mockResolvedValue({});
    tasks = new Map<string, MicroTaskRecord>();
    tasks.set('a', makeTask({ id: 'a', elapsed_seconds: 600, timer_state: 'paused' }));
    tasks.set('b', makeTask({ id: 'b', elapsed_seconds: 60, timer_state: 'paused' }));
    getTaskById = (id: string) => tasks.get(id);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Tear down the polyfilled elementFromPoint between tests so suites
    // that don't set it back to a node see "no hovered target".
    delete (document as unknown as Record<string, unknown>).elementFromPoint;
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    expect(result.current.state).toBeNull();
    expect(result.current.requestedMinutes).toBe(0);
    expect(result.current.effectiveMinutes).toBe(0);
  });

  it('beginPress with movement <6px does not activate', () => {
    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(100, 100)));
    act(() => fireWindow('pointermove', { clientX: 102, clientY: 101 }));
    expect(result.current.state).toBeNull();
    act(() => fireWindow('pointerup', { clientX: 102, clientY: 101 }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('activates on movement >6px and shows default 5 minutes', () => {
    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(100, 100)));
    act(() => fireWindow('pointermove', { clientX: 110, clientY: 110 }));
    expect(result.current.state).not.toBeNull();
    expect(result.current.requestedMinutes).toBe(5);
    expect(result.current.effectiveMinutes).toBe(5);
  });

  it('keyboard input replaces default', () => {
    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    act(() => fireKey('1'));
    expect(result.current.requestedMinutes).toBe(1);
    act(() => fireKey('2'));
    expect(result.current.requestedMinutes).toBe(12);
    act(() => fireKey('3'));
    expect(result.current.requestedMinutes).toBe(123);
  });

  it('Backspace removes last digit', () => {
    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    act(() => fireKey('2'));
    act(() => fireKey('3'));
    act(() => fireKey('Backspace'));
    expect(result.current.requestedMinutes).toBe(2);
    act(() => fireKey('Backspace'));
    // empty buffer => default
    expect(result.current.requestedMinutes).toBe(5);
  });

  it('Escape cancels the drag without committing', () => {
    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    expect(result.current.state).not.toBeNull();
    act(() => fireKey('Escape'));
    expect(result.current.state).toBeNull();
    act(() => fireWindow('pointerup', { clientX: 20, clientY: 20 }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('drops without target → no commit', () => {
    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    // elementFromPoint returns null in JSDOM by default → no hovered target
    act(() => fireWindow('pointerup', { clientX: 20, clientY: 20 }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('drop on target task commits transfer', async () => {
    // Arrange a fake task element so document.elementFromPoint resolves it.
    const target = document.createElement('div');
    target.setAttribute('data-task-id', 'b');
    document.body.appendChild(target);
    // JSDOM doesn't ship elementFromPoint — assign it directly.
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => target;

    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    expect(result.current.state?.hoveredTargetId).toBe('b');
    await act(async () => {
      fireWindow('pointerup', { clientX: 20, clientY: 20 });
      // microtasks
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledWith({
      fromTaskId: 'a',
      toTaskId: 'b',
      seconds: 5 * 60,
    });
    document.body.removeChild(target);
  });

  it('drop with custom keyboard amount commits the typed value', async () => {
    const target = document.createElement('div');
    target.setAttribute('data-task-id', 'b');
    document.body.appendChild(target);
    // JSDOM doesn't ship elementFromPoint — assign it directly.
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => target;

    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    act(() => fireKey('3'));
    await act(async () => {
      fireWindow('pointerup', { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledWith({
      fromTaskId: 'a',
      toTaskId: 'b',
      seconds: 3 * 60,
    });
    document.body.removeChild(target);
  });

  it('drop on the same task does not commit', async () => {
    const target = document.createElement('div');
    target.setAttribute('data-task-id', 'a');
    document.body.appendChild(target);
    // JSDOM doesn't ship elementFromPoint — assign it directly.
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => target;

    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    await act(async () => {
      fireWindow('pointerup', { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    expect(onCommit).not.toHaveBeenCalled();
    document.body.removeChild(target);
  });

  it('drop with too-much request commits the clamped value (not the over-amount)', async () => {
    // Source has 10:00 displayed (600s). User types 100 — they're asking
    // for way more than exists. Previously the drop was REJECTED outright
    // ('too_much' returned no-op). New behaviour: clamp to what the source
    // actually has (10 min = 600s) and commit silently. The amber overlay
    // colour tells the user the value got clamped.
    const target = document.createElement('div');
    target.setAttribute('data-task-id', 'b');
    document.body.appendChild(target);
    // JSDOM doesn't ship elementFromPoint — assign it directly.
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => target;

    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    act(() => fireKey('1'));
    act(() => fireKey('0'));
    act(() => fireKey('0'));
    expect(result.current.validity).toBe('too_much');
    await act(async () => {
      fireWindow('pointerup', { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      fromTaskId: 'a',
      toTaskId: 'b',
      seconds: 600, // clamped to all available
    });
    document.body.removeChild(target);
  });

  it('drop with exact-available + 1s drift commits clamped value (16/16 with 959s underneath)', async () => {
    // Real-world scenario: display says "16:00" but elapsed_seconds is
    // physically 959 (rounded up on display). User types 16. Previously
    // rejected as too_much (16*60=960 > 959). Now: clamp to 15 (the
    // whole-minutes worth of 959) and commit.
    const target = document.createElement('div');
    target.setAttribute('data-task-id', 'b');
    document.body.appendChild(target);
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => target;

    // Override getTaskById to return a paused source with 959 stored seconds.
    const localGetTaskById = vi.fn((id: string) =>
      id === 'a' ? makeTask({ id: 'a', elapsed_seconds: 959 }) : undefined,
    );

    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById: localGetTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    act(() => fireKey('1'));
    act(() => fireKey('6'));
    expect(result.current.requestedMinutes).toBe(16);
    expect(result.current.validity).toBe('too_much');
    await act(async () => {
      fireWindow('pointerup', { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      fromTaskId: 'a',
      toTaskId: 'b',
      seconds: 15 * 60, // 15 whole minutes from the 959s available
    });
    document.body.removeChild(target);
  });

  it('Ctrl+Z after a successful transfer commits the reverse', async () => {
    const target = document.createElement('div');
    target.setAttribute('data-task-id', 'b');
    document.body.appendChild(target);
    // JSDOM doesn't ship elementFromPoint — assign it directly.
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => target;

    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    act(() => result.current.beginPress('a', makePointerReact(0, 0)));
    act(() => fireWindow('pointermove', { clientX: 20, clientY: 20 }));
    act(() => fireKey('2'));
    await act(async () => {
      fireWindow('pointerup', { clientX: 20, clientY: 20 });
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith({
      fromTaskId: 'a',
      toTaskId: 'b',
      seconds: 120,
    });

    await act(async () => {
      fireKey('z', { ctrlKey: true });
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(2);
    // Reverse
    expect(onCommit).toHaveBeenLastCalledWith({
      fromTaskId: 'b',
      toTaskId: 'a',
      seconds: 120,
    });
    document.body.removeChild(target);
  });

  it('Ctrl+Z while editing an input is ignored', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const { result } = renderHook(() =>
      useTimeTransferDrag({ getTaskById, onCommit }),
    );
    expect(result.current.getUndoStack().length).toBe(0);

    // Dispatch Ctrl+Z with the input as event.target by dispatching on it.
    const ev = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: true,
    });
    Object.defineProperty(ev, 'target', { value: input });
    window.dispatchEvent(ev);
    expect(onCommit).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
