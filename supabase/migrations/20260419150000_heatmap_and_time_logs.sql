-- Heatmap widget: time logs per session + per-day points distribution on goal completion

begin;

-- Allow 'heatmap' widget type
alter table public.widgets drop constraint if exists widgets_type_check;
alter table public.widgets
  add constraint widgets_type_check check (
    type in ('habits', 'problems', 'tasks', 'image', 'analytics', 'goals', 'heatmap')
  );

-- Session log: one row per pause (or implicit pause via starting another task).
create table if not exists public.micro_task_time_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  micro_task_id uuid not null references public.micro_tasks(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  seconds integer not null check (seconds >= 0),
  day_key date not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists micro_task_time_logs_user_day_idx
  on public.micro_task_time_logs (user_id, day_key);
create index if not exists micro_task_time_logs_task_idx
  on public.micro_task_time_logs (micro_task_id);

-- Per-goal per-day points (filled by trigger on goal completion).
create table if not exists public.goal_daily_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  day date not null,
  points integer not null check (points >= 0),
  seconds bigint not null check (seconds >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (goal_id, day)
);

create index if not exists goal_daily_points_user_day_idx
  on public.goal_daily_points (user_id, day);
create index if not exists goal_daily_points_goal_idx
  on public.goal_daily_points (goal_id);

-- RLS
alter table public.micro_task_time_logs enable row level security;
alter table public.goal_daily_points enable row level security;

drop policy if exists "Time logs scoped to owner" on public.micro_task_time_logs;
create policy "Time logs scoped to owner" on public.micro_task_time_logs
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Daily points scoped to owner" on public.goal_daily_points;
create policy "Daily points scoped to owner" on public.goal_daily_points
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Redefine pause_micro_task_timer to record a session log.
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
  v_started_at timestamptz;
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

  v_started_at := v_task.last_started_at;
  v_increment := coalesce(extract(epoch from (v_now - v_started_at)), 0)::bigint;

  update public.micro_tasks
     set elapsed_seconds = elapsed_seconds + v_increment,
         last_started_at = null,
         timer_state = 'paused'
   where id = v_task.id
   returning * into v_task;

  if v_increment > 0 and v_started_at is not null then
    insert into public.micro_task_time_logs
      (user_id, micro_task_id, started_at, ended_at, seconds, day_key)
    values (
      v_task.user_id,
      v_task.id,
      v_started_at,
      v_now,
      v_increment::integer,
      v_started_at::date
    );
  end if;

  return v_task;
end;
$$;

-- Redefine start_micro_task_timer to log the implicitly paused task.
create or replace function public.start_micro_task_timer(p_task_id uuid)
returns public.micro_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_task public.micro_tasks%rowtype;
  v_prev public.micro_tasks%rowtype;
  v_prev_increment bigint := 0;
  v_prev_started_at timestamptz;
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

  if v_task.timer_state = 'running' then
    return v_task;
  end if;

  -- Capture and pause any other running task for the same widget+user.
  select * into v_prev
    from public.micro_tasks
    where widget_id = v_task.widget_id
      and user_id = v_task.user_id
      and timer_state = 'running'
      and id <> v_task.id
    for update
    limit 1;

  if found then
    v_prev_started_at := v_prev.last_started_at;
    v_prev_increment := coalesce(extract(epoch from (v_now - v_prev_started_at)), 0)::bigint;

    update public.micro_tasks
       set elapsed_seconds = elapsed_seconds + v_prev_increment,
           last_started_at = null,
           timer_state = 'paused'
     where id = v_prev.id;

    if v_prev_increment > 0 and v_prev_started_at is not null then
      insert into public.micro_task_time_logs
        (user_id, micro_task_id, started_at, ended_at, seconds, day_key)
      values (
        v_prev.user_id,
        v_prev.id,
        v_prev_started_at,
        v_now,
        v_prev_increment::integer,
        v_prev_started_at::date
      );
    end if;
  end if;

  update public.micro_tasks
     set last_started_at = v_now,
         timer_state = 'running'
   where id = v_task.id
   returning * into v_task;

  return v_task;
end;
$$;

-- Distribute a goal's value across days proportional to logged time.
-- Rounding: each day gets floor(value * day_seconds / total_seconds); any remainder
-- is credited to the last day so the sum always equals the goal's value.
create or replace function public.distribute_goal_points(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal public.goals%rowtype;
  v_total_seconds bigint := 0;
  v_distributed integer := 0;
  v_points integer;
  v_last_row_id uuid := null;
  r record;
begin
  select * into v_goal from public.goals where id = p_goal_id;
  if not found or not v_goal.is_done or v_goal.value <= 0 then
    return;
  end if;

  select coalesce(sum(l.seconds), 0)::bigint
    into v_total_seconds
    from public.micro_task_time_logs l
    join public.micro_tasks t on t.id = l.micro_task_id
    where t.goal_id = v_goal.id;

  if v_total_seconds = 0 then
    return;
  end if;

  for r in
    select l.day_key as day,
           sum(l.seconds)::bigint as day_seconds
      from public.micro_task_time_logs l
      join public.micro_tasks t on t.id = l.micro_task_id
      where t.goal_id = v_goal.id
      group by l.day_key
      order by l.day_key
  loop
    v_points := floor(v_goal.value::numeric * r.day_seconds / v_total_seconds)::integer;
    v_distributed := v_distributed + v_points;
    insert into public.goal_daily_points (user_id, goal_id, day, points, seconds)
      values (v_goal.user_id, v_goal.id, r.day, v_points, r.day_seconds)
      returning id into v_last_row_id;
  end loop;

  if v_distributed < v_goal.value and v_last_row_id is not null then
    update public.goal_daily_points
       set points = points + (v_goal.value - v_distributed)
     where id = v_last_row_id;
  end if;
end;
$$;

-- Trigger: recompute points when a goal is (un)completed or its value changes while done.
create or replace function public.handle_goal_points_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.is_done is distinct from new.is_done)
     or (new.is_done and old.value is distinct from new.value) then
    delete from public.goal_daily_points where goal_id = new.id;
    if new.is_done then
      perform public.distribute_goal_points(new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists goal_points_recompute on public.goals;
create trigger goal_points_recompute
  after update on public.goals
  for each row
  execute function public.handle_goal_points_recompute();

-- Heatmap day details: for a given day, return goals that had activity (points or time).
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
  select
    g.id as goal_id,
    g.title,
    g.value,
    coalesce(gdp.points, 0)::integer as points_today,
    coalesce(t_day.seconds, 0)::bigint as seconds_today,
    coalesce(t_total.seconds, 0)::bigint as seconds_total
  from public.goals g
  left join public.goal_daily_points gdp
    on gdp.goal_id = g.id and gdp.day = p_day and gdp.user_id = auth.uid()
  left join (
    select t.goal_id, sum(l.seconds)::bigint as seconds
      from public.micro_task_time_logs l
      join public.micro_tasks t on t.id = l.micro_task_id
      where l.user_id = auth.uid() and l.day_key = p_day
      group by t.goal_id
  ) t_day on t_day.goal_id = g.id
  left join (
    select t.goal_id, sum(l.seconds)::bigint as seconds
      from public.micro_task_time_logs l
      join public.micro_tasks t on t.id = l.micro_task_id
      where l.user_id = auth.uid()
      group by t.goal_id
  ) t_total on t_total.goal_id = g.id
  where g.user_id = auth.uid()
    and (gdp.points is not null or t_day.seconds is not null);
$$;

grant execute on function public.get_heatmap_day_details(date) to authenticated;

commit;
