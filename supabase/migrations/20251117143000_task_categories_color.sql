begin;

alter table public.task_categories
  add column if not exists color text;

commit;

