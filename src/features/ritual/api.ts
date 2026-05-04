import { supabase } from '../../lib/supabaseClient';
import type { RitualAnswer, RitualStepType } from './types';

export type RitualAnswerInsert = {
  user_id: string;
  day_key: string;
  set_id: string;
  set_name: string;
  step_id: string;
  step_type: RitualStepType;
  prompt: string;
  /**
   * Mixed-shape value column (jsonb). Number for scale, string for trio,
   * null for `reminder` steps where the user just acknowledged the prompt.
   */
  value: RitualAnswer | null;
  /**
   * IANA timezone reported by the browser (e.g. "Europe/Moscow"). Helpful
   * for time-of-day analytics later — server-side `now()` only knows UTC.
   */
  client_timezone: string;
};

/**
 * Append-only insert. We never update or upsert: each press of "Next" lands
 * its own row so the table reads as an immutable answer log.
 */
export async function recordRitualAnswer(payload: RitualAnswerInsert) {
  if (!supabase) {
    console.warn('Supabase client unavailable - ritual answers persistence disabled.');
    return;
  }
  const { error } = await supabase.from('ritual_answers').insert(payload);
  if (error) throw error;
}

/** Best-effort timezone read; falls back to "UTC" on environments without Intl. */
export function getClientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
