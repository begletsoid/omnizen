-- Enum для статусов привычек
create type habit_status_enum as enum ('adopted', 'in_progress', 'not_started');

-- Таблица профилей (зеркало auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- триггер: создаём profile при вставке в auth.users
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url, settings)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url', '{}')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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

-- Таблица дашбордов (на будущее поддержка нескольких)
create table if not exists public.dashboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Мой дашборд',
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index dashboards_user_default_idx on public.dashboards(user_id, is_default)
  where is_default = true;

-- Таблица виджетов (инстансы и настройки)
create table if not exists public.widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  type text not null check (type in ('habits', 'problems', 'tasks', 'image')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index widgets_dashboard_type_idx on public.widgets(dashboard_id, type);

-- Таблица layout хранит JSON-конфигурацию
create table if not exists public.widget_layouts (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  layout jsonb not null,
  updated_at timestamptz not null default now()
);

create unique index widget_layouts_dashboard_idx on public.widget_layouts(dashboard_id);

-- Привычки
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  status habit_status_enum not null default 'not_started',
  "order" numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index habits_widget_idx on public.habits(widget_id, "order");
create index habits_user_idx on public.habits(user_id);

-- Проблемы
create table if not exists public.problems (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  "order" numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index problems_widget_idx on public.problems(widget_id, "order");
create index problems_user_idx on public.problems(user_id);

-- Решения для проблем
create table if not exists public.problem_solutions (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems(id) on delete cascade,
  content text not null,
  "order" numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index problem_solutions_problem_idx on public.problem_solutions(problem_id, "order");

-- Микрозадачи
create table if not exists public.micro_tasks (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  "order" numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index micro_tasks_widget_idx on public.micro_tasks(widget_id, "order");
create index micro_tasks_user_idx on public.micro_tasks(user_id, is_done);

-- Картинки
create table if not exists public.images (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  width int,
  height int,
  "order" numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index images_widget_idx on public.images(widget_id, "order");
create index images_user_idx on public.images(user_id);

-- Функция и триггер для updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at_dashboards before update on public.dashboards
  for each row execute function public.set_updated_at();
create trigger set_updated_at_widgets before update on public.widgets
  for each row execute function public.set_updated_at();
create trigger set_updated_at_widget_layouts before update on public.widget_layouts
  for each row execute function public.set_updated_at();
create trigger set_updated_at_habits before update on public.habits
  for each row execute function public.set_updated_at();
create trigger set_updated_at_problems before update on public.problems
  for each row execute function public.set_updated_at();
create trigger set_updated_at_problem_solutions before update on public.problem_solutions
  for each row execute function public.set_updated_at();
create trigger set_updated_at_micro_tasks before update on public.micro_tasks
  for each row execute function public.set_updated_at();
create trigger set_updated_at_images before update on public.images
  for each row execute function public.set_updated_at();

-- RLS включим позже в отдельной секции (тор же файл)

alter table public.profiles enable row level security;
alter table public.dashboards enable row level security;
alter table public.widgets enable row level security;
alter table public.widget_layouts enable row level security;
alter table public.habits enable row level security;
alter table public.problems enable row level security;
alter table public.problem_solutions enable row level security;
alter table public.micro_tasks enable row level security;
alter table public.images enable row level security;

-- profiles
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- dashboards
create policy "dashboards_crud" on public.dashboards
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- widgets
create policy "widgets_crud" on public.widgets
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = widgets.dashboard_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = widgets.dashboard_id and d.user_id = auth.uid()
    )
  );

-- widget_layouts
create policy "widget_layouts_crud" on public.widget_layouts
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = widget_layouts.dashboard_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = widget_layouts.dashboard_id and d.user_id = auth.uid()
    )
  );

-- habits, problems, micro_tasks, images (простая проверка по user_id)
create policy "habits_crud" on public.habits
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "problems_crud" on public.problems
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "micro_tasks_crud" on public.micro_tasks
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "images_crud" on public.images
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- problem_solutions через join
create policy "problem_solutions_select" on public.problem_solutions
  for select using (
    exists (
      select 1 from public.problems p
      where p.id = problem_id and p.user_id = auth.uid()
    )
  );

create policy "problem_solutions_mutate" on public.problem_solutions
  for all using (
    exists (
      select 1 from public.problems p
      where p.id = problem_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.problems p
      where p.id = problem_id and p.user_id = auth.uid()
    )
  );

