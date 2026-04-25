-- Allow two new widget types: 'ritual' (step-by-step questionnaire) and 'notes-board' (free-form pinboard).
-- Both widgets keep all state in widgets.config; no additional tables needed.

begin;

alter table public.widgets drop constraint if exists widgets_type_check;
alter table public.widgets
  add constraint widgets_type_check check (
    type in ('habits', 'problems', 'tasks', 'image', 'analytics', 'goals', 'heatmap', 'ritual', 'notes-board')
  );

commit;
