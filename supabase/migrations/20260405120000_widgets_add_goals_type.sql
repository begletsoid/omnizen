-- Allow goals (Tasks widget) type on widgets
alter table public.widgets drop constraint if exists widgets_type_check;
alter table public.widgets
  add constraint widgets_type_check check (
    type in ('habits', 'problems', 'tasks', 'image', 'analytics', 'goals')
  );
