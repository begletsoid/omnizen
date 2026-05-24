import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '../../lib/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import {
  archiveGoal,
  attachCategoryToGoal,
  createGoal,
  createRecurringGoal,
  deleteGoal,
  deleteRecurringGoal,
  detachCategoryFromGoal,
  fetchMinGoalSortOrder,
  listGoals,
  listRecurringGoals,
  reorderGoals,
  updateGoal,
  updateRecurringGoal,
} from './api';
import type { GoalRecord, GoalUpdate, RecurringGoalInsert, RecurringGoalRecord } from './types';

const GOALS_REFETCH_INTERVAL_MS = 10_000;

export function useGoals(widgetId: string | null) {
  return useQuery({
    queryKey: ['goals', widgetId],
    queryFn: async () => {
      if (!widgetId || !supabase) return [];
      const { data, error } = await listGoals(widgetId);
      if (error) throw error;
      type RawRow = {
        id: string;
        widget_id: string;
        user_id: string;
        title: string;
        is_done: boolean;
        is_locked: boolean;
        is_recurring: boolean;
        value: number;
        expected_hours: number;
        sort_order: number;
        archived_at: string | null;
        created_at: string;
        updated_at: string;
        categories?: Array<{ category: { id: string; name: string; is_auto: boolean; color?: string | null; source_tag_id?: string | null; created_at: string; updated_at: string; user_id: string } }>;
      };
      const rows = (data as RawRow[]) ?? [];

      // Aggregate elapsed_seconds from ALL linked micro tasks (including archived and currently running).
      const goalIds = rows.map((r) => r.id);
      const elapsedByGoal = new Map<string, number>();
      if (goalIds.length > 0) {
        const { data: microRows, error: microError } = await supabase
          .from('micro_tasks')
          .select('goal_id, elapsed_seconds, timer_state, last_started_at')
          .in('goal_id', goalIds);
        if (microError) throw microError;
        const now = Date.now();
        for (const row of microRows ?? []) {
          if (!row.goal_id) continue;
          let seconds = typeof row.elapsed_seconds === 'number' ? row.elapsed_seconds : 0;
          if (row.timer_state === 'running' && row.last_started_at) {
            const started = Date.parse(row.last_started_at);
            if (!Number.isNaN(started)) {
              seconds += Math.max(0, Math.floor((now - started) / 1000));
            }
          }
          elapsedByGoal.set(row.goal_id, (elapsedByGoal.get(row.goal_id) ?? 0) + seconds);
        }
      }

      return rows.map((row): GoalRecord => ({
        ...row,
        categories: row.categories
          ?.map((link) => link.category)
          .filter(Boolean) ?? [],
        elapsed_seconds: elapsedByGoal.get(row.id) ?? 0,
      }));
    },
    enabled: !!widgetId && !!supabase,
    refetchInterval: GOALS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useCreateGoal(widgetId: string | null) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: async (data: { title: string; value?: number; expected_hours?: number; is_recurring?: boolean }) => {
      if (!widgetId || !user) throw new Error('Missing widgetId or user');
      const minOrder = await fetchMinGoalSortOrder(widgetId);
      const { data: row, error } = await createGoal({
        ...data,
        widget_id: widgetId,
        user_id: user.id,
        sort_order: minOrder - 1,
      });
      if (error) throw error;
      return row;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals', widgetId] });
    },
  });
}

export function useReorderGoals(widgetId: string | null) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      if (!widgetId || !user) throw new Error('Missing widgetId or user');
      await reorderGoals({
        widgetId,
        userId: user.id,
        updates: orderedIds.map((id) => ({ id })),
      });
    },
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: ['goals', widgetId] });
      const prev = queryClient.getQueryData<GoalRecord[]>(['goals', widgetId]);
      if (prev) {
        const byId = new Map(prev.map((g) => [g.id, g]));
        const next = orderedIds
          .map((id, idx) => {
            const goal = byId.get(id);
            return goal ? { ...goal, sort_order: idx + 1 } : null;
          })
          .filter((g): g is GoalRecord => g !== null);
        queryClient.setQueryData<GoalRecord[]>(['goals', widgetId], next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['goals', widgetId], ctx.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals', widgetId] });
    },
  });
}

export function useUpdateGoal(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string } & GoalUpdate) => {
      const { id, ...update } = data;
      const { data: row, error } = await updateGoal(id, update);
      if (error) throw error;
      return row;
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['goals', widgetId] });
      const prev = queryClient.getQueryData<GoalRecord[]>(['goals', widgetId]);
      queryClient.setQueryData<GoalRecord[]>(['goals', widgetId], (old) =>
        old?.map((g) => (g.id === data.id ? { ...g, ...data } : g)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['goals', widgetId], ctx.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals', widgetId] });
    },
  });
}

export function useDeleteGoal(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await deleteGoal(id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['goals', widgetId] });
      const prev = queryClient.getQueryData<GoalRecord[]>(['goals', widgetId]);
      queryClient.setQueryData<GoalRecord[]>(['goals', widgetId], (old) =>
        old?.filter((g) => g.id !== id),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['goals', widgetId], ctx.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals', widgetId] });
    },
  });
}

export function useArchiveGoal(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await archiveGoal(id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['goals', widgetId] });
      const prev = queryClient.getQueryData<GoalRecord[]>(['goals', widgetId]);
      queryClient.setQueryData<GoalRecord[]>(['goals', widgetId], (old) =>
        old?.filter((g) => g.id !== id),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['goals', widgetId], ctx.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals', widgetId] });
    },
  });
}

export function useAttachCategoryToGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ goalId, categoryId }: { goalId: string; categoryId: string }) => {
      const { error } = await attachCategoryToGoal(goalId, categoryId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      // The SQL trigger `goal_category_cascade` rewrites task_category_links
      // for every micro-task linked to this goal. Invalidate so the
      // dashboard/overlay reflects the new category set without waiting
      // for the per-widget polling refetch.
      void queryClient.invalidateQueries({ queryKey: ['microTasks'] });
      void queryClient.invalidateQueries({ queryKey: ['quickSwitcher'] });
    },
  });
}

export function useDetachCategoryFromGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ goalId, categoryId }: { goalId: string; categoryId: string }) => {
      const { error } = await detachCategoryFromGoal(goalId, categoryId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      // Same as attach: the SQL trigger cascades the removal to linked
      // micro-tasks, so refresh their cache too.
      void queryClient.invalidateQueries({ queryKey: ['microTasks'] });
      void queryClient.invalidateQueries({ queryKey: ['quickSwitcher'] });
    },
  });
}

export function useRecurringGoals(widgetId: string | null) {
  return useQuery({
    queryKey: ['recurringGoals', widgetId],
    queryFn: async () => {
      if (!widgetId) return [];
      const { data, error } = await listRecurringGoals(widgetId);
      if (error) throw error;
      return (data ?? []) as RecurringGoalRecord[];
    },
    enabled: !!widgetId && !!supabase,
    refetchInterval: GOALS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useCreateRecurringGoal(widgetId: string | null) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: async (data: Omit<RecurringGoalInsert, 'widget_id' | 'user_id'>) => {
      if (!widgetId || !user) throw new Error('Missing widgetId or user');
      const { data: row, error } = await createRecurringGoal({
        ...data,
        widget_id: widgetId,
        user_id: user.id,
      });
      if (error) throw error;
      return row;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurringGoals', widgetId] });
    },
  });
}

export function useUpdateRecurringGoal(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string } & Partial<RecurringGoalInsert & { last_triggered_at: string }>) => {
      const { id, ...update } = data;
      const { error } = await updateRecurringGoal(id, update);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurringGoals', widgetId] });
    },
  });
}

export function useDeleteRecurringGoal(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await deleteRecurringGoal(id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurringGoals', widgetId] });
    },
  });
}
