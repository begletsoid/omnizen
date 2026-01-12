// Helpers for days_mask bitstring (bit(7), ISO week: Mon=1 ... Sun=7)

const DAYS_IN_WEEK = 7;

export function encodeDaysMask(enabled: boolean[]): string {
  const normalized = [...enabled].slice(0, DAYS_IN_WEEK);
  while (normalized.length < DAYS_IN_WEEK) normalized.push(true); // default all on
  // Postgres bit ordering: leftmost is highest-order bit; we treat index 0 = Mon => bit0
  return normalized.map((flag) => (flag ? '1' : '0')).join('');
}

export function decodeDaysMask(mask: string | null | undefined): boolean[] {
  if (!mask) return new Array(DAYS_IN_WEEK).fill(true);
  const chars = mask.split('');
  const padded = chars.length >= DAYS_IN_WEEK ? chars.slice(-DAYS_IN_WEEK) : [...new Array(DAYS_IN_WEEK - chars.length).fill('1'), ...chars];
  return padded.map((c) => c === '1');
}

export type DateRange = { start: string; end: string };

export function clampRange(range: DateRange) {
  if (range.start > range.end) {
    return { start: range.end, end: range.start };
  }
  return range;
}

// Timezone helpers (Europe/Moscow)
const MOSCOW_TZ = 'Europe/Moscow';
const MS_IN_DAY = 86_400_000;

function formatMoscow(date: Date, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MOSCOW_TZ, ...opts }).format(date);
}

export function toMoscowDateString(iso: string) {
  const d = new Date(iso);
  return formatMoscow(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function getMoscowWeekdayIndex(iso: string): number {
  const d = new Date(iso);
  const formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: MOSCOW_TZ });
  const name = formatter.format(d); // Mon, Tue...
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[name] ?? 0;
}

export function toUtcStartOfMoscowDay(dateStr: string) {
  // dateStr: YYYY-MM-DD in local (Moscow) terms
  return new Date(`${dateStr}T00:00:00+03:00`).toISOString();
}

export function toUtcEndOfMoscowDay(dateStr: string) {
  return new Date(`${dateStr}T23:59:59.999+03:00`).toISOString();
}

export function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDateKeys(range: DateRange, granularity: 'day' | 'week' | 'month') {
  const keys: string[] = [];
  const start = new Date(`${range.start}T00:00:00Z`).getTime();
  const end = new Date(`${range.end}T00:00:00Z`).getTime();
  if (granularity === 'day') {
    for (let t = start; t <= end; t += MS_IN_DAY) {
      const d = new Date(t);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      keys.push(`${y}-${m}-${day}`);
    }
    return keys;
  }
  if (granularity === 'week') {
    // ISO weeks covering the whole range
    const seen = new Set<string>();
    for (let t = start; t <= end; t += MS_IN_DAY) {
      const key = getIsoWeekKey(new Date(t).toISOString());
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    return keys;
  }
  // month
  const seen = new Set<string>();
  for (let t = start; t <= end; t += MS_IN_DAY) {
    const key = getMonthKey(new Date(t).toISOString());
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export function getIsoWeekKey(iso: string) {
  // compute ISO week in Moscow TZ
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(d)
    .split('-')
    .map(Number);
  const local = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  // adjust to Thursday to get ISO week
  const day = (local.getUTCDay() + 6) % 7; // Mon=0
  local.setUTCDate(local.getUTCDate() + 3 - day);
  const week1 = new Date(Date.UTC(local.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((local.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${local.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function getMonthKey(iso: string) {
  const d = new Date(iso);
  return formatMoscow(d, { year: 'numeric', month: '2-digit' });
}
