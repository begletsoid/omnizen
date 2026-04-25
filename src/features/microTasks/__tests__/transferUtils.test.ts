import { describe, expect, it } from 'vitest';

import {
  TRANSFER_DEFAULT_MINUTES,
  TRANSFER_KEYBOARD_BUFFER_MAX,
  appendDigitToBuffer,
  backspaceBuffer,
  clampTransferMinutes,
  computeAvailableSecondsOnSource,
  formatTransferDuration,
  parseKeyboardMinutes,
  reverseTransferOp,
  validateTransfer,
} from '../transferUtils';

describe('formatTransferDuration', () => {
  it.each([
    [0, '0:00'],
    [1, '1:00'],
    [5, '5:00'],
    [60, '60:00'],
    [100, '100:00'],
    [9999, '9999:00'],
  ])('formats %i → %s', (mins, expected) => {
    expect(formatTransferDuration(mins)).toBe(expected);
  });

  it('clamps negative input to 0', () => {
    expect(formatTransferDuration(-3)).toBe('0:00');
  });

  it('floors fractional input', () => {
    expect(formatTransferDuration(5.7)).toBe('5:00');
  });

  it('treats NaN/Infinity as 0', () => {
    expect(formatTransferDuration(Number.NaN)).toBe('0:00');
    expect(formatTransferDuration(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('parseKeyboardMinutes', () => {
  it('returns the default for an empty buffer', () => {
    expect(parseKeyboardMinutes('')).toBe(TRANSFER_DEFAULT_MINUTES);
  });

  it('respects a custom default', () => {
    expect(parseKeyboardMinutes('', 7)).toBe(7);
  });

  it('parses numeric strings', () => {
    expect(parseKeyboardMinutes('1')).toBe(1);
    expect(parseKeyboardMinutes('23')).toBe(23);
    expect(parseKeyboardMinutes('9999')).toBe(9999);
  });

  it('falls back to default for nonsense', () => {
    expect(parseKeyboardMinutes('abc')).toBe(TRANSFER_DEFAULT_MINUTES);
  });
});

describe('appendDigitToBuffer', () => {
  it('builds digits up', () => {
    expect(appendDigitToBuffer('', '5')).toBe('5');
    expect(appendDigitToBuffer('5', '0')).toBe('50');
    expect(appendDigitToBuffer('1', '2')).toBe('12');
    expect(appendDigitToBuffer('12', '3')).toBe('123');
  });

  it('drops leading zero', () => {
    expect(appendDigitToBuffer('', '0')).toBe('');
  });

  it('ignores non-digit input', () => {
    expect(appendDigitToBuffer('5', 'a')).toBe('5');
    expect(appendDigitToBuffer('5', '')).toBe('5');
    expect(appendDigitToBuffer('5', '12')).toBe('5');
    expect(appendDigitToBuffer('5', '-')).toBe('5');
  });

  it(`caps at TRANSFER_KEYBOARD_BUFFER_MAX = ${TRANSFER_KEYBOARD_BUFFER_MAX}`, () => {
    const full = '1'.repeat(TRANSFER_KEYBOARD_BUFFER_MAX);
    expect(appendDigitToBuffer(full, '9')).toBe(full);
  });
});

describe('backspaceBuffer', () => {
  it('removes last char', () => {
    expect(backspaceBuffer('123')).toBe('12');
    expect(backspaceBuffer('1')).toBe('');
  });

  it('returns "" for empty input', () => {
    expect(backspaceBuffer('')).toBe('');
  });
});

describe('computeAvailableSecondsOnSource', () => {
  const fixedNow = new Date('2026-04-25T12:00:00Z').getTime();
  const tenSecondsAgo = new Date(fixedNow - 10_000).toISOString();
  const futureStart = new Date(fixedNow + 5_000).toISOString();

  it('returns stored for paused', () => {
    expect(computeAvailableSecondsOnSource(300, 'paused', null, fixedNow)).toBe(300);
    expect(computeAvailableSecondsOnSource(300, 'paused', tenSecondsAgo, fixedNow)).toBe(300);
  });

  it('returns stored for never', () => {
    expect(computeAvailableSecondsOnSource(0, 'never', null, fixedNow)).toBe(0);
  });

  it('adds delta for running', () => {
    expect(computeAvailableSecondsOnSource(300, 'running', tenSecondsAgo, fixedNow)).toBe(310);
  });

  it('treats running with null last_started_at as stored only', () => {
    expect(computeAvailableSecondsOnSource(300, 'running', null, fixedNow)).toBe(300);
  });

  it('handles clock skew (now < last_started_at) without going negative', () => {
    expect(computeAvailableSecondsOnSource(300, 'running', futureStart, fixedNow)).toBe(300);
  });

  it('handles malformed last_started_at gracefully', () => {
    expect(computeAvailableSecondsOnSource(300, 'running', 'not-a-date', fixedNow)).toBe(300);
  });

  it('floors fractional stored values to be safe', () => {
    expect(computeAvailableSecondsOnSource(300.9, 'paused', null, fixedNow)).toBe(300);
  });

  it('clamps negative stored to 0', () => {
    expect(computeAvailableSecondsOnSource(-50, 'paused', null, fixedNow)).toBe(0);
  });
});

describe('clampTransferMinutes', () => {
  it('returns requested when under available', () => {
    expect(clampTransferMinutes(5, 600)).toBe(5);
  });

  it('caps at full available minutes', () => {
    expect(clampTransferMinutes(5, 240)).toBe(4);
  });

  it('handles edge: exact match', () => {
    expect(clampTransferMinutes(5, 300)).toBe(5);
  });

  it('returns 0 for non-positive request', () => {
    expect(clampTransferMinutes(0, 600)).toBe(0);
    expect(clampTransferMinutes(-3, 600)).toBe(0);
  });

  it('returns 0 when nothing available', () => {
    expect(clampTransferMinutes(5, 0)).toBe(0);
  });

  it('floors partial available time below 1 minute', () => {
    expect(clampTransferMinutes(5, 45)).toBe(0); // 45s < 60s = 0 minutes
  });

  it('handles NaN gracefully', () => {
    expect(clampTransferMinutes(Number.NaN, 600)).toBe(0);
    expect(clampTransferMinutes(5, Number.NaN)).toBe(0);
  });
});

describe('validateTransfer', () => {
  const baseAvailable = 600; // 10 minutes
  const sourceId = 'source-1';
  const targetId = 'target-1';

  it('returns "ok" for a valid transfer', () => {
    expect(
      validateTransfer({
        requestedMinutes: 5,
        availableSeconds: baseAvailable,
        hoveredTargetId: targetId,
        sourceTaskId: sourceId,
      }),
    ).toBe('ok');
  });

  it('returns "no_target" without hover', () => {
    expect(
      validateTransfer({
        requestedMinutes: 5,
        availableSeconds: baseAvailable,
        hoveredTargetId: null,
        sourceTaskId: sourceId,
      }),
    ).toBe('no_target');
  });

  it('returns "same_task" when hovering source', () => {
    expect(
      validateTransfer({
        requestedMinutes: 5,
        availableSeconds: baseAvailable,
        hoveredTargetId: sourceId,
        sourceTaskId: sourceId,
      }),
    ).toBe('same_task');
  });

  it('returns "zero" for 0 minutes', () => {
    expect(
      validateTransfer({
        requestedMinutes: 0,
        availableSeconds: baseAvailable,
        hoveredTargetId: targetId,
        sourceTaskId: sourceId,
      }),
    ).toBe('zero');
  });

  it('returns "too_much" when over-requesting', () => {
    expect(
      validateTransfer({
        requestedMinutes: 11,
        availableSeconds: baseAvailable,
        hoveredTargetId: targetId,
        sourceTaskId: sourceId,
      }),
    ).toBe('too_much');
  });

  it('treats exact availability as ok', () => {
    expect(
      validateTransfer({
        requestedMinutes: 10,
        availableSeconds: baseAvailable,
        hoveredTargetId: targetId,
        sourceTaskId: sourceId,
      }),
    ).toBe('ok');
  });
});

describe('reverseTransferOp', () => {
  it('swaps source and target, keeps seconds', () => {
    const op = { fromTaskId: 'a', toTaskId: 'b', seconds: 120, appliedAt: 1 };
    const reversed = reverseTransferOp(op);
    expect(reversed.fromTaskId).toBe('b');
    expect(reversed.toTaskId).toBe('a');
    expect(reversed.seconds).toBe(120);
    expect(reversed.appliedAt).toBeGreaterThan(0);
  });
});
