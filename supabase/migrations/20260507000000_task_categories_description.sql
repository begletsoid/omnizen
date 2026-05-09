-- Per-category description text — used by:
--   - The voice pipeline LLM (sees description as a semantic hint when
--     classifying which category a new task belongs to).
--   - The user, who can read what goes into each category in the UI.
--
-- Optional. NULL means "no description yet, classify by name + tags only".

begin;

alter table public.task_categories
  add column if not exists description text;

commit;
