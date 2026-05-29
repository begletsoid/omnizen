-- Preserve seconds that ticked on the optimistic temp-row before the server
-- actually started the timer.
--
-- Why: when a user creates a micro-task and presses ▶ on the optimistic
-- temp-row, the client shows the timer running from the moment of the
-- click (`last_started_at = client_now_at_click`). The server-side
-- INSERT + start can happen 1-3 seconds later (LLM-classify wait +
-- createMicroTask RPC roundtrip). Without compensation, the server
-- writes `last_started_at = server_now (= click_time + load_delay)` and
-- `elapsed_seconds = 0` — so when `onSuccess` replaces the temp-row
-- with the server row, the displayed timer "jumps back" by the load
-- delay (~1-3s of work the user thought they were already doing
-- against the new task).
--
-- Fix: both timer-starting RPCs gain an optional
-- `p_started_offset_seconds` parameter. The client computes it as
-- `Math.floor((Date.now() - click_time) / 1000)` and passes it. The
-- server pretends the timer has already been running for that many
-- seconds by initialising / bumping `elapsed_seconds`. Net effect:
-- `last_started_at = server_now`, `elapsed_seconds = offset`, so the
-- display value `elapsed_seconds + (now - last_started_at)` matches
-- what the user saw on the optimistic temp-row.
--
-- Default is 0 → existing callers (manual pause/resume) get current
-- behaviour. Only the two race-path callers in
-- `src/features/microTasks/hooks.ts` actually pass a non-zero value.

begin;

-- create_micro_task_with_start: add p_started_offset_seconds.
create or replace function public.create_micro_task_with_start(
  p_widget_id uuid,
  p_user_id uuid,
  p_title text,
  p_order integer,
  p_start_timer boolean default false,
  p_group_id uuid default null,
  p_group_order integer default null,
  p_goal_id uuid default null,
  p_started_offset_seconds integer default 0
) returns public.micro_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_task public.micro_tasks%rowtype;
  v_initial_elapsed bigint := greatest(coalesce(p_started_offset_seconds, 0), 0);
begin
  -- INSERT. If the caller is about to start the timer, seed
  -- elapsed_seconds with the loading-delay offset so the displayed
  -- timer continues from where the user's optimistic click had it.
  insert into public.micro_tasks (
    widget_id, user_id, title, "order",
    group_id, group_order, goal_id,
    elapsed_seconds, timer_state
  ) values (
    p_widget_id, p_user_id, p_title, coalesce(p_order, 1),
    p_group_id, p_group_order, p_goal_id,
    case when p_start_timer then v_initial_elapsed else 0 end,
    'never'
  )
  returning * into v_task;

  if p_start_timer then
    -- Pause any other running task in the same widget — same semantics as
    -- start_micro_task_timer (only one timer per widget runs at a time).
    update public.micro_tasks
       set elapsed_seconds = elapsed_seconds + coalesce(extract(epoch from (v_now - last_started_at)), 0)::bigint,
           last_started_at = null,
           timer_state = 'paused'
     where widget_id = v_task.widget_id
       and user_id = v_task.user_id
       and timer_state = 'running'
       and id <> v_task.id;

    update public.micro_tasks
       set last_started_at = v_now,
           timer_state = 'running'
     where id = v_task.id
       and user_id = v_task.user_id
     returning * into v_task;
  end if;

  return v_task;
end;
$$;

-- start_micro_task_timer: add p_started_offset_seconds. Mirrors the
-- existing definition from 20260419200000_heatmap_on_the_fly.sql, plus
-- the offset bump.
create or replace function public.start_micro_task_timer(
  p_task_id uuid,
  p_started_offset_seconds integer default 0
)
returns public.micro_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_task public.micro_tasks%rowtype;
  v_offset bigint := greatest(coalesce(p_started_offset_seconds, 0), 0);
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

  -- Pause any other running task in the widget.
  update public.micro_tasks
     set elapsed_seconds = elapsed_seconds + coalesce(extract(epoch from (v_now - last_started_at)), 0)::bigint,
         last_started_at = null,
         timer_state = 'paused'
   where widget_id = v_task.widget_id
     and user_id = v_task.user_id
     and timer_state = 'running'
     and id <> v_task.id;

  -- Already running → no-op start, but still apply the offset bump if
  -- caller passed one. Conservative: only bump elapsed_seconds when the
  -- task was NOT already running, to keep "resume an existing running
  -- timer" calls idempotent.
  if v_task.timer_state = 'running' then
    return v_task;
  end if;

  update public.micro_tasks
     set last_started_at = v_now,
         elapsed_seconds = elapsed_seconds + v_offset,
         timer_state = 'running'
   where id = v_task.id
   returning * into v_task;

  return v_task;
end;
$$;

commit;
