begin;

-- Goals (tasks) table
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  is_locked boolean not null default false,
  is_recurring boolean not null default false,
  value integer not null default 0,
  expected_hours real not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists goals_widget_idx
  on public.goals(widget_id);

create trigger set_updated_at_goals before update on public.goals
  for each row execute function public.set_updated_at();

-- Recurring goals table
create table if not exists public.recurring_goals (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  value integer not null default 0,
  expected_hours real not null default 0,
  cron_expression text not null default '0 9 * * 1',
  last_triggered_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists recurring_goals_widget_idx
  on public.recurring_goals(widget_id);

create trigger set_updated_at_recurring_goals before update on public.recurring_goals
  for each row execute function public.set_updated_at();

-- Goal ↔ category links
create table if not exists public.goal_category_links (
  goal_id uuid not null references public.goals(id) on delete cascade,
  category_id uuid not null references public.task_categories(id) on delete cascade,
  primary key (goal_id, category_id)
);

-- Link micro_tasks to goals
alter table public.micro_tasks
  add column if not exists goal_id uuid references public.goals(id) on delete set null;

create index if not exists micro_tasks_goal_id_idx
  on public.micro_tasks(goal_id);

-- RLS
alter table public.goals enable row level security;
alter table public.recurring_goals enable row level security;
alter table public.goal_category_links enable row level security;

create policy "Goals scoped to owner" on public.goals
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Recurring goals scoped to owner" on public.recurring_goals
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Goal category links scoped via goal owner" on public.goal_category_links
  using (
    exists (
      select 1 from public.goals g
      where g.id = goal_id
        and g.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.goals g
      where g.id = goal_id
        and g.user_id = auth.uid()
    )
  );

commit;
