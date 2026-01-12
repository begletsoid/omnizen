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
