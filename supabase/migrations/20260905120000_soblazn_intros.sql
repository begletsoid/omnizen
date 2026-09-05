-- soblazn: строки «начни с ней» с телефона.
-- Пишет Netlify-функция soblazn-intro (быстрая команда на iPhone), читает бот
-- soblazn на компе Макса через Realtime и отмечает результат. Политик RLS нет
-- намеренно: доступ только с service role (функция и бот).
create table if not exists public.soblazn_intros (
  id bigint generated always as identity primary key,
  line text not null,
  dry boolean not null default false,
  status text not null default 'new' check (status in ('new', 'taken', 'done', 'error')),
  result text,
  created_at timestamptz not null default now(),
  taken_at timestamptz,
  done_at timestamptz
);

comment on table public.soblazn_intros is
  'soblazn: строки «начни с ней» (логин имя возраст сайт оценка) с телефона; пишет Netlify-функция soblazn-intro, читает бот на компе через Realtime';

alter table public.soblazn_intros enable row level security;

create index if not exists soblazn_intros_new_idx on public.soblazn_intros (id) where status = 'new';

alter publication supabase_realtime add table public.soblazn_intros;
