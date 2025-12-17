set search_path = public;

alter table public.task_categories
  add column if not exists source_tag_id uuid references public.task_tags(id) on delete cascade;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_category_buffers'
      and column_name = 'category_ids'
      and data_type = 'jsonb'
  ) then
    alter table public.task_category_buffers
      add column category_ids_uuid uuid[] not null default '{}'::uuid[];

    update public.task_category_buffers
    set category_ids_uuid =
      coalesce(
        (
          select array_agg(value::uuid)
          from jsonb_array_elements_text(category_ids) as value
          where value ~ '^[0-9a-fA-F-]{36}$'
        ),
        '{}'::uuid[]
      );

    alter table public.task_category_buffers
      drop column category_ids;

    alter table public.task_category_buffers
      rename column category_ids_uuid to category_ids;
  end if;
end;
$$;

alter table public.task_category_buffers
  alter column category_ids set default '{}'::uuid[];

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
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  if not exists (select 1 from public.task_categories where id = p_category_id and user_id = p_user_id) then
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
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  if not exists (select 1 from public.task_categories where id = p_category_id and user_id = p_user_id) then
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
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  if not exists (select 1 from public.micro_tasks where id = p_task_id and user_id = p_user_id) then
    raise exception 'Task not found or not owned by user.';
  end if;

  foreach category_id in array coalesce(p_category_ids, '{}') loop
    if exists (select 1 from public.task_categories where id = category_id and user_id = p_user_id) then
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
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'User mismatch or not authenticated.';
  end if;

  if not exists (select 1 from public.micro_tasks where id = p_task_id and user_id = p_user_id) then
    raise exception 'Task not found or not owned by user.';
  end if;

  delete from public.task_category_links
  where task_id = p_task_id
    and category_id = p_category_id;
end;
$$;


