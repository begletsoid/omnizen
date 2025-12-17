alter table public.habits
  add column if not exists success_count integer not null default 0,
  add column if not exists fail_count integer not null default 0,
  add column if not exists success_updated_at timestamptz not null default timezone('utc', now());



