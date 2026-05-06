/**
 * Supabase Realtime subscription for voice_transcriptions.
 *
 * Why: the webhook pipeline takes 3-5s and finishes asynchronously w.r.t. the
 * dashboard tab. Without Realtime the UI would only catch up on the next
 * 10s polling tick — that's not "instant" enough for the voice UX.
 *
 * Subscription strategy: one channel per signed-in user, filtered by user_id.
 * On every voice_transcriptions UPDATE we route to onApplied or onError based
 * on the new status. Caller is responsible for invalidating the relevant
 * react-query caches (micro_tasks, etc.) inside its callback.
 */

import { supabase } from '../../lib/supabaseClient';
import type { Database } from './types';

export type VoiceTranscriptionRow = Database['voice_transcriptions'];

export type VoiceRealtimeHandlers = {
  onApplied: (row: VoiceTranscriptionRow) => void;
  onError: (row: VoiceTranscriptionRow) => void;
};

const ERROR_STATUSES = new Set<string>([
  'error_stt',
  'error_llm',
  'error_apply',
  'error_hallucination',
  'error_quota',
  'error_unknown_intent',
]);

export function subscribeVoiceTranscriptions(
  userId: string,
  handlers: VoiceRealtimeHandlers,
): () => void {
  if (!supabase) return () => undefined;

  const channel = supabase
    .channel(`voice-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'voice_transcriptions',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as VoiceTranscriptionRow;
        if (!row || typeof row.status !== 'string') return;
        if (row.status === 'applied') handlers.onApplied(row);
        else if (ERROR_STATUSES.has(row.status)) handlers.onError(row);
      },
    )
    .subscribe();

  return () => {
    void supabase!.removeChannel(channel);
  };
}
