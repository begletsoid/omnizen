-- Adds timer fields and RPC helpers for micro tasks widget

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'micro_task_timer_state'
  ) then
    create type public.micro_task_timer_state as enum ('never', 'paused', 'running');
  end if;
end$$;

alter table public.micro_tasks
  add column if not exists elapsed_seconds bigint not null default 0,
  add column if not exists timer_state public.micro_task_timer_state not null default 'never',
  add column if not exists last_started_at timestamptz;

create unique index if not exists micro_tasks_running_unique
  on public.micro_tasks(widget_id)
  where timer_state = 'running';

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

create or replace function public.reorder_micro_tasks(
  p_widget_id uuid,
  p_user_id uuid,
  p_updates jsonb
)
returns setof public.micro_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_position integer := 1;
begin
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'updates must be an array of micro task ids';
  end if;

  for item in
    select value from jsonb_array_elements(p_updates)
  loop
    update public.micro_tasks
       set "order" = v_position
     where id = (item->>'id')::uuid
       and widget_id = p_widget_id
       and user_id = p_user_id;

    v_position := v_position + 1;
  end loop;

  return query
    select *
      from public.micro_tasks
     where widget_id = p_widget_id
       and user_id = p_user_id
     order by "order";
end;
$$;

