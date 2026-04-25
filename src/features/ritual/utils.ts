import type { RitualSet, RitualSetState, RitualState } from './types';

/**
 * Cutoff in minutes-after-midnight that counts as "new day" for the ritual.
 * 4:30 AM matches when the user typically gets up — anything before that
 * belongs to the previous day's ritual run.
 */
export const RITUAL_DAY_CUTOFF_MINUTES = 4 * 60 + 30;

/**
 * "Ritual day" key — a local-date string that rolls over at 4:30 AM instead
 * of midnight. If the user opens the app at 02:00 on the 23rd, they still
 * see the 22nd's ritual; at 04:30 on the 23rd it flips to the 23rd.
 */
export function getTodayKey(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - RITUAL_DAY_CUTOFF_MINUTES * 60_000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Return a state object valid for "today". If the stored state is from a
 * previous day, the answers/progress are reset, but the chosen active set is
 * preserved so reloading in the middle of the day doesn't jump tabs.
 */
export function normaliseRitualState(
  raw: RitualState | undefined,
  sets: RitualSet[],
  todayKey: string,
): RitualState {
  const defaultActive = raw?.activeSetId ?? sets[0]?.id ?? null;
  if (!raw || raw.dayKey !== todayKey) {
    return { dayKey: todayKey, activeSetId: defaultActive, answers: {} };
  }
  // Filter answers for sets that no longer exist.
  const validIds = new Set(sets.map((s) => s.id));
  const cleaned: Record<string, RitualSetState> = {};
  for (const [setId, st] of Object.entries(raw.answers ?? {})) {
    if (validIds.has(setId)) cleaned[setId] = st;
  }
  const active = raw.activeSetId && validIds.has(raw.activeSetId)
    ? raw.activeSetId
    : sets[0]?.id ?? null;
  return { dayKey: raw.dayKey, activeSetId: active, answers: cleaned };
}

export function getSetState(state: RitualState, setId: string): RitualSetState {
  return state.answers[setId] ?? { stepIndex: 0, values: {} };
}

export function reorderItems<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
  if (fromId === toId) return items;
  const fromIdx = items.findIndex((x) => x.id === fromId);
  const toIdx = items.findIndex((x) => x.id === toId);
  if (fromIdx < 0 || toIdx < 0) return items;
  const copy = [...items];
  const [moved] = copy.splice(fromIdx, 1);
  copy.splice(toIdx, 0, moved);
  return copy;
}

/**
 * Like `reorderItems` but respects a drop position ("before" or "after" the
 * target). Essential for a drag-with-ghost UI where the indicator can land on
 * either side of the target row.
 */
export function reorderItemsWithPosition<T extends { id: string }>(
  items: T[],
  fromId: string,
  toId: string,
  position: 'before' | 'after',
): T[] {
  if (fromId === toId) return items;
  const fromIdx = items.findIndex((x) => x.id === fromId);
  const toIdx = items.findIndex((x) => x.id === toId);
  if (fromIdx < 0 || toIdx < 0) return items;
  const copy = [...items];
  const [moved] = copy.splice(fromIdx, 1);
  // After splice, the target's index may have shifted.
  let insertAt = copy.findIndex((x) => x.id === toId);
  if (insertAt < 0) insertAt = copy.length;
  if (position === 'after') insertAt += 1;
  copy.splice(insertAt, 0, moved);
  return copy;
}
