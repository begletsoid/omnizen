import { nanoid } from 'nanoid';

import { supabase } from '../../lib/supabaseClient';

export type ProfileRecord = {
  id: string;
  timezone: string | null;
  last_bedtime_at: string | null;
  sleep_webhook_token: string | null;
  voice_webhook_token: string | null;
  voice_target_widget_id: string | null;
  voice_intent_rules: Record<string, string>;
};

function requireSupabase() {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase;
}

export async function fetchProfile(userId: string): Promise<ProfileRecord | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('profiles')
    .select(
      'id, timezone, last_bedtime_at, sleep_webhook_token, voice_webhook_token, voice_target_widget_id, voice_intent_rules',
    )
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...(data as Omit<ProfileRecord, 'voice_intent_rules'>),
    voice_intent_rules:
      ((data as { voice_intent_rules?: Record<string, string> | null })
        .voice_intent_rules) ?? {},
  };
}

export async function updateProfileTimezone(userId: string, timezone: string) {
  const client = requireSupabase();
  const { error } = await client
    .from('profiles')
    .update({ timezone })
    .eq('id', userId);
  if (error) throw error;
}

/**
 * Ensure the profile has a non-empty webhook token. If the token is already
 * set, returns the existing one. Otherwise generates a fresh one and stores
 * it. The token is opaque and only used to authenticate the sleep webhook.
 */
export async function ensureSleepWebhookToken(userId: string): Promise<string> {
  const client = requireSupabase();
  const existing = await fetchProfile(userId);
  if (existing?.sleep_webhook_token) return existing.sleep_webhook_token;
  const token = `omz_${nanoid(28)}`;
  const { error } = await client
    .from('profiles')
    .update({ sleep_webhook_token: token })
    .eq('id', userId);
  if (error) throw error;
  return token;
}

export async function rotateSleepWebhookToken(userId: string): Promise<string> {
  const client = requireSupabase();
  const token = `omz_${nanoid(28)}`;
  const { error } = await client
    .from('profiles')
    .update({ sleep_webhook_token: token })
    .eq('id', userId);
  if (error) throw error;
  return token;
}

/** Same shape as sleep webhook — separate token because the user may want to
 * rotate one without affecting the other (e.g. swap iPhone or revoke voice
 * access while keeping sleep auto-cleanup). */
export async function ensureVoiceWebhookToken(userId: string): Promise<string> {
  const client = requireSupabase();
  const existing = await fetchProfile(userId);
  if (existing?.voice_webhook_token) return existing.voice_webhook_token;
  const token = `omz_${nanoid(28)}`;
  const { error } = await client
    .from('profiles')
    .update({ voice_webhook_token: token })
    .eq('id', userId);
  if (error) throw error;
  return token;
}

export async function rotateVoiceWebhookToken(userId: string): Promise<string> {
  const client = requireSupabase();
  const token = `omz_${nanoid(28)}`;
  const { error } = await client
    .from('profiles')
    .update({ voice_webhook_token: token })
    .eq('id', userId);
  if (error) throw error;
  return token;
}

export async function updateVoiceTargetWidget(
  userId: string,
  widgetId: string | null,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('profiles')
    .update({ voice_target_widget_id: widgetId })
    .eq('id', userId);
  if (error) throw error;
}
