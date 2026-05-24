/**
 * Supabase Realtime subscription for micro_tasks.
 *
 * Why this exists: without Realtime the dashboard only catches up to
 * cross-tab / cross-device / voice-webhook mutations on the next
 * `useMicroTasks` polling tick (10s). The Phase 6 user pain point was
 * that adding a goal-linked microtask in one source didn't bump the
 * goal timer in another open session for ~10s — annoying when the
 * Electron quick-switcher overlay sits next to the dashboard window.
 *
 * Strategy: one channel per signed-in user, filtered by `user_id` on
 * the postgres_changes event. Any INSERT / UPDATE / DELETE on
 * micro_tasks owned by this user fires the callback exactly once. The
 * caller decides which React Query caches to invalidate (we don't do
 * it here so the hook layer can be more surgical, e.g. invalidate
 * `['goals']` only when `goal_id` was involved).
 *
 * Mirrors `src/features/voice/realtime.ts` — same shape, different
 * table. Both depend on the respective table being in the
 * `supabase_realtime` publication (see
 * `supabase/migrations/20260513000000_realtime_microtasks.sql`).
 */

import { supabase } from '../../lib/supabaseClient';
import type { MicroTaskRecord } from './types';

export type MicroTaskRealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export type MicroTaskRealtimePayload = {
  event: MicroTaskRealtimeEvent;
  /**
   * For DELETE this is the `old` row; for INSERT/UPDATE it's the `new`
   * row. The schema may not include every MicroTaskRecord column (joined
   * `categories` aren't carried by Realtime), so callers should treat it
   * as a hint to invalidate rather than as authoritative data.
   */
  row: Partial<MicroTaskRecord> | null;
};

export function subscribeMicroTasks(
  userId: string,
  onChange: (payload: MicroTaskRealtimePayload) => void,
): () => void {
  if (!supabase) return () => undefined;

  const channel = supabase
    .channel(`micro-tasks-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'micro_tasks',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const event = payload.eventType as MicroTaskRealtimeEvent;
        const row =
          event === 'DELETE'
            ? (payload.old as Partial<MicroTaskRecord>)
            : (payload.new as Partial<MicroTaskRecord>);
        onChange({ event, row: row ?? null });
      },
    )
    .subscribe();

  return () => {
    void supabase!.removeChannel(channel);
  };
}
