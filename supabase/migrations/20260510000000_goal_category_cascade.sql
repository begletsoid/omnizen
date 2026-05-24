-- Cascade goal categories onto linked micro-tasks.
--
-- Until now, changing a goal's categories left the categories of every
-- micro-task linked via micro_tasks.goal_id stuck on whatever they had
-- at creation. The user expects a goal's category set to be the source
-- of truth for its tasks: edit the goal → every linked task's category
-- set is reconciled to match.
--
-- We implement this with an AFTER-trigger on goal_category_links that
-- rewrites task_category_links for every micro_task whose goal_id is
-- the changed link's goal. Replace (not merge) — the goal's current
-- category set becomes the task's category set, exactly.
--
-- SECURITY DEFINER so the trigger can DELETE/INSERT links bypassing RLS;
-- it only operates on rows whose user_id is implied by the goal's owner
-- (the same user owns the micro_task and its task_category_links by
-- construction — see existing RLS policies that scope link-tables via
-- their parent task / category ownership).

begin;

create or replace function public.sync_micro_task_categories_from_goal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal_id uuid := coalesce(new.goal_id, old.goal_id);
  v_category_ids uuid[];
begin
  if v_goal_id is null then
    return null;
  end if;

  -- Snapshot the goal's CURRENT category set.
  select array_agg(category_id)
    into v_category_ids
    from public.goal_category_links
   where goal_id = v_goal_id;

  -- Wipe the categories of all micro_tasks attached to this goal.
  delete from public.task_category_links
   where task_id in (
     select id from public.micro_tasks where goal_id = v_goal_id
   );

  -- And re-attach exactly the goal's categories (if any).
  if v_category_ids is not null and array_length(v_category_ids, 1) > 0 then
    insert into public.task_category_links (task_id, category_id)
    select m.id, c
      from public.micro_tasks m
      cross join unnest(v_category_ids) as c
     where m.goal_id = v_goal_id;
  end if;

  return null;
end;
$$;

-- Re-create idempotently (drop first; CREATE TRIGGER has no `or replace`).
drop trigger if exists goal_category_cascade on public.goal_category_links;
create trigger goal_category_cascade
  after insert or update or delete on public.goal_category_links
  for each row execute function public.sync_micro_task_categories_from_goal();

commit;
