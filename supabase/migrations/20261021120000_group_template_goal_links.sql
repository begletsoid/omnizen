begin;

-- A saved group must remember the actual goal, even after either title is
-- edited or the goal is archived. Deleting a goal explicitly unlinks it.
alter table public.micro_task_group_template_items
  add column goal_id uuid references public.goals(id) on delete set null;

create index micro_task_group_template_items_goal_idx
  on public.micro_task_group_template_items(goal_id) where goal_id is not null;

-- A foreign key alone would allow a template to reference another user's
-- goal. Enforce matching owners for normal clients and service-role writes.
create function public.check_group_template_goal_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.goal_id is not null and not exists (
    select 1
    from public.micro_task_group_templates t
    join public.goals g on g.id = new.goal_id and g.user_id = t.user_id
    where t.id = new.template_id
  ) then
    raise exception 'Template and goal must belong to the same user' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger group_template_goal_owner
  before insert or update of goal_id, template_id
  on public.micro_task_group_template_items
  for each row execute function public.check_group_template_goal_owner();

commit;
