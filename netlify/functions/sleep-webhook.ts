import { createClient } from '@supabase/supabase-js';

import {
  detectBedtime,
  detectBedtimeFromTimestamps,
  type StepSample,
} from '../../src/lib/detectBedtime';

/**
 * Accepts sleep/activity data pushed from iOS Shortcuts and runs the end-of-day
 * cleanup right away.
 *
 * Three payload shapes are accepted (priority order):
 *
 * 1. Structured step samples (most accurate):
 *      { "step_samples": [{ "start": "...", "end": "...", "value": 200 }, ...] }
 *
 * 2. Flat list of step-sample START times — much simpler to build in iOS
 *    Shortcuts (just Find Health Samples → Get Start → Format Date → POST):
 *      { "timestamps": ["2026-04-25T22:30:00+03:00", "2026-04-25T22:32:00+03:00", ...] }
 *
 *    OR — same thing wrapped in a `bedtime_at` field as a multi-line string,
 *    which is what falls out naturally from Format Date applied to a list:
 *      { "bedtime_at": "2026-04-25T22:30:00+03:00\n2026-04-25T22:32:00+03:00\n..." }
 *
 *    For both 2 variants the server runs the simplified (timestamp-only)
 *    detection.
 *
 * 3. Pre-computed bedtime (legacy):
 *      { "bedtime_at": "2026-04-23T01:20:00Z" }
 *
 * Auth:
 *   Authorization: Bearer <token>   (or { "token": "..." } in body)
 *
 * On success we store the resolved bedtime in `profiles.last_bedtime_at` AND
 * immediately fire `eod_cleanup_user`. The cleanup RPC's own double-run guard
 * prevents back-to-back cleanups if the user re-runs the Shortcut.
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

  // Resolve bedtime. Try inputs in priority order:
  //   1) structured step_samples — best accuracy
  //   2) flat list of timestamps (in `timestamps` field or as a multi-line
  //      `bedtime_at` string from iOS Format Date over a list)
  //   3) single ISO bedtime_at — legacy
  const now = new Date();
  let bedtimeDate: Date;
  let detectionSummary: {
    mode: 'detected_from_steps' | 'detected_from_timestamps' | 'explicit';
    confidence?: string;
    samples_count?: number;
  };

  if (Array.isArray(body.step_samples)) {
    const samples = (body.step_samples as unknown[]).filter(
      (s): s is StepSample =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as StepSample).start === 'string' &&
        typeof (s as StepSample).end === 'string' &&
        typeof (s as StepSample).value === 'number',
    );
    if (samples.length === 0) {
      return new Response('Empty or malformed step_samples', { status: 400 });
    }
    const result = detectBedtime(samples, now);
    if (result.kind !== 'detected') {
      return new Response(`Could not detect bedtime: ${result.reason}`, { status: 422 });
    }
    bedtimeDate = result.bedtime;
    detectionSummary = {
      mode: 'detected_from_steps',
      confidence: result.confidence,
      samples_count: samples.length,
    };
  } else if (Array.isArray(body.timestamps)) {
    const timestamps = (body.timestamps as unknown[]).filter(
      (t): t is string => typeof t === 'string',
    );
    if (timestamps.length === 0) {
      return new Response('Empty or malformed timestamps', { status: 400 });
    }
    const result = detectBedtimeFromTimestamps(timestamps, now);
    if (result.kind !== 'detected') {
      return new Response(`Could not detect bedtime: ${result.reason}`, { status: 422 });
    }
    bedtimeDate = result.bedtime;
    detectionSummary = {
      mode: 'detected_from_timestamps',
      confidence: result.confidence,
      samples_count: timestamps.length,
    };
  } else if (typeof body.bedtime_at === 'string') {
    // iOS Shortcuts "Format Date" applied to a list returns a single string
    // with each formatted date on its own line. Split on any whitespace
    // separator and treat as a list IF we got more than one timestamp.
    const lines = body.bedtime_at
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (lines.length > 1) {
      const result = detectBedtimeFromTimestamps(lines, now);
      if (result.kind !== 'detected') {
        return new Response(`Could not detect bedtime: ${result.reason}`, { status: 422 });
      }
      bedtimeDate = result.bedtime;
      detectionSummary = {
        mode: 'detected_from_timestamps',
        confidence: result.confidence,
        samples_count: lines.length,
      };
    } else {
      // Single ISO string — legacy explicit bedtime.
      const parsed = new Date(body.bedtime_at);
      if (Number.isNaN(parsed.getTime())) {
        return new Response('Invalid bedtime_at', { status: 400 });
      }
      bedtimeDate = parsed;
      detectionSummary = { mode: 'explicit' };
    }
  } else {
    return new Response('Missing step_samples, timestamps, or bedtime_at', { status: 400 });
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

  // Fire cleanup right away — bedtime arriving is the signal that the user
  // just woke up. We deliberately don't await/check the RPC error: if it fails
  // (transient DB hiccup, etc.) the bedtime was still saved, and the user can
  // re-trigger by re-running the Shortcut. The RPC's own log table records
  // success/failure, so we don't need to surface it in the HTTP response.
  await supabase.rpc('eod_cleanup_user', { p_user_id: profile.id });

  // Return JSON so the iPhone side gets useful feedback (resolved bedtime +
  // detection mode) — handy for the "Show Notification" debug step in the
  // Shortcut. Existing 204 callers still tolerate a 200 with body.
  return new Response(
    JSON.stringify({
      bedtime_at: bedtimeDate.toISOString(),
      ...detectionSummary,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

export const config = {
  path: '/api/sleep-webhook',
};
