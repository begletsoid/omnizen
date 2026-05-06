/**
 * Intent registry — the extension surface for future voice commands.
 *
 * Adding a new intent = one new entry here + the matching `apply` function.
 * The LLM system prompt is generated from this map (see llm.ts), so adding
 * an intent automatically teaches the LLM to recognise it.
 *
 * MVP ships with one intent: `start_microtask`. Future entries (add_goal,
 * resume_existing, add_note, mark_habit_done) are documented in the plan
 * file but DELIBERATELY not in the registry — the LLM should not propose
 * intents the dispatcher can't apply.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ApplyOutcome,
  StartMicrotaskPayload,
  WebhookContext,
} from './types';

export type IntentSpec = {
  /** Human-readable summary used in the LLM system prompt. */
  description: string;
  /** When the LLM emits this intent, what the payload SHOULD look like. */
  payloadShape: string;
  /** Validate the LLM-returned payload at runtime. Throw on invalid. */
  validatePayload: (raw: unknown) => Record<string, unknown>;
  /** Apply the intent — mutate the DB and return effect IDs. */
  apply: (
    supabase: SupabaseClient,
    payload: Record<string, unknown>,
    ctx: WebhookContext,
  ) => Promise<ApplyOutcome>;
};

// --- start_microtask --------------------------------------------------------

function validateStartMicrotask(raw: unknown): StartMicrotaskPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('payload is not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.new_task_title !== 'string' || obj.new_task_title.trim().length === 0) {
    throw new Error('new_task_title must be a non-empty string');
  }
  const goal_id = obj.goal_id === null || obj.goal_id === undefined
    ? null
    : typeof obj.goal_id === 'string' ? obj.goal_id : null;
  const similar_task_id = obj.similar_task_id === null || obj.similar_task_id === undefined
    ? null
    : typeof obj.similar_task_id === 'string' ? obj.similar_task_id : null;
  const category_ids = Array.isArray(obj.category_ids)
    ? obj.category_ids.filter((x): x is string => typeof x === 'string')
    : [];
  return {
    new_task_title: obj.new_task_title.trim().slice(0, 200),
    goal_id,
    similar_task_id,
    category_ids,
  };
}

async function resolveTargetWidget(
  supabase: SupabaseClient,
  ctx: WebhookContext,
): Promise<string> {
  // Lazy-init: if profiles.voice_target_widget_id is null, find the user's
  // first 'tasks' widget and persist that choice for next time.
  if (ctx.voiceTargetWidgetId) return ctx.voiceTargetWidgetId;

  // The user owns dashboards; widgets join through dashboard_id. We look up
  // the user's tasks widget via that join.
  const { data: dashboards, error: dashErr } = await supabase
    .from('dashboards')
    .select('id')
    .eq('user_id', ctx.userId);
  if (dashErr) throw new Error(`dashboards lookup: ${dashErr.message}`);
  const dashboardIds = (dashboards ?? []).map((d) => d.id);
  if (dashboardIds.length === 0) {
    throw new Error('user has no dashboards — cannot create micro-task');
  }
  const { data: widgets, error: widgetErr } = await supabase
    .from('widgets')
    .select('id')
    .eq('type', 'tasks')
    .in('dashboard_id', dashboardIds)
    .order('created_at', { ascending: true })
    .limit(1);
  if (widgetErr) throw new Error(`widgets lookup: ${widgetErr.message}`);
  const widget = widgets?.[0];
  if (!widget) {
    throw new Error('user has no `tasks`-type widget — add one first');
  }

  // Persist for future calls.
  await supabase
    .from('profiles')
    .update({ voice_target_widget_id: widget.id })
    .eq('id', ctx.userId);
  return widget.id;
}

async function applyStartMicrotask(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  ctx: WebhookContext,
): Promise<ApplyOutcome> {
  const p = payload as StartMicrotaskPayload;

  // NOTE on RPC vs direct SQL:
  // The existing pause_micro_task_timer / start_micro_task_timer / attach_
  // categories_to_task RPCs are SECURITY DEFINER with internal `auth.uid()`
  // ownership checks. Calling them with a service-role JWT yields auth.uid()
  // = NULL, so every ownership predicate fails ("not found or not owned by
  // user"). Service-role bypasses RLS but doesn't invent a user identity.
  // Workaround: do the same updates with explicit user_id filters via the
  // service-role client. Race-safe enough for one user (no concurrent voice
  // commands in flight). Future fix: a *_as(p_task_id, p_user_id) variant
  // of the RPCs that takes user_id as a parameter.

  const nowIso = new Date().toISOString();

  // 1. Pause the currently running task (if any).
  let pausedId: string | null = null;
  const { data: running, error: runningErr } = await supabase
    .from('micro_tasks')
    .select('id, last_started_at, elapsed_seconds')
    .eq('user_id', ctx.userId)
    .eq('timer_state', 'running')
    .is('archived_at', null)
    .maybeSingle();
  if (runningErr) throw new Error(`running lookup: ${runningErr.message}`);
  if (running) {
    const startedAt = running.last_started_at as string | null;
    const elapsedSeconds = Number(running.elapsed_seconds ?? 0);
    const increment = startedAt
      ? Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(startedAt)) / 1000))
      : 0;
    const { error: pauseErr } = await supabase
      .from('micro_tasks')
      .update({
        timer_state: 'paused',
        last_started_at: null,
        elapsed_seconds: elapsedSeconds + increment,
      })
      .eq('id', running.id)
      .eq('user_id', ctx.userId);
    if (pauseErr) throw new Error(`pause running: ${pauseErr.message}`);
    pausedId = running.id;
  }

  // 2. Create the new micro-task in the user's target widget.
  const widgetId = await resolveTargetWidget(supabase, ctx);
  const { data: created, error: insertErr } = await supabase
    .from('micro_tasks')
    .insert({
      widget_id: widgetId,
      user_id: ctx.userId,
      title: p.new_task_title,
      goal_id: p.goal_id,
      timer_state: 'never',
      elapsed_seconds: 0,
    })
    .select('id')
    .single();
  if (insertErr) throw new Error(`micro_tasks insert: ${insertErr.message}`);

  // 3. Attach categories. Insert into the task_category_links join table
  //    directly — the attach_categories_to_task RPC also has the auth.uid()
  //    issue, and the join row needs no extra logic beyond (task_id, cat_id).
  if (p.category_ids.length > 0) {
    const { data: ownedCategories, error: catLookupErr } = await supabase
      .from('task_categories')
      .select('id')
      .eq('user_id', ctx.userId)
      .in('id', p.category_ids);
    if (catLookupErr) throw new Error(`category lookup: ${catLookupErr.message}`);
    const validIds = (ownedCategories ?? []).map((c) => c.id as string);
    if (validIds.length > 0) {
      const links = validIds.map((category_id) => ({
        task_id: created.id,
        category_id,
      }));
      const { error: linkErr } = await supabase
        .from('task_category_links')
        .insert(links);
      if (linkErr) throw new Error(`category link insert: ${linkErr.message}`);
    }
  }

  // 4. Start the timer on the new task. There can be no peer in 'running'
  //    state at this point (we paused above), so we just flip our own row.
  const { error: startErr } = await supabase
    .from('micro_tasks')
    .update({
      timer_state: 'running',
      last_started_at: nowIso,
    })
    .eq('id', created.id)
    .eq('user_id', ctx.userId);
  if (startErr) throw new Error(`start timer: ${startErr.message}`);

  return { applied_task_id: created.id, paused_task_id: pausedId };
}

// --- Registry ---------------------------------------------------------------

export const INTENT_REGISTRY: Record<string, IntentSpec> = {
  start_microtask: {
    description:
      'Начать новую микрозадачу прямо сейчас. Текущая работающая задача (если есть) автоматически паузится; новая создаётся и стартует таймер.',
    payloadShape: `{
  "new_task_title": string,            // нормализованное короткое название задачи
  "goal_id": string | null,            // UUID цели из ОТКРЫТЫЕ ЦЕЛИ если задача явно к ней относится
  "similar_task_id": string | null,    // UUID из НЕДАВНИЕ МИКРОЗАДАЧИ если очень похожая задача найдена (для переноса категорий)
  "category_ids": string[]             // 0..3 UUID из ДОСТУПНЫЕ КАТЕГОРИИ. Если similar_task_id указан — берём ЕГО категории.
}`,
    validatePayload: (raw) => validateStartMicrotask(raw) as unknown as Record<string, unknown>,
    apply: applyStartMicrotask,
  },
};

export function listKnownIntents(): string[] {
  return Object.keys(INTENT_REGISTRY);
}
