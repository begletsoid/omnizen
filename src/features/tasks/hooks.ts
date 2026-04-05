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
  listGoals,
  listRecurringGoals,
  updateGoal,
  updateRecurringGoal,
} from './api';
import type { GoalRecord, GoalUpdate, RecurringGoalInsert, RecurringGoalRecord } from './types';

export function useGoals(widgetId: string | null) {
  return useQuery({
    queryKey: ['goals', widgetId],
    queryFn: async () => {
      if (!widgetId) return [];
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
        archived_at: string | null;
        created_at: string;
        updated_at: string;
        categories?: Array<{ category: { id: string; name: string; is_auto: boolean; color?: string | null; source_tag_id?: string | null; created_at: string; updated_at: string; user_id: string } }>;
      };
      return ((data as RawRow[]) ?? []).map((row): GoalRecord => ({
        ...row,
        categories: row.categories
          ?.map((link) => link.category)
          .filter(Boolean) ?? [],
      }));
    },
    enabled: !!widgetId && !!supabase,
  });
}

export function useCreateGoal(widgetId: string | null) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: async (data: { title: string; value?: number; expected_hours?: number; is_recurring?: boolean }) => {
      if (!widgetId || !user) throw new Error('Missing widgetId or user');
      const { data: row, error } = await createGoal({
        ...data,
        widget_id: widgetId,
        user_id: user.id,
      });
      if (error) throw error;
      return row;
    },
    onSuccess: () => {
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
