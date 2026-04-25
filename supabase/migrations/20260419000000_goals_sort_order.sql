-- Goals manual ordering: sort_order column + reorder_goals RPC

alter table public.goals
  add column if not exists sort_order integer not null default 0;

-- Backfill sort_order based on created_at so existing goals keep a deterministic order
do $$
begin
  if exists (
    select 1 from public.goals where sort_order = 0
  ) then
    with ranked as (
      select id,
             row_number() over (partition by widget_id order by created_at) as rn
        from public.goals
    )
    update public.goals g
       set sort_order = r.rn
      from ranked r
     where g.id = r.id
       and g.sort_order = 0;
  end if;
end$$;

create index if not exists goals_widget_sort_idx
  on public.goals(widget_id, sort_order);

create or replace function public.reorder_goals(
  p_widget_id uuid,
  p_user_id uuid,
  p_updates jsonb
)
returns setof public.goals
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_position integer := 1;
begin
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'updates must be an array of goal ids';
  end if;

  for item in
    select value from jsonb_array_elements(p_updates)
  loop
    update public.goals
       set sort_order = v_position
     where id = (item->>'id')::uuid
       and widget_id = p_widget_id
       and user_id = p_user_id;

    v_position := v_position + 1;
  end loop;

  return query
    select *
      from public.goals
     where widget_id = p_widget_id
       and user_id = p_user_id
     order by sort_order;
end;
$$;

grant execute on function public.reorder_goals(uuid, uuid, jsonb) to authenticated;
