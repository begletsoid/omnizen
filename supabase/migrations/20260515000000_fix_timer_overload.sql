-- Fix function overloading caused by 20260514000000_timer_started_offset.
--
-- That migration used CREATE OR REPLACE FUNCTION with a NEW signature
-- (added `p_started_offset_seconds integer default 0` to both
-- start_micro_task_timer and create_micro_task_with_start). Postgres
-- treats functions with different argument lists as DISTINCT functions,
-- so CREATE OR REPLACE only matched the new signature — the old
-- 1-arg / 8-arg definitions stayed in place. PostgREST then can't
-- choose between the two when a client calls the RPC with the old
-- parameter set:
--
--   { "code": "PGRST203", "message":
--     "Could not choose the best candidate function between:
--      public.start_micro_task_timer(p_task_id => uuid),
--      public.start_micro_task_timer(p_task_id => uuid,
--                                    p_started_offset_seconds => integer)" }
--
-- That breaks the smoke test, the existing prod frontend bundle
-- (`Cu01VGZw.js`), and the desktop Electron app — all of which call
-- with the old parameter set.
--
-- Fix: drop the old signatures explicitly. The newer functions have
-- `default 0` on the offset parameter, so legacy callers transparently
-- match the surviving definitions without code changes.

begin;

drop function if exists public.start_micro_task_timer(uuid);
drop function if exists public.create_micro_task_with_start(
  uuid, uuid, text, integer, boolean, uuid, integer, uuid
);

commit;
