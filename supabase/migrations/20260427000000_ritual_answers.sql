-- Persist each Ritual step answer to its own row. Captured at the moment the
-- user presses "Next" so the timestamp reflects when they actually answered,
-- not when the day rolled over. Stores the user's local timezone so future
-- analytics ("how does my mood at 09:00 compare on Mondays?") can pick a
-- canonical clock to bucket on.

begin;

create table if not exists public.ritual_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- "Day" key as the widget computed it (4:30 AM cutoff, e.g. "2026-04-25").
  day_key text not null,
  -- Logical set/step IDs the widget already maintains in widgets.config.
  -- We don't FK them — sets/steps live inside a JSON config blob, not a
  -- separate table — so renaming or removing a set won't cascade-delete
  -- historical answers.
  set_id text not null,
  set_name text not null,
  step_id text not null,
  step_type text not null check (step_type in ('reminder', 'scale', 'trio')),
  prompt text not null,
  -- Mixed value: number for scale (0-10), string for trio (yes/mid/no), null
  -- for reminder steps (a reminder has no answer; we still record the row to
  -- mark "user saw the prompt").
  value jsonb,
  -- When the user pressed Next, in UTC.
  answered_at timestamptz not null default now(),
  -- IANA tz the browser reported (Intl.DateTimeFormat().resolvedOptions().timeZone).
  -- Keeps the "what time of day was this?" question answerable later.
  client_timezone text,
  created_at timestamptz not null default now()
);

create index if not exists ritual_answers_user_day_idx
  on public.ritual_answers (user_id, day_key);
create index if not exists ritual_answers_user_step_idx
  on public.ritual_answers (user_id, step_id, answered_at desc);

alter table public.ritual_answers enable row level security;

create policy "ritual_answers_owner_read"
  on public.ritual_answers for select using (auth.uid() = user_id);
create policy "ritual_answers_owner_insert"
  on public.ritual_answers for insert with check (auth.uid() = user_id);
-- No update/delete: we want an immutable audit trail of past answers.
-- (If the user ever re-answers a step in the same day, we just add another row.)

commit;
