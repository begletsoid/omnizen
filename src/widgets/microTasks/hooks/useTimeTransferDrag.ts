import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TRANSFER_ACTIVATION_DISTANCE_PX,
  TRANSFER_DEFAULT_MINUTES,
  appendDigitToBuffer,
  backspaceBuffer,
  clampTransferMinutes,
  computeAvailableSecondsOnSource,
  parseKeyboardMinutes,
  reverseTransferOp,
  validateTransfer,
  type TransferOp,
  type TransferValidity,
} from '../../../features/microTasks/transferUtils';
import type { MicroTaskRecord } from '../../../features/microTasks/types';

const UNDO_STACK_LIMIT = 20;

/**
 * Identifier read from the row DOM. Must match the `data-task-id="..."`
 * attribute placed on each task `<article>` so we can resolve a hovered drop
 * target via `document.elementFromPoint`.
 */
const TASK_ID_DATA_SELECTOR = '[data-task-id]';
const TASK_ID_DATA_ATTR = 'data-task-id';

export type TimeTransferDragState = {
  sourceTaskId: string;
  pointerX: number;
  pointerY: number;
  /**
   * String of typed digits ("" => use TRANSFER_DEFAULT_MINUTES). The buffer
   * is the source of truth — `requestedMinutes` derives from it.
   */
  keyboardBuffer: string;
  hoveredTargetId: string | null;
  /**
   * Snapshot of the source task at the moment the drag activated. Used to
   * keep the "live source preview" stable when the per-second tick fires —
   * we want the preview to read `committed - requestedMinutes`, not be
   * influenced by the running timer's progression during the drag itself.
   */
  sourceCommittedSeconds: number;
  sourceTimerState: MicroTaskRecord['timer_state'];
  sourceLastStartedAt: string | null;
};

type PendingPress = {
  sourceTaskId: string;
  pointerId: number;
  startX: number;
  startY: number;
  /**
   * Captured at pointerdown so when the drag activates we don't have to
   * re-look-up the task — useful if the source row got rearranged or
   * re-rendered between press and activation.
   */
  sourceSnapshot: {
    elapsed_seconds: number;
    timer_state: MicroTaskRecord['timer_state'];
    last_started_at: string | null;
  };
};

type UseTimeTransferDragParams = {
  /**
   * Lookup by id — kept as a prop callback so the hook doesn't need to
   * subscribe to the whole task array, and stays stable across renders.
   */
  getTaskById: (id: string) => MicroTaskRecord | undefined;
  /**
   * Commit to the server. Awaited so we can keep the row from settling
   * before the optimistic update lands; rejection falls back to no-op
   * (the mutation hook already rolls back the cache).
   */
  onCommit: (op: { fromTaskId: string; toTaskId: string; seconds: number }) => Promise<unknown>;
  /**
   * Allows ancestors to disable the mechanic entirely (e.g. when the row
   * is in edit mode or no widget is mounted).
   */
  disabled?: boolean;
};

export type TimeTransferDragApi = {
  state: TimeTransferDragState | null;
  /** Minutes the user is currently asking to transfer (after clamp). */
  effectiveMinutes: number;
  /** Raw minutes from keyboard buffer / default — pre-clamp, for preview. */
  requestedMinutes: number;
  validity: TransferValidity;
  /**
   * Begin tracking a press on the timer of `sourceTaskId`. If the pointer
   * moves more than the activation distance the drag activates; otherwise
   * the press dies on pointerup and the browser's native click event fires
   * for whichever onClick the consumer wired (e.g. edit time).
   */
  beginPress: (sourceTaskId: string, e: React.PointerEvent) => void;
  /** Pop the most recent successful transfer (Ctrl+Z). */
  undoLast: () => Promise<void>;
  /** Programmatically cancel any in-flight drag (Escape, edit-mode entry, etc.). */
  cancel: () => void;
  /** Inspect the undo stack — exposed for tests and toast messages. */
  getUndoStack: () => readonly TransferOp[];
};

export function useTimeTransferDrag({
  getTaskById,
  onCommit,
  disabled = false,
}: UseTimeTransferDragParams): TimeTransferDragApi {
  const [state, setState] = useState<TimeTransferDragState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const pendingRef = useRef<PendingPress | null>(null);
  const undoStackRef = useRef<TransferOp[]>([]);

  const activeRef = useRef(false);
  activeRef.current = state !== null;

  const requestedMinutes = state ? parseKeyboardMinutes(state.keyboardBuffer) : 0;
  const availableSeconds = state
    ? computeAvailableSecondsOnSource(
        state.sourceCommittedSeconds,
        state.sourceTimerState,
        state.sourceLastStartedAt,
        // Important: we re-evaluate against the live now so a long drag
        // (~1m) over a running source can still claim the time it
        // accumulated during the press itself. The render naturally happens
        // every animation frame during drag, so this is the right cadence.
        // eslint-disable-next-line react-hooks/purity -- intentional: timer math needs fresh Date.now()
        Date.now(),
      )
    : 0;
  const effectiveMinutes = state
    ? clampTransferMinutes(requestedMinutes, availableSeconds)
    : 0;
  const validity: TransferValidity = state
    ? validateTransfer({
        requestedMinutes,
        availableSeconds,
        hoveredTargetId: state.hoveredTargetId,
        sourceTaskId: state.sourceTaskId,
      })
    : 'no_target';

  const cancel = useCallback(() => {
    pendingRef.current = null;
    setState(null);
  }, []);

  const beginPress = useCallback(
    (sourceTaskId: string, e: React.PointerEvent) => {
      if (disabled) return;
      if (e.button !== 0) return;
      const task = getTaskById(sourceTaskId);
      if (!task) return;
      pendingRef.current = {
        sourceTaskId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        sourceSnapshot: {
          elapsed_seconds: task.elapsed_seconds ?? 0,
          timer_state: task.timer_state,
          last_started_at: task.last_started_at ?? null,
        },
      };
    },
    [disabled, getTaskById],
  );

  // Resolve which task (if any) the pointer is currently over. We attach
  // listeners imperatively so they don't tear down between renders — the
  // state-keyed effect pattern leaves a window where pointerup or keydown
  // can be missed (the same race that bit the notes-board widget earlier).
  useEffect(() => {
    function findTaskAt(x: number, y: number): string | null {
      // JSDOM (older versions) and a few embedded WebViews don't implement
      // elementFromPoint — degrade gracefully so unit tests don't blow up.
      if (typeof document.elementFromPoint !== 'function') return null;
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return null;
      const row = el.closest(TASK_ID_DATA_SELECTOR) as HTMLElement | null;
      if (!row) return null;
      return row.getAttribute(TASK_ID_DATA_ATTR);
    }

    function activate(pending: PendingPress, x: number, y: number) {
      const hovered = findTaskAt(x, y);
      setState({
        sourceTaskId: pending.sourceTaskId,
        pointerX: x,
        pointerY: y,
        keyboardBuffer: '',
        hoveredTargetId: hovered,
        sourceCommittedSeconds: pending.sourceSnapshot.elapsed_seconds,
        sourceTimerState: pending.sourceSnapshot.timer_state,
        sourceLastStartedAt: pending.sourceSnapshot.last_started_at,
      });
    }

    function onMove(e: PointerEvent) {
      const pending = pendingRef.current;
      if (!stateRef.current && pending) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.sqrt(dx * dx + dy * dy) >= TRANSFER_ACTIVATION_DISTANCE_PX) {
          activate(pending, e.clientX, e.clientY);
        }
        return;
      }
      if (stateRef.current) {
        const hovered = findTaskAt(e.clientX, e.clientY);
        setState((prev) =>
          prev
            ? { ...prev, pointerX: e.clientX, pointerY: e.clientY, hoveredTargetId: hovered }
            : prev,
        );
      }
    }

    async function onUp(e: PointerEvent) {
      const pending = pendingRef.current;
      const current = stateRef.current;

      if (current) {
        // Drag was active. Decide whether to commit.
        const reqMins = parseKeyboardMinutes(current.keyboardBuffer);
        const avail = computeAvailableSecondsOnSource(
          current.sourceCommittedSeconds,
          current.sourceTimerState,
          current.sourceLastStartedAt,
          Date.now(),
        );
        const result = validateTransfer({
          requestedMinutes: reqMins,
          availableSeconds: avail,
          hoveredTargetId: current.hoveredTargetId,
          sourceTaskId: current.sourceTaskId,
        });
        const finalMinutes = clampTransferMinutes(reqMins, avail);
        pendingRef.current = null;
        setState(null);
        if (
          result === 'ok' &&
          finalMinutes > 0 &&
          current.hoveredTargetId &&
          current.hoveredTargetId !== current.sourceTaskId
        ) {
          const op: TransferOp = {
            fromTaskId: current.sourceTaskId,
            toTaskId: current.hoveredTargetId,
            seconds: finalMinutes * 60,
            appliedAt: Date.now(),
          };
          try {
            await onCommit({
              fromTaskId: op.fromTaskId,
              toTaskId: op.toTaskId,
              seconds: op.seconds,
            });
            const stack = undoStackRef.current;
            stack.push(op);
            if (stack.length > UNDO_STACK_LIMIT) stack.shift();
          } catch {
            // mutation hook already rolled back its optimistic state
          }
        }
        return;
      }

      // No activation — clear the pending press. The browser dispatches a
      // native click on the same target if the pointer didn't move beyond
      // its own threshold, which the timer button's onClick will catch.
      if (pending && pending.pointerId === e.pointerId) {
        pendingRef.current = null;
      }
    }

    function onKey(e: KeyboardEvent) {
      const current = stateRef.current;
      if (!current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        setState((prev) =>
          prev ? { ...prev, keyboardBuffer: backspaceBuffer(prev.keyboardBuffer) } : prev,
        );
        return;
      }
      if (e.key.length === 1 && e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setState((prev) =>
          prev
            ? {
                ...prev,
                keyboardBuffer: appendDigitToBuffer(prev.keyboardBuffer, e.key),
              }
            : prev,
        );
      }
    }

    function onCancel() {
      // pointercancel (e.g. browser yanks pointer capture).
      cancel();
    }

    function onBlur() {
      cancel();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [cancel, onCommit]);

  // Ctrl/Cmd+Z global undo. Skipped while focus is in an editable element
  // so we don't hijack the user's text-editing undo.
  useEffect(() => {
    function isEditable(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }
    function handler(e: KeyboardEvent) {
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я');
      if (!isUndo) return;
      if (isEditable(e.target)) return;
      const stack = undoStackRef.current;
      if (stack.length === 0) return;
      e.preventDefault();
      const last = stack.pop()!;
      const reversed = reverseTransferOp(last);
      onCommit({
        fromTaskId: reversed.fromTaskId,
        toTaskId: reversed.toTaskId,
        seconds: reversed.seconds,
      }).catch(() => {
        // re-push so the user can try again
        stack.push(last);
      });
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCommit]);

  const undoLast = useCallback(async () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const last = stack.pop()!;
    const reversed = reverseTransferOp(last);
    try {
      await onCommit({
        fromTaskId: reversed.fromTaskId,
        toTaskId: reversed.toTaskId,
        seconds: reversed.seconds,
      });
    } catch {
      stack.push(last);
    }
  }, [onCommit]);

  const getUndoStack = useCallback(
    () => undoStackRef.current as readonly TransferOp[],
    [],
  );

  return {
    state,
    effectiveMinutes,
    requestedMinutes: state
      ? parseKeyboardMinutes(state.keyboardBuffer, TRANSFER_DEFAULT_MINUTES)
      : 0,
    validity,
    beginPress,
    undoLast,
    cancel,
    getUndoStack,
  };
}
