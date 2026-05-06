-- Voice-driven micro-task pipeline.
--
-- Architecture (see docs/voice-microtask-plan.md):
-- iPhone Action Button → iOS Shortcut records audio → POSTs multipart to
-- /api/voice-microtask-webhook → Netlify function uploads to Storage,
-- transcribes (Groq Whisper), classifies via LLM into {intent, payload},
-- dispatches to RPCs (pause running task, create new, attach categories,
-- start timer). Frontend listens via Supabase Realtime on this table and
-- invalidates micro_tasks query when a row hits status='applied'.

begin;

-- 1. Profile columns ---------------------------------------------------------
alter table public.profiles
  add column if not exists voice_webhook_token text,
  add column if not exists voice_target_widget_id uuid
    references public.widgets(id) on delete set null,
  add column if not exists voice_intent_rules jsonb not null default '{}'::jsonb;

-- Single endpoint dispatches by token alone — match the sleep_webhook_token
-- pattern (same migration: 20260424000000_eod_cleanup.sql).
create unique index if not exists profiles_voice_webhook_token_key
  on public.profiles (voice_webhook_token)
  where voice_webhook_token is not null;

-- 2. voice_transcriptions table ---------------------------------------------
-- Every voice command is one row. We persist raw audio path, raw transcript,
-- and full LLM output even on partial failures so nothing is lost — the user
-- can replay/inspect from a future History UI.
create table if not exists public.voice_transcriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  audio_path text not null,
  audio_duration_ms integer,
  raw_transcript text,
  llm_output jsonb,
  applied_intent text,
  applied_payload jsonb,
  applied_task_id uuid references public.micro_tasks(id) on delete set null,
  paused_task_id uuid references public.micro_tasks(id) on delete set null,
  -- Status enum:
  --   received: row created, audio uploaded, processing not yet started.
  --   processing: STT/LLM/apply in progress (transient).
  --   applied: end-to-end success.
  --   error_stt: speech-to-text failed for both providers.
  --   error_llm: LLM call failed for both providers OR returned invalid JSON.
  --   error_apply: dispatcher / RPC error.
  --   error_hallucination: transcript looks like Whisper noise (silence/fillers).
  --   error_quota: per-user daily limit reached.
  --   error_unknown_intent: LLM returned an intent not yet supported by dispatcher.
  status text not null default 'received'
    check (status in (
      'received', 'processing', 'applied',
      'error_stt', 'error_llm', 'error_apply',
      'error_hallucination', 'error_quota', 'error_unknown_intent'
    )),
  error_detail text,
  -- Client-generated UUID per recording. iOS Shortcut auto-retries on 5xx, so
  -- we dedupe at the webhook entry: if a row already exists with this key,
  -- return its prior result instead of creating a duplicate task.
  idempotency_key text not null unique,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists voice_transcriptions_user_created_idx
  on public.voice_transcriptions (user_id, created_at desc);

create index if not exists voice_transcriptions_user_status_idx
  on public.voice_transcriptions (user_id, status);

-- 3. RLS ---------------------------------------------------------------------
alter table public.voice_transcriptions enable row level security;

drop policy if exists "voice_transcriptions_owner_read" on public.voice_transcriptions;
create policy "voice_transcriptions_owner_read" on public.voice_transcriptions
  for select using (user_id = auth.uid());

-- INSERT/UPDATE/DELETE are service-role only (webhook function). No client-side
-- write policy — frontend is read-only on this table.

-- 4. Storage bucket ----------------------------------------------------------
-- Private bucket; signed URLs only (used by future History UI to play audio).
insert into storage.buckets (id, name, public)
values ('voice-recordings', 'voice-recordings', false)
on conflict (id) do nothing;

-- Service-role full access (used by Netlify webhook with service-role key).
drop policy if exists "voice_recordings_service_role_all" on storage.objects;
create policy "voice_recordings_service_role_all" on storage.objects
  for all
  to service_role
  using (bucket_id = 'voice-recordings')
  with check (bucket_id = 'voice-recordings');

-- Owner can read their own audio (path convention: <user_id>/<yyyy-mm>/<file>).
drop policy if exists "voice_recordings_owner_read" on storage.objects;
create policy "voice_recordings_owner_read" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'voice-recordings'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- 5. Realtime publication ----------------------------------------------------
-- Enable Realtime so the frontend can subscribe to voice_transcriptions UPDATE
-- events and react to status='applied' / 'error_*' without polling.
do $$
begin
  alter publication supabase_realtime add table public.voice_transcriptions;
exception when duplicate_object then
  null;
end$$;

-- 6. updated_at trigger ------------------------------------------------------
create or replace function public.touch_voice_transcriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_voice_transcriptions_updated_at on public.voice_transcriptions;
create trigger trg_voice_transcriptions_updated_at
  before update on public.voice_transcriptions
  for each row execute function public.touch_voice_transcriptions_updated_at();

commit;
