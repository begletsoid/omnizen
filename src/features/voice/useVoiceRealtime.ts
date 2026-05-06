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
  text: string;
  /** Sub-text shown below the main text (e.g. error_detail). */
  detail?: string | null;
};

const TOAST_TTL_MS = 4000;

function summariseTitle(row: VoiceTranscriptionRow): string {
  const payload = row.applied_payload;
  if (payload && typeof payload === 'object' && 'new_task_title' in payload) {
    const title = (payload as { new_task_title?: unknown }).new_task_title;
    if (typeof title === 'string') return title;
  }
  if (row.raw_transcript) return row.raw_transcript.slice(0, 80);
  return '(без названия)';
}

function statusToToast(row: VoiceTranscriptionRow): VoiceToast | null {
  if (row.status === 'applied') {
    return {
      id: row.id,
      kind: 'applied',
      text: `Голос: «${summariseTitle(row)}» запущена`,
    };
  }
  // Error variants: short user-facing message + technical detail.
  const errorTitles: Record<string, string> = {
    error_stt: 'Не разобрал звук',
    error_llm: 'Не смог классифицировать',
    error_apply: 'Ошибка применения',
    error_hallucination: 'Слышу только тишину',
    error_quota: 'Лимит на сегодня исчерпан',
    error_unknown_intent: 'Команда не поддерживается',
  };
  const title = errorTitles[row.status];
  if (!title) return null;
  return {
    id: row.id,
    kind: 'error',
    text: title,
    detail: row.error_detail ?? null,
  };
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
