import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';

import { supabase } from '../../lib/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import { subscribeMicroTasks } from './realtime';
import {
  acknowledgeCategoriesIntroduction,
  attachCategoriesToTask,
  attachTagToCategory,
  classifyMicrotaskCategories,
  createMicroTask,
  createMicroTaskGroup,
  createMicroTaskGroupTemplate,
  archiveTaskCategory,
  archiveTaskTag,
  createTaskCategory,
  createTaskTag,
  deleteMicroTask,
  deleteMicroTaskGroup,
  deleteMicroTaskGroupTemplate,
  deleteTaskCategory,
  deleteTaskTag,
  unarchiveTaskCategory,
  unarchiveTaskTag,
  detachCategoryFromTask,
  detachTagFromCategory,
  fetchNextMicroTaskOrder,
  getMicroTaskGroups,
  getMicroTasks,
  getTaskCategoryBuffer,
  listTaskCategories,
  listMicroTaskGroupTemplateItems,
  listMicroTaskGroupTemplates,
  replaceMicroTaskGroupTemplateItems,
  listTaskTags,
  pauseMicroTaskTimer,
  reorderMicroTasks,
  reorderMicroTaskItems,
  setTaskCategoryBuffer,
  startMicroTaskTimer,
  transferMicroTaskTime,
  updateMicroTask,
  updateMicroTaskGroup,
  updateTaskCategoryAttributes,
} from './api';
import type {
  MicroTaskInsert,
  MicroTaskOrderUpdatePayload,
  MicroTaskRecord,
  MicroTaskUpdate,
  MicroTaskGroup,
  MicroTaskGroupOrderUpdatePayload,
  MicroTaskGroupTemplate,
  MicroTaskGroupTemplateItem,
  MicroTaskGroupTaskUpdatePayload,
  TaskCategory,
  TaskTag,
} from './types';
import { normalizeTimerState } from './utils';

const DATA_REFETCH_INTERVAL_MS = 10_000;

/**
 * State shared between `useCreateMicroTask` (the writer) and
 * `useToggleMicroTaskTimer` (the toggler) for the create+start race:
 *
 *   - User hits "+" → `useCreateMicroTask.onMutate` puts a `temp-…` task
 *     in the cache and stashes its optimistic id in `optimisticIdByPayload`
 *     keyed on the mutate payload object.
 *   - In `mutationFn` we FIRST classify categories via LLM (~1-2s).
 *     During this window the `temp-…` row is visible to the user — this
 *     IS the click window.
 *   - If the user clicks ▶ on that row, `useToggleMicroTaskTimer` sees a
 *     temp id, ADDS the id to `pendingTimerStarts`, and skips both the
 *     server RPC (it would fail — no such id server-side yet) and the
 *     query invalidation (refetch would clobber the optimistic running
 *     state). The cache update from its own `onMutate` already shows
 *     the timer ticking for the user.
 *   - AFTER the LLM await, `useCreateMicroTask.mutationFn` reads the
 *     optimisticId via the WeakMap, checks `pendingTimerStarts.has(id)`,
 *     and asks the server to insert + start the timer atomically via
 *     `start_timer: true`. The row returned is already in the running
 *     state — the merge in `onSuccess` no longer wipes out the user's
 *     click. Reading BEFORE the LLM await (old behaviour) missed every
 *     click that landed during classification — that was the regression
 *     fixed in Phase 6.
 */
const pendingTimerStarts = new Set<string>();
const optimisticIdByPayload = new WeakMap<object, string>();

/**
 * Subscribe to Supabase Realtime for micro_tasks owned by this user.
 *
 * Mount this once at the dashboard root (not inside individual widgets)
 * so a single channel covers every consumer of `['microTasks']` and
 * `['goals']`. On any INSERT/UPDATE/DELETE we invalidate the relevant
 * caches; React Query will refetch only the queries that have active
 * subscribers, so the cost is paid by whoever is actually visible.
 *
 * The local mutations already do their own optimistic+invalidate cycle
 * (and in Phase 6 we added explicit `['goals']` invalidates to micro
 * mutations). This hook closes the *cross-source* hole: another tab,
 * another device, the iPhone voice webhook, or the Electron quick-
 * switcher overlay can all change micro_tasks state, and now those
 * sessions update this one within ~500ms instead of ~10s.
 *
 * Requires `micro_tasks` to be in the `supabase_realtime` publication
 * (migration `20260513000000_realtime_microtasks.sql`).
 */
export function useMicroTasksRealtime(userId: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId || !supabase) return undefined;
    const unsubscribe = subscribeMicroTasks(userId, (payload) => {
      void queryClient.invalidateQueries({ queryKey: ['microTasks'] });
      // Cross-source mutation may have touched a goal-linked task,
      // changed elapsed_seconds, or deleted/added a row that affects
      // `useGoals.elapsedByGoal`. Cheap to invalidate; the goals
      // queryFn already pulls the freshest micro_tasks aggregation.
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      // The desktop quick-switcher overlay lists tasks across all widgets;
      // keep its cache in sync too.
      void queryClient.invalidateQueries({ queryKey: ['quickSwitcher'] });
      // payload is currently unused — kept for future surgical invalidates.
      void payload;
    });
    return unsubscribe;
  }, [queryClient, userId]);
}

export function useMicroTasks(widgetId: string | null) {
  const enabled = Boolean(widgetId && supabase);
  return useQuery<MicroTaskRecord[], Error>({
    queryKey: ['microTasks', widgetId],
    refetchInterval: DATA_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!widgetId) throw new Error('Widget id is required');
      const { data, error } = await getMicroTasks(widgetId);
      if (error) throw error;
      type RawTagLink = { task_tags: { id: string; name: string; user_id: string; created_at: string; updated_at: string } };
      type RawCategoryLink = {
        task_categories: {
          id: string;
          name: string;
          is_auto: boolean;
          color: string | null;
          user_id: string;
          created_at: string;
          updated_at: string;
          source_tag_id: string | null;
          tags?: RawTagLink[];
        };
      };
      type RawTask = Omit<MicroTaskRecord, 'categories'> & { categories?: RawCategoryLink[] };

      return (data ?? []).map((task) => {
        const raw = task as RawTask;
        return {
          ...raw,
          timer_state: normalizeTimerState(raw.timer_state),
          elapsed_seconds: raw.elapsed_seconds ?? 0,
          group_id: raw.group_id ?? null,
          group_order: typeof raw.group_order === 'number' ? raw.group_order : null,
          categories:
            raw.categories?.map((link) => ({
              id: link.task_categories.id,
              name: link.task_categories.name,
              is_auto: link.task_categories.is_auto,
              color: link.task_categories.color,
              user_id: link.task_categories.user_id,
              created_at: link.task_categories.created_at,
              updated_at: link.task_categories.updated_at,
              source_tag_id: link.task_categories.source_tag_id,
              tags:
                link.task_categories.tags?.map((tagLink: RawTagLink) => ({
                  id: tagLink.task_tags.id,
                  name: tagLink.task_tags.name,
                  user_id: tagLink.task_tags.user_id,
                  created_at: tagLink.task_tags.created_at,
                  updated_at: tagLink.task_tags.updated_at,
                })) ?? [],
            })) ?? [],
        };
      }) as MicroTaskRecord[];
    },
    enabled,
  });
}

export function useMicroTaskGroups(widgetId: string | null) {
  const enabled = Boolean(widgetId && supabase);
  return useQuery<MicroTaskGroup[], Error>({
    queryKey: ['microTaskGroups', widgetId],
    refetchInterval: DATA_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!widgetId) throw new Error('Widget id is required');
      const { data, error } = await getMicroTaskGroups(widgetId);
      if (error) throw error;
      return (data ?? []) as MicroTaskGroup[];
    },
    enabled,
  });
}

export function useCreateMicroTaskGroup(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, order }: { name: string; order: number }) => {
      if (!widgetId) throw new Error('Widget id missing');
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await createMicroTaskGroup({
        widget_id: widgetId,
        user_id: user.id,
        name,
        order,
      });
      if (error) throw error;
      return data as MicroTaskGroup;
    },
    onMutate: async ({ name, order }) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTaskGroups', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskGroup[]>(['microTaskGroups', widgetId]);
      const optimisticId = `temp-${nanoid()}`;
      const optimisticGroup: MicroTaskGroup = {
        id: optimisticId,
        widget_id: widgetId,
        user_id: user?.id ?? 'temp-user',
        name,
        order,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<MicroTaskGroup[]>(['microTaskGroups', widgetId], (old) =>
        old ? [...old, optimisticGroup] : [optimisticGroup],
      );
      return { previous, optimisticId };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTaskGroups', widgetId], context.previous);
    },
    onSuccess: (data, _vars, context) => {
      if (!widgetId) return;
      queryClient.setQueryData<MicroTaskGroup[]>(['microTaskGroups', widgetId], (old) =>
        old?.map((group) => (group.id === context?.optimisticId ? data : group)) ?? [data],
      );
      queryClient.invalidateQueries({ queryKey: ['microTaskGroups', widgetId] });
    },
  });
}

export function useUpdateMicroTaskGroup(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Partial<Pick<MicroTaskGroup, 'name' | 'order'>>) =>
      updateMicroTaskGroup(id, payload),
    onMutate: async (variables) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTaskGroups', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskGroup[]>(['microTaskGroups', widgetId]);
      queryClient.setQueryData<MicroTaskGroup[]>(['microTaskGroups', widgetId], (old) =>
        old?.map((group) => (group.id === variables.id ? { ...group, ...variables } : group)) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTaskGroups', widgetId], context.previous);
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['microTaskGroups', widgetId] });
    },
  });
}

export function useDeleteMicroTaskGroup(widgetId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => deleteMicroTaskGroup(id),
    onMutate: async (id) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTaskGroups', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskGroup[]>(['microTaskGroups', widgetId]);
      queryClient.setQueryData<MicroTaskGroup[]>(['microTaskGroups', widgetId], (old) =>
        old?.filter((group) => group.id !== id) ?? [],
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTaskGroups', widgetId], context.previous);
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['microTaskGroups', widgetId] });
    },
  });
}

type CreateMicroTaskPayload = Omit<MicroTaskInsert, 'widget_id' | 'user_id' | 'order'> & {
  /**
   * When provided, these category IDs are attached to the new task instead of the
   * user's task category buffer. Use an empty array to attach no categories.
   * Typical use case: dragging a goal into the micro tasks widget — we want the
   * new task to inherit only the goal's categories, not the buffer.
   */
  category_ids_override?: string[];
};

export function useCreateMicroTask(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const { data: bufferedCategoryIds } = useTaskCategoryBuffer(user?.id ?? null);

  return useMutation({
    mutationFn: async (payload: CreateMicroTaskPayload) => {
      if (!widgetId) throw new Error('Widget id missing');
      if (!user) throw new Error('User not authenticated');
      const { category_ids_override, ...insertData } = payload;
      const order = await fetchNextMicroTaskOrder(widgetId);

      // Category resolution priority (resolved BEFORE the INSERT so the
      // LLM-classify wait gives the user a window to press ▶ on the
      // optimistic temp-row — we read `pendingTimerStarts` below AFTER
      // this await):
      //   1. Explicit override (e.g. dropping a goal onto the widget → use goal's categories).
      //   2. LLM classification by title (same Groq/Anthropic/OpenAI chain as voice).
      //   3. Buffer fallback (the user's "default set" of categories).
      // The LLM call is best-effort: any failure resolves to [] and we fall to the buffer.
      let categoriesToAttach: string[];
      if (category_ids_override !== undefined) {
        categoriesToAttach = category_ids_override;
      } else {
        const llmIds = await classifyMicrotaskCategories(insertData.title);
        categoriesToAttach = llmIds.length > 0 ? llmIds : (bufferedCategoryIds ?? []);
      }

      // Read `pendingTimerStarts` AFTER the LLM await — the 1-2s LLM
      // window is exactly when the user has time to see the temp-row and
      // press ▶ on it. Reading before the await (old behaviour) missed
      // every click that happened during classification. See the comment
      // on `pendingTimerStarts` at module top for the race this closes.
      const tempId = optimisticIdByPayload.get(payload);
      const wantsStartTimer = tempId ? pendingTimerStarts.has(tempId) : false;
      if (tempId) pendingTimerStarts.delete(tempId);

      const { data, error } = await createMicroTask({
        widget_id: widgetId,
        user_id: user.id,
        order,
        ...insertData,
        start_timer: wantsStartTimer,
      });
      if (error) throw error;
      if (!data) throw new Error('createMicroTask returned no row');

      if (categoriesToAttach.length > 0) {
        await attachCategoriesToTask(data.id, categoriesToAttach, user.id);
      } else {
        // No auto-attached categories → mark the intro as already shown.
        // Otherwise, if the user later picks a category by hand, the chip
        // preview would fire — but the user just chose that category, so
        // they don't need a preview of it.
        await updateMicroTask(data.id, {
          categories_introduced_at: new Date().toISOString(),
        });
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
      // Make the optimisticId visible to `mutationFn` (which runs after
      // onMutate but doesn't receive context) via a WeakMap keyed on the
      // mutate payload — same object reference both callbacks see.
      optimisticIdByPayload.set(variables, optimisticId);
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
    onSuccess: async (data, _vars, context) => {
      if (!widgetId) return;

      // Late-click safety net: even with the LLM-before-check reorder, the
      // user can press ▶ on the temp-row AFTER our `pendingTimerStarts`
      // read at the top of mutationFn but BEFORE we get here (the window
      // between createMicroTask + attachCategoriesToTask + return — up to
      // ~700ms). In that case the server task came back as 'never' and the
      // user's optimistic 'running' cache state would be silently
      // overwritten by the setQueryData below. Detect that case and start
      // the timer server-side BEFORE invalidating, so the refetch sees
      // the running state and doesn't snap the UI back to 'never'.
      const tempId = context?.optimisticId;
      const lateClick = !!tempId && pendingTimerStarts.has(tempId);
      if (tempId) pendingTimerStarts.delete(tempId);

      if (lateClick) {
        try {
          await startMicroTaskTimer(data.id);
        } catch (err) {
          console.warn('late-click startMicroTaskTimer failed', err);
        }
      }

      const replacement: MicroTaskRecord = lateClick
        ? { ...data, timer_state: 'running', last_started_at: new Date().toISOString() }
        : data;

      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) => {
        if (!old) return [replacement];
        return old.map((task) => (task.id === context?.optimisticId ? replacement : task));
      });

      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
      // If the new task has a goal_id, the goal card needs to refresh its
      // aggregated elapsed_seconds and "linked tasks count" right away —
      // otherwise the user has to wait for the 10s `useGoals` polling tick.
      queryClient.invalidateQueries({ queryKey: ['goals'] });
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
      // Updates may touch elapsed_seconds (inline edit), is_done, goal_id or
      // archived_at — all of which feed `useGoals` aggregation. Refresh goals
      // immediately instead of waiting for the 10s poll.
      queryClient.invalidateQueries({ queryKey: ['goals'] });
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
      // Deleting a task drops its elapsed_seconds from any goal aggregation.
      queryClient.invalidateQueries({ queryKey: ['goals'] });
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
      // `useGoals` aggregates elapsed_seconds across ALL linked micro tasks
      // including archived — so archiving doesn't drop time from the goal
      // card today. Still invalidate defensively in case aggregation rules
      // ever change, and so the "linked tasks count" reflects the archive.
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

/**
 * Mark the "auto-assigned categories" intro as seen for a single task.
 * Used once per task across all devices — the partial `is(... null)` filter
 * in api.ts guarantees only the first writer wins, so concurrent devices
 * don't fight. The optimistic update flips `categories_introduced_at` in
 * the cache immediately so the card swaps back to its normal controls
 * without waiting for the network round-trip.
 */
export function useAcknowledgeCategoriesIntroduction(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      if (!user) throw new Error('User not authenticated');
      await acknowledgeCategoriesIntroduction(taskId, user.id);
      return { id: taskId };
    },
    onMutate: async (taskId) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTasks', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(['microTasks', widgetId]);
      const nowIso = new Date().toISOString();
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old?.map((task) =>
          task.id === taskId
            ? { ...task, categories_introduced_at: task.categories_introduced_at ?? nowIso }
            : task,
        ) ?? [],
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (!widgetId || !context?.previous) return;
      queryClient.setQueryData(['microTasks', widgetId], context.previous);
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

export function useReorderMicroTaskItems(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskUpdates,
      groupUpdates,
    }: {
      taskUpdates: MicroTaskGroupTaskUpdatePayload[];
      groupUpdates: MicroTaskGroupOrderUpdatePayload[];
    }) => {
      if (!widgetId) throw new Error('Widget id missing');
      if (!user) throw new Error('User not authenticated');
      return reorderMicroTaskItems({
        widgetId,
        userId: user.id,
        taskUpdates,
        groupUpdates,
      });
    },
    onMutate: async ({ taskUpdates, groupUpdates }) => {
      if (!widgetId) return;
      await queryClient.cancelQueries({ queryKey: ['microTasks', widgetId] });
      await queryClient.cancelQueries({ queryKey: ['microTaskGroups', widgetId] });
      const previousTasks = queryClient.getQueryData<MicroTaskRecord[]>(['microTasks', widgetId]);
      const previousGroups = queryClient.getQueryData<MicroTaskGroup[]>(['microTaskGroups', widgetId]);
      const taskMap = new Map(taskUpdates.map((update) => [update.id, update]));
      const groupMap = new Map(groupUpdates.map((update) => [update.id, update.order]));
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old?.map((task) => {
          const update = taskMap.get(task.id);
          if (!update) return task;
          return {
            ...task,
            order: update.order,
            group_id: update.group_id,
            group_order: update.group_order,
          };
        }) ?? [],
      );
      queryClient.setQueryData<MicroTaskGroup[]>(['microTaskGroups', widgetId], (old) =>
        old?.map((group) => (groupMap.has(group.id) ? { ...group, order: groupMap.get(group.id)! } : group)) ?? [],
      );
      return { previousTasks, previousGroups };
    },
    onError: (_err, _vars, context) => {
      if (!widgetId || !context) return;
      if (context.previousTasks) {
        queryClient.setQueryData(['microTasks', widgetId], context.previousTasks);
      }
      if (context.previousGroups) {
        queryClient.setQueryData(['microTaskGroups', widgetId], context.previousGroups);
      }
    },
    onSettled: () => {
      if (!widgetId) return;
      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
      queryClient.invalidateQueries({ queryKey: ['microTaskGroups', widgetId] });
    },
  });
}

export function useToggleMicroTaskTimer(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isRunning }: { id: string; isRunning: boolean }) => {
      if (!user) throw new Error('User not authenticated');
      // The row hasn't actually been created on the server yet — it's
      // the optimistic placeholder from useCreateMicroTask. Calling
      // start/pause RPC with a temp id would 404. Instead we stash the
      // user's intent in `pendingTimerStarts`; useCreateMicroTask reads
      // it just before sending the INSERT and asks the server to insert
      // + start the timer atomically (see `start_timer` param). The
      // optimistic onMutate update already shows the timer running, so
      // the user sees no delay.
      if (id.startsWith('temp-')) {
        if (isRunning) pendingTimerStarts.delete(id);
        else pendingTimerStarts.add(id);
        return null;
      }
      if (isRunning) return pauseMicroTaskTimer(id);
      return startMicroTaskTimer(id);
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
    onSettled: (_data, _err, vars) => {
      if (!widgetId) return;
      // For optimistic temp- rows, the server hasn't done anything yet
      // (we short-circuited in mutationFn). A refetch here would replace
      // the optimistic "running" cache with the older "never" row from
      // the server (or no row at all), erasing the user's click. Skip.
      if (vars?.id?.startsWith('temp-')) return;
      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
      // Goals show aggregate elapsed_seconds across linked micro tasks. Without
      // this invalidation the goal card waits ~10s for the polling refetch
      // before reflecting a paused/started timer.
      queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export type TransferMicroTaskTimeVariables = {
  fromTaskId: string;
  toTaskId: string;
  seconds: number;
};

/**
 * Move N seconds from one micro_task to another via the
 * `transfer_micro_task_time` RPC. Optimistically subtracts/adds on the source
 * and target rows so the UI reflects the change instantly; rolls back on RPC
 * error and invalidates on settle so any server-side rebase of running
 * timers is picked up. The hook keeps both mutate/mutateAsync stable refs so
 * memoised drag handlers don't lose identity between renders.
 */
export function useTransferMicroTaskTime(widgetId: string | null) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: TransferMicroTaskTimeVariables) => {
      if (!user) throw new Error('User not authenticated');
      return transferMicroTaskTime({
        fromTaskId: vars.fromTaskId,
        toTaskId: vars.toTaskId,
        seconds: vars.seconds,
        userId: user.id,
      });
    },
    onMutate: async ({ fromTaskId, toTaskId, seconds }) => {
      if (!widgetId) return undefined;
      await queryClient.cancelQueries({ queryKey: ['microTasks', widgetId] });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>([
        'microTasks',
        widgetId,
      ]);
      queryClient.setQueryData<MicroTaskRecord[]>(['microTasks', widgetId], (old) =>
        old?.map((task) => {
          if (task.id === fromTaskId) {
            return {
              ...task,
              elapsed_seconds: Math.max(0, task.elapsed_seconds - seconds),
            };
          }
          if (task.id === toTaskId) {
            return { ...task, elapsed_seconds: task.elapsed_seconds + seconds };
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
      // Goals aggregate elapsed_seconds across linked tasks — keep them fresh
      // so the value moved doesn't appear duplicated/missing in the goal card.
      queryClient.invalidateQueries({ queryKey: ['goals'] });
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

/**
 * Archive a tag: mark archived_at = now and cascade to its auto-category.
 * Existing task→tag attachments are kept (they survive archival), but the
 * tag stops appearing in TaxonomySelect and in the voice LLM's context.
 */
export function useArchiveTaskTag() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) => {
      if (!user) throw new Error('User not authenticated');
      return archiveTaskTag(tagId, user.id);
    },
    onMutate: async (tagId) => {
      if (!user) return;
      const nowIso = new Date().toISOString();
      await queryClient.cancelQueries({ queryKey: ['taskTags', user.id] });
      const previousTags = queryClient.getQueryData<TaskTag[]>(['taskTags', user.id]);
      queryClient.setQueryData<TaskTag[]>(['taskTags', user.id], (old) =>
        old?.map((tag) => (tag.id === tagId ? { ...tag, archived_at: nowIso } : tag)) ?? [],
      );
      // Cascade in the categories cache: auto-category with source_tag_id=tagId.
      await queryClient.cancelQueries({ queryKey: ['taskCategories', user.id] });
      const previousCategories = queryClient.getQueryData<TaskCategory[]>([
        'taskCategories',
        user.id,
      ]);
      queryClient.setQueryData<TaskCategory[]>(['taskCategories', user.id], (old) =>
        old?.map((cat) =>
          cat.source_tag_id === tagId && !cat.archived_at
            ? { ...cat, archived_at: nowIso }
            : cat,
        ) ?? [],
      );
      return { previousTags, previousCategories };
    },
    onError: (_err, _vars, context) => {
      if (user && context?.previousTags) {
        queryClient.setQueryData(['taskTags', user.id], context.previousTags);
      }
      if (user && context?.previousCategories) {
        queryClient.setQueryData(['taskCategories', user.id], context.previousCategories);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['taskTags', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
    },
  });
}

export function useUnarchiveTaskTag() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) => {
      if (!user) throw new Error('User not authenticated');
      return unarchiveTaskTag(tagId, user.id);
    },
    onMutate: async (tagId) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: ['taskTags', user.id] });
      const previousTags = queryClient.getQueryData<TaskTag[]>(['taskTags', user.id]);
      queryClient.setQueryData<TaskTag[]>(['taskTags', user.id], (old) =>
        old?.map((tag) => (tag.id === tagId ? { ...tag, archived_at: null } : tag)) ?? [],
      );
      return { previousTags };
    },
    onError: (_err, _vars, context) => {
      if (user && context?.previousTags) {
        queryClient.setQueryData(['taskTags', user.id], context.previousTags);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['taskTags', user?.id] });
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

/**
 * Mirror of useUpdateTaskCategoryColor but for the description column.
 * Description has no fan-out into micro_tasks rows (unlike color, which is
 * embedded into MicroTaskRecord.categories[]) — it's stored only on
 * task_categories itself, so the optimistic update path is simpler.
 */
export function useUpdateTaskCategoryDescription() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      description,
    }: {
      id: string;
      description: string | null;
    }) => {
      if (!user) throw new Error('User not authenticated');
      return updateTaskCategoryAttributes(id, { description }, user.id);
    },
    onMutate: async ({ id, description }) => {
      await queryClient.cancelQueries({ queryKey: ['taskCategories', user?.id] });
      const prevCategories = queryClient.getQueryData<TaskCategory[]>([
        'taskCategories',
        user?.id,
      ]);
      queryClient.setQueryData<TaskCategory[]>(
        ['taskCategories', user?.id],
        (old) =>
          old?.map((category) =>
            category.id === id ? { ...category, description } : category,
          ) ?? [],
      );
      return { prevCategories };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevCategories) {
        queryClient.setQueryData(['taskCategories', user?.id], context.prevCategories);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
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

/**
 * Archive a category. Pre-existing task→category links survive (the
 * historical attachment is meaningful even after archiving), but the
 * category is hidden from new selectors and the voice LLM's context.
 */
export function useArchiveTaskCategory() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (categoryId: string) => {
      if (!user) throw new Error('User not authenticated');
      return archiveTaskCategory(categoryId, user.id);
    },
    onMutate: async (categoryId) => {
      if (!user) return;
      const nowIso = new Date().toISOString();
      await queryClient.cancelQueries({ queryKey: ['taskCategories', user.id] });
      const previousCategories = queryClient.getQueryData<TaskCategory[]>([
        'taskCategories',
        user.id,
      ]);
      queryClient.setQueryData<TaskCategory[]>(['taskCategories', user.id], (old) =>
        old?.map((cat) =>
          cat.id === categoryId ? { ...cat, archived_at: nowIso } : cat,
        ) ?? [],
      );
      return { previousCategories };
    },
    onError: (_err, _vars, context) => {
      if (user && context?.previousCategories) {
        queryClient.setQueryData(['taskCategories', user.id], context.previousCategories);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
    },
  });
}

export function useUnarchiveTaskCategory() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (categoryId: string) => {
      if (!user) throw new Error('User not authenticated');
      return unarchiveTaskCategory(categoryId, user.id);
    },
    onMutate: async (categoryId) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: ['taskCategories', user.id] });
      const previousCategories = queryClient.getQueryData<TaskCategory[]>([
        'taskCategories',
        user.id,
      ]);
      queryClient.setQueryData<TaskCategory[]>(['taskCategories', user.id], (old) =>
        old?.map((cat) =>
          cat.id === categoryId ? { ...cat, archived_at: null } : cat,
        ) ?? [],
      );
      return { previousCategories };
    },
    onError: (_err, _vars, context) => {
      if (user && context?.previousCategories) {
        queryClient.setQueryData(['taskCategories', user.id], context.previousCategories);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCategories', user?.id] });
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

export function useMicroTaskGroupTemplates() {
  const user = useAuthStore((state) => state.user);
  return useQuery<MicroTaskGroupTemplate[], Error>({
    queryKey: ['microTaskGroupTemplates', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      return listMicroTaskGroupTemplates(user.id);
    },
    enabled: Boolean(user?.id),
  });
}

export function useMicroTaskGroupTemplateItems(templateId: string | null) {
  const enabled = Boolean(templateId);
  return useQuery<MicroTaskGroupTemplateItem[], Error>({
    queryKey: ['microTaskGroupTemplateItems', templateId],
    queryFn: async () => {
      if (!templateId) throw new Error('Template id required');
      return listMicroTaskGroupTemplateItems(templateId);
    },
    enabled,
  });
}

export function useCreateMicroTaskGroupTemplate() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      items,
    }: {
      name: string;
      items: Array<Pick<MicroTaskGroupTemplateItem, 'title' | 'category_ids' | 'order'>>;
    }) => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await createMicroTaskGroupTemplate({ user_id: user.id, name });
      if (error) throw error;
      const template = data as MicroTaskGroupTemplate;
      const { error: itemsError } = await replaceMicroTaskGroupTemplateItems(template.id, items);
      if (itemsError) throw itemsError;
      return template;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['microTaskGroupTemplates', user?.id] });
    },
  });
}

export function useDeleteMicroTaskGroupTemplate() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      if (!user) throw new Error('User not authenticated');
      return deleteMicroTaskGroupTemplate(templateId, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['microTaskGroupTemplates', user?.id] });
    },
  });
}

