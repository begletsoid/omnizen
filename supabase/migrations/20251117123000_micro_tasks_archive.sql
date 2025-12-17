begin;

alter table public.micro_tasks
  add column if not exists archived_at timestamptz;

create index if not exists micro_tasks_archived_idx
  on public.micro_tasks(widget_id, archived_at);

commit;

