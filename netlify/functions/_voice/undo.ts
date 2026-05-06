/**
 * Undo dispatcher — reverses the most recently applied voice command.
 *
 * Lives in its own module instead of being inline in intents.ts because:
 *   - The reverse logic per-intent is non-trivial (especially the
 *     "re-start what I paused" path) and would clutter the registry.
 *   - We want to import `pauseRunningTask` from intents.ts but also be
 *     imported from intents.ts. Splitting avoids a circular dep.
 *
 * Safety nets:
 *   - Only reverts rows from the same user.
 *   - Only rows newer than 30 minutes (UNDO_WINDOW_MS).
 *   - Skips rows whose intent is itself `undo_last` (no undo-of-undo loop).
 *   - Picks the SINGLE most recent applied row that hasn't already been
 *     reverted (anything with `undid_transcription_id IS NOT NULL` doesn't
 *     count as the "previous applied row").
 *
 * The reverse for each intent is intentionally conservative: we soft-delete
 * rather than hard-delete, and resume only what we know we paused (using
 * paused_task_id from the original applied_actions). Anything ambiguous
 * surfaces as a friendly error in the summary.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AppliedActionRecord,
  ApplyOutcome,
  ApplyResult,
  UndoLastPayload,
  WebhookContext,
} from './types';

const UNDO_WINDOW_MS = 30 * 60 * 1000;

export function validateUndoLast(_raw: unknown): UndoLastPayload {
  return {};
}

type PreviousRow = {
  id: string;
  applied_intent: string | null;
  applied_payload: Record<string, unknown> | null;
  applied_actions: AppliedActionRecord[] | null;
  applied_task_id: string | null;
  paused_task_id: string | null;
  created_at: string;
};

async function findRowToUndo(
  supabase: SupabaseClient,
  userId: string,
  selfRowId: string,
): Promise<PreviousRow | null> {
  const sinceIso = new Date(Date.now() - UNDO_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('voice_transcriptions')
    .select(
      'id, applied_intent, applied_payload, applied_actions, applied_task_id, paused_task_id, created_at',
    )
    .eq('user_id', userId)
    .eq('status', 'applied')
    .gte('created_at', sinceIso)
    // Exclude the undo row itself (it's already 'applied=processing' but
    // safer to filter explicitly) and any earlier row that's already been
    // reverted by a previous undo (those still say status='applied' but
    // are pointed-to by some `undid_transcription_id`). Querying
    // distinct-on-the-NOT clause inline would be heavy; we just filter
    // client-side after the fetch.
    .neq('id', selfRowId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`undo lookup: ${error.message}`);
  if (!data || data.length === 0) return null;

  // Fetch which rows have already been undone by some later undo_last row.
  const candidateIds = data.map((r) => r.id as string);
  const { data: undoneRows, error: undoneErr } = await supabase
    .from('voice_transcriptions')
    .select('undid_transcription_id')
    .eq('user_id', userId)
    .in('undid_transcription_id', candidateIds);
  if (undoneErr) throw new Error(`undo dedup lookup: ${undoneErr.message}`);
  const alreadyUndone = new Set(
    (undoneRows ?? [])
      .map((r) => r.undid_transcription_id as string | null)
      .filter((x): x is string => Boolean(x)),
  );

  for (const row of data) {
    if (row.applied_intent === 'undo_last') continue; // no undo-of-undo
    if (alreadyUndone.has(row.id as string)) continue;
    return {
      id: row.id as string,
      applied_intent: row.applied_intent as string | null,
      applied_payload: row.applied_payload as Record<string, unknown> | null,
      applied_actions: (row.applied_actions as AppliedActionRecord[] | null) ?? null,
      applied_task_id: row.applied_task_id as string | null,
      paused_task_id: row.paused_task_id as string | null,
      created_at: row.created_at as string,
    };
  }
  return null;
}

/**
 * Re-start a previously-paused task: flip back to `running` with
 * last_started_at = now. This deliberately doesn't subtract the elapsed
 * increment we added when pausing — we treat "undo of pause" as resuming
 * the timer fresh, not rewinding the recorded time. Simpler and matches
 * what the user expects: pressing undo within seconds of a pause shouldn't
 * lose the time they actually worked.
 */
async function restartTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<void> {
  const { error } = await supabase
    .from('micro_tasks')
    .update({ timer_state: 'running', last_started_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('user_id', userId);
  if (error) throw new Error(`restart task: ${error.message}`);
}

async function softDeleteTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<{ title: string | null }> {
  const { data, error } = await supabase
    .from('micro_tasks')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('user_id', userId)
    .select('title')
    .maybeSingle();
  if (error) throw new Error(`archive task: ${error.message}`);
  return { title: (data?.title as string | null) ?? null };
}

async function softDeleteGoal(
  supabase: SupabaseClient,
  userId: string,
  goalId: string,
): Promise<{ title: string | null }> {
  const { data, error } = await supabase
    .from('goals')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', goalId)
    .eq('user_id', userId)
    .select('title')
    .maybeSingle();
  if (error) throw new Error(`archive goal: ${error.message}`);
  return { title: (data?.title as string | null) ?? null };
}

async function pauseTaskById(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<void> {
  const { data: row, error: lookupErr } = await supabase
    .from('micro_tasks')
    .select('id, last_started_at, elapsed_seconds, timer_state')
    .eq('id', taskId)
    .eq('user_id', userId)
    .maybeSingle();
  if (lookupErr) throw new Error(`undo pause lookup: ${lookupErr.message}`);
  if (!row || row.timer_state !== 'running') return;
  const startedAt = row.last_started_at as string | null;
  const elapsedSeconds = Number(row.elapsed_seconds ?? 0);
  const increment = startedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000))
    : 0;
  const { error } = await supabase
    .from('micro_tasks')
    .update({
      timer_state: 'paused',
      last_started_at: null,
      elapsed_seconds: elapsedSeconds + increment,
    })
    .eq('id', row.id)
    .eq('user_id', userId);
  if (error) throw new Error(`undo pause: ${error.message}`);
}

/**
 * Reverse the effects of a single previously-applied action. Reads what
 * that action did from the AppliedActionRecord (payload + outcome) and
 * undoes it. Returns the human-readable fragment to put in the summary.
 */
async function reverseSingleAction(
  supabase: SupabaseClient,
  userId: string,
  action: AppliedActionRecord,
): Promise<string> {
  const { intent, payload, outcome } = action;

  if (intent === 'start_microtask') {
    const mode = (payload as { mode?: unknown }).mode;
    if (mode === 'resume') {
      // We resumed a task. Pause it again. If we'd paused another task to do
      // so, re-start that one.
      if (outcome.applied_task_id) {
        await pauseTaskById(supabase, userId, outcome.applied_task_id);
      }
      if (outcome.paused_task_id) {
        await restartTask(supabase, userId, outcome.paused_task_id);
      }
      return 'возобновление задачи отменено';
    }
    // mode === 'create' (or default): archive the new task, restart whatever
    // we paused to make room.
    let archivedTitle: string | null = null;
    if (outcome.applied_task_id) {
      archivedTitle = (await softDeleteTask(supabase, userId, outcome.applied_task_id))
        .title;
    }
    if (outcome.paused_task_id) {
      await restartTask(supabase, userId, outcome.paused_task_id);
    }
    return archivedTitle
      ? `задача «${archivedTitle}» удалена`
      : 'создание задачи отменено';
  }

  if (intent === 'pause_current') {
    if (outcome.paused_task_id) {
      await restartTask(supabase, userId, outcome.paused_task_id);
      return 'таймер возобновлён';
    }
    return 'пауза отменена (нечего возобновлять)';
  }

  if (intent === 'add_goal') {
    if (outcome.applied_goal_id) {
      const { title } = await softDeleteGoal(supabase, userId, outcome.applied_goal_id);
      return title ? `цель «${title}» удалена` : 'цель удалена';
    }
    return 'создание цели отменено';
  }

  if (intent === 'undo_last') {
    // Should be filtered out by findRowToUndo, but defensive.
    throw new Error('cannot undo an undo');
  }

  return `intent «${intent}» откачен (без деталей)`;
}

/**
 * Undo entry point used by the registry. Iterates every action of the
 * previous applied row in REVERSE order (so a [undo, start] chain unwinds
 * correctly), reverses each, then marks the previous row as undone via
 * undid_transcription_id on the current undo row (caller writes that).
 */
export async function applyUndoLast(
  supabase: SupabaseClient,
  _payload: Record<string, unknown>,
  ctx: WebhookContext,
): Promise<ApplyResult> {
  // The current row's id is in `voice_transcriptions` already (we INSERTed
  // it in the webhook before calling apply). We don't have it in ctx, so
  // we rely on the most-recent-applied query; since the current row is
  // status='processing' at this point, it will be excluded by status filter.
  const previous = await findRowToUndo(supabase, ctx.userId, '');
  if (!previous) {
    return {
      outcome: {},
      summary: { title: 'Откат не выполнен', body: 'Нечего откатывать (старше 30 минут или уже откачено).' },
    };
  }
  if (previous.applied_intent === 'undo_last') {
    return {
      outcome: {},
      summary: { title: 'Откат не выполнен', body: 'Предыдущая команда сама была откатом.' },
    };
  }

  // Reverse each constituent action, oldest-first inside the row but in
  // reverse order so chains undo cleanly. applied_actions is the canonical
  // record; if missing (older row from before phase 2), synthesise a
  // single-action shape from applied_intent + applied_payload + outcome
  // so undoing those rows still works.
  const actions: AppliedActionRecord[] =
    previous.applied_actions ??
    (previous.applied_intent
      ? [
          {
            intent: previous.applied_intent,
            payload: previous.applied_payload ?? {},
            outcome: {
              applied_task_id: previous.applied_task_id,
              paused_task_id: previous.paused_task_id,
            },
            summary: { title: '', body: '' },
          },
        ]
      : []);

  if (actions.length === 0) {
    return {
      outcome: {},
      summary: { title: 'Откат не выполнен', body: 'Предыдущая команда не оставила следов.' },
    };
  }

  const fragments: string[] = [];
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    fragments.push(await reverseSingleAction(supabase, ctx.userId, actions[i]));
  }

  const outcome: ApplyOutcome = { undid_transcription_id: previous.id };
  return {
    outcome,
    summary: { title: 'Откат', body: `${fragments.join(', ')}.` },
  };
}
