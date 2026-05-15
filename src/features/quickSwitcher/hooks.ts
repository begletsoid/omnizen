/**
 * Quick-switcher React Query hooks. Mirrors the patterns used by
 * `useMicroTasks` / `useToggleMicroTaskTimer` from
 * `src/features/microTasks/hooks.ts`, but cross-widget: every mutation
 * targets a single task identified by both its task id and its widget id
 * (the widget id comes off the row itself), so we can keep the dashboard's
 * cache and the overlay's cache in sync without ever needing to know
 * which board the user is currently looking at.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '../../lib/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import {
  pauseMicroTaskTimer,
  startMicroTaskTimer,
  transferMicroTaskTime,
  updateMicroTask,
} from '../microTasks/api';
import type { MicroTaskRecord } from '../microTasks/types';
import { normalizeTimerState } from '../microTasks/utils';

import { getActiveMicroTasksForUser } from './api';

const ACTIVE_QUERY_INTERVAL_MS = 5_000;

export const quickSwitcherQueryKey = (userId: string) => ['quickSwitcher', userId] as const;

/**
 * Fetches all in-progress micro-tasks for the current user across every
 * widget on their dashboard. Polls modestly (5s) so the overlay reflects
 * background changes from voice commands / other devices without being
 * chatty enough to hammer the API.
 */
export function useActiveMicroTasks() {
  const user = useAuthStore((state) => state.user);
  const enabled = Boolean(user && supabase);
  return useQuery<MicroTaskRecord[], Error>({
    queryKey: user ? quickSwitcherQueryKey(user.id) : ['quickSwitcher', 'anonymous'],
    enabled,
    refetchInterval: ACTIVE_QUERY_INTERVAL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const tasks = await getActiveMicroTasksForUser(user.id);
      return tasks.map((task) => ({
        ...task,
        timer_state: normalizeTimerState(task.timer_state),
      }));
    },
  });
}

/**
 * Cross-widget timer toggle. Unlike `useToggleMicroTaskTimer(widgetId)`,
 * this hook reads `widget_id` off the task itself so the overlay can flip
 * timers from any widget without enumerating them. After the mutation we
 * invalidate BOTH the overlay's cache and the originating widget's cache
 * — that way returning to the dashboard shows fresh state immediately.
 */
export function useToggleAnyMicroTaskTimer() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ task }: { task: MicroTaskRecord }) => {
      const isRunning = task.timer_state === 'running';
      return isRunning ? pauseMicroTaskTimer(task.id) : startMicroTaskTimer(task.id);
    },
    onMutate: async ({ task }) => {
      if (!user) return;
      const key = quickSwitcherQueryKey(user.id);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(key);
      const wasRunning = task.timer_state === 'running';
      const nowIso = new Date().toISOString();
      queryClient.setQueryData<MicroTaskRecord[]>(key, (old) =>
        old?.map((row) => {
          if (row.id === task.id) {
            // Same elapsed math as useToggleMicroTaskTimer: when pausing,
            // commit the active span; when starting, just flip flags.
            const elapsed =
              wasRunning && row.last_started_at
                ? row.elapsed_seconds +
                  Math.max(0, Math.floor((Date.now() - new Date(row.last_started_at).getTime()) / 1000))
                : row.elapsed_seconds;
            return {
              ...row,
              timer_state: wasRunning ? 'paused' : 'running',
              last_started_at: wasRunning ? null : nowIso,
              elapsed_seconds: elapsed,
            };
          }
          // Starting a new task also pauses other running tasks in the
          // SAME widget — mirror that here so the optimistic view matches
          // what the server will return.
          if (!wasRunning && row.widget_id === task.widget_id && row.timer_state === 'running') {
            const elapsed =
              row.last_started_at
                ? row.elapsed_seconds +
                  Math.max(0, Math.floor((Date.now() - new Date(row.last_started_at).getTime()) / 1000))
                : row.elapsed_seconds;
            return {
              ...row,
              timer_state: 'paused',
              last_started_at: null,
              elapsed_seconds: elapsed,
            };
          }
          return row;
        }) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!user || !context?.previous) return;
      queryClient.setQueryData(quickSwitcherQueryKey(user.id), context.previous);
    },
    onSettled: (_data, _err, { task }) => {
      if (user) queryClient.invalidateQueries({ queryKey: quickSwitcherQueryKey(user.id) });
      // Refresh the widget's own cache so returning to the dashboard
      // doesn't show a stale state for a few seconds.
      queryClient.invalidateQueries({ queryKey: ['microTasks', task.widget_id] });
      // Goals show aggregate elapsed seconds — same invalidation pattern
      // as useToggleMicroTaskTimer.
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

/**
 * Cross-widget time transfer. The drag mechanic in `useTimeTransferDrag`
 * works regardless of which widget two tasks belong to; the RPC itself
 * also doesn't care. We just need somewhere to thread the user id and
 * invalidate the right caches.
 */
export function useTransferAnyMicroTaskTime() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { fromTaskId: string; toTaskId: string; seconds: number }) => {
      if (!user) throw new Error('User not authenticated');
      return transferMicroTaskTime({ ...params, userId: user.id });
    },
    onSettled: () => {
      if (user) queryClient.invalidateQueries({ queryKey: quickSwitcherQueryKey(user.id) });
      // Coarse invalidation: any widget could host either of the two
      // tasks. The overhead of refetching all `micro_tasks` queries is
      // acceptable since transfers are rare events.
      queryClient.invalidateQueries({ queryKey: ['microTasks'] });
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

/**
 * Mark a task done from the overlay (clicking its number badge). The
 * UI plays a checkmark + fade animation BEFORE calling this; by the
 * time we mutate we just want the row gone. We optimistically drop it
 * from the overlay cache so the list reflows and the bottom-up hotkey
 * numbers recompute immediately, without waiting for a refetch.
 */
export function useMarkAnyMicroTaskDone() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ task }: { task: MicroTaskRecord }) => {
      await updateMicroTask(task.id, { is_done: true });
      return task;
    },
    onMutate: async ({ task }) => {
      if (!user) return;
      const key = quickSwitcherQueryKey(user.id);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(key);
      queryClient.setQueryData<MicroTaskRecord[]>(key, (old) =>
        old?.filter((row) => row.id !== task.id) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!user || !context?.previous) return;
      queryClient.setQueryData(quickSwitcherQueryKey(user.id), context.previous);
    },
    onSettled: (_data, _err, { task }) => {
      if (user) queryClient.invalidateQueries({ queryKey: quickSwitcherQueryKey(user.id) });
      queryClient.invalidateQueries({ queryKey: ['microTasks', task.widget_id] });
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}
