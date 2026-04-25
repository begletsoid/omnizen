import type { HeatmapDayStats } from './types';

/** Convert a Date to `YYYY-MM-DD` in the local timezone (matches Postgres DATE). */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDayKey(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Enumerate days (inclusive) from `from` to `to`, oldest first. */
export function enumerateDays(from: string, to: string): string[] {
  const start = parseDayKey(from);
  const end = parseDayKey(to);
  if (start > end) return [];
  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(toDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0м';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}ч ${m}м`;
  if (h > 0) return `${h}ч`;
  return `${m}м`;
}

/**
 * Hours rounded to the nearest tenth — used in the averages line where the
 * grain of "13м vs 47м" is less useful than a single at-a-glance hour figure.
 * Uses a comma decimal separator to match Russian locale.
 */
export function formatHoursTenth(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0ч';
  const hours = seconds / 3600;
  return `${hours.toFixed(1).replace('.', ',')}ч`;
}

export type HeatmapMetrics = {
  longestStreak: number;
  currentStreak: number;
  activeDays: number;
  totalDays: number;
  activePercent: number;
  avgPointsPerDay: number;
  avgSecondsPerDay: number;
  /** Average points per hour of work across the period. */
  avgPointsPerHour: number;
};

/**
 * Compute streaks and averages for the heatmap period.
 * "Active" means a day has either points OR seconds > 0.
 * `days` is the full enumerated range; `statsByDay` is a lookup.
 * "Current streak" counts the streak ending at the latest day in range.
 */
export function computeHeatmapMetrics(
  days: string[],
  statsByDay: Map<string, HeatmapDayStats>,
): HeatmapMetrics {
  const totalDays = days.length;
  let longestStreak = 0;
  let currentStreakInRun = 0;
  let activeDays = 0;
  let totalPoints = 0;
  let totalSeconds = 0;

  for (const day of days) {
    const stat = statsByDay.get(day);
    const active = Boolean(stat && (stat.points > 0 || stat.seconds > 0));
    if (active) {
      activeDays += 1;
      currentStreakInRun += 1;
      if (currentStreakInRun > longestStreak) longestStreak = currentStreakInRun;
      totalPoints += stat!.points;
      totalSeconds += stat!.seconds;
    } else {
      currentStreakInRun = 0;
    }
  }

  // Current streak = streak ending at the latest day. Walk from the end backwards.
  let currentStreak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const stat = statsByDay.get(days[i]);
    const active = Boolean(stat && (stat.points > 0 || stat.seconds > 0));
    if (active) currentStreak += 1;
    else break;
  }

  const avgPointsPerDay = totalDays > 0 ? totalPoints / totalDays : 0;
  const avgSecondsPerDay = totalDays > 0 ? totalSeconds / totalDays : 0;
  const avgPointsPerHour = totalSeconds > 0 ? (totalPoints * 3600) / totalSeconds : 0;
  const activePercent = totalDays > 0 ? (activeDays / totalDays) * 100 : 0;

  return {
    longestStreak,
    currentStreak,
    activeDays,
    totalDays,
    activePercent,
    avgPointsPerDay,
    avgSecondsPerDay,
    avgPointsPerHour,
  };
}

/**
 * Map a value in [0, max] to an intensity bucket (0..9).
 * Bucket 0 = empty; buckets 1..9 split the non-empty range into 9 equal tenths,
 * so any positive value lands in bucket ≥ 1 (no "invisible" activity).
 */
export type IntensityBucket = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export function computeIntensityBucket(value: number, max: number): IntensityBucket {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  // Map (0, 1] → {1..9}. Ensure any positive value is at least bucket 1.
  const bucket = Math.min(9, Math.max(1, Math.ceil(ratio * 9))) as IntensityBucket;
  return bucket;
}
