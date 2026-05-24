-- Atomic JSONB shallow merge for widget config patches.
--
-- Why this exists: `handleWidgetConfigPatch` (DashboardShell) used to read
-- the widget config from the React Query cache, merge the new patch on
-- the client, and persist the FULL merged config via `UPDATE widgets SET
-- config = $1`. That worked in single-tab/single-process flows but broke
-- in two situations:
--
--   1. Cross-tab race. Tab A finishes the ritual → state.stepIndex = 27,
--      persisted. Tab B's cache still holds the old config (no Realtime,
--      no auto-refetch with staleTime=Infinity). The user clicks the
--      chevron in Tab B → patch = {collapsed: true}, but the full config
--      that gets persisted INCLUDES Tab B's stale state.stepIndex = 0 —
--      silently clobbering Tab A's progress.
--
--   2. Cross-window race with the Electron desktop overlay: same shape,
--      different source.
--
-- The user hit exactly this on 2026-05-24: `ritual_answers` showed 36
-- progressions through the morning ritual at 6:00–6:34 AM, but
-- `widgets.config.state` was reset to `stepIndex: 0, values: {}` with
-- updated_at at 17:52 — ~11 hours later, after the user collapsed/expanded
-- the widget in some other context.
--
-- Fix: do the merge on the server. The client sends ONLY the patch (the
-- keys it wants to change), never the full config. Postgres' `||`
-- operator does a top-level shallow merge: keys in the patch overwrite
-- keys in the existing config, all other keys (like `state`) are
-- preserved. So persisting `{collapsed: true}` can NEVER touch `state`.
--
-- For full-state updates (where the user just answered a ritual step and
-- the patch IS `{state: <new full state>}`), the shallow merge still
-- works correctly — the `state` key is replaced wholesale with the new
-- object, which is the intended semantics: the client always sends a
-- complete `state` object when it touches it.

begin;

create or replace function public.patch_widget_config(
  p_widget_id uuid,
  p_patch jsonb
) returns public.widgets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.widgets%rowtype;
begin
  -- Authorize via the widget's dashboard ownership. `widgets` itself has
  -- no `user_id` column — RLS goes through `dashboards.user_id`.
  update public.widgets w
     set config = coalesce(w.config, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
         updated_at = now()
   where w.id = p_widget_id
     and exists (
       select 1 from public.dashboards d
        where d.id = w.dashboard_id
          and d.user_id = auth.uid()
     )
  returning w.* into v_row;

  if v_row.id is null then
    raise exception 'widget not found or not authorized' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

grant execute on function public.patch_widget_config(uuid, jsonb) to authenticated;

commit;
