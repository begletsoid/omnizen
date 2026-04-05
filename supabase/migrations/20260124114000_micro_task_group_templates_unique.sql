begin;

drop index if exists public.micro_task_group_templates_user_name_key;

create unique index if not exists micro_task_group_templates_user_name_key
  on public.micro_task_group_templates(user_id, name);

commit;
