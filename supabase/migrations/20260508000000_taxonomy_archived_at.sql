-- Soft-delete columns for tags & categories. "Archived" means:
--   • The voice pipeline LLM doesn't see them in its context, so they
--     never get auto-attached to new micro-tasks.
--   • UI selectors (TaxonomySelect) hide them, so the user can't pick
--     them by mistake when attaching to a task.
--   • The Taxonomy Manager shows them in a separate "archived" section
--     at the bottom for restore-or-purge decisions.
--
-- Tasks that already have archived categories/tags attached keep them —
-- archive ≠ delete, the historical link stays intact.

begin;

alter table public.task_categories
  add column if not exists archived_at timestamptz;

alter table public.task_tags
  add column if not exists archived_at timestamptz;

commit;
