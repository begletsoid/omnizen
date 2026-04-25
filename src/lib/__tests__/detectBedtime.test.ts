import { describe, expect, it } from 'vitest';

import { detectBedtime, detectBedtimeFromTimestamps, type StepSample } from '../detectBedtime';

// Tests use Moscow timezone offsets (+03:00) to mirror real iPhone payloads.
// Helper to keep tests readable.
function sample(startIso: string, endIso: string, value: number): StepSample {
  return { start: startIso, end: endIso, value };
}

describe('detectBedtime', () => {
  it('returns no_sleep_detected on empty input', () => {
    const result = detectBedtime([], new Date('2026-04-25T08:00:00+03:00'));
    expect(result.kind).toBe('no_sleep_detected');
  });

  it('returns no_sleep_detected when there is no inactivity gap >= 3h', () => {
    // Continuous activity with small breaks
    const samples = [
      sample('2026-04-25T06:00:00+03:00', '2026-04-25T06:15:00+03:00', 300),
      sample('2026-04-25T07:00:00+03:00', '2026-04-25T07:30:00+03:00', 800),
      sample('2026-04-25T08:00:00+03:00', '2026-04-25T08:10:00+03:00', 200),
    ];
    const result = detectBedtime(samples, new Date('2026-04-25T08:30:00+03:00'));
    expect(result.kind).toBe('no_sleep_detected');
  });

  it('detects bedtime with a single clean sleep gap (no night wake)', () => {
    // Last evening activity 22:30, then nothing until morning at 08:00.
    const samples = [
      sample('2026-04-24T20:00:00+03:00', '2026-04-24T20:30:00+03:00', 1500),
      sample('2026-04-24T22:00:00+03:00', '2026-04-24T22:30:00+03:00', 800),
      sample('2026-04-25T08:00:00+03:00', '2026-04-25T08:05:00+03:00', 100),
    ];
    const result = detectBedtime(samples, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z'); // 22:30 MSK = 19:30 UTC
      expect(result.confidence).toBe('high');
    }
  });

  it('merges a single brief night toilet break into one sleep gap', () => {
    const samples = [
      sample('2026-04-24T22:00:00+03:00', '2026-04-24T22:30:00+03:00', 800),
      // Toilet at 03:00: 50 steps, 3 min
      sample('2026-04-25T03:00:00+03:00', '2026-04-25T03:03:00+03:00', 50),
      sample('2026-04-25T08:00:00+03:00', '2026-04-25T08:05:00+03:00', 100),
    ];
    const result = detectBedtime(samples, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      // Bedtime should be END of evening activity (22:30 MSK = 19:30 UTC)
      // — toilet break absorbed.
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z');
      expect(result.confidence).toBe('medium'); // merged → medium
    }
  });

  it('merges two brief night toilet breaks', () => {
    const samples = [
      sample('2026-04-24T22:00:00+03:00', '2026-04-24T22:30:00+03:00', 800),
      sample('2026-04-25T02:00:00+03:00', '2026-04-25T02:02:00+03:00', 30),
      sample('2026-04-25T05:00:00+03:00', '2026-04-25T05:02:00+03:00', 40),
      sample('2026-04-25T08:00:00+03:00', '2026-04-25T08:05:00+03:00', 100),
    ];
    const result = detectBedtime(samples, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z');
    }
  });

  it('does NOT merge gaps separated by significant activity', () => {
    // User went to bed, slept 4h, got up and walked 1000 steps, then slept again
    const samples = [
      sample('2026-04-24T22:00:00+03:00', '2026-04-24T22:30:00+03:00', 800),
      sample('2026-04-25T02:30:00+03:00', '2026-04-25T03:00:00+03:00', 1000),
      sample('2026-04-25T08:00:00+03:00', '2026-04-25T08:05:00+03:00', 100),
    ];
    const result = detectBedtime(samples, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      // Most recent long gap is 03:00 → 08:00, so bedtime = 03:00 MSK
      expect(result.bedtime.toISOString()).toBe('2026-04-24T23:55:00.000Z'); // 02:55 MSK (03:00 minus 5 min) = 23:55 UTC prev day
    }
  });

  it('picks the most recent long gap (ignores old daytime nap)', () => {
    // User: napped midday (3h), normal evening, slept night (8h)
    const samples = [
      sample('2026-04-24T11:00:00+03:00', '2026-04-24T11:30:00+03:00', 500),
      // 3.5h nap
      sample('2026-04-24T15:00:00+03:00', '2026-04-24T15:30:00+03:00', 600),
      sample('2026-04-24T19:00:00+03:00', '2026-04-24T19:30:00+03:00', 400),
      sample('2026-04-24T22:00:00+03:00', '2026-04-24T22:30:00+03:00', 800),
      // night sleep
      sample('2026-04-25T08:00:00+03:00', '2026-04-25T08:05:00+03:00', 100),
    ];
    const result = detectBedtime(samples, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      // Most recent gap is 22:30 → 08:00 (night sleep), bedtime = 22:30 MSK
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z');
    }
  });

  it('ignores stale gaps from previous day (>12h ago)', () => {
    // We're at 14:00 today, but the only "long" gap ended 24h ago
    const samples = [
      sample('2026-04-23T22:00:00+03:00', '2026-04-23T22:30:00+03:00', 800),
      sample('2026-04-24T08:00:00+03:00', '2026-04-24T08:05:00+03:00', 100),
      // user has been active all day yesterday and today
      sample('2026-04-24T10:00:00+03:00', '2026-04-24T10:30:00+03:00', 1000),
      sample('2026-04-24T13:00:00+03:00', '2026-04-24T13:30:00+03:00', 1000),
      sample('2026-04-24T16:00:00+03:00', '2026-04-24T16:30:00+03:00', 1000),
      sample('2026-04-24T20:00:00+03:00', '2026-04-24T20:30:00+03:00', 1000),
      sample('2026-04-25T09:00:00+03:00', '2026-04-25T09:30:00+03:00', 800),
      sample('2026-04-25T13:00:00+03:00', '2026-04-25T13:30:00+03:00', 500),
    ];
    // last night's sleep (24/04 evening to 25/04 morning) actually has a gap
    // 20:30 → 09:00 = 12.5h. That ends within 12h cutoff window of 14:00 (cutoff = 02:00 today).
    // 09:00 today is after 02:00 today → in window. So we DO get this gap.
    const result = detectBedtime(samples, new Date('2026-04-25T14:00:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      // Bedtime = end of 20:30 MSK = 17:30 UTC on 24 апр
      expect(result.bedtime.toISOString()).toBe('2026-04-24T17:25:00.000Z');
    }
  });

  it('skips malformed samples and uses only valid ones', () => {
    const samples = [
      sample('2026-04-24T22:00:00+03:00', '2026-04-24T22:30:00+03:00', 800),
      // Malformed: invalid date
      { start: 'not a date', end: '2026-04-25T03:00:00+03:00', value: 50 },
      // Malformed: end before start
      sample('2026-04-25T05:00:00+03:00', '2026-04-25T04:00:00+03:00', 100),
      sample('2026-04-25T08:00:00+03:00', '2026-04-25T08:05:00+03:00', 100),
    ];
    const result = detectBedtime(samples, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z');
    }
  });

  it('handles unsorted input by sorting it internally', () => {
    const samples = [
      sample('2026-04-25T08:00:00+03:00', '2026-04-25T08:05:00+03:00', 100),
      sample('2026-04-24T22:00:00+03:00', '2026-04-24T22:30:00+03:00', 800),
      sample('2026-04-25T03:00:00+03:00', '2026-04-25T03:03:00+03:00', 50),
    ];
    const result = detectBedtime(samples, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z');
    }
  });
});

describe('detectBedtimeFromTimestamps', () => {
  it('returns no_sleep_detected on empty input', () => {
    const result = detectBedtimeFromTimestamps([], new Date('2026-04-25T08:00:00+03:00'));
    expect(result.kind).toBe('no_sleep_detected');
  });

  it('detects bedtime from a flat list of step-sample start times', () => {
    // Evening: many step samples (a real walk). Then nothing for 9.5 hours.
    // Morning: more step samples (waking up).
    const timestamps = [
      // evening walking session — many samples within 30 min
      '2026-04-24T22:00:00+03:00',
      '2026-04-24T22:01:00+03:00',
      '2026-04-24T22:02:00+03:00',
      '2026-04-24T22:10:00+03:00',
      '2026-04-24T22:20:00+03:00',
      '2026-04-24T22:30:00+03:00',
      // sleep gap
      // morning
      '2026-04-25T08:00:00+03:00',
      '2026-04-25T08:01:00+03:00',
      '2026-04-25T08:02:00+03:00',
    ];
    const result = detectBedtimeFromTimestamps(timestamps, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      // Last evening cluster ends 22:30 MSK = 19:30 UTC. Minus 5 min = 19:25 UTC.
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z');
    }
  });

  it('absorbs a 1-2 sample toilet break in the middle of the night', () => {
    const timestamps = [
      '2026-04-24T22:00:00+03:00',
      '2026-04-24T22:30:00+03:00',
      // toilet at 03:00 — a single timestamp
      '2026-04-25T03:00:00+03:00',
      '2026-04-25T08:00:00+03:00',
      '2026-04-25T08:01:00+03:00',
    ];
    const result = detectBedtimeFromTimestamps(timestamps, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      // Bedtime = end of evening cluster (22:30 MSK) - 5min = 19:25 UTC
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z');
      expect(result.confidence).toBe('medium');
    }
  });

  it('does NOT absorb a substantial mid-night activity (3+ samples)', () => {
    const timestamps = [
      '2026-04-24T22:00:00+03:00',
      '2026-04-24T22:30:00+03:00',
      // serious wake-up: 3 samples within 5 min — that's a real walk
      '2026-04-25T03:00:00+03:00',
      '2026-04-25T03:01:00+03:00',
      '2026-04-25T03:03:00+03:00',
      '2026-04-25T08:00:00+03:00',
      '2026-04-25T08:01:00+03:00',
    ];
    const result = detectBedtimeFromTimestamps(timestamps, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      // Most recent long gap is 03:03 → 08:00. End of cluster before that gap
      // is 03:03 MSK = 00:03 UTC. Minus 5 min = 23:58 UTC of prev day.
      expect(result.bedtime.toISOString()).toBe('2026-04-24T23:58:00.000Z');
    }
  });

  it('handles DESC-ordered input (iPhone "Сначала недавние")', () => {
    const timestamps = [
      // newest first — iOS Shortcuts order
      '2026-04-25T08:01:00+03:00',
      '2026-04-25T08:00:00+03:00',
      '2026-04-24T22:30:00+03:00',
      '2026-04-24T22:00:00+03:00',
      '2026-04-24T21:55:00+03:00',
    ];
    const result = detectBedtimeFromTimestamps(timestamps, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z');
    }
  });

  it('skips malformed timestamps', () => {
    const timestamps = [
      '2026-04-24T22:00:00+03:00',
      'not a date',
      '',
      '2026-04-24T22:30:00+03:00',
      '2026-04-25T08:00:00+03:00',
      '2026-04-25T08:01:00+03:00',
    ];
    const result = detectBedtimeFromTimestamps(timestamps, new Date('2026-04-25T08:10:00+03:00'));
    expect(result.kind).toBe('detected');
    if (result.kind === 'detected') {
      expect(result.bedtime.toISOString()).toBe('2026-04-24T19:25:00.000Z');
    }
  });
});
