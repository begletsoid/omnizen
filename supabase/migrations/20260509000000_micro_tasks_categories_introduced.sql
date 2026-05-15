-- `categories_introduced_at` tracks whether the user has seen the "auto
-- assigned category" intro for a given task. Used to show the chip preview
-- exactly once per task across all devices: the first viewer flips the
-- timestamp to now() (via acknowledgeCategoriesIntroduction RPC/UPDATE),
-- and subsequent loads anywhere will skip the intro.
--
-- Backfill: every pre-existing task gets `categories_introduced_at` set to
-- its `created_at`, so loading the dashboard right after the migration
-- doesn't suddenly animate hundreds of category chips on legacy tasks.
-- New tasks (those created after this migration) start with NULL.

begin;

alter table public.micro_tasks
  add column if not exists categories_introduced_at timestamptz;

-- Backfill: existing rows are already known to the user; no intro needed.
update public.micro_tasks
   set categories_introduced_at = created_at
 where categories_introduced_at is null;

commit;
