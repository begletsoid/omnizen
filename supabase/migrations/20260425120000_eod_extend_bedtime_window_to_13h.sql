-- Extend the bedtime freshness check from 8h to 13h. The cleanup runs at 04:30
-- local time, but a long sleep (e.g. went to bed at 14:00, woke up at 04:00 —
-- 14h gap minus the 30 min before the cleanup tick) would otherwise be rejected
-- as 'no_recent_bedtime'. 13h covers any realistic sleep length while still
-- catching obviously-stale data (yesterday's wakeup, midday nap from a day
-- earlier, etc).

begin;

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

  -- Must be within 13 hours of "now" and not in the future. Anything older is
  -- assumed stale (a previous night's bedtime, or a wake-up time accidentally
  -- stored as bedtime) — safer to skip than to clamp against it.
  if v_bedtime is null
     or v_bedtime < p_now - interval '13 hours'
     or v_bedtime > p_now then
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

  update public.micro_tasks
     set elapsed_seconds = elapsed_seconds
           + greatest(0, floor(extract(epoch from least(v_bedtime, p_now) - last_started_at))::bigint),
         last_started_at = null,
         timer_state = 'paused'
   where user_id = p_user_id
     and timer_state = 'running'
     and last_started_at is not null;

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

  with deleted as (
    delete from public.micro_tasks
     where user_id = p_user_id
       and archived_at is null
       and elapsed_seconds < 5
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;

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

commit;
