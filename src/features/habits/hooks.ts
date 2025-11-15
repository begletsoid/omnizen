import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';

import { supabase } from '../../lib/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import { createHabit, deleteHabit, getHabits, moveHabit, reorderHabits, updateHabit } from './api';
import type { HabitInsert, HabitRecord, HabitStatus } from './types';
import { getNextOrder } from './utils';

export function useHabits(widgetId: string | null) {
  const enabled = Boolean(widgetId && supabase);
  return useQuery<HabitRecord[], Error>({
    queryKey: ['habits', widgetId],
    queryFn: async () => {
      if (!widgetId) throw new Error('Widget id is required');
      const { data, error } = await getHabits(widgetId);
      if (error) throw error;
      return data as HabitRecord[];
    },
    enabled,
  });
}

export function useCreateHabit(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Omit<HabitInsert, 'widget_id'>) => {
      if (!widgetId) throw new Error('Widget id missing');
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await createHabit({
        widget_id: widgetId,
        status: 'not_started',
        ...payload,
      });
      if (error) throw error;
      return data as HabitRecord;
    },
    onMutate: async ({ title }) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['habits', widgetId] });
      const previous = queryClient.getQueryData<HabitRecord[]>(['habits', widgetId]);
      const nextOrder = getNextOrder(previous?.at(-1)?.order);
      const optimisticHabit: HabitRecord = {
        id: `temp-${nanoid()}`,
        widget_id: widgetId,
        user_id: user?.id ?? 'temp-user',
        title,
        status: 'not_started',
        order: nextOrder,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) =>
        old ? [...old, optimisticHabit] : [optimisticHabit],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['habits', widgetId], context.previous);
    },
    onSuccess: (data) => {
      if (!widgetId) return;
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) =>
        old?.map((habit) => (habit.id.startsWith('temp-') ? data : habit)) ?? [data],
      );
    },
  });
}

export function useUpdateHabit(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      title?: string;
      status?: HabitStatus;
      order?: number;
    }) => updateHabit(id, payload),
    onSuccess: (_, variables) => {
      if (!widgetId) return;
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) =>
        old?.map((habit) => (habit.id === variables.id ? { ...habit, ...variables } : habit)) ?? [],
      );
    },
  });
}

export function useDeleteHabit(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteHabit(id),
    onMutate: async (id) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['habits', widgetId] });
      const previous = queryClient.getQueryData<HabitRecord[]>(['habits', widgetId]);
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) =>
        old?.filter((habit) => habit.id !== id) ?? [],
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['habits', widgetId], context.previous);
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['habits', widgetId] });
    },
  });
}

export function useReorderHabits(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reorderHabits,
    onMutate: async (updates: Array<{ id: string; order: number }>) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['habits', widgetId] });
      const previous = queryClient.getQueryData<HabitRecord[]>(['habits', widgetId]);
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) =>
        old?.map((habit) => {
          const update = updates.find((u) => u.id === habit.id);
          return update ? { ...habit, order: update.order } : habit;
        }) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['habits', widgetId], context.previous);
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['habits', widgetId] });
    },
  });
}

export function useMoveHabit(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, order }: { id: string; status: HabitStatus; order: number }) =>
      moveHabit(id, status, order),
    onMutate: async (variables) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['habits', widgetId] });
      const previous = queryClient.getQueryData<HabitRecord[]>(['habits', widgetId]);
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) =>
        old?.map((habit) =>
          habit.id === variables.id
            ? { ...habit, status: variables.status, order: variables.order }
            : habit,
        ) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['habits', widgetId], context.previous);
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['habits', widgetId] });
    },
  });
}
