begin;

-- Snapshot the group on the server. A stale client-side task list should
-- never overwrite the goal IDs currently stored on the source tasks.
create function public.save_micro_task_group_template(p_group_id uuid)
returns public.micro_task_group_templates
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group public.micro_task_groups;
  v_template public.micro_task_group_templates;
begin
  select * into v_group
    from public.micro_task_groups
   where id = p_group_id and user_id = v_user_id
   for update;
  if not found then
    raise exception 'Micro-task group not found' using errcode = '42501';
  end if;

  insert into public.micro_task_group_templates (user_id, name)
    values (v_user_id, v_group.name)
    on conflict (user_id, name) do update set updated_at = now()
    returning * into v_template;

  delete from public.micro_task_group_template_items where template_id = v_template.id;
  insert into public.micro_task_group_template_items (template_id, title, category_ids, goal_id, "order")
    select v_template.id, t.title,
           array(select l.category_id from public.task_category_links l where l.task_id = t.id),
           t.goal_id,
           row_number() over (order by coalesce(t.group_order, t."order"), t.id)
      from public.micro_tasks t
     where t.group_id = v_group.id and t.widget_id = v_group.widget_id
       and t.user_id = v_user_id and t.archived_at is null;

  return v_template;
end;
$$;

-- Manual cleanup is scoped to this widget. Unlike the sleep automation,
-- it has no bedtime cutoff and settles the running timer at button press.
create function public.finish_micro_task_day(p_widget_id uuid)
returns table (tasks_archived integer, tasks_deleted integer, groups_deleted integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
begin
  if not exists (
    select 1
      from public.widgets w
      join public.dashboards d on d.id = w.dashboard_id
     where w.id = p_widget_id and w.type = 'tasks' and d.user_id = v_user_id
  ) then
    raise exception 'Micro-task widget not found' using errcode = '42501';
  end if;

  with targets as materialized (
    select t.id,
           t.elapsed_seconds + case when t.timer_state = 'running' and t.last_started_at is not null
             then greatest(0, floor(extract(epoch from v_now - t.last_started_at))::bigint)
             else 0 end as seconds
      from public.micro_tasks t
     where t.widget_id = p_widget_id and t.user_id = v_user_id and t.archived_at is null
     for update
  ), archived as (
    update public.micro_tasks t
       set elapsed_seconds = target.seconds, archived_at = v_now, is_done = true,
           timer_state = case when t.timer_state = 'running' then 'paused' else t.timer_state end,
           last_started_at = null
      from targets target where t.id = target.id and target.seconds >= 5
    returning t.id
  ), deleted as (
    delete from public.micro_tasks t
      using targets target where t.id = target.id and target.seconds < 5
    returning t.id
  )
  select (select count(*) from archived), (select count(*) from deleted)
    into tasks_archived, tasks_deleted;

  delete from public.micro_task_groups g
   where g.widget_id = p_widget_id and g.user_id = v_user_id
     and not exists (
       select 1 from public.micro_tasks t where t.group_id = g.id and t.archived_at is null
     );
  get diagnostics groups_deleted = row_count;
  return next;
end;
$$;

revoke execute on function public.save_micro_task_group_template(uuid) from public, anon;
revoke execute on function public.finish_micro_task_day(uuid) from public, anon;
grant execute on function public.save_micro_task_group_template(uuid) to authenticated;
grant execute on function public.finish_micro_task_day(uuid) to authenticated;

commit;
