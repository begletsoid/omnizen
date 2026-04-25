-- End-of-day cleanup: automatically pause the lone running micro task and
-- archive/delete everything else at 04:30 user-local, but only when Apple
-- Watch sleep data tells us when the user actually went to bed. Without a
-- recent `last_bedtime_at` the cron does nothing — we'd rather leave yesterday's
-- clutter than guess and wipe something real.

begin;

-- 1. Profile columns.
alter table public.profiles
  add column if not exists timezone text default 'UTC',
  add column if not exists last_bedtime_at timestamptz,
  add column if not exists sleep_webhook_token text;

-- Unique per user, so a single webhook endpoint can route by token alone.
create unique index if not exists profiles_sleep_webhook_token_key
  on public.profiles (sleep_webhook_token)
  where sleep_webhook_token is not null;

-- 2. Audit log. Every tick writes either a completed cleanup or a skip reason,
-- so we can diff behaviour day-to-day and trust the cron.
create table if not exists public.eod_cleanup_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ran_at timestamptz not null default timezone('utc', now()),
  bedtime_at timestamptz,
  tasks_archived integer not null default 0,
  tasks_deleted integer not null default 0,
  groups_deleted integer not null default 0,
  skipped_reason text
);
create index if not exists eod_cleanup_log_user_ran_idx
  on public.eod_cleanup_log (user_id, ran_at desc);

alter table public.eod_cleanup_log enable row level security;

drop policy if exists "Cleanup log owned by user" on public.eod_cleanup_log;
create policy "Cleanup log owned by user" on public.eod_cleanup_log
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3. Per-user cleanup routine. Separate from the tick so we can unit-test it
-- by invoking it directly with a fake "now" in smoke / psql.
create or replace function public.eod_cleanup_user(p_user_id uuid, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_bedtime timestamptz;
  v_archived integer := 0;
  v_deleted integer := 0;
  v_groups integer := 0;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    return;
  end if;

  v_bedtime := v_profile.last_bedtime_at;

  -- Only act on bedtime data that is actually from this past night.
  if v_bedtime is null or v_bedtime < p_now - interval '24 hours' or v_bedtime > p_now then
    insert into public.eod_cleanup_log (user_id, ran_at, bedtime_at, skipped_reason)
      values (p_user_id, p_now, v_bedtime, 'no_recent_bedtime');
    return;
  end if;

  -- Double-run guard: don't re-clean within 4 hours of a successful run.
  if exists (
    select 1 from public.eod_cleanup_log
    where user_id = p_user_id
      and ran_at > p_now - interval '4 hours'
      and skipped_reason is null
  ) then
    insert into public.eod_cleanup_log (user_id, ran_at, bedtime_at, skipped_reason)
      values (p_user_id, p_now, v_bedtime, 'already_ran_today');
    return;
  end if;

  -- 1. Pause the running task (there is at most one per widget thanks to the
  -- partial unique index on `timer_state = 'running'`). Clamp elapsed_seconds
  -- using the time the user actually went to bed — anything after that was
  -- a forgotten timer.
  update public.micro_tasks
     set elapsed_seconds = elapsed_seconds
           + greatest(0, floor(extract(epoch from least(v_bedtime, p_now) - last_started_at))::bigint),
         last_started_at = null,
         timer_state = 'paused'
   where user_id = p_user_id
     and timer_state = 'running'
     and last_started_at is not null;

  -- 2. Archive everything with >=5s on the clock. Keeps done/undone distinction
  -- irrelevant here — the idea is the user intended to work on it, so it's a
  -- real artefact of the day.
  with archived as (
    update public.micro_tasks
       set archived_at = p_now,
           is_done = true
     where user_id = p_user_id
       and archived_at is null
       and elapsed_seconds >= 5
    returning 1
  )
  select count(*)::integer into v_archived from archived;

  -- 3. Delete tasks with <5s — noise the user never really touched.
  with deleted as (
    delete from public.micro_tasks
     where user_id = p_user_id
       and archived_at is null
       and elapsed_seconds < 5
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;

  -- 4. Groups whose tasks all got archived above become empty shells; drop them.
  with g as (
    delete from public.micro_task_groups grp
     where grp.user_id = p_user_id
       and not exists (
         select 1 from public.micro_tasks t
         where t.group_id = grp.id and t.archived_at is null
       )
    returning 1
  )
  select count(*)::integer into v_groups from g;

  insert into public.eod_cleanup_log
    (user_id, ran_at, bedtime_at, tasks_archived, tasks_deleted, groups_deleted)
    values (p_user_id, p_now, v_bedtime, v_archived, v_deleted, v_groups);
end;
$$;

-- 4. Tick: find users whose local time is in [04:30, 04:45] and call per-user
-- cleanup. Runs every 15 minutes via pg_cron.
create or replace function public.eod_cleanup_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  v_local_minute integer;
  v_now timestamptz := now();
begin
  for u in
    select id, coalesce(timezone, 'UTC') as tz
      from public.profiles
  loop
    begin
      v_local_minute := (extract(hour from v_now at time zone u.tz) * 60
                       + extract(minute from v_now at time zone u.tz))::integer;
    exception when others then
      continue; -- skip malformed timezone strings
    end;
    -- 04:30..04:44 inclusive.
    if v_local_minute between 270 and 284 then
      perform public.eod_cleanup_user(u.id, v_now);
    end if;
  end loop;
end;
$$;

grant execute on function public.eod_cleanup_user(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.eod_cleanup_tick() to service_role;

-- 5. Schedule. pg_cron is preinstalled on Supabase since 2023 on all plans.
create extension if not exists pg_cron;

-- Unschedule any previous registration (idempotent re-apply).
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'omnizen-eod-cleanup';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end$$;

select cron.schedule(
  'omnizen-eod-cleanup',
  '*/15 * * * *',
  $cron$select public.eod_cleanup_tick()$cron$
);

commit;
