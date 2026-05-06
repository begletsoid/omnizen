// Quick read-only helper: dump the last 10 voice_transcriptions rows.
// Run with: `node scripts/voice-logs.mjs`
// Requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from('voice_transcriptions')
  .select('id, status, raw_transcript, applied_intent, applied_task_id, paused_task_id, error_detail, audio_duration_ms, created_at, processed_at, idempotency_key')
  .order('created_at', { ascending: false })
  .limit(10);

if (error) {
  console.error('Query failed:', error.message);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.log('No voice_transcriptions rows yet.');
  process.exit(0);
}

console.log(`Last ${data.length} voice_transcriptions rows (newest first):\n`);
for (const row of data) {
  const elapsed = row.processed_at && row.created_at
    ? `${new Date(row.processed_at).getTime() - new Date(row.created_at).getTime()}ms`
    : '-';
  console.log(`[${row.created_at}] status=${row.status} elapsed=${elapsed}`);
  console.log(`  id=${row.id}`);
  console.log(`  idempotency_key=${row.idempotency_key}`);
  if (row.audio_duration_ms !== null) console.log(`  audio_duration_ms=${row.audio_duration_ms}`);
  if (row.raw_transcript) console.log(`  transcript: "${row.raw_transcript}"`);
  if (row.applied_intent) console.log(`  applied_intent=${row.applied_intent}`);
  if (row.applied_task_id) console.log(`  applied_task_id=${row.applied_task_id}`);
  if (row.paused_task_id) console.log(`  paused_task_id=${row.paused_task_id}`);
  if (row.error_detail) console.log(`  ERROR: ${row.error_detail}`);
  console.log('');
}
