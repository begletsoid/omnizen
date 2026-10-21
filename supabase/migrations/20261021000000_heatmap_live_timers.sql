-- Include the unpaused portion of running timers in both heatmap RPCs.
-- Incomplete and archived micro-tasks remain eligible. Points still require
-- a completed goal; time is attributed to task creation day as before.
-- Read-only aggregation: do not persist the running increment, or pausing a
-- timer would count the same seconds twice.

begin;

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
  with task_times as (
    select
      t.goal_id,
      t.created_at::date as day,
      greatest(coalesce(t.elapsed_seconds, 0), 0) +
        case when t.timer_state = 'running' and t.last_started_at is not null then
          greatest(floor(extract(epoch from (now() - t.last_started_at)))::bigint, 0)
        else 0 end as elapsed_seconds
    from public.micro_tasks t
    where t.user_id = auth.uid()
      and t.goal_id is not null
  ),
  task_days as (
    select goal_id, day, elapsed_seconds
    from task_times
    where elapsed_seconds > 0
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
  with task_times as (
    select
      t.goal_id,
      t.created_at::date as day,
      greatest(coalesce(t.elapsed_seconds, 0), 0) +
        case when t.timer_state = 'running' and t.last_started_at is not null then
          greatest(floor(extract(epoch from (now() - t.last_started_at)))::bigint, 0)
        else 0 end as elapsed_seconds
    from public.micro_tasks t
    where t.user_id = auth.uid()
      and t.goal_id is not null
  ),
  task_days as (
    select goal_id, day, elapsed_seconds
    from task_times
    where elapsed_seconds > 0
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
