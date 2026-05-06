/**
 * Subscribe to voice_transcriptions UPDATE events for the signed-in user.
 * Invalidates micro_tasks caches on `applied` so the widget reflects the
 * voice-driven mutation within ~200ms instead of waiting for the 10s poll.
 *
 * Also exposes a `toast` state that components (e.g. DashboardShell) can
 * render. Single global queue — at any moment only one voice toast is shown.
 *
 * This is the project's first Supabase Realtime channel. If the channel
 * fails to subscribe we fall back silently to polling (no error UI) — the
 * webhook still completes its work, the user just sees the change ~10s
 * later via TanStack Query's refetchInterval.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { subscribeVoiceTranscriptions } from './realtime';
import type { VoiceTranscriptionRow } from './types';

type ToastKind = 'applied' | 'error';

export type VoiceToast = {
  id: string;
  kind: ToastKind;
  /** Bold title line (mirrors iOS notification title). */
  text: string;
  /** Optional body line shown below the title (mirrors iOS body). */
  detail?: string | null;
};

const TOAST_TTL_MS = 4000;

/**
 * Pull the structured {title, body} pair from the row. Sources tried in
 * order: applied_actions[].summary (multi-action chains aggregated),
 * applied_summary string parsed back into title/body, or a synthesised
 * fallback for legacy phase-1 rows.
 */
function extractTitleBody(row: VoiceTranscriptionRow): { title: string; body: string } {
  // Preferred: structured per-action summaries from applied_actions.
  if (Array.isArray(row.applied_actions) && row.applied_actions.length > 0) {
    const titles: string[] = [];
    const bodies: string[] = [];
    for (const action of row.applied_actions) {
      const s = (action as { summary?: unknown }).summary;
      if (s && typeof s === 'object') {
        const t = (s as { title?: unknown }).title;
        const b = (s as { body?: unknown }).body;
        if (typeof t === 'string' && t.length > 0) titles.push(t);
        if (typeof b === 'string' && b.length > 0) bodies.push(b);
      }
    }
    if (titles.length > 0) {
      return { title: titles.join(' + '), body: bodies.join(' · ') };
    }
  }
  // Fallback: split applied_summary on the server's "Title. Body" join.
  if (typeof row.applied_summary === 'string' && row.applied_summary.length > 0) {
    const idx = row.applied_summary.indexOf('. ');
    if (idx > 0) {
      return {
        title: row.applied_summary.slice(0, idx),
        body: row.applied_summary.slice(idx + 2),
      };
    }
    return { title: row.applied_summary, body: '' };
  }
  // Legacy phase-1 fallback.
  const payload = row.applied_payload;
  if (payload && typeof payload === 'object' && 'new_task_title' in payload) {
    const title = (payload as { new_task_title?: unknown }).new_task_title;
    if (typeof title === 'string') {
      return { title: 'Создана задача', body: `«${title}». Таймер запущен.` };
    }
  }
  if (row.raw_transcript) {
    return { title: 'Голос', body: row.raw_transcript.slice(0, 80) };
  }
  return { title: 'Голос', body: 'команда применена' };
}

function statusToToast(row: VoiceTranscriptionRow): VoiceToast | null {
  if (row.status === 'applied') {
    const { title, body } = extractTitleBody(row);
    return { id: row.id, kind: 'applied', text: title, detail: body || null };
  }
  // Error variants: same extraction logic — applied_summary on errors is
  // populated by the webhook with a friendly title/body pair.
  const { title, body } = extractTitleBody(row);
  if (title) {
    return {
      id: row.id,
      kind: 'error',
      text: title,
      detail: body || row.error_detail || null,
    };
  }
  // Last-resort canonical map.
  const errorTitles: Record<string, string> = {
    error_stt: 'Не разобрал звук',
    error_llm: 'Не смог классифицировать',
    error_apply: 'Ошибка применения',
    error_hallucination: 'Слышу только тишину',
    error_quota: 'Лимит на сегодня исчерпан',
    error_unknown_intent: 'Команда не поддерживается',
  };
  const fallback = errorTitles[row.status];
  if (!fallback) return null;
  return { id: row.id, kind: 'error', text: fallback, detail: row.error_detail ?? null };
}

export function useVoiceRealtime(userId: string | null) {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<VoiceToast | null>(null);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeVoiceTranscriptions(userId, {
      onApplied: (row) => {
        // Voice mutation hit micro_tasks; invalidate any micro_tasks query.
        queryClient.invalidateQueries({ queryKey: ['micro_tasks'] });
        // Goals listing also depends on linked micro_tasks for elapsed totals.
        queryClient.invalidateQueries({ queryKey: ['goals'] });
        const t = statusToToast(row);
        if (t) setToast(t);
      },
      onError: (row) => {
        const t = statusToToast(row);
        if (t) setToast(t);
      },
    });
    return unsubscribe;
  }, [userId, queryClient]);

  // Auto-dismiss after TTL.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_TTL_MS);
    return () => clearTimeout(id);
  }, [toast]);

  return { toast, dismissToast };
}
