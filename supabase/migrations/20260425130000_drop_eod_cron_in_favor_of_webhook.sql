-- Drop the pg_cron schedule for end-of-day cleanup. The original design fired
-- cleanup at 04:30 user-local, but by 04:30 the user is still asleep — Apple
-- Watch hasn't recorded "wake up" yet, so no bedtime has arrived. By the time
-- bedtime DOES arrive (when the user wakes at 07:00, 08:00, etc.), the cron's
-- 04:30..04:44 window has already passed for the day, so cleanup never runs.
--
-- New design: the webhook itself calls `eod_cleanup_user` immediately after
-- updating `profiles.last_bedtime_at`. Bedtime arriving IS the signal — no
-- need for a separate clock-based trigger. The RPC's own double-run guard
-- (4h) prevents accidental re-runs if the Shortcut fires twice.
--
-- We keep `eod_cleanup_user` and `eod_cleanup_tick` themselves: the per-user
-- function is the unit of work for the webhook + smoke tests, and the tick
-- stays in case we later want a periodic safety-net trigger.

begin;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'omnizen-eod-cleanup';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end$$;

commit;
