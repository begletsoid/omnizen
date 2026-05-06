-- Voice pipeline Phase 2: multi-action LLM responses, summary text,
-- undo machinery, goals-widget target, default intent rules.
--
-- See plans/ancient-percolating-fairy.md "Phase 2" for the full design.
-- Key changes vs Phase 1:
--   - LLM now returns `actions: [{intent, payload}, ...]` (length 1+);
--     dispatcher iterates and accumulates outcomes.
--   - Each successful run produces a human-readable `applied_summary`
--     ("Создана задача «X». Таймер запущен.") shown in the iOS push
--     notification and in-app toast.
--   - New intents: pause_current, add_goal, undo_last. start_microtask
--     gains a `mode: 'resume' | 'create'` switch so the LLM can either
--     restart an existing task or create a fresh one.
--   - undo_last needs to walk back the last applied row, so we add
--     `undid_transcription_id` to track which row a given undo reversed.

begin;

-- 1. voice_transcriptions: new columns -------------------------------------
alter table public.voice_transcriptions
  -- Human-readable summary of what was applied. Populated on success and
  -- mirrored into the JSON response so the iOS Shortcut can show it.
  add column if not exists applied_summary text,
  -- Per-action results when the LLM returned more than one action
  -- (e.g. "Отмена, начни X" → [undo_last, start_microtask]). Each entry:
  -- { intent: string, outcome: { applied_task_id?, paused_task_id?, ... } }.
  add column if not exists applied_actions jsonb,
  -- Set on undo_last rows: points at the previously-applied row that this
  -- one rolled back. Lets us prevent infinite undo loops + future History UI
  -- showing "X was undone by Y".
  add column if not exists undid_transcription_id uuid
    references public.voice_transcriptions(id) on delete set null;

-- 2. profiles.voice_target_goals_widget_id ---------------------------------
-- Lazy-init parallel to voice_target_widget_id (which targets tasks-type
-- widgets for new micro-tasks). For add_goal we need to know which
-- goals-type widget to insert into. NULL until the first add_goal call,
-- then persisted.
alter table public.profiles
  add column if not exists voice_target_goals_widget_id uuid
    references public.widgets(id) on delete set null;

-- 3. Default voice_intent_rules for NEW profiles ---------------------------
-- The five rules cover the most common phrasings we want the LLM to reliably
-- recognise. Existing users keep their empty `{}` and can add their own
-- rules through the upcoming Settings UI; we don't backfill on purpose so
-- a returning user doesn't suddenly find new system-imposed rules.
alter table public.profiles
  alter column voice_intent_rules
  set default '{"отмена":"undo_last","стоп":"pause_current","пауза":"pause_current","добавь цель":"add_goal","добавить цель":"add_goal"}'::jsonb;

commit;
