import { describe, expect, it } from 'vitest';

import type { HeatmapDayStats } from '../types';
import {
  computeHeatmapMetrics,
  computeIntensityBucket,
  enumerateDays,
  formatHoursTenth,
  formatSeconds,
  parseDayKey,
  toDayKey,
} from '../utils';

describe('toDayKey / parseDayKey', () => {
  it('round-trips a date through a YYYY-MM-DD key', () => {
    const original = new Date(2026, 3, 19); // 19 Apr 2026, month index 3
    const key = toDayKey(original);
    expect(key).toBe('2026-04-19');
    const parsed = parseDayKey(key);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(3);
    expect(parsed.getDate()).toBe(19);
  });
});

describe('enumerateDays', () => {
  it('includes both endpoints and every day between them', () => {
    const days = enumerateDays('2026-04-01', '2026-04-04');
    expect(days).toEqual(['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04']);
  });

  it('handles a single-day range', () => {
    expect(enumerateDays('2026-04-19', '2026-04-19')).toEqual(['2026-04-19']);
  });

  it('crosses month boundary correctly', () => {
    const days = enumerateDays('2026-04-29', '2026-05-02');
    expect(days).toEqual(['2026-04-29', '2026-04-30', '2026-05-01', '2026-05-02']);
  });

  it('returns empty when from is after to', () => {
    expect(enumerateDays('2026-04-10', '2026-04-01')).toEqual([]);
  });
});

describe('formatHoursTenth', () => {
  it('rounds seconds to tenths of an hour with a comma', () => {
    expect(formatHoursTenth(3600)).toBe('1,0ч');
    expect(formatHoursTenth(1800)).toBe('0,5ч');
    expect(formatHoursTenth(2 * 3600 + 15 * 60)).toBe('2,3ч'); // 2h15m ≈ 2.25h → rounds 2.3
    expect(formatHoursTenth(33 * 60)).toBe('0,6ч'); // 33m ≈ 0.55h → rounds 0.6
  });

  it('returns 0ч when seconds is 0 or negative', () => {
    expect(formatHoursTenth(0)).toBe('0ч');
    expect(formatHoursTenth(-10)).toBe('0ч');
  });
});

describe('formatSeconds', () => {
  it('shows hours and minutes when both present', () => {
    expect(formatSeconds(3 * 3600 + 25 * 60)).toBe('3ч 25м');
  });

  it('shows only hours when minutes are zero', () => {
    expect(formatSeconds(2 * 3600)).toBe('2ч');
  });

  it('shows only minutes when under an hour', () => {
    expect(formatSeconds(45 * 60)).toBe('45м');
  });

  it('returns zero fallback when seconds <= 0', () => {
    expect(formatSeconds(0)).toBe('0м');
    expect(formatSeconds(-5)).toBe('0м');
  });
});

describe('computeIntensityBucket', () => {
  it('returns 0 when value is zero or max is zero', () => {
    expect(computeIntensityBucket(0, 100)).toBe(0);
    expect(computeIntensityBucket(50, 0)).toBe(0);
  });

  it('any tiny positive value lands in bucket 1 (no invisible activity)', () => {
    expect(computeIntensityBucket(0.0001, 100)).toBe(1);
    expect(computeIntensityBucket(1, 100)).toBe(1);
  });

  it('full value lands in top bucket (9)', () => {
    expect(computeIntensityBucket(100, 100)).toBe(9);
  });

  it('maps ratios to 9 equal tenths', () => {
    // Ceiling of ratio*9: each threshold n/9 maps to bucket n.
    expect(computeIntensityBucket(10, 100)).toBe(1); // 0.9 → ceil = 1
    expect(computeIntensityBucket(12, 100)).toBe(2); // 1.08 → ceil = 2
    expect(computeIntensityBucket(45, 100)).toBe(5); // 4.05 → ceil = 5
    expect(computeIntensityBucket(80, 100)).toBe(8); // 7.2  → ceil = 8
    expect(computeIntensityBucket(90, 100)).toBe(9); // 8.1  → ceil = 9
  });

  it('clamps ratios above 1 to bucket 9', () => {
    expect(computeIntensityBucket(200, 100)).toBe(9);
  });
});

describe('computeHeatmapMetrics', () => {
  const buildStats = (entries: Array<[string, number, number]>): Map<string, HeatmapDayStats> => {
    const map = new Map<string, HeatmapDayStats>();
    for (const [day, points, seconds] of entries) {
      map.set(day, { day, points, seconds });
    }
    return map;
  };

  it('counts only days with positive points or seconds as active', () => {
    const days = ['2026-04-01', '2026-04-02', '2026-04-03'];
    const stats = buildStats([
      ['2026-04-01', 10, 0],
      ['2026-04-02', 0, 0],
      ['2026-04-03', 0, 600],
    ]);
    const m = computeHeatmapMetrics(days, stats);
    expect(m.activeDays).toBe(2);
    expect(m.totalDays).toBe(3);
    expect(m.activePercent).toBeCloseTo(66.6667, 2);
  });

  it('computes longest and current streaks correctly', () => {
    const days = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    const stats = buildStats([
      ['d1', 5, 0],
      ['d2', 5, 0],
      ['d3', 0, 0],
      ['d4', 5, 0],
      ['d5', 5, 0],
      ['d6', 5, 0],
    ]);
    const m = computeHeatmapMetrics(days, stats);
    expect(m.longestStreak).toBe(3);
    expect(m.currentStreak).toBe(3);
  });

  it('current streak is 0 when the latest day is idle', () => {
    const days = ['d1', 'd2', 'd3'];
    const stats = buildStats([['d1', 10, 0], ['d2', 10, 0]]);
    const m = computeHeatmapMetrics(days, stats);
    expect(m.longestStreak).toBe(2);
    expect(m.currentStreak).toBe(0);
  });

  it('computes avg points per hour across the whole period', () => {
    const days = ['d1', 'd2'];
    const stats = buildStats([
      ['d1', 30, 3600],
      ['d2', 60, 7200],
    ]);
    const m = computeHeatmapMetrics(days, stats);
    // Total: 90 points over 10800 seconds (3 hours) = 30 pts/hour
    expect(m.avgPointsPerHour).toBeCloseTo(30, 4);
    expect(m.avgPointsPerDay).toBe(45);
    expect(m.avgSecondsPerDay).toBe(5400);
  });

  it('returns zero metrics for empty range', () => {
    const m = computeHeatmapMetrics([], new Map());
    expect(m).toEqual({
      longestStreak: 0,
      currentStreak: 0,
      activeDays: 0,
      totalDays: 0,
      activePercent: 0,
      avgPointsPerDay: 0,
      avgSecondsPerDay: 0,
      avgPointsPerHour: 0,
    });
  });
});
