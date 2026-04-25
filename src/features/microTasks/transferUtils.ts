// Pure helpers for the time-transfer drag mechanic.
// Kept side-effect-free so they can be unit-tested without DOM/timers.

import type { MicroTaskTimerState } from './types';

export const TRANSFER_DEFAULT_MINUTES = 5;

/**
 * Hard cap for how many digits the user can type during a drag — anything
 * beyond 9999 minutes (~7 days) is almost certainly an unintended keypress
 * and should not silently change the transferred amount.
 */
export const TRANSFER_KEYBOARD_BUFFER_MAX = 4;

/** Pointer movement (px) that promotes a press into a transfer drag. */
export const TRANSFER_ACTIVATION_DISTANCE_PX = 6;

export type TransferValidity = 'ok' | 'too_much' | 'zero' | 'no_target' | 'same_task';

/**
 * Format a minute count as the floating preview shows it during drag.
 * Always renders ":00" because the unit of transfer is whole minutes.
 */
export function formatTransferDuration(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  return `${safe}:00`;
}

/**
 * Resolve the keyboard buffer to a minute count.
 * Empty buffer → fall back to the default (5 min).
 */
export function parseKeyboardMinutes(
  buffer: string,
  defaultMinutes: number = TRANSFER_DEFAULT_MINUTES,
): number {
  if (!buffer) return defaultMinutes;
  const parsed = Number.parseInt(buffer, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultMinutes;
  return parsed;
}

/**
 * Append a digit to the buffer following these rules:
 *   - non-digit input is ignored.
 *   - a leading "0" is dropped (no padded "05").
 *   - the buffer never exceeds TRANSFER_KEYBOARD_BUFFER_MAX characters.
 */
export function appendDigitToBuffer(buffer: string, digit: string): string {
  if (digit.length !== 1 || digit < '0' || digit > '9') return buffer;
  if (buffer === '' && digit === '0') return '';
  if (buffer.length >= TRANSFER_KEYBOARD_BUFFER_MAX) return buffer;
  return buffer + digit;
}

export function backspaceBuffer(buffer: string): string {
  return buffer.length > 0 ? buffer.slice(0, -1) : '';
}

/**
 * How many seconds the source task currently has available, factoring in any
 * live running interval. Tolerant to clock skew (never returns negative) and
 * to a missing `last_started_at` on a "running" task.
 */
export function computeAvailableSecondsOnSource(
  storedSeconds: number,
  timerState: MicroTaskTimerState,
  lastStartedAt: string | null,
  now: number = Date.now(),
): number {
  const stored = Number.isFinite(storedSeconds) ? Math.max(0, Math.floor(storedSeconds)) : 0;
  if (timerState !== 'running' || !lastStartedAt) return stored;
  const startMs = Date.parse(lastStartedAt);
  if (!Number.isFinite(startMs)) return stored;
  const delta = Math.max(0, Math.floor((now - startMs) / 1000));
  return stored + delta;
}

/**
 * Reduce the user's requested minutes to what the source can actually give up.
 * Returns whole minutes (we never transfer a fraction of a minute).
 */
export function clampTransferMinutes(
  requestedMinutes: number,
  availableSeconds: number,
): number {
  const safeMinutes = Number.isFinite(requestedMinutes)
    ? Math.max(0, Math.floor(requestedMinutes))
    : 0;
  const safeAvailable = Number.isFinite(availableSeconds)
    ? Math.max(0, Math.floor(availableSeconds))
    : 0;
  const requestedSec = safeMinutes * 60;
  const allowedSec = Math.min(requestedSec, safeAvailable);
  return Math.floor(allowedSec / 60);
}

/**
 * Decide whether the current drag should commit on pointer-up. The four
 * non-`ok` states drive the floating preview's colour and a no-op drop.
 */
export function validateTransfer(params: {
  requestedMinutes: number;
  availableSeconds: number;
  hoveredTargetId: string | null;
  sourceTaskId: string;
}): TransferValidity {
  const { requestedMinutes, availableSeconds, hoveredTargetId, sourceTaskId } = params;
  if (!hoveredTargetId) return 'no_target';
  if (hoveredTargetId === sourceTaskId) return 'same_task';
  if (!Number.isFinite(requestedMinutes) || requestedMinutes <= 0) return 'zero';
  if (requestedMinutes * 60 > availableSeconds) return 'too_much';
  return 'ok';
}

export type TransferOp = {
  fromTaskId: string;
  toTaskId: string;
  seconds: number;
  appliedAt: number;
};

/**
 * Build the inverse operation (used when the user undoes via Ctrl+Z).
 * Source and target swap; everything else stays the same.
 */
export function reverseTransferOp(op: TransferOp): TransferOp {
  return {
    fromTaskId: op.toTaskId,
    toTaskId: op.fromTaskId,
    seconds: op.seconds,
    appliedAt: Date.now(),
  };
}
