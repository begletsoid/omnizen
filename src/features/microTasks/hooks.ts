import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';

import { supabase } from '../../lib/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import {
  attachCategoriesToTask,
  attachTagToCategory,
  createMicroTask,
  createTaskCategory,
  createTaskTag,
  deleteMicroTask,
  deleteTaskCategory,
  deleteTaskTag,
  detachCategoryFromTask,
  detachTagFromCategory,
  fetchNextMicroTaskOrder,
  getMicroTasks,
  getTaskCategoryBuffer,
  listTaskCategories,
  listTaskTags,
  pauseMicroTaskTimer,
  reorderMicroTasks,
  setTaskCategoryBuffer,
  startMicroTaskTimer,
  updateMicroTask,
  updateTaskCategoryAttributes,
} from './api';
import type {
  MicroTaskInsert,
  MicroTaskOrderUpdatePayload,
  MicroTaskRecord,
  MicroTaskUpdate,
  TaskCategory,
  TaskTag,
} from './types';
import { normalizeTimerState } from './utils';

export function useMicroTasks(widgetId: string | null) {
  const enabled = Boolean(widgetId && supabase);
  return useQuery<MicroTaskRecord[], Error>({
    queryKey: ['microTasks', widgetId],
    queryFn: async () => {
      if (!widgetId) throw new Error('Widget id is required');
      const { data, error } = await getMicroTasks(widgetId);
      if (error) throw error;
      return (data ?? []).map((task: any) => ({
        ...task,
        timer_state: normalizeTimerState(task.timer_state),
        elapsed_seconds: task.elapsed_seconds ?? 0,
        categories:
          task.categories?.map((link: any) => ({
            id: link.task_categories.id,
            name: link.task_categories.name,
            is_auto: link.task_categories.is_auto,
            color: link.task_categories.color,
            user_id: link.task_categories.user_id,
            created_at: link.task_categories.created_at,
            updated_at: link.task_categories.updated_at,
            source_tag_id: link.task_categories.source_tag_id,
            tags:
              link.task_categories.tags?.map((tagLink: any) => ({
                id: tagLink.task_tags.id,
                name: tagLink.task_tags.name,
                user_id: tagLink.task_tags.user_id,
                created_at: tagLink.task_tags.created_at,
                updated_at: tagLink.task_tags.updated_at,
              })) ?? [],
          })) ?? [],
      })) as MicroTaskRecord[];
    },
    enabled,
  });
}

export function useCreateMicroTask(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const { data: bufferedCategoryIds } = useTaskCategoryBuffer(user?.id ?? null);

  return useMutation({
    mutationFn: async (payload: Omit<MicroTaskInsert, 'widget_id' | 'user_id' | 'order'>) => {
      if (!widgetId) throw new Error('Widget id missing');
      if (!user) throw new Error('User not authenticated');
      const order = await fetchNextMicroTaskOrder(widgetId);
      const { data, error } = await createMicroTask({
        widget_id: widgetId,
        user_id: user.id,
        order,
        ...payload,
      });
      if (error) throw error;

      if (bufferedCategoryIds && bufferedCategoryIds.length > 0) {
        await attachCategoriesToTask(data.id, bufferedCategoryIds, user.id);
      }

      return data as MicroTaskRecord;
    },
    onMutate: async (variables) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTasks', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(['microTasks', widgetId]);
      const nextOrder =
        previous && previous.length
          ? Math.max(...previous.map((task) => task.order)) + 1
          : 1;
      const optimisticId = `temp-${nanoid()}`;
      const optimisticTask: MicroTaskRecord = {
        id: optimisticId,
        widget_id: widgetId,
        user_id: user?.id ?? 'temp-user',
        title: variables.title,
        is_done: variables.is_done ?? false,
        order: nextOrder,
        elapsed_seconds: 0,
        timer_state: 'never',
        last_started_at: null,
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        categories: [],
      };
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old ? [...old, optimisticTask] : [optimisticTask],
      );
      return { previous, optimisticId };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTasks', widgetId], context.previous);
    },
    onSuccess: (data, _vars, context) => {
      if (!widgetId) return;
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) => {
        if (!old) return [data];
        return old.map((task) => (task.id === context?.optimisticId ? data : task));
      });
      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
    },
  });
}

export function useUpdateMicroTask(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & MicroTaskUpdate) => updateMicroTask(id, payload),
    onMutate: async (variables) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTasks', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(['microTasks', widgetId]);
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old?.map((task) => (task.id === variables.id ? { ...task, ...variables } : task)) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTasks', widgetId], context.previous);
    },
    onSuccess: (response, variables, context) => {
      if (!widgetId) return;
      const updated = response?.data;
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old?.map((task) => {
          if (task.id !== variables.id) return task;
          if (updated) return { ...task, ...updated };
          return { ...task, ...variables };
        }) ?? [],
      );
      if (!updated && context?.previous) {
        queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
      }
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
    },
  });
}

export function useDeleteMicroTask(widgetId: string | null) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const toggleTimer = useToggleMicroTaskTimer(widgetId);

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error('User not authenticated');
      const tasks = queryClient.getQueryData<MicroTaskRecord[]>(['microTasks', widgetId]);
      const task = tasks?.find((t) => t.id === id);
      if (task?.timer_state === 'running') {
        await toggleTimer.mutateAsync({ id, isRunning: true });
      }
      return deleteMicroTask(id);
    },
    onMutate: async (id) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTasks', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(['microTasks', widgetId]);
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old?.filter((task) => task.id !== id) ?? [],
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTasks', widgetId], context.previous);
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
    },
  });
}

export function useArchiveMicroTask(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const archivedAt = new Date().toISOString();
      await updateMicroTask(id, { archived_at: archivedAt });
      return { id };
    },
    onMutate: async (id) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTasks', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(['microTasks', widgetId]);
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old?.filter((task) => task.id !== id) ?? [],
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTasks', widgetId], context.previous);
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
    },
  });
}

export function useReorderMicroTasks(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: MicroTaskOrderUpdatePayload[]) => {
      if (!widgetId) throw new Error('Widget id missing');
      if (!user) throw new Error('User not authenticated');
      return reorderMicroTasks({ widgetId, userId: user.id, updates });
    },
    onMutate: async (updates) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTasks', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(['microTasks', widgetId]);
      const map = new Map(updates.map((u) => [u.id, u.order]));
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old
          ?.map((task) => (map.has(task.id) ? { ...task, order: map.get(task.id)! } : task))
          .sort((a, b) => a.order - b.order) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTasks', widgetId], context.previous);
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
    },
  });
}

export function useToggleMicroTaskTimer(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isRunning }: { id: string; isRunning: boolean }) => {
      if (!user) throw new Error('User not authenticated');
      if (isRunning) {
        return pauseMicroTaskTimer(id, user.id);
      }
      return startMicroTaskTimer(id, user.id);
    },
    onMutate: async ({ id, isRunning }) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTasks', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(['microTasks', widgetId]);
      const now = new Date().toISOString();
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old?.map((task) => {
          if (task.id === id) {
            const elapsed =
              isRunning && task.last_started_at
                ? task.elapsed_seconds +
                  Math.max(
                    0,
                    Math.floor((Date.now() - new Date(task.last_started_at).getTime()) / 1000),
                  )
                : task.elapsed_seconds;
            return {
              ...task,
              timer_state: isRunning ? 'paused' : 'running',
              last_started_at: isRunning ? null : now,
              elapsed_seconds: elapsed,
            };
          }
          if (!isRunning && task.timer_state === 'running') {
            const elapsed =
              task.last_started_at && previous
                ? task.elapsed_seconds +
                  Math.max(
                    0,
                    Math.floor((Date.now() - new Date(task.last_started_at).getTime()) / 1000),
                  )
                : task.elapsed_seconds;
            return {
              ...task,
              timer_state: 'paused',
              last_started_at: null,
              elapsed_seconds: elapsed,
            };
          }
          return task;
        }) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTasks', widgetId], context.previous);
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
    },
  });
}

export function useTaskTags() {
  const user = useAuthStore((state) => state.user);
  return useQuery<TaskTag[], Error>({
    queryKey: ['taskTags', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const data = await listTaskTags(user.id);
      return data;
    },
    enabled: Boolean(user?.id),
  });
}

export function useCreateTaskTag() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      if (!user) throw new Error('User not authenticated');
      return createTaskTag(name, user.id);
    },
    onMutate: async (name: string) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: ['taskTags', user.id] });
      const previous = queryClient.getQueryData<TaskTag[]>(['taskTags', user.id]);
      const optimistic: TaskTag = {
        id: `temp-${nanoid()}`,
        name,
        user_id: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<TaskTag[]>(['taskTags', user.id], (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      return { previous, optimisticId: optimistic.id };
    },
    onError: (_err, _vars, context) => {
      if (!user || !context?.previous) return;
      queryClient.setQueryData(['taskTags', user.id], context.previous);
    },
    onSuccess: (result, _vars, context) => {
      if (!user) return;
      const tag = result?.tag as TaskTag | undefined;
      queryClient.setQueryData<TaskTag[]>(['taskTags', user.id], (old) => {
        if (!old) return tag ? [tag] : old;
        if (!tag) return old;
        return old.map((entry) => (entry.id === context?.optimisticId ? tag : entry));
      });
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user.id] });
    },
  });
}

export function useDeleteTaskTag() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) => {
      if (!user) throw new Error('User not authenticated');
      return deleteTaskTag(tagId, user.id);
    },
    onMutate: async (tagId) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: ['taskTags', user.id] });
      const previousTags = queryClient.getQueryData<TaskTag[]>(['taskTags', user.id]);
      queryClient.setQueryData<TaskTag[]>(['taskTags', user.id], (old) =>
        old?.filter((tag) => tag.id !== tagId) ?? [],
      );

      const microKeys = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['microTasks'] })
        .map((entry) => entry.queryKey);
      const prevTasksEntries = microKeys.map((key) => ({
        key,
        data: queryClient.getQueryData<MicroTaskRecord[]>(key),
      }));
      microKeys.forEach((key) => {
        queryClient.setQueryData<MicroTaskRecord[]>(key, (old) =>
          old?.map((task) => ({
            ...task,
            categories:
              task.categories?.map((category) => ({
                ...category,
                tags: category.tags?.filter((tag) => tag.id !== tagId) ?? [],
              })) ?? [],
          })) ?? [],
        );
      });

      return { previousTags, prevTasksEntries };
    },
    onError: (_err, _vars, context) => {
      if (user && context?.previousTags) {
        queryClient.setQueryData(['taskTags', user.id], context.previousTags);
      }
      context?.prevTasksEntries?.forEach(({ key, data }) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskTags', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['microTasks'] });
    },
  });
}

export function useTaskCategories() {
  const user = useAuthStore((state) => state.user);
  return useQuery<TaskCategory[], Error>({
    queryKey: ['taskCategories', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      return listTaskCategories(user.id);
    },
    enabled: Boolean(user?.id),
  });
}

export function useCreateTaskCategory() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      if (!user) throw new Error('User not authenticated');
      return createTaskCategory(name, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
    },
  });
}

export function useRenameTaskCategory() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!user) throw new Error('User not authenticated');
      return updateTaskCategoryAttributes(id, { name }, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
    },
  });
}

export function useUpdateTaskCategoryColor() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, color }: { id: string; color: string | null }) => {
      if (!user) throw new Error('User not authenticated');
      return updateTaskCategoryAttributes(id, { color }, user.id);
    },
    onMutate: async ({ id, color }) => {
      await queryClient.cancelQueries({ queryKey: ['taskCategories', user?.id] });
      const prevCategories = queryClient.getQueryData<TaskCategory[]>(['taskCategories', user?.id]);
      queryClient.setQueryData<TaskCategory[]>(['taskCategories', user?.id], (old) =>
        old?.map((category) => (category.id === id ? { ...category, color } : category)) ?? [],
      );

      await queryClient.cancelQueries({ queryKey: ['microTasks'] });
      const keys = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['microTasks'] })
        .map((entry) => entry.queryKey);
      const prevTasksEntries = keys.map((key) => ({
        key,
        data: queryClient.getQueryData<MicroTaskRecord[]>(key),
      }));
      keys.forEach((key) => {
        queryClient.setQueryData<MicroTaskRecord[]>(key, (old) =>
          old?.map((task) => ({
            ...task,
            categories:
              task.categories?.map((category) =>
                category.id === id ? { ...category, color } : category,
              ) ?? [],
          })) ?? [],
        );
      });

      return { prevCategories, prevTasksEntries };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevCategories) {
        queryClient.setQueryData(['taskCategories', user?.id], context.prevCategories);
      }
      context?.prevTasksEntries?.forEach(({ key, data }) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['microTasks'] });
    },
  });
}

export function useDeleteTaskCategory() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (categoryId: string) => {
      if (!user) throw new Error('User not authenticated');
      return deleteTaskCategory(categoryId, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['microTasks'] });
    },
  });
}

export function useAttachTagToCategory() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ categoryId, tagId }: { categoryId: string; tagId: string }) => {
      if (!user) throw new Error('User not authenticated');
      return attachTagToCategory(categoryId, tagId, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
    },
  });
}

export function useDetachTagFromCategory() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ categoryId, tagId }: { categoryId: string; tagId: string }) => {
      if (!user) throw new Error('User not authenticated');
      return detachTagFromCategory(categoryId, tagId, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
    },
  });
}

export function useTaskCategoryBuffer(userId: string | null) {
  return useQuery<string[], Error>({
    queryKey: ['taskCategoryBuffer', userId],
    queryFn: async () => {
      if (!userId) throw new Error('User not authenticated');
      return getTaskCategoryBuffer(userId);
    },
    enabled: Boolean(userId),
  });
}

export function useSetTaskCategoryBuffer() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (categoryIds: string[]) => {
      if (!user) throw new Error('User not authenticated');
      return setTaskCategoryBuffer(user.id, categoryIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategoryBuffer', user?.id] });
    },
  });
}

export function useAttachCategoryToTask() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, categoryId }: { taskId: string; categoryId: string }) => {
      if (!user) throw new Error('User not authenticated');
      return attachCategoriesToTask(taskId, [categoryId], user.id);
    },
    onMutate: async ({ taskId, categoryId }) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: ['microTasks'] });
      const keys = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['microTasks'] })
        .map((entry) => entry.queryKey);
      const prevTasksEntries = keys.map((key) => ({
        key,
        data: queryClient.getQueryData<MicroTaskRecord[]>(key),
      }));
      const categories = queryClient.getQueryData<TaskCategory[]>(['taskCategories', user.id]);
      const category = categories?.find((c) => c.id === categoryId);
      keys.forEach((key) => {
        queryClient.setQueryData<MicroTaskRecord[]>(key, (old) =>
          old?.map((task) => {
            if (task.id !== taskId) return task;
            const nextCategories = task.categories ?? [];
            if (nextCategories.some((c) => c.id === categoryId)) return task;
            return {
              ...task,
              categories: [
                ...nextCategories,
                category ?? {
                  id: categoryId,
                  name: 'Новая категория',
                  user_id: user.id,
                  is_auto: false,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  color: null,
                  source_tag_id: null,
                  tags: [],
                },
              ],
            };
          }) ?? [],
        );
      });
      return { prevTasksEntries };
    },
    onError: (_err, _vars, context) => {
      context?.prevTasksEntries?.forEach(({ key, data }) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['microTasks'] });
    },
  });
}

export function useDetachCategoryFromTask() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, categoryId }: { taskId: string; categoryId: string }) => {
      if (!user) throw new Error('User not authenticated');
      return detachCategoryFromTask(taskId, categoryId, user.id);
    },
    onMutate: async ({ taskId, categoryId }) => {
      await queryClient.cancelQueries({ queryKey: ['microTasks'] });
      const keys = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['microTasks'] })
        .map((entry) => entry.queryKey);
      const prevTasksEntries = keys.map((key) => ({
        key,
        data: queryClient.getQueryData<MicroTaskRecord[]>(key),
      }));
      keys.forEach((key) => {
        queryClient.setQueryData<MicroTaskRecord[]>(key, (old) =>
          old?.map((task) =>
            task.id === taskId
              ? { ...task, categories: task.categories?.filter((cat) => cat.id !== categoryId) ?? [] }
              : task,
          ) ?? [],
        );
      });
      return { prevTasksEntries };
    },
    onError: (_err, _vars, context) => {
      context?.prevTasksEntries?.forEach(({ key, data }) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['microTasks'] });
    },
  });
}

