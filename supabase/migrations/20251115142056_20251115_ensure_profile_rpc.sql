create or replace function public.ensure_profile(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id)
  values (p_user_id)
  on conflict (id) do nothing;
end;
$$;
