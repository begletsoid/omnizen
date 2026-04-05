begin;

create table if not exists public.micro_task_groups (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  "order" numeric(10,4) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists micro_task_groups_widget_idx
  on public.micro_task_groups(widget_id, "order");

create trigger set_updated_at_micro_task_groups before update on public.micro_task_groups
  for each row execute function public.set_updated_at();

create table if not exists public.micro_task_group_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists micro_task_group_templates_user_name_key
  on public.micro_task_group_templates(user_id, lower(name));

create trigger set_updated_at_micro_task_group_templates before update on public.micro_task_group_templates
  for each row execute function public.set_updated_at();

create table if not exists public.micro_task_group_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.micro_task_group_templates(id) on delete cascade,
  title text not null,
  category_ids uuid[] not null default '{}'::uuid[],
  "order" numeric(10,4) not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists micro_task_group_template_items_idx
  on public.micro_task_group_template_items(template_id, "order");

alter table public.micro_tasks
  add column if not exists group_id uuid references public.micro_task_groups(id) on delete set null,
  add column if not exists group_order numeric(10,4);

alter table public.micro_task_groups enable row level security;
alter table public.micro_task_group_templates enable row level security;
alter table public.micro_task_group_template_items enable row level security;

create policy "Micro task groups scoped to owner" on public.micro_task_groups
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Micro task group templates scoped to owner" on public.micro_task_group_templates
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Micro task group template items scoped via template owner" on public.micro_task_group_template_items
  using (
    exists (
      select 1 from public.micro_task_group_templates t
      where t.id = template_id
        and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.micro_task_group_templates t
      where t.id = template_id
        and t.user_id = auth.uid()
    )
  );

create or replace function public.reorder_micro_task_items(
  p_widget_id uuid,
  p_user_id uuid,
  p_task_updates jsonb,
  p_group_updates jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  if p_group_updates is not null and jsonb_typeof(p_group_updates) = 'array' then
    for item in select value from jsonb_array_elements(p_group_updates)
    loop
      update public.micro_task_groups
         set "order" = coalesce((item->>'order')::numeric, "order")
       where id = (item->>'id')::uuid
         and widget_id = p_widget_id
         and user_id = p_user_id;
    end loop;
  end if;

  if p_task_updates is not null and jsonb_typeof(p_task_updates) = 'array' then
    for item in select value from jsonb_array_elements(p_task_updates)
    loop
      update public.micro_tasks
         set "order" = coalesce((item->>'order')::numeric, "order"),
             group_id = nullif(item->>'group_id', '')::uuid,
             group_order = nullif(item->>'group_order', '')::numeric
       where id = (item->>'id')::uuid
         and widget_id = p_widget_id
         and user_id = p_user_id;
    end loop;
  end if;
end;
$$;

comment on function public.reorder_micro_task_items(uuid, uuid, jsonb, jsonb)
  is 'Reorders micro task groups and tasks (including group membership and group order).';

commit;
