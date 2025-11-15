create or replace function public.next_habit_order(p_widget_id uuid, p_status habit_status_enum)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_order bigint;
begin
  select coalesce(max("order"), 0) + 1
    into next_order
  from public.habits
  where widget_id = p_widget_id
    and status = p_status;

  return next_order;
end;
$$;


