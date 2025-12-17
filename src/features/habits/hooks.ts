import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';

import { supabase } from '../../lib/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import {
  createHabit,
  deleteHabit,
  fetchNextHabitOrder,
  getHabits,
  moveHabit,
  saveHabitOrders,
  updateHabit,
} from './api';
import type {
  HabitInsert,
  HabitOrderUpdatePayload,
  HabitRecord,
  HabitStatus,
  HabitUpdate,
} from './types';

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
    mutationFn: async (payload: Omit<HabitInsert, 'widget_id'> & { order?: number }) => {
      if (!widgetId) throw new Error('Widget id missing');
      if (!user) throw new Error('User not authenticated');
      const status = payload.status ?? 'not_started';
      const order = payload.order;
      if (typeof order !== 'number') {
        throw new Error('Order is required');
      }
      const { data, error } = await createHabit({
        widget_id: widgetId,
        user_id: user.id,
        status,
        order,
        ...payload,
      });
      if (error) throw error;
      return data as HabitRecord;
    },
    onMutate: async (variables) => {
      if (!widgetId) return;
      const targetStatus = variables.status ?? 'not_started';
      const nextOrder = await fetchNextHabitOrder(widgetId, targetStatus);
      variables.order = nextOrder;
      variables.status = targetStatus;

      await queryClient.cancelQueries({ queryKey: ['habits', widgetId] });
      const previous = queryClient.getQueryData<HabitRecord[]>(['habits', widgetId]);
      const optimisticId = `temp-${nanoid()}`;
      const optimisticHabit: HabitRecord = {
        id: optimisticId,
        widget_id: widgetId,
        user_id: user?.id ?? 'temp-user',
        title: variables.title,
        status: targetStatus,
        order: nextOrder,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        success_count: 0,
        fail_count: 0,
        success_updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) =>
        old ? [...old, optimisticHabit] : [optimisticHabit],
      );
      return { previous, optimisticId };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['habits', widgetId], context.previous);
    },
    onSuccess: (data, _vars, context) => {
      if (!widgetId) return;
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) => {
        if (!old) return [data];
        return old.map((habit) => (habit.id === context?.optimisticId ? data : habit));
      });
    },
  });
}

export function useUpdateHabit(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & HabitUpdate) => updateHabit(id, payload),
    onMutate: async (variables) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['habits', widgetId] });
      const previous = queryClient.getQueryData<HabitRecord[]>(['habits', widgetId]);
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) =>
        old?.map((habit) => (habit.id === variables.id ? { ...habit, ...variables } : habit)) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['habits', widgetId], context.previous);
    },
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

export function useSaveHabitOrders(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: HabitOrderUpdatePayload[]) => {
      if (!widgetId) throw new Error('Widget id missing');
      if (!user) throw new Error('User not authenticated');
      return saveHabitOrders({ widgetId, userId: user.id, updates });
    },
    onMutate: async (updates) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['habits', widgetId] });
      const previous = queryClient.getQueryData<HabitRecord[]>(['habits', widgetId]);
      const updateMap = new Map(updates.map((u) => [u.id, u]));
      queryClient.setQueryData<HabitRecord[]>(['habits', widgetId], (old) =>
        old?.map((habit) => {
          const update = updateMap.get(habit.id);
          if (!update) return habit;
          return {
            ...habit,
            order: update.order,
            status: update.status ?? habit.status,
          };
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
