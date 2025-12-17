
-- Task tag taxonomy schema

set search_path = public;

create table if not exists public.task_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists task_tags_user_name_key on public.task_tags (user_id, lower(name));

create trigger set_updated_at_task_tags before update on public.task_tags
  for each row execute procedure public.set_updated_at();

create table if not exists public.task_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  is_auto boolean not null default false,
  source_tag_id uuid references public.task_tags(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists task_categories_user_name_key on public.task_categories (user_id, lower(name));

create trigger set_updated_at_task_categories before update on public.task_categories
  for each row execute procedure public.set_updated_at();

create table if not exists public.category_tags (
  category_id uuid not null references public.task_categories(id) on delete cascade,
  tag_id uuid not null references public.task_tags(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (category_id, tag_id)
);

create table if not exists public.task_category_links (
  task_id uuid not null references public.micro_tasks(id) on delete cascade,
  category_id uuid not null references public.task_categories(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (task_id, category_id)
);

create table if not exists public.task_category_buffers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  category_ids uuid[] not null default '{}'::uuid[],
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.task_tags is 'User-defined tags for micro tasks';
comment on table public.task_categories is 'Groups of tags for micro tasks';
comment on table public.category_tags is 'Many-to-many mapping between categories and tags';
comment on table public.task_category_links is 'Many-to-many mapping between micro tasks and categories';
comment on table public.task_category_buffers is 'Per-user buffer storing last used categories for auto-assignment';

-- RLS policies

alter table public.task_tags enable row level security;
alter table public.task_categories enable row level security;
alter table public.category_tags enable row level security;
alter table public.task_category_links enable row level security;
alter table public.task_category_buffers enable row level security;

create policy "Task tags are scoped to owner" on public.task_tags
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Task categories scoped to owner" on public.task_categories
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Category tags scoped via category owner" on public.category_tags
  using (
    exists (
      select 1 from public.task_categories c
      where c.id = category_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.task_categories c
      where c.id = category_id
        and c.user_id = auth.uid()
    )
  );

create policy "Task category links scoped via task owner" on public.task_category_links
  using (
    exists (
      select 1 from public.micro_tasks mt
      where mt.id = task_id
        and mt.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.micro_tasks mt
      where mt.id = task_id
        and mt.user_id = auth.uid()
    )
  );

create policy "Category buffers per user" on public.task_category_buffers
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Trigger helper for updating buffers when categories removed (optional manual maintenance in code)

create or replace function public.create_task_tag_with_category(p_name text, p_user_id uuid)
returns table(tag task_tags, category task_categories)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tag task_tags;
  new_cat task_categories;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Tag name is required';
  end if;

  insert into public.task_tags (user_id, name)
  values (p_user_id, trim(p_name))
  returning * into new_tag;

  insert into public.task_categories (user_id, name, is_auto, source_tag_id)
  values (new_tag.user_id, new_tag.name, true, new_tag.id)
  returning * into new_cat;

  insert into public.category_tags (category_id, tag_id)
  values (new_cat.id, new_tag.id);

  return query select new_tag, new_cat;
end;
$$;

comment on function public.create_task_tag_with_category(text, uuid) is 'Creates a tag and matching auto category with transactional consistency.';

create or replace function public.delete_task_tag_and_associated_data(p_tag_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  select user_id into v_user_id from public.task_tags where id = p_tag_id and user_id = p_user_id;
  if not found then
    raise exception 'Tag not found or not owned by user.';
  end if;

  delete from public.task_categories
  where source_tag_id = p_tag_id
    and user_id = v_user_id;

  delete from public.task_tags
  where id = p_tag_id
    and user_id = v_user_id;
end;
$$;

comment on function public.delete_task_tag_and_associated_data(uuid, uuid) is 'Deletes a tag and cascades removal of its auto-generated category and links.';

create or replace function public.attach_tag_to_category(p_category_id uuid, p_tag_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  select user_id into v_user_id from public.task_categories where id = p_category_id and user_id = p_user_id;
  if not found then
    raise exception 'Category not found or not owned by user.';
  end if;

  if not exists (select 1 from public.task_tags where id = p_tag_id and user_id = p_user_id) then
    raise exception 'Tag not found or not owned by user.';
  end if;

  insert into public.category_tags (category_id, tag_id)
  values (p_category_id, p_tag_id)
  on conflict do nothing;
end;
$$;

create or replace function public.detach_tag_from_category(p_category_id uuid, p_tag_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  select user_id into v_user_id from public.task_categories where id = p_category_id and user_id = p_user_id;
  if not found then
    raise exception 'Category not found or not owned by user.';
  end if;

  delete from public.category_tags
  where category_id = p_category_id
    and tag_id = p_tag_id;
end;
$$;

create or replace function public.attach_categories_to_task(p_task_id uuid, p_category_ids uuid[], p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  category_id uuid;
  v_user_id uuid;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  select user_id into v_user_id from public.micro_tasks where id = p_task_id and user_id = p_user_id;
  if not found then
    raise exception 'Task not found or not owned by user.';
  end if;

  foreach category_id in array coalesce(p_category_ids, '{}') loop
    if exists (
      select 1 from public.task_categories where id = category_id and user_id = p_user_id
    ) then
      insert into public.task_category_links (task_id, category_id)
      values (p_task_id, category_id)
      on conflict do nothing;
    else
      raise exception 'Category % not found or not owned by user.', category_id;
    end if;
  end loop;
end;
$$;

create or replace function public.detach_category_from_task(p_task_id uuid, p_category_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  select user_id into v_user_id from public.micro_tasks where id = p_task_id and user_id = p_user_id;
  if not found then
    raise exception 'Task not found or not owned by user.';
  end if;

  delete from public.task_category_links
  where task_id = p_task_id
    and category_id = p_category_id;
end;
$$;

