import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';

import { supabase } from '../../lib/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import {
  createAnalyticsTimer,
  deleteAnalyticsTimer,
  getAnalyticsSettings,
  listAnalyticsTimers,
  listCompletedTasksWithCategories,
  updateAnalyticsTimer,
  upsertAnalyticsSettings,
  type CompletedTasksParams,
} from './api';
import type {
  AnalyticsSettings,
  AnalyticsSettingsUpsert,
  AnalyticsTimer,
  AnalyticsTimerInsert,
  AnalyticsTimerUpdate,
  CompletedTaskWithCategories,
} from './types';

export function useAnalyticsSettings() {
  const user = useAuthStore((state) => state.user);
  return useQuery<AnalyticsSettings | null, Error>({
    queryKey: ['analyticsSettings', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await getAnalyticsSettings(user.id);
      if (error) throw error;
      return (data as AnalyticsSettings | null) ?? null;
    },
    enabled: Boolean(user?.id && supabase),
  });
}

export function useUpsertAnalyticsSettings() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AnalyticsSettingsUpsert) => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await upsertAnalyticsSettings(user.id, payload);
      if (error) throw error;
      return data as AnalyticsSettings;
    },
    onMutate: async (payload) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: ['analyticsSettings', user.id] });
      const previous = queryClient.getQueryData<AnalyticsSettings | null>(['analyticsSettings', user.id]);
      const optimistic: AnalyticsSettings = {
        user_id: user.id,
        period_start: payload.period_start,
        period_end: payload.period_end,
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData(['analyticsSettings', user.id], optimistic);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!user || !context?.previous) return;
      queryClient.setQueryData(['analyticsSettings', user.id], context.previous);
    },
    onSuccess: (data) => {
      if (!user) return;
      queryClient.setQueryData(['analyticsSettings', user.id], data);
    },
  });
}

export function useAnalyticsTimers() {
  const user = useAuthStore((state) => state.user);
  return useQuery<AnalyticsTimer[], Error>({
    queryKey: ['analyticsTimers', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await listAnalyticsTimers(user.id);
      if (error) throw error;
      return (data ?? []) as AnalyticsTimer[];
    },
    enabled: Boolean(user?.id && supabase),
  });
}

export function useCreateAnalyticsTimer() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AnalyticsTimerInsert) => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await createAnalyticsTimer(user.id, payload);
      if (error) throw error;
      return data as AnalyticsTimer;
    },
    onMutate: async (payload) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: ['analyticsTimers', user.id] });
      const previous = queryClient.getQueryData<AnalyticsTimer[]>(['analyticsTimers', user.id]);
      const optimistic: AnalyticsTimer = {
        id: `temp-${nanoid()}`,
        user_id: user.id,
        name: payload.name,
        color: payload.color ?? null,
        days_mask: payload.days_mask ?? '1111111',
        tag_ids: payload.tag_ids ?? [],
        category_ids: payload.category_ids ?? [],
        sort_order: payload.sort_order,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<AnalyticsTimer[]>(['analyticsTimers', user.id], (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      return { previous, optimisticId: optimistic.id };
    },
    onError: (_err, _vars, context) => {
      if (!user || !context?.previous) return;
      queryClient.setQueryData(['analyticsTimers', user.id], context.previous);
    },
    onSuccess: (data, _vars, context) => {
      if (!user) return;
      queryClient.setQueryData<AnalyticsTimer[]>(['analyticsTimers', user.id], (old) =>
        old?.map((timer) => (timer.id === context?.optimisticId ? data : timer)) ?? [data],
      );
    },
  });
}

export function useUpdateAnalyticsTimer() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string } & AnalyticsTimerUpdate) => {
      const { data, error } = await updateAnalyticsTimer(id, payload);
      if (error) throw error;
      return data as AnalyticsTimer;
    },
    onMutate: async (variables) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: ['analyticsTimers', user.id] });
      const previous = queryClient.getQueryData<AnalyticsTimer[]>(['analyticsTimers', user.id]);
      queryClient.setQueryData<AnalyticsTimer[]>(['analyticsTimers', user.id], (old) =>
        old?.map((timer) => (timer.id === variables.id ? { ...timer, ...variables } : timer)) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!user || !context?.previous) return;
      queryClient.setQueryData(['analyticsTimers', user.id], context.previous);
    },
    onSuccess: (data) => {
      if (!user) return;
      queryClient.setQueryData<AnalyticsTimer[]>(['analyticsTimers', user.id], (old) =>
        old?.map((timer) => (timer.id === data.id ? data : timer)) ?? [data],
      );
    },
  });
}

export function useDeleteAnalyticsTimer() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await deleteAnalyticsTimer(id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: ['analyticsTimers', user.id] });
      const previous = queryClient.getQueryData<AnalyticsTimer[]>(['analyticsTimers', user.id]);
      queryClient.setQueryData<AnalyticsTimer[]>(['analyticsTimers', user.id], (old) =>
        old?.filter((timer) => timer.id !== id) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!user || !context?.previous) return;
      queryClient.setQueryData(['analyticsTimers', user.id], context.previous);
    },
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: ['analyticsTimers', user.id] });
    },
  });
}

export function useCompletedTasks(params: Omit<CompletedTasksParams, 'userId'> & { enabled?: boolean }) {
  const user = useAuthStore((state) => state.user);
  const enabled = Boolean(user?.id && (params.enabled ?? true));
  return useQuery<CompletedTaskWithCategories[], Error>({
    queryKey: [
      'analyticsCompletedTasks',
      user?.id,
      params.from,
      params.to,
      params.limit ?? 50,
      params.offset ?? 0,
    ],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      return listCompletedTasksWithCategories({
        userId: user.id,
        from: params.from,
        to: params.to,
        limit: params.limit,
        offset: params.offset,
      });
    },
    enabled,
    staleTime: 5_000,
  });
}
