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

  // 1. Pause the currently running task (if any). The user's "previous
  //    activity" gets closed out so the new one can take the floor cleanly.
  let pausedId: string | null = null;
  const { data: running, error: runningErr } = await supabase
    .from('micro_tasks')
    .select('id')
    .eq('user_id', ctx.userId)
    .eq('timer_state', 'running')
    .is('archived_at', null)
    .maybeSingle();
  if (runningErr) throw new Error(`running lookup: ${runningErr.message}`);
  if (running) {
    const { error } = await supabase.rpc('pause_micro_task_timer', {
      p_task_id: running.id,
    });
    if (error) throw new Error(`pause_micro_task_timer: ${error.message}`);
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

  // 3. Attach categories (skip if empty — the LLM contract allows []).
  if (p.category_ids.length > 0) {
    const { error } = await supabase.rpc('attach_categories_to_task', {
      p_task_id: created.id,
      p_category_ids: p.category_ids,
      p_user_id: ctx.userId,
    });
    if (error) throw new Error(`attach_categories: ${error.message}`);
  }

  // 4. Start the timer. The RPC is idempotent re: pausing peers via the
  //    partial unique index `timer_state='running'`.
  const { error: startErr } = await supabase.rpc('start_micro_task_timer', {
    p_task_id: created.id,
  });
  if (startErr) throw new Error(`start_micro_task_timer: ${startErr.message}`);

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
