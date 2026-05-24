-- Atomic "insert a new micro-task AND optionally start its timer".
--
-- Why this exists: when the user creates a micro-task in the UI, the
-- frontend optimistically inserts a row with a `temp-…` id, then calls
-- the LLM to classify categories (~1-2s). If the user presses ▶ during
-- that window, the old timer-toggle path called `start_micro_task_timer`
-- with the temp id, which obviously failed on the server. By the time
-- the real id arrived, the optimistic "running" state was overwritten by
-- the server's freshly-inserted "never" state — the timer the user
-- thought they'd started silently reset to zero.
--
-- This RPC packages the INSERT and the start-timer into one server-side
-- transaction. The client sets a `start_timer: true` flag if it knows
-- the user wants the timer running on commit, and the row comes back
-- already in the running state. No race window.

begin;

create or replace function public.create_micro_task_with_start(
  p_widget_id uuid,
  p_user_id uuid,
  p_title text,
  p_order integer,
  p_start_timer boolean default false,
  p_group_id uuid default null,
  p_group_order integer default null,
  p_goal_id uuid default null
) returns public.micro_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_task public.micro_tasks%rowtype;
begin
  -- INSERT the new task. timer_state defaults to 'never' (paused by another
  -- way of saying it). If the caller asked to start, the next block flips
  -- it to 'running' atomically.
  insert into public.micro_tasks (
    widget_id, user_id, title, "order",
    group_id, group_order, goal_id,
    elapsed_seconds, timer_state
  ) values (
    p_widget_id, p_user_id, p_title, coalesce(p_order, 1),
    p_group_id, p_group_order, p_goal_id,
    0, 'never'
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

commit;
