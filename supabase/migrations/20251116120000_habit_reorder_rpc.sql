-- Align habit ordering with integer indices and server-side reorder RPC

alter table public.habits
  alter column "order" type integer using ceil("order")::integer,
  alter column "order" set default 1;

with ranked as (
  select
    id,
    row_number() over (partition by widget_id, status order by "order", updated_at, id) as new_order
  from public.habits
)
update public.habits as h
set "order" = ranked.new_order
from ranked
where h.id = ranked.id;

alter table public.habits
  drop constraint if exists habits_widget_status_order_unique;

alter table public.habits
  add constraint habits_widget_status_order_unique unique (widget_id, status, "order");

create or replace function public.reorder_habits(
  p_user_id uuid,
  p_widget_id uuid,
  p_updates jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  updated_count integer;
begin
  expected_count := coalesce(jsonb_array_length(p_updates), 0);
  if expected_count = 0 then
    return;
  end if;

  with parsed as (
    select
      (value->>'id')::uuid as id,
      (value->>'order')::integer as order,
      case
        when value ? 'status' then (value->>'status')::habit_status_enum
        else null
      end as status
    from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) as value
  ),
  updated as (
    update public.habits as h
    set
      "order" = parsed.order,
      status = coalesce(parsed.status, h.status),
      updated_at = now()
    from parsed
    where h.id = parsed.id
      and h.user_id = p_user_id
      and h.widget_id = p_widget_id
    returning 1
  )
  select count(*) into updated_count from updated;

  if updated_count <> expected_count then
    raise exception 'Reorder mismatch: expected %, updated %', expected_count, updated_count
      using errcode = 'P0001';
  end if;
end;
$$;

