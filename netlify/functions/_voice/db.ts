/**
 * Service-role Supabase client + voice_transcriptions row helpers.
 *
 * The webhook bypasses RLS via SUPABASE_SERVICE_ROLE_KEY (same pattern as
 * netlify/functions/sleep-webhook.ts:48). Every helper here narrows the row
 * to a few well-defined shapes so the webhook handler doesn't have to build
 * raw inserts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AppliedActionRecord, LlmActionPlan, VoiceStatus } from './types';

export function getServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ProfileForVoice = {
  id: string;
  voice_target_widget_id: string | null;
  voice_target_goals_widget_id: string | null;
  voice_intent_rules: Record<string, string>;
};

/**
 * Resolve user via voice_webhook_token (same lookup pattern as sleep-webhook).
 * Returns null when token is invalid (caller responds 401).
 */
export async function findProfileByVoiceToken(
  supabase: SupabaseClient,
  token: string,
): Promise<ProfileForVoice | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, voice_target_widget_id, voice_target_goals_widget_id, voice_intent_rules',
    )
    .eq('voice_webhook_token', token)
    .maybeSingle();
  if (error) throw new Error(`Profile lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    voice_target_widget_id: data.voice_target_widget_id ?? null,
    voice_target_goals_widget_id: data.voice_target_goals_widget_id ?? null,
    voice_intent_rules:
      (data.voice_intent_rules as Record<string, string> | null) ?? {},
  };
}

/**
 * Idempotency check. iOS Shortcut auto-retries on 5xx; if the same
 * Idempotency-Key already produced an outcome we return that prior row
 * verbatim instead of running the pipeline twice.
 */
export async function findExistingByIdempotency(
  supabase: SupabaseClient,
  idempotencyKey: string,
): Promise<{ id: string; status: VoiceStatus } | null> {
  const { data, error } = await supabase
    .from('voice_transcriptions')
    .select('id, status')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw new Error(`Idempotency lookup failed: ${error.message}`);
  if (!data) return null;
  return { id: data.id, status: data.status as VoiceStatus };
}

/**
 * Daily usage cap (matches plan: "200/day per user"). Cheap defence against
 * a runaway shortcut loop racking up Whisper/LLM costs.
 */
export async function countTodayForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('voice_transcriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);
  if (error) throw new Error(`Daily count failed: ${error.message}`);
  return count ?? 0;
}

export type CreatedRow = { id: string };

export async function insertReceivedRow(
  supabase: SupabaseClient,
  args: {
    userId: string;
    audioPath: string;
    audioDurationMs: number | null;
    idempotencyKey: string;
  },
): Promise<CreatedRow> {
  const { data, error } = await supabase
    .from('voice_transcriptions')
    .insert({
      user_id: args.userId,
      audio_path: args.audioPath,
      audio_duration_ms: args.audioDurationMs,
      idempotency_key: args.idempotencyKey,
      status: 'received' satisfies VoiceStatus,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Insert failed: ${error.message}`);
  return { id: data.id };
}

/** Generic row-update — used by every pipeline stage. */
export async function updateRow(
  supabase: SupabaseClient,
  rowId: string,
  patch: {
    status?: VoiceStatus;
    raw_transcript?: string | null;
    llm_output?: LlmActionPlan | null;
    applied_intent?: string | null;
    applied_payload?: Record<string, unknown> | null;
    applied_task_id?: string | null;
    paused_task_id?: string | null;
    /** Phase 2: full action history for the row. */
    applied_actions?: AppliedActionRecord[] | null;
    /** Phase 2: human-readable summary the iOS notification displays. */
    applied_summary?: string | null;
    /** Phase 2: undo bookkeeping. */
    undid_transcription_id?: string | null;
    error_detail?: string | null;
    processed_at?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from('voice_transcriptions')
    .update(patch)
    .eq('id', rowId);
  if (error) throw new Error(`Update failed: ${error.message}`);
}
