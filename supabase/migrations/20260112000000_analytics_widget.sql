-- Analytics widget schema: settings per user and timers
set check_function_bodies = off;

create table if not exists public.analytics_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.analytics_timers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  color text,
  days_mask bit(7) not null default B'1111111', -- ISO week: Mon=bit1 ... Sun=bit7
  tag_ids uuid[] not null default '{}'::uuid[],
  category_ids uuid[] not null default '{}'::uuid[],
  sort_order integer not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists analytics_timers_user_id_idx on public.analytics_timers(user_id);
create index if not exists analytics_timers_user_sort_idx on public.analytics_timers(user_id, sort_order);

alter table public.analytics_settings enable row level security;
alter table public.analytics_timers enable row level security;

create policy "analytics_settings_select_owner"
  on public.analytics_settings
  for select
  using (auth.uid() = user_id);

create policy "analytics_settings_insert_owner"
  on public.analytics_settings
  for insert
  with check (auth.uid() = user_id);

create policy "analytics_settings_update_owner"
  on public.analytics_settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "analytics_settings_delete_owner"
  on public.analytics_settings
  for delete
  using (auth.uid() = user_id);

create policy "analytics_timers_select_owner"
  on public.analytics_timers
  for select
  using (auth.uid() = user_id);

create policy "analytics_timers_insert_owner"
  on public.analytics_timers
  for insert
  with check (auth.uid() = user_id);

create policy "analytics_timers_update_owner"
  on public.analytics_timers
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "analytics_timers_delete_owner"
  on public.analytics_timers
  for delete
  using (auth.uid() = user_id);
