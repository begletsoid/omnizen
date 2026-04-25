import { createClient } from '@supabase/supabase-js';

/**
 * Accepts sleep data pushed from iOS Shortcuts.
 *
 * Request:
 *   POST /api/sleep-webhook
 *   Content-Type: application/json
 *   Authorization: Bearer <token>   (alternatively in body as { token })
 *   { "bedtime_at": "2026-04-23T01:20:00Z" }
 *
 * Response: 204 on success, 401 on bad token, 400 on bad payload.
 *
 * Token is the value of `profiles.sleep_webhook_token` (rotate-able in the
 * app's Settings modal). On success we store `bedtime_at` in
 * `profiles.last_bedtime_at`; the 04:30 pg_cron reads it there.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const tokenFromHeader = authHeader.replace(/^Bearer\s+/i, '').trim();
  const tokenFromBody = typeof body.token === 'string' ? body.token : '';
  const token = tokenFromBody || tokenFromHeader;
  if (!token) {
    return new Response('Missing token', { status: 401 });
  }

  const bedtimeRaw = body.bedtime_at;
  if (typeof bedtimeRaw !== 'string') {
    return new Response('Missing bedtime_at', { status: 400 });
  }
  const bedtimeDate = new Date(bedtimeRaw);
  if (Number.isNaN(bedtimeDate.getTime())) {
    return new Response('Invalid bedtime_at', { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return new Response('Server misconfigured', { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: findError } = await supabase
    .from('profiles')
    .select('id')
    .eq('sleep_webhook_token', token)
    .maybeSingle();

  if (findError) {
    return new Response('Database error', { status: 500 });
  }
  if (!profile) {
    return new Response('Invalid token', { status: 401 });
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ last_bedtime_at: bedtimeDate.toISOString() })
    .eq('id', profile.id);

  if (updateError) {
    return new Response(updateError.message, { status: 500 });
  }

  return new Response(null, { status: 204 });
}

export const config = {
  path: '/api/sleep-webhook',
};
