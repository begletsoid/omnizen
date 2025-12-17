-- Ensure habit reorders remain atomic and avoid unique constraint conflicts

alter table public.habits
  drop constraint if exists habits_widget_status_order_unique;

alter table public.habits
  add constraint habits_widget_status_order_unique
  unique (widget_id, status, "order")
  deferrable initially immediate;

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
  expected_count integer := coalesce(jsonb_array_length(p_updates), 0);
  updated_count integer;
  affected_statuses habit_status_enum[] := '{}';
begin
  if expected_count = 0 then
    return;
  end if;

  set constraints habits_widget_status_order_unique deferred;

  with parsed as (
    select
      (value->>'id')::uuid as id,
      (value->>'order')::integer as "order",
      case
        when value ? 'status' then (value->>'status')::habit_status_enum
        else null
      end as status
    from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) as value
  ),
  updated as (
    update public.habits as h
    set
      "order" = parsed."order",
      status = coalesce(parsed.status, h.status),
      updated_at = now()
    from parsed
    where h.id = parsed.id
      and h.user_id = p_user_id
      and h.widget_id = p_widget_id
    returning h.id, h.widget_id, h.status
  )
  select
    count(*) as total,
    coalesce(array_agg(distinct status), '{}') as statuses
  into updated_count, affected_statuses
  from updated;

  if updated_count <> expected_count then
    raise exception 'Reorder mismatch: expected %, updated %', expected_count, updated_count
      using errcode = 'P0001';
  end if;

  if array_length(affected_statuses, 1) > 0 then
    with ranked as (
      select
        id,
        row_number() over (
          partition by widget_id, status
          order by "order", updated_at, id
        ) as new_order
      from public.habits
      where widget_id = p_widget_id
        and status = any(affected_statuses)
    )
    update public.habits as h
    set
      "order" = ranked.new_order,
      updated_at = now()
    from ranked
    where h.id = ranked.id;
  end if;

  set constraints habits_widget_status_order_unique immediate;
end;
$$;


