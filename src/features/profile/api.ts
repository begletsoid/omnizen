import { nanoid } from 'nanoid';

import { supabase } from '../../lib/supabaseClient';

export type ProfileRecord = {
  id: string;
  timezone: string | null;
  last_bedtime_at: string | null;
  sleep_webhook_token: string | null;
};

function requireSupabase() {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase;
}

export async function fetchProfile(userId: string): Promise<ProfileRecord | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('profiles')
    .select('id, timezone, last_bedtime_at, sleep_webhook_token')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileRecord | null) ?? null;
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
