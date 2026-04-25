-- Time-transfer between micro-tasks (drag-from-timer mechanic).
-- Atomically moves N seconds from one micro_task to another, preserving running
-- timers without visual jump (rebases live interval into stored before mutation).

begin;

-- Removes any older signature so re-running is idempotent.
drop function if exists public.transfer_micro_task_time(uuid, uuid, integer, uuid);

create or replace function public.transfer_micro_task_time(
  p_from_task_id uuid,
  p_to_task_id   uuid,
  p_seconds      integer,
  p_user_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.micro_tasks%rowtype;
  v_to   public.micro_tasks%rowtype;
  v_from_total bigint;
  v_now timestamptz := now();
begin
  if p_seconds is null or p_seconds <= 0 then
    raise exception 'transfer_seconds_invalid' using errcode = '22023'; -- invalid_parameter_value
  end if;

  if p_from_task_id is null or p_to_task_id is null then
    raise exception 'transfer_task_id_invalid' using errcode = '22023';
  end if;

  if p_from_task_id = p_to_task_id then
    raise exception 'transfer_same_task' using errcode = '22023';
  end if;

  if p_user_id is null or auth.uid() is distinct from p_user_id then
    raise exception 'transfer_unauthorized' using errcode = '42501';
  end if;

  -- Lock both rows in a deterministic order to avoid deadlocks.
  if p_from_task_id < p_to_task_id then
    select * into v_from from public.micro_tasks
      where id = p_from_task_id and user_id = p_user_id and archived_at is null
      for update;
    if not found then
      raise exception 'transfer_source_not_found' using errcode = '02000';
    end if;
    select * into v_to from public.micro_tasks
      where id = p_to_task_id and user_id = p_user_id and archived_at is null
      for update;
    if not found then
      raise exception 'transfer_target_not_found' using errcode = '02000';
    end if;
  else
    select * into v_to from public.micro_tasks
      where id = p_to_task_id and user_id = p_user_id and archived_at is null
      for update;
    if not found then
      raise exception 'transfer_target_not_found' using errcode = '02000';
    end if;
    select * into v_from from public.micro_tasks
      where id = p_from_task_id and user_id = p_user_id and archived_at is null
      for update;
    if not found then
      raise exception 'transfer_source_not_found' using errcode = '02000';
    end if;
  end if;

  -- Total time available on source (stored + running delta if any).
  v_from_total := v_from.elapsed_seconds;
  if v_from.timer_state = 'running' and v_from.last_started_at is not null then
    v_from_total := v_from_total +
      greatest(0, extract(epoch from (v_now - v_from.last_started_at))::bigint);
  end if;

  if v_from_total < p_seconds then
    raise exception 'transfer_insufficient_source_time' using errcode = '23514'; -- check_violation
  end if;

  -- Source: rebase any live interval into stored, then subtract.
  if v_from.timer_state = 'running' and v_from.last_started_at is not null then
    update public.micro_tasks
       set elapsed_seconds = elapsed_seconds
                              + greatest(0, extract(epoch from (v_now - last_started_at))::bigint)
                              - p_seconds,
           last_started_at = v_now,
           updated_at = v_now
     where id = p_from_task_id;
  else
    update public.micro_tasks
       set elapsed_seconds = greatest(0, elapsed_seconds - p_seconds),
           updated_at = v_now
     where id = p_from_task_id;
  end if;

  -- Target: rebase any live interval into stored, then add.
  if v_to.timer_state = 'running' and v_to.last_started_at is not null then
    update public.micro_tasks
       set elapsed_seconds = elapsed_seconds
                              + greatest(0, extract(epoch from (v_now - last_started_at))::bigint)
                              + p_seconds,
           last_started_at = v_now,
           updated_at = v_now
     where id = p_to_task_id;
  else
    update public.micro_tasks
       set elapsed_seconds = elapsed_seconds + p_seconds,
           updated_at = v_now
     where id = p_to_task_id;
  end if;

  return jsonb_build_object(
    'from_task_id', p_from_task_id,
    'to_task_id',   p_to_task_id,
    'seconds',      p_seconds,
    'applied_at',   v_now
  );
end;
$$;

grant execute on function public.transfer_micro_task_time(uuid, uuid, integer, uuid) to authenticated;

commit;
