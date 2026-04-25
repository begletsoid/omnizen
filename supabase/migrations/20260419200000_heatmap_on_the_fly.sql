-- Replace the log-based heatmap storage with on-the-fly aggregation.
-- Time is attributed to `micro_tasks.created_at::date`; points for completed goals
-- are redistributed proportionally to per-day time on every query.

begin;

-- Drop denormalized storage introduced in 20260419150000_heatmap_and_time_logs.sql
drop trigger if exists goal_points_recompute on public.goals;
drop function if exists public.handle_goal_points_recompute();
drop function if exists public.distribute_goal_points(uuid);
drop function if exists public.get_heatmap_day_details(date);
drop table if exists public.goal_daily_points;
drop table if exists public.micro_task_time_logs;

-- Revert pause_micro_task_timer to the original implementation (no log side-effect).
create or replace function public.pause_micro_task_timer(p_task_id uuid)
returns public.micro_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_task public.micro_tasks%rowtype;
  v_increment bigint := 0;
begin
  select * into v_task
    from public.micro_tasks
    where id = p_task_id
      and user_id = auth.uid()
    for update;

  if not found then
    raise exception 'Micro task % not found or not owned by user', p_task_id
      using errcode = 'P0001';
  end if;

  if v_task.timer_state <> 'running' then
    return v_task;
  end if;

  v_increment := coalesce(extract(epoch from (v_now - v_task.last_started_at)), 0)::bigint;

  update public.micro_tasks
     set elapsed_seconds = elapsed_seconds + v_increment,
         last_started_at = null,
         timer_state = 'paused'
   where id = v_task.id
   returning * into v_task;

  return v_task;
end;
$$;

-- Revert start_micro_task_timer similarly.
create or replace function public.start_micro_task_timer(p_task_id uuid)
returns public.micro_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_task public.micro_tasks%rowtype;
begin
  select * into v_task
    from public.micro_tasks
    where id = p_task_id
      and user_id = auth.uid()
    for update;

  if not found then
    raise exception 'Micro task % not found or not owned by user', p_task_id
      using errcode = 'P0001';
  end if;

  update public.micro_tasks
     set elapsed_seconds = elapsed_seconds + coalesce(extract(epoch from (v_now - last_started_at)), 0)::bigint,
         last_started_at = null,
         timer_state = 'paused'
   where widget_id = v_task.widget_id
     and user_id = v_task.user_id
     and timer_state = 'running'
     and id <> v_task.id;

  if v_task.timer_state = 'running' then
    return v_task;
  end if;

  update public.micro_tasks
     set last_started_at = v_now,
         timer_state = 'running'
   where id = v_task.id
   returning * into v_task;

  return v_task;
end;
$$;

-- Aggregated view reused by both heatmap RPCs: per (goal_id, day) time sums.
-- Days are derived from micro_tasks.created_at in the session time zone.
-- Only counts tasks linked to a goal with elapsed_seconds > 0.
create or replace function public.get_heatmap_period(p_from date, p_to date)
returns table (
  day date,
  points integer,
  seconds bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with task_days as (
    select
      t.goal_id,
      t.created_at::date as day,
      t.elapsed_seconds
    from public.micro_tasks t
    where t.user_id = auth.uid()
      and t.goal_id is not null
      and t.elapsed_seconds > 0
  ),
  goal_day_times as (
    select td.goal_id, td.day, sum(td.elapsed_seconds)::bigint as day_seconds
      from task_days td
      join public.goals g on g.id = td.goal_id
     where g.is_done = true and g.value > 0
     group by td.goal_id, td.day
  ),
  goal_totals as (
    select goal_id, sum(day_seconds)::bigint as total_seconds
      from goal_day_times
     group by goal_id
  ),
  goal_day_base as (
    select
      gdt.goal_id,
      gdt.day,
      g.value,
      gdt.day_seconds,
      floor(g.value::numeric * gdt.day_seconds / gt.total_seconds)::integer as base_points,
      (gdt.day = max(gdt.day) over (partition by gdt.goal_id)) as is_last
    from goal_day_times gdt
    join goal_totals gt on gt.goal_id = gdt.goal_id
    join public.goals g on g.id = gdt.goal_id
  ),
  goal_distributed as (
    select goal_id, sum(base_points)::integer as distributed_sum
      from goal_day_base
     group by goal_id
  ),
  goal_day_points as (
    select
      gdb.goal_id,
      gdb.day,
      case when gdb.is_last then gdb.base_points + (gdb.value - gd.distributed_sum)
           else gdb.base_points end as points
    from goal_day_base gdb
    join goal_distributed gd on gd.goal_id = gdb.goal_id
  ),
  day_points as (
    select day, sum(points)::integer as points
      from goal_day_points
     where day between p_from and p_to
     group by day
  ),
  day_seconds as (
    select td.day, sum(td.elapsed_seconds)::bigint as seconds
      from task_days td
     where td.day between p_from and p_to
     group by td.day
  )
  select
    d.day,
    coalesce(dp.points, 0)::integer as points,
    coalesce(ds.seconds, 0)::bigint as seconds
  from (
    select day from day_points
    union
    select day from day_seconds
  ) d
  left join day_points dp on dp.day = d.day
  left join day_seconds ds on ds.day = d.day
  order by d.day;
$$;

grant execute on function public.get_heatmap_period(date, date) to authenticated;

-- Day-level drilldown: goals that had activity on p_day (either points or time).
create or replace function public.get_heatmap_day_details(p_day date)
returns table (
  goal_id uuid,
  title text,
  value integer,
  points_today integer,
  seconds_today bigint,
  seconds_total bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with task_days as (
    select
      t.goal_id,
      t.created_at::date as day,
      t.elapsed_seconds
    from public.micro_tasks t
    where t.user_id = auth.uid()
      and t.goal_id is not null
      and t.elapsed_seconds > 0
  ),
  goal_day_times as (
    select td.goal_id, td.day, sum(td.elapsed_seconds)::bigint as day_seconds
      from task_days td
      join public.goals g on g.id = td.goal_id
     where g.is_done = true and g.value > 0
     group by td.goal_id, td.day
  ),
  goal_totals as (
    select goal_id, sum(day_seconds)::bigint as total_seconds
      from goal_day_times
     group by goal_id
  ),
  goal_day_base as (
    select
      gdt.goal_id,
      gdt.day,
      g.value,
      gdt.day_seconds,
      floor(g.value::numeric * gdt.day_seconds / gt.total_seconds)::integer as base_points,
      (gdt.day = max(gdt.day) over (partition by gdt.goal_id)) as is_last
    from goal_day_times gdt
    join goal_totals gt on gt.goal_id = gdt.goal_id
    join public.goals g on g.id = gdt.goal_id
  ),
  goal_distributed as (
    select goal_id, sum(base_points)::integer as distributed_sum
      from goal_day_base
     group by goal_id
  ),
  goal_day_points as (
    select
      gdb.goal_id,
      gdb.day,
      case when gdb.is_last then gdb.base_points + (gdb.value - gd.distributed_sum)
           else gdb.base_points end as points
    from goal_day_base gdb
    join goal_distributed gd on gd.goal_id = gdb.goal_id
  ),
  day_time_per_goal as (
    select goal_id, sum(elapsed_seconds)::bigint as seconds
      from task_days
     where day = p_day
     group by goal_id
  ),
  total_time_per_goal as (
    select goal_id, sum(elapsed_seconds)::bigint as seconds
      from task_days
     group by goal_id
  )
  select
    g.id as goal_id,
    g.title,
    g.value,
    coalesce(gdp.points, 0)::integer as points_today,
    coalesce(dtpg.seconds, 0)::bigint as seconds_today,
    coalesce(ttpg.seconds, 0)::bigint as seconds_total
  from public.goals g
  left join goal_day_points gdp on gdp.goal_id = g.id and gdp.day = p_day
  left join day_time_per_goal dtpg on dtpg.goal_id = g.id
  left join total_time_per_goal ttpg on ttpg.goal_id = g.id
  where g.user_id = auth.uid()
    and (gdp.points is not null or dtpg.seconds is not null);
$$;

grant execute on function public.get_heatmap_day_details(date) to authenticated;

commit;
