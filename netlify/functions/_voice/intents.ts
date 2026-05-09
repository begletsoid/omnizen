/**
 * Intent registry — the extension surface for voice commands.
 *
 * Each entry teaches the LLM about a new command (system prompt is generated
 * from this map in llm.ts) AND tells the dispatcher how to apply it. To add
 * a new command: one entry here, no other code changes required.
 *
 * Phase 2 (current):
 *   - start_microtask: now has mode='resume' | 'create' (find-or-create).
 *   - pause_current: stop the running task without creating a new one.
 *   - add_goal: create a goal, optionally with value/expected_hours.
 *   - undo_last: revert the most recent applied voice command (in undo.ts).
 *
 * undo_last lives in undo.ts (separate module to keep the registry simple)
 * but is re-exported here so the LLM/dispatcher see a unified registry.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { applyUndoLast, validateUndoLast } from './undo';
import type {
  AddGoalPayload,
  ApplyResult,
  PauseCurrentPayload,
  StartMicrotaskPayload,
  SummaryPair,
  WebhookContext,
} from './types';

/**
 * Build the single-line "Title. Body" representation used for in-app toasts
 * and the legacy `applied_summary` text column. Punctuates so the body
 * doesn't look chopped after the title.
 */
export function summaryText(pair: SummaryPair): string {
  if (!pair.body) return pair.title;
  return `${pair.title}. ${pair.body}`;
}

export type IntentSpec = {
  /** Human-readable summary used in the LLM system prompt. */
  description: string;
  /** Block of pseudo-code shown in the prompt so the LLM knows the schema. */
  payloadShape: string;
  /** Validate the LLM-returned payload at runtime. Throw on invalid. */
  validatePayload: (raw: unknown) => Record<string, unknown>;
  /** Mutate the DB and produce {outcome, summary}. */
  apply: (
    supabase: SupabaseClient,
    payload: Record<string, unknown>,
    ctx: WebhookContext,
  ) => Promise<ApplyResult>;
};

// ============================================================================
// start_microtask (Phase 2: resume | create)
// ============================================================================

function validateStartMicrotask(raw: unknown): StartMicrotaskPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('payload is not an object');
  }
  const obj = raw as Record<string, unknown>;
  // mode is the discriminator. Default to 'create' for back-compat with any
  // prompt edge case where the LLM forgets to emit it.
  const mode = obj.mode === 'resume' ? 'resume' : 'create';
  const resume_task_id =
    typeof obj.resume_task_id === 'string' ? obj.resume_task_id : null;
  const new_task_title =
    typeof obj.new_task_title === 'string' && obj.new_task_title.trim().length > 0
      ? obj.new_task_title.trim().slice(0, 200)
      : null;
  const goal_id = typeof obj.goal_id === 'string' ? obj.goal_id : null;
  const category_ids = Array.isArray(obj.category_ids)
    ? obj.category_ids.filter((x): x is string => typeof x === 'string')
    : [];

  if (mode === 'resume' && !resume_task_id) {
    throw new Error('mode=resume requires resume_task_id');
  }
  if (mode === 'create' && !new_task_title) {
    throw new Error('mode=create requires new_task_title');
  }

  return { mode, resume_task_id, new_task_title, goal_id, category_ids };
}

/**
 * Load the categories attached to a goal via `goal_category_links`. Mirrors
 * the source-of-truth used by the goal→micro-task drag-drop (see
 * src/widgets/microTasks/MicroTasksWidget.tsx:213-218 and the goal SELECT
 * in src/features/tasks/api.ts:23). Returns the user's own category UUIDs
 * (the user_id filter is enforced through goals — RLS on goal_category_links
 * itself trusts the goals row's owner).
 */
async function getGoalCategoryIds(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('goal_category_links')
    .select('category_id, goals!inner(user_id)')
    .eq('goal_id', goalId)
    .eq('goals.user_id', userId);
  if (error) throw new Error(`goal categories lookup: ${error.message}`);
  return (data ?? [])
    .map((row) => (row as { category_id?: string }).category_id)
    .filter((id): id is string => typeof id === 'string');
}

async function resolveTargetTasksWidget(
  supabase: SupabaseClient,
  ctx: WebhookContext,
): Promise<string> {
  if (ctx.voiceTargetWidgetId) return ctx.voiceTargetWidgetId;

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
  if (!widget) throw new Error('user has no `tasks`-type widget — add one first');

  await supabase
    .from('profiles')
    .update({ voice_target_widget_id: widget.id })
    .eq('id', ctx.userId);
  return widget.id;
}

/**
 * Pause whatever micro-task is currently running (if any), incrementing its
 * elapsed_seconds with the time since last_started_at. Returns the paused
 * task's id so callers can record it.
 *
 * Shared between every intent that needs to free up the "single running
 * task" slot before doing its own work.
 */
async function pauseRunningTask(
  supabase: SupabaseClient,
  userId: string,
  excludeTaskId: string | null = null,
): Promise<string | null> {
  let query = supabase
    .from('micro_tasks')
    .select('id, last_started_at, elapsed_seconds, title')
    .eq('user_id', userId)
    .eq('timer_state', 'running')
    .is('archived_at', null);
  if (excludeTaskId) query = query.neq('id', excludeTaskId);
  const { data: running, error: lookupErr } = await query.maybeSingle();
  if (lookupErr) throw new Error(`running lookup: ${lookupErr.message}`);
  if (!running) return null;

  const startedAt = running.last_started_at as string | null;
  const elapsedSeconds = Number(running.elapsed_seconds ?? 0);
  const increment = startedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000))
    : 0;
  const { error: pauseErr } = await supabase
    .from('micro_tasks')
    .update({
      timer_state: 'paused',
      last_started_at: null,
      elapsed_seconds: elapsedSeconds + increment,
    })
    .eq('id', running.id)
    .eq('user_id', userId);
  if (pauseErr) throw new Error(`pause running: ${pauseErr.message}`);
  return running.id as string;
}

async function applyStartMicrotask(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  ctx: WebhookContext,
): Promise<ApplyResult> {
  const p = payload as StartMicrotaskPayload;
  const nowIso = new Date().toISOString();

  if (p.mode === 'resume') {
    // Validate the target task exists, isn't archived, belongs to user.
    const { data: target, error: lookupErr } = await supabase
      .from('micro_tasks')
      .select('id, title, timer_state')
      .eq('id', p.resume_task_id!)
      .eq('user_id', ctx.userId)
      .is('archived_at', null)
      .maybeSingle();
    if (lookupErr) throw new Error(`resume lookup: ${lookupErr.message}`);
    if (!target) throw new Error(`task ${p.resume_task_id} not found or archived`);

    // If it's already running — no-op, return early.
    if (target.timer_state === 'running') {
      return {
        outcome: { applied_task_id: target.id as string },
        summary: { title: 'Уже идёт', body: `«${target.title}»` },
      };
    }

    // Pause anyone else first, then start this one.
    const pausedId = await pauseRunningTask(supabase, ctx.userId, target.id as string);
    const { error: startErr } = await supabase
      .from('micro_tasks')
      .update({ timer_state: 'running', last_started_at: nowIso })
      .eq('id', target.id)
      .eq('user_id', ctx.userId);
    if (startErr) throw new Error(`resume start: ${startErr.message}`);

    return {
      outcome: { applied_task_id: target.id as string, paused_task_id: pausedId },
      summary: { title: 'Возобновлена', body: `«${target.title}». Таймер запущен.` },
    };
  }

  // mode === 'create' ------------------------------------------------------
  const pausedId = await pauseRunningTask(supabase, ctx.userId);
  const widgetId = await resolveTargetTasksWidget(supabase, ctx);
  const { data: created, error: insertErr } = await supabase
    .from('micro_tasks')
    .insert({
      widget_id: widgetId,
      user_id: ctx.userId,
      title: p.new_task_title!,
      goal_id: p.goal_id,
      timer_state: 'never',
      elapsed_seconds: 0,
    })
    .select('id, title')
    .single();
  if (insertErr) throw new Error(`micro_tasks insert: ${insertErr.message}`);

  // Categories: when the new task is linked to a goal, INHERIT that goal's
  // categories rather than trusting the LLM's category_ids. Mirrors the
  // drag-drop behaviour at src/widgets/microTasks/MicroTasksWidget.tsx:213-218
  // (`goalCategoryIds = goal.categories?.map(c => c.id) ?? []`) so voice and
  // UI stay aligned. The LLM is explicitly told (in buildSystemPrompt rule
  // 5a) to leave category_ids=[] when goal_id is set, but we belt-and-braces
  // override here in case it forgets.
  const categoryIds = p.goal_id
    ? await getGoalCategoryIds(supabase, ctx.userId, p.goal_id)
    : p.category_ids;

  if (categoryIds.length > 0) {
    const { data: ownedCategories, error: catLookupErr } = await supabase
      .from('task_categories')
      .select('id')
      .eq('user_id', ctx.userId)
      .in('id', categoryIds);
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

  const { error: startErr } = await supabase
    .from('micro_tasks')
    .update({ timer_state: 'running', last_started_at: nowIso })
    .eq('id', created.id)
    .eq('user_id', ctx.userId);
  if (startErr) throw new Error(`start timer: ${startErr.message}`);

  const goalSuffix = p.goal_id ? ', привязана к цели' : '';
  return {
    outcome: { applied_task_id: created.id as string, paused_task_id: pausedId },
    summary: {
      title: 'Создана задача',
      body: `«${created.title}»${goalSuffix}. Таймер запущен.`,
    },
  };
}

// ============================================================================
// pause_current
// ============================================================================

function validatePauseCurrent(_raw: unknown): PauseCurrentPayload {
  return {};
}

async function applyPauseCurrent(
  supabase: SupabaseClient,
  _payload: Record<string, unknown>,
  ctx: WebhookContext,
): Promise<ApplyResult> {
  // Read the running task BEFORE pausing so we can name it in the summary.
  const { data: running, error: lookupErr } = await supabase
    .from('micro_tasks')
    .select('id, title, last_started_at, elapsed_seconds')
    .eq('user_id', ctx.userId)
    .eq('timer_state', 'running')
    .is('archived_at', null)
    .maybeSingle();
  if (lookupErr) throw new Error(`running lookup: ${lookupErr.message}`);
  if (!running) {
    return { outcome: {}, summary: { title: 'Пауза', body: 'Активной задачи не было.' } };
  }
  const pausedId = await pauseRunningTask(supabase, ctx.userId);
  if (!pausedId) {
    return { outcome: {}, summary: { title: 'Пауза', body: 'Активной задачи не было.' } };
  }
  // Compute total elapsed for the human summary (including the just-added increment).
  const startedAt = running.last_started_at as string | null;
  const baseElapsed = Number(running.elapsed_seconds ?? 0);
  const increment = startedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000))
    : 0;
  const totalSeconds = baseElapsed + increment;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const elapsedHuman = minutes > 0 ? `${minutes} мин ${seconds} сек` : `${seconds} сек`;
  return {
    outcome: { paused_task_id: pausedId },
    summary: {
      title: 'Пауза',
      body: `«${running.title}» (на счётчике ${elapsedHuman}).`,
    },
  };
}

// ============================================================================
// add_goal
// ============================================================================

function validateAddGoal(raw: unknown): AddGoalPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('payload is not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string' || obj.title.trim().length === 0) {
    throw new Error('title must be a non-empty string');
  }
  // value & expected_hours arrive as numbers OR null. Accept strings for
  // robustness ("100 часов" → LLM might send "100"); coerce.
  const coerceNumber = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    title: obj.title.trim().slice(0, 200),
    value: coerceNumber(obj.value),
    expected_hours: coerceNumber(obj.expected_hours),
  };
}

async function resolveTargetGoalsWidget(
  supabase: SupabaseClient,
  ctx: WebhookContext,
): Promise<string> {
  if (ctx.voiceTargetGoalsWidgetId) return ctx.voiceTargetGoalsWidgetId;

  const { data: dashboards, error: dashErr } = await supabase
    .from('dashboards')
    .select('id')
    .eq('user_id', ctx.userId);
  if (dashErr) throw new Error(`dashboards lookup: ${dashErr.message}`);
  const dashboardIds = (dashboards ?? []).map((d) => d.id);
  if (dashboardIds.length === 0) {
    throw new Error('user has no dashboards — cannot create goal');
  }
  const { data: widgets, error: widgetErr } = await supabase
    .from('widgets')
    .select('id')
    .eq('type', 'goals')
    .in('dashboard_id', dashboardIds)
    .order('created_at', { ascending: true })
    .limit(1);
  if (widgetErr) throw new Error(`widgets lookup: ${widgetErr.message}`);
  const widget = widgets?.[0];
  if (!widget) throw new Error('user has no `goals`-type widget — add one first');

  await supabase
    .from('profiles')
    .update({ voice_target_goals_widget_id: widget.id })
    .eq('id', ctx.userId);
  return widget.id;
}

async function applyAddGoal(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  ctx: WebhookContext,
): Promise<ApplyResult> {
  const p = payload as AddGoalPayload;
  const widgetId = await resolveTargetGoalsWidget(supabase, ctx);

  // Compute next sort_order so the new goal lands at the bottom.
  const { data: maxRow, error: maxErr } = await supabase
    .from('goals')
    .select('sort_order')
    .eq('widget_id', widgetId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) throw new Error(`max sort_order lookup: ${maxErr.message}`);
  const nextOrder = ((maxRow?.sort_order as number | null) ?? 0) + 1;

  const { data: created, error: insertErr } = await supabase
    .from('goals')
    .insert({
      widget_id: widgetId,
      user_id: ctx.userId,
      title: p.title,
      value: p.value ?? 0,
      expected_hours: p.expected_hours ?? 0,
      sort_order: nextOrder,
    })
    .select('id, title')
    .single();
  if (insertErr) throw new Error(`goals insert: ${insertErr.message}`);

  // Body — title in quotes plus optional value/hours suffix.
  const meta: string[] = [];
  if (p.expected_hours !== null) meta.push(`${p.expected_hours} ч`);
  if (p.value !== null) meta.push(`${p.value} баллов`);
  const body = meta.length > 0
    ? `«${created.title}» (${meta.join(', ')}).`
    : `«${created.title}».`;
  return {
    outcome: { applied_goal_id: created.id as string },
    summary: { title: 'Создана цель', body },
  };
}

// ============================================================================
// Registry
// ============================================================================

export const INTENT_REGISTRY: Record<string, IntentSpec> = {
  start_microtask: {
    description:
      'Запустить микрозадачу. Если в НЕДАВНИЕ_АКТИВНЫЕ_МИКРОЗАДАЧИ есть очень похожая по смыслу — ставь mode="resume" с её UUID. Иначе mode="create": если фраза явно про какую-то ОТКРЫТАЯ_ЦЕЛЬ — выставь её UUID в goal_id.',
    payloadShape: `{
  "mode": "resume" | "create",
  "resume_task_id": string | null,     // UUID существующей задачи (только при mode="resume")
  "new_task_title": string | null,     // короткое название (только при mode="create")
  "goal_id": string | null,            // UUID цели если задача явно к ней относится
  "category_ids": string[]             // 0..3 UUID из ДОСТУПНЫЕ_КАТЕГОРИИ (только при mode="create")
}`,
    validatePayload: (raw) =>
      validateStartMicrotask(raw) as unknown as Record<string, unknown>,
    apply: applyStartMicrotask,
  },

  pause_current: {
    description:
      'Поставить текущую работающую микрозадачу на паузу, ничего не создавая. Используй для команд "стоп", "пауза", "закончил".',
    payloadShape: `{}`,
    validatePayload: (raw) => validatePauseCurrent(raw) as Record<string, unknown>,
    apply: applyPauseCurrent,
  },

  add_goal: {
    description:
      'Создать новую цель в виджете целей. Используй для "добавь цель X", опционально с "цена N" / "время N часов".',
    payloadShape: `{
  "title": string,                     // название цели
  "value": number | null,              // ценность (баллы для heatmap)
  "expected_hours": number | null      // план часов до десятых (например 100 или 2.5)
}`,
    validatePayload: (raw) => validateAddGoal(raw) as unknown as Record<string, unknown>,
    apply: applyAddGoal,
  },

  undo_last: {
    description:
      'Откатить последнюю применённую голосовую команду (как Ctrl+Z). Используй для "отмена". Может стоять перед другой командой ("отмена, начни X") — тогда сначала undo, потом следующая команда.',
    payloadShape: `{}`,
    validatePayload: (raw) => validateUndoLast(raw) as Record<string, unknown>,
    apply: applyUndoLast,
  },
};

export function listKnownIntents(): string[] {
  return Object.keys(INTENT_REGISTRY);
}

// Export internal helpers reused from undo.ts to keep undo logic isolated.
export { pauseRunningTask };
