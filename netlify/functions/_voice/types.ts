/**
 * Shared types for the voice-microtask pipeline.
 *
 * These mirror the `voice_transcriptions` table schema from
 * supabase/migrations/20260505000000_voice_microtask.sql plus the LLM
 * response contract documented in plans/ancient-percolating-fairy.md.
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
 * The shape the LLM MUST return. `intent` is checked against the intent
 * registry; unknown values fall through to `error_unknown_intent`. The
 * payload is intent-specific and validated by the corresponding spec.
 *
 * Adding a new intent = one entry in INTENT_REGISTRY + a payload type below.
 * No other code changes required.
 */
export type LlmClassification = {
  intent: string;
  payload: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  raw_user_phrase: string;
};

// --- Intent payload types ---------------------------------------------------

export type StartMicrotaskPayload = {
  /** New micro-task title (cleaned up, ready to display). */
  new_task_title: string;
  /** Goal to attach the task to (UUID from goals table) or null. */
  goal_id: string | null;
  /** ID of an existing recent micro-task whose categories to reuse, or null. */
  similar_task_id: string | null;
  /** Final list of category IDs to attach (subset of user's existing categories). */
  category_ids: string[];
};

// --- Webhook input/output ---------------------------------------------------

export type WebhookContext = {
  userId: string;
  voiceTargetWidgetId: string | null;
  voiceIntentRules: Record<string, string>;
};

export type ApplyOutcome = {
  applied_task_id?: string | null;
  paused_task_id?: string | null;
};
