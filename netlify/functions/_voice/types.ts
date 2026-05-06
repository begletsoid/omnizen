/**
 * Shared types for the voice-microtask pipeline (Phase 2).
 *
 * Mirrors the `voice_transcriptions` table schema from migrations
 * 20260505000000_voice_microtask.sql + 20260506000000_voice_phase2.sql,
 * plus the multi-action LLM response contract documented in
 * plans/ancient-percolating-fairy.md "Phase 2".
 *
 * Why types live in a non-function file (_voice prefix): Netlify treats every
 * `*.ts` directly under netlify/functions/ as an endpoint. Files inside an
 * underscore-prefixed subfolder are ignored as endpoints but are still bundled
 * by esbuild when imported from a function entry point.
 */

export type VoiceStatus =
  | 'received'
  | 'processing'
  | 'applied'
  | 'error_stt'
  | 'error_llm'
  | 'error_apply'
  | 'error_hallucination'
  | 'error_quota'
  | 'error_unknown_intent';

/**
 * Phase 2 LLM contract — a plan with one or more atomic actions.
 *
 * Single-intent commands return `actions: [single]`. Multi-action commands
 * (the canonical example: "Отмена, начни X" → undo_last + start_microtask)
 * return them in execution order.
 *
 * The dispatcher iterates `actions`, accumulating per-step summaries into
 * the final `applied_summary` shown to the user.
 */
export type LlmAction = {
  intent: string;
  payload: Record<string, unknown>;
};

export type LlmActionPlan = {
  actions: LlmAction[];
  confidence: 'high' | 'medium' | 'low';
  raw_user_phrase: string;
};

/**
 * Hard limit on how many actions one voice command can apply. Guards
 * against the LLM cascading: e.g. it should never decide to do undo +
 * pause + create + add_goal in one breath. Three is enough for the
 * realistic case (undo + new command).
 */
export const MAX_ACTIONS_PER_COMMAND = 3;

// --- Intent payload types ---------------------------------------------------

/**
 * Phase 2: start_microtask gained a `mode` switch. In `'resume'` we restart
 * an existing task by id (no new row). In `'create'` we behave like Phase 1.
 */
export type StartMicrotaskPayload = {
  mode: 'resume' | 'create';
  /** UUID of an existing micro-task to restart. Required when mode='resume'. */
  resume_task_id: string | null;
  /** New title. Required when mode='create'. */
  new_task_title: string | null;
  /** Goal to attach the new task to (only meaningful for mode='create'). */
  goal_id: string | null;
  /** Categories for the new task (only meaningful for mode='create'). */
  category_ids: string[];
};

/** Stop the currently running micro-task. No payload needed. */
export type PauseCurrentPayload = Record<string, never>;

/** Create a new goal in the user's goals widget. */
export type AddGoalPayload = {
  title: string;
  /** Heat-map point value; null lets the dispatcher pick a sensible default (0). */
  value: number | null;
  /** Planning estimate in hours, supports decimals (e.g. 2.5). */
  expected_hours: number | null;
};

/** Roll back the most recent applied voice command. No payload needed. */
export type UndoLastPayload = Record<string, never>;

// --- Webhook context + outcomes -------------------------------------------

export type WebhookContext = {
  userId: string;
  voiceTargetWidgetId: string | null;
  voiceTargetGoalsWidgetId: string | null;
  voiceIntentRules: Record<string, string>;
};

/**
 * Per-action outcome the dispatcher returns. Optional fields are filled
 * by whichever intent applied the change. Aggregated into the row's
 * `applied_actions` jsonb so the future History UI can render every step.
 */
export type ApplyOutcome = {
  applied_task_id?: string | null;
  paused_task_id?: string | null;
  /** UUID of a goal created/modified by this action. */
  applied_goal_id?: string | null;
  /** UUID of the prior voice_transcriptions row this action reverted. */
  undid_transcription_id?: string | null;
};

/**
 * Two-line human summary so the iOS push notification can render a bold
 * `title` line plus a regular `body` line. Title is short ("Создана задача",
 * "Возобновлена", "Пауза"), body has the specifics ("«X». 5 мин."). The
 * `text` field is the joined "Title. Body" representation used everywhere
 * we still need a single string (in-app toast, history list, debug logs).
 */
export type SummaryPair = {
  title: string;
  body: string;
};

/**
 * What every IntentSpec.apply must return: the outcome bookkeeping plus a
 * structured summary for the notification.
 */
export type ApplyResult = {
  outcome: ApplyOutcome;
  summary: SummaryPair;
};

/**
 * Persisted shape of a single applied action inside `applied_actions` jsonb.
 * Preserves the intent name, the payload that was actually applied (already
 * validated, post-LLM), and the outcome. Phase 2.1: summary is the
 * structured {title, body} pair.
 */
export type AppliedActionRecord = {
  intent: string;
  payload: Record<string, unknown>;
  outcome: ApplyOutcome;
  summary: SummaryPair;
};
