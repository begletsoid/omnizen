import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useFloating,
  type ReferenceType,
} from '@floating-ui/react';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';

import {
  useAcknowledgeCategoriesIntroduction,
  useArchiveTaskCategory,
  useArchiveTaskTag,
  useAttachCategoryToTask,
  useAttachTagToCategory,
  useCreateMicroTaskGroup,
  useCreateMicroTaskGroupTemplate,
  useCreateMicroTask,
  useCreateTaskCategory,
  useCreateTaskTag,
  useArchiveMicroTask,
  useDeleteMicroTaskGroup,
  useDeleteMicroTaskGroupTemplate,
  useDeleteMicroTask,
  useDeleteTaskCategory,
  useDeleteTaskTag,
  useDetachCategoryFromTask,
  useDetachTagFromCategory,
  useUnarchiveTaskCategory,
  useUnarchiveTaskTag,
  useMicroTaskGroups,
  useMicroTaskGroupTemplates,
  useMicroTasks,
  useRenameTaskCategory,
  useReorderMicroTaskItems,
  useUpdateMicroTaskGroup,
  useSetTaskCategoryBuffer,
  useTaskCategories,
  useTaskTags,
  useToggleMicroTaskTimer,
  useTransferMicroTaskTime,
  useUpdateMicroTask,
  useUpdateTaskCategoryColor,
  useUpdateTaskCategoryDescription,
} from '../../features/microTasks/hooks';
import type {
  MicroTaskGroup,
  MicroTaskGroupOrderUpdatePayload,
  MicroTaskGroupTaskUpdatePayload,
  MicroTaskRecord,
  TaskCategory,
} from '../../features/microTasks/types';
import {
  buildTemplateTaskPayloads,
  formatDuration,
  normalizeTimerState,
  parseDurationInput,
} from '../../features/microTasks/utils';
import {
  attachCategoriesToTask,
  createMicroTask,
  fetchNextMicroTaskOrder,
  listMicroTaskGroupTemplateItems,
} from '../../features/microTasks/api';
import { useAuthStore } from '../../stores/authStore';

import { MicroTaskCard } from './components/MicroTaskCard';
import { GroupHeader } from './components/GroupHeader';
import { TimerPill, SortableTimerPill } from './components/TimerPill';
import { TaxonomySelect } from './components/TaxonomySelect';
import { TimeTransferOverlay } from './components/TimeTransferOverlay';
import { TagIcon, ArchiveIcon } from './components/Icons';
import { usePointerDnd } from './hooks/usePointerDnd';
import { useTimeTransferDrag } from './hooks/useTimeTransferDrag';
import { useDuplicateOnD } from './hooks/useDuplicateOnD';
import { useCrossWidgetDrag } from '../tasks/CrossWidgetDragContext';
import { useTimers, describeTimerTags } from './hooks/useTimers';
import { computeAvailableSecondsOnSource } from '../../features/microTasks/transferUtils';
import {
  getCategoryColorPreset,
  CATEGORY_COLOR_PRESETS,
  TAXONOMY_DROPDOWN_SELECTOR,
} from './utils/constants';
import { isTaskId, isGroupId, isGendId, extractId } from './utils/dndUtils';

const getReferenceElement = (reference: ReferenceType | null): Element | null => {
  if (!reference) return null;
  if (reference instanceof Element) return reference;
  return reference.contextElement ?? null;
};

const referenceContainsNode = (
  reference: ReferenceType | null,
  target: Node,
): boolean => {
  const element = getReferenceElement(reference);
  return element ? element.contains(target) : false;
};

function reorderTasksByCompletion(
  list: MicroTaskRecord[],
  taskId: string,
  nextDone: boolean,
): MicroTaskRecord[] | null {
  const index = list.findIndex((entry) => entry.id === taskId);
  if (index === -1) return null;
  const updatedTask = { ...list[index], is_done: nextDone };
  const others = list.filter((entry) => entry.id !== taskId);
  const targetIndex = nextDone
    ? others.findIndex((entry) => !entry.is_done)
    : others.findIndex((entry) => entry.is_done);
  const insertIndex = targetIndex === -1 ? others.length : targetIndex;
  const reordered = [...others];
  reordered.splice(insertIndex, 0, updatedTask);
  return reordered;
}

export type MicroTasksWidgetProps = {
  widgetId: string | null;
  config?: Record<string, unknown> | null;
  onUpdateConfig?: (patch: Record<string, unknown>) => void;
};

function buildE2eSeed(): { tasks: MicroTaskRecord[]; groups: MicroTaskGroup[] } {
  const now = new Date().toISOString();
  const task = (id: string, order: number, overrides: Partial<MicroTaskRecord> = {}): MicroTaskRecord => ({
    id, widget_id: 'e2e', user_id: 'e2e', title: id, is_done: false, order,
    group_id: null, group_order: null, elapsed_seconds: 0, timer_state: 'paused',
    last_started_at: null, archived_at: null, created_at: now, updated_at: now, categories: [], ...overrides,
  });
  const group = (id: string, order: number): MicroTaskGroup => ({
    id, widget_id: 'e2e', user_id: 'e2e', name: id, order, created_at: now, updated_at: now,
  });
  return {
    groups: [group('group-1', 4)],
    tasks: [
      task('task-A', 1), task('task-B', 2), task('task-C', 3),
      task('task-G1', 4, { group_id: 'group-1', group_order: 1 }),
      task('task-G2', 4, { group_id: 'group-1', group_order: 2 }),
      task('task-G3', 4, { group_id: 'group-1', group_order: 3 }),
    ],
  };
}

/**
 * A flat list of N ungrouped tasks for the scroll-jump e2e test
 * (Phase 7.4 / Bug F). Enough rows to overflow the viewport so we can
 * scroll to the bottom, complete the last task, and assert the page
 * doesn't jump. Triggered by a `#e2e-many` (or `#e2e:<count>`) hash.
 */
function buildE2eManySeed(count: number): { tasks: MicroTaskRecord[]; groups: MicroTaskGroup[] } {
  const now = new Date().toISOString();
  const tasks: MicroTaskRecord[] = Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    widget_id: 'e2e',
    user_id: 'e2e',
    title: `Задача ${i + 1}`,
    is_done: false,
    order: i + 1,
    group_id: null,
    group_order: null,
    elapsed_seconds: 0,
    timer_state: 'paused',
    last_started_at: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    categories: [],
  }));
  return { groups: [], tasks };
}

/**
 * Resolve the e2e seed from the URL hash:
 *   #e2e            → small mixed seed (groups + tasks)
 *   #e2e-many       → 40 flat tasks (overflow viewport)
 *   #e2e:<count>    → <count> flat tasks
 */
function resolveE2eSeed(hash: string): { tasks: MicroTaskRecord[]; groups: MicroTaskGroup[] } {
  const countMatch = hash.match(/e2e[:-](\d+)/);
  if (countMatch) return buildE2eManySeed(Math.max(1, Number(countMatch[1])));
  if (hash.includes('e2e-many')) return buildE2eManySeed(40);
  return buildE2eSeed();
}

export function MicroTasksWidget({
  widgetId,
  config,
  onUpdateConfig,
}: MicroTasksWidgetProps) {
  const e2eMode = typeof window !== 'undefined' && window.location.hash.includes('e2e');
  const e2eHash = typeof window !== 'undefined' ? window.location.hash : '';
  const [e2eTasks, setE2eTasks] = useState<MicroTaskRecord[]>(() => e2eMode ? resolveE2eSeed(e2eHash).tasks : []);
  const [e2eGroups, setE2eGroups] = useState<MicroTaskGroup[]>(() => e2eMode ? resolveE2eSeed(e2eHash).groups : []);

  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  // Wrapped in try/catch so the widget renders standalone in tests where the
  // cross-widget drag provider isn't mounted. The hook is still called on
  // every render — the `eslint-disable` is for the IIFE wrapper, which the
  // rules-of-hooks rule mistakes for a conditional call site.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const crossDragCtx = (() => { try { return useCrossWidgetDrag(); } catch { return null; } })();
  const dropZoneRef = useRef<HTMLElement | null>(null);
  // Cancel handle for the in-flight completion scroll-pin loop (Bug F).
  // Completing a task floats it to the top of its section, shifting the
  // list; the browser then jumps the page to chase the moved row / shifted
  // content. pinScrollDuringCompletion keeps a stable neighbor row's
  // viewport position fixed for a few frames after the reorder, overriding
  // any native scroll. This holds the cancel fn so a rapid second
  // completion supersedes the previous pin instead of stacking.
  const scrollPinCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!crossDragCtx || !widgetId) return;
    crossDragCtx.registerDropZone(widgetId, dropZoneRef.current);
    return () => crossDragCtx.registerDropZone(widgetId, null);
  }, [crossDragCtx, widgetId]);

  // Cancel any in-flight scroll-pin loop when the widget unmounts.
  useEffect(() => () => scrollPinCancelRef.current?.(), []);

  /**
   * Bug F fix — keep the viewport visually still across a completion
   * reorder. Completing a task floats it to the top of its section, which
   * shifts the list and makes the browser jump the page (to chase the
   * moved row's focus and/or the shifted content) when the task leaves the
   * viewport. We pick a stable neighbor row (the one just above the
   * completed task, or just below if it's first), record its viewport top,
   * then re-assert that position on every animation frame until the layout
   * settles — overriding whatever the browser tries to do.
   *
   * Per-frame (not one-shot) because the reorder can land across several
   * renders (optimistic update, then the onSettled refetch), at different
   * times in prod vs e2e. The loop waits for the shift to actually happen
   * (first correction) and only then counts "settled" frames, with a hard
   * ~700ms cap so it never fights a manually-scrolling user for long.
   */
  const pinScrollDuringCompletion = useCallback((pivotTaskId: string) => {
    const container = dropZoneRef.current;
    if (!container) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-task-id]'));
    const idx = rows.findIndex((row) => row.dataset.taskId === pivotTaskId);
    if (idx === -1) return;
    const anchor = rows[idx - 1] ?? rows[idx + 1] ?? null;
    if (!anchor) return;

    // Find the actual scroll container. This app sets `overflow-x: hidden`
    // on html/body, which by CSS spec makes overflow-y compute to `auto` —
    // so the real vertical scroller is usually <body>, NOT the window.
    // Using window.scrollBy here was a no-op (part of why earlier Bug F
    // attempts failed). Walk up to the first ancestor that actually
    // scrolls; fall back to the document scrolling element.
    const findScroller = (from: HTMLElement): HTMLElement => {
      let el: HTMLElement | null = from.parentElement;
      while (el && el !== document.documentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
          return el;
        }
        el = el.parentElement;
      }
      return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    };
    const scroller = findScroller(anchor);
    const beforeTop = anchor.getBoundingClientRect().top;

    // Supersede any previous pin (rapid successive completions).
    scrollPinCancelRef.current?.();

    let rafId = 0;
    let stableFrames = 0;
    let corrected = false;
    const start = performance.now();
    const tick = () => {
      const afterTop = anchor.getBoundingClientRect().top;
      const delta = afterTop - beforeTop;
      if (Math.abs(delta) > 0.5) {
        scroller.scrollTop += delta;
        corrected = true;
        stableFrames = 0;
      } else {
        stableFrames += 1;
      }
      const elapsed = performance.now() - start;
      // Stop only after we've actually corrected a shift AND it's been
      // stable for a few frames, or after the hard cap (covers the case
      // where the reorder somehow never shifts the anchor).
      if ((corrected && stableFrames >= 4) || elapsed > 700) {
        scrollPinCancelRef.current = null;
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    scrollPinCancelRef.current = () => {
      cancelAnimationFrame(rafId);
      scrollPinCancelRef.current = null;
    };
  }, []);

  const { data: rawTasks = [], isLoading, isError, error } = useMicroTasks(e2eMode ? null : widgetId);
  const { data: groups = [] } = useMicroTaskGroups(e2eMode ? null : widgetId);
  const { data: templates = [] } = useMicroTaskGroupTemplates();
  const { data: tags = [] } = useTaskTags();
  const { data: taskCategories = [] } = useTaskCategories();

  const createTask = useCreateMicroTask(widgetId);
  const createGroup = useCreateMicroTaskGroup(widgetId);
  const updateGroup = useUpdateMicroTaskGroup(widgetId);
  const deleteGroupMutation = useDeleteMicroTaskGroup(widgetId);
  const createGroupTemplate = useCreateMicroTaskGroupTemplate();
  const deleteGroupTemplate = useDeleteMicroTaskGroupTemplate();
  const updateTask = useUpdateMicroTask(widgetId);
  const deleteTask = useDeleteMicroTask(widgetId);
  const reorderItemsMutation = useReorderMicroTaskItems(widgetId);
  const toggleTimer = useToggleMicroTaskTimer(widgetId);
  const transferTime = useTransferMicroTaskTime(widgetId);
  const archiveTask = useArchiveMicroTask(widgetId);
  const acknowledgeIntroduction = useAcknowledgeCategoriesIntroduction(widgetId);
  const attachCategoryToTask = useAttachCategoryToTask();
  const detachCategoryFromTask = useDetachCategoryFromTask();
  const setCategoryBuffer = useSetTaskCategoryBuffer();
  const createTag = useCreateTaskTag();
  const deleteTag = useDeleteTaskTag();
  const archiveTag = useArchiveTaskTag();
  const unarchiveTag = useUnarchiveTaskTag();
  const createCategory = useCreateTaskCategory();
  const renameCategory = useRenameTaskCategory();
  const deleteCategory = useDeleteTaskCategory();
  const archiveCategory = useArchiveTaskCategory();
  const unarchiveCategory = useUnarchiveTaskCategory();
  const attachTagToCategory = useAttachTagToCategory();
  const detachTagFromCategory = useDetachTagFromCategory();

  useEffect(() => {
    if (!widgetId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.targetWidgetId !== widgetId) return;
      const goal = detail.goal as { id?: string; title?: string; categories?: Array<{ id: string }> } | undefined;
      if (!goal?.title) return;
      const goalCategoryIds = goal.categories?.map((c) => c.id).filter(Boolean) ?? [];
      void createTask.mutateAsync({
        title: goal.title!,
        goal_id: goal.id ?? null,
        category_ids_override: goalCategoryIds,
      });
    };
    window.addEventListener('cross-widget-drop', handler);
    return () => window.removeEventListener('cross-widget-drop', handler);
  }, [widgetId, createTask]);
  const updateCategoryColor = useUpdateTaskCategoryColor();
  const updateCategoryDescription = useUpdateTaskCategoryDescription();

  const [optimisticRunningId, setOptimisticRunningId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const effectiveRawTasks = e2eMode ? e2eTasks : rawTasks;
  const effectiveGroups = e2eMode ? e2eGroups : groups;

  const tasks = useMemo<MicroTaskRecord[]>(
    () =>
      effectiveRawTasks
        .map((task) => ({
          ...task,
          elapsed_seconds:
            typeof task.elapsed_seconds === 'number' && Number.isFinite(task.elapsed_seconds)
              ? task.elapsed_seconds
              : 0,
          timer_state: normalizeTimerState(task.timer_state),
          last_started_at: task.last_started_at ?? null,
          archived_at: task.archived_at ?? null,
          group_id: task.group_id ?? null,
          group_order: typeof task.group_order === 'number' ? task.group_order : null,
        }))
        .filter((task) => !task.archived_at),
    [effectiveRawTasks],
  );

  const runningTask = tasks.find((task) => task.timer_state === 'running');
  const effectiveRunningId = optimisticRunningId ?? runningTask?.id ?? null;

  useEffect(() => {
    if (!optimisticRunningId) return;
    if (runningTask?.id === optimisticRunningId) setOptimisticRunningId(null);
  }, [optimisticRunningId, runningTask?.id]);

  useEffect(() => {
    if (!effectiveRunningId) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [effectiveRunningId]);

  const {
    timersState,
    extraTimerViews,
    primaryTimerView,
    canAddTimer,
    computeTaskSeconds,
    taskSecondsMap,
    handleTimerDragEnd,
    handleAddTimer,
    handleRemoveTimer,
    handleTimerModeToggle,
    handleTimerTagAdd,
    handleTimerTagRemove,
    handleTimerColorSelect,
  } = useTimers({
    config,
    onUpdateConfig,
    tasks,
    effectiveRunningId,
    now,
  });

  const handleE2eReorder = useCallback(
    ({ taskUpdates, groupUpdates }: { taskUpdates: MicroTaskGroupTaskUpdatePayload[]; groupUpdates: MicroTaskGroupOrderUpdatePayload[] }) => {
      const taskMap = new Map(taskUpdates.map((u) => [u.id, u]));
      const groupMap = new Map(groupUpdates.map((u) => [u.id, u.order]));
      setE2eTasks((prev) =>
        prev
          .map((t) => {
            const u = taskMap.get(t.id);
            if (!u) return t;
            return { ...t, order: u.order, group_id: u.group_id, group_order: u.group_order };
          })
          .sort((a, b) => a.order - b.order),
      );
      setE2eGroups((prev) =>
        prev
          .map((g) => (groupMap.has(g.id) ? { ...g, order: groupMap.get(g.id)! } : g))
          .sort((a, b) => a.order - b.order),
      );
    },
    [],
  );

  const handleReorder = useCallback(
    (result: { taskUpdates: MicroTaskGroupTaskUpdatePayload[]; groupUpdates: MicroTaskGroupOrderUpdatePayload[] }) => {
      if (e2eMode) {
        handleE2eReorder(result);
      } else {
        reorderItemsMutation.mutate(result);
      }
    },
    [e2eMode, handleE2eReorder, reorderItemsMutation],
  );

  const {
    dragState,
    flatList,
    taskById,
    groupById,
    registerRef,
    handlePointerDown,
  } = usePointerDnd({
    tasks,
    groups: effectiveGroups,
    onReorder: handleReorder,
  });

  // Time-transfer drag from a task's timer button.
  // We pull a stable reference to mutateAsync so the hook's identity stays
  // stable across renders — otherwise its window listeners (pointermove,
  // keydown) churn every render and lose mid-drag state.
  const transferMutateAsync = transferTime.mutateAsync;
  const handleTransferCommit = useCallback(
    async (op: { fromTaskId: string; toTaskId: string; seconds: number }) => {
      await transferMutateAsync(op);
    },
    [transferMutateAsync],
  );
  const getTaskById = useCallback(
    (id: string) => taskById.get(id),
    [taskById],
  );
  const transferDrag = useTimeTransferDrag({
    getTaskById,
    onCommit: handleTransferCommit,
  });
  const transferState = transferDrag.state;
  const transferEffectiveMinutes = transferDrag.effectiveMinutes;
  const transferRequestedMinutes = transferDrag.requestedMinutes;
  const transferValidity = transferDrag.validity;

  // Press D over a task row to duplicate it (title + categories + goal_id).
  // We track the pointer imperatively because the keydown event itself has no
  // pointer position — and the alternative (mouseenter/mouseleave on every
  // row) would flicker each time the user re-renders the list.
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 });
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', handler);
    return () => window.removeEventListener('pointermove', handler);
  }, []);

  const resolveTaskAtPointer = useCallback((): MicroTaskRecord | null => {
    if (typeof document.elementFromPoint !== 'function') return null;
    const { x, y } = lastPointerRef.current;
    if (x < 0 || y < 0) return null;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    const row = el.closest('[data-task-id]') as HTMLElement | null;
    if (!row) return null;
    const id = row.getAttribute('data-task-id');
    if (!id) return null;
    return taskById.get(id) ?? null;
  }, [taskById]);

  const createTaskMutateAsync = createTask.mutateAsync;
  const toggleTimerMutateAsync = toggleTimer.mutateAsync;
  const handleDuplicateTask = useCallback(
    async (task: MicroTaskRecord) => {
      const categoryIds = task.categories?.map((c) => c.id) ?? [];
      // Cast: MicroTaskRecord type doesn't list goal_id, but the runtime row
      // carries it (added in the tasks-widget migration). Read it loosely.
      const goalId = (task as MicroTaskRecord & { goal_id?: string | null }).goal_id ?? null;
      const created = await createTaskMutateAsync({
        title: task.title,
        goal_id: goalId,
        group_id: task.group_id ?? null,
        category_ids_override: categoryIds,
      });
      // `created` is null only when the create was cancelled mid-flight
      // (✕ on the temp-row) — nothing to start then.
      if (!created) return;
      // Auto-start the duplicate's timer. start_micro_task_timer pauses any
      // other running task in the widget atomically, so the previously active
      // task gets paused without a separate call.
      try {
        await toggleTimerMutateAsync({ id: created.id, isRunning: false });
      } catch {
        // Non-fatal: duplicate row exists; user can press the play button.
      }
    },
    [createTaskMutateAsync, toggleTimerMutateAsync],
  );

  useDuplicateOnD({
    enabled: Boolean(widgetId),
    resolveTaskAtPointer,
    onDuplicate: handleDuplicateTask,
  });

  const timerSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // --- Taxonomy Manager ---
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [colorMenuCategoryId, setColorMenuCategoryId] = useState<string | null>(null);
  const [colorMenuPosition, setColorMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const colorButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const colorMenuRef = useRef<HTMLDivElement | null>(null);

  const { refs: managerRefs, strategy: managerStrategy, x: managerX, y: managerY } = useFloating({
    open: isManagerOpen,
    onOpenChange: setIsManagerOpen,
    placement: 'bottom-start',
    middleware: [offset(12), flip(), shift()],
  });

  useEffect(() => {
    if (!isManagerOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        referenceContainsNode(managerRefs.reference.current, target) ||
        managerRefs.floating.current?.contains(target) ||
        (target instanceof HTMLElement && target.closest(TAXONOMY_DROPDOWN_SELECTOR)) ||
        colorMenuRef.current?.contains(target)
      ) {
        return;
      }
      setIsManagerOpen(false);
      setColorMenuCategoryId(null);
      setColorMenuPosition(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isManagerOpen, managerRefs.reference, managerRefs.floating]);

  useEffect(() => {
    if (!isManagerOpen) {
      setColorMenuCategoryId(null);
      setColorMenuPosition(null);
    }
  }, [isManagerOpen]);

  useEffect(() => {
    if (!colorMenuCategoryId) return;
    const activeCategoryId = colorMenuCategoryId;
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      const activeButton = colorButtonRefs.current[activeCategoryId] ?? null;
      if (
        colorMenuRef.current?.contains(target) ||
        (activeButton && activeButton.contains(target))
      ) {
        return;
      }
      setColorMenuCategoryId(null);
      setColorMenuPosition(null);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [colorMenuCategoryId]);

  // --- Group Menu ---
  const [isGroupMenuOpen, setIsGroupMenuOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const { refs: groupMenuRefs, strategy: groupMenuStrategy, x: groupMenuX, y: groupMenuY } = useFloating({
    open: isGroupMenuOpen,
    onOpenChange: setIsGroupMenuOpen,
    placement: 'bottom-start',
    middleware: [offset(12), flip(), shift()],
  });

  useEffect(() => {
    if (!isGroupMenuOpen) return;
    function handleGroupMenuOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        referenceContainsNode(groupMenuRefs.reference.current, target) ||
        groupMenuRefs.floating.current?.contains(target)
      ) {
        return;
      }
      setIsGroupMenuOpen(false);
    }
    document.addEventListener('mousedown', handleGroupMenuOutside);
    return () => document.removeEventListener('mousedown', handleGroupMenuOutside);
  }, [isGroupMenuOpen, groupMenuRefs.reference, groupMenuRefs.floating]);

  // --- Timer Menu ---
  const [activeTimerMenuId, setActiveTimerMenuId] = useState<string | null>(null);
  const timerButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const timerColorButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [timerColorMenuId, setTimerColorMenuId] = useState<string | null>(null);

  const timerMenuFloating = useFloating({
    open: Boolean(activeTimerMenuId),
    onOpenChange: (open) => { if (!open) setActiveTimerMenuId(null); },
    placement: 'bottom-end',
    middleware: [offset(8), flip(), shift()],
  });
  const { refs: timerMenuRefs, strategy: timerMenuStrategy, x: timerMenuX, y: timerMenuY } = timerMenuFloating;

  const timerColorMenuFloating = useFloating({
    open: Boolean(timerColorMenuId),
    onOpenChange: (open) => { if (!open) setTimerColorMenuId(null); },
    placement: 'top-end',
    middleware: [offset(8), flip(), shift()],
  });
  const { refs: timerColorMenuRefs, strategy: timerColorMenuStrategy, x: timerColorMenuX, y: timerColorMenuY } = timerColorMenuFloating;

  const activeTimerSettings =
    activeTimerMenuId === timersState.primary.id
      ? timersState.primary
      : timersState.extras.find((t) => t.id === activeTimerMenuId) ?? null;
  const activeTimerIsPrimary = activeTimerSettings?.id === timersState.primary.id;
  const activeTimerAvailableTags = activeTimerSettings
    ? tags.filter((tag) => !activeTimerSettings.tagIds.includes(tag.id))
    : [];
  const activeTimerMetrics = activeTimerSettings
    ? (() => {
        const view = activeTimerSettings.id === timersState.primary.id
          ? primaryTimerView
          : extraTimerViews.find((v) => v.settings.id === activeTimerSettings.id)?.metrics;
        return view ?? { elapsed: 0, percent: 0, colorPreset: getCategoryColorPreset() };
      })()
    : null;

  const timerColorMenuTimer =
    timerColorMenuId === timersState.primary.id
      ? timersState.primary
      : timersState.extras.find((t) => t.id === timerColorMenuId) ?? null;

  useEffect(() => {
    if (!activeTimerMenuId) return;
    const reference = timerButtonRefs.current[activeTimerMenuId];
    if (reference) timerMenuRefs.setReference(reference);
  }, [activeTimerMenuId, timerMenuRefs]);

  useEffect(() => {
    if (!activeTimerMenuId) return;
    function handleTimerMenuOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        referenceContainsNode(timerMenuRefs.reference.current, target) ||
        timerMenuRefs.floating.current?.contains(target) ||
        (target instanceof HTMLElement && target.closest(TAXONOMY_DROPDOWN_SELECTOR))
      ) {
        return;
      }
      setActiveTimerMenuId(null);
    }
    document.addEventListener('mousedown', handleTimerMenuOutside);
    return () => document.removeEventListener('mousedown', handleTimerMenuOutside);
  }, [activeTimerMenuId, timerMenuRefs.reference, timerMenuRefs.floating]);

  useEffect(() => {
    if (!timerColorMenuId) return;
    const reference = timerColorButtonRefs.current[timerColorMenuId];
    if (reference) timerColorMenuRefs.setReference(reference);
  }, [timerColorMenuId, timerColorMenuRefs]);

  useEffect(() => {
    if (!timerColorMenuId) return;
    function handleTimerColorOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        referenceContainsNode(timerColorMenuRefs.reference.current, target) ||
        timerColorMenuRefs.floating.current?.contains(target)
      ) {
        return;
      }
      setTimerColorMenuId(null);
    }
    document.addEventListener('mousedown', handleTimerColorOutside);
    return () => document.removeEventListener('mousedown', handleTimerColorOutside);
  }, [timerColorMenuId, timerColorMenuRefs.reference, timerColorMenuRefs.floating]);

  useEffect(() => {
    if (activeTimerMenuId && !activeTimerSettings) setActiveTimerMenuId(null);
  }, [activeTimerMenuId, activeTimerSettings]);

  // --- Editing State ---
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [editingTask, setEditingTask] = useState<{ id: string; value: string } | null>(null);
  const [editingTimeTaskId, setEditingTimeTaskId] = useState<string | null>(null);
  const [timeDraft, setTimeDraft] = useState('');
  const [isTimeInvalid, setIsTimeInvalid] = useState(false);
  const [isTimeSaving, setIsTimeSaving] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  const tagMap = useMemo(() => {
    const map = new Map<string, string>();
    tags.forEach((tag) => map.set(tag.id, tag.name));
    return map;
  }, [tags]);

  const groupTasksMap = useMemo(() => {
    const map = new Map<string, MicroTaskRecord[]>();
    tasks.forEach((task) => {
      if (!task.group_id) return;
      const list = map.get(task.group_id) ?? [];
      list.push(task);
      map.set(task.group_id, list);
    });
    map.forEach((list) =>
      list.sort((a, b) => (a.group_order ?? a.order) - (b.group_order ?? b.order)),
    );
    return map;
  }, [tasks]);

  const ungroupedTasks = useMemo(
    () => tasks.filter((t) => !t.group_id).sort((a, b) => a.order - b.order),
    [tasks],
  );

  const sortedGroups = useMemo(
    () => [...effectiveGroups].sort((a, b) => a.order - b.order),
    [effectiveGroups],
  );

  const listEntries = useMemo(() => {
    const entries: Array<
      | { kind: 'group'; group: MicroTaskGroup; order: number }
      | { kind: 'task'; task: MicroTaskRecord; order: number }
    > = [
      ...sortedGroups.map((g) => ({ kind: 'group' as const, group: g, order: g.order })),
      ...ungroupedTasks.map((t) => ({ kind: 'task' as const, task: t, order: t.order })),
    ];
    return entries.sort((a, b) => a.order - b.order);
  }, [sortedGroups, ungroupedTasks]);

  const maxEntryOrder = useMemo(() => {
    const orders = [
      ...sortedGroups.map((g) => g.order),
      ...ungroupedTasks.map((t) => t.order),
    ];
    return orders.length ? Math.max(...orders) : 0;
  }, [sortedGroups, ungroupedTasks]);

  const filteredTemplates = useMemo(() => {
    const term = groupSearch.trim().toLowerCase();
    if (!term) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(term));
  }, [groupSearch, templates]);

  // --- Handlers ---
  const handleCreateTag = async () => {
    const value = newTagName.trim();
    if (!value) return;
    await createTag.mutateAsync(value);
    setNewTagName('');
  };

  const handleCreateCategory = async () => {
    const value = newCategoryName.trim();
    if (!value) return;
    await createCategory.mutateAsync(value);
    setNewCategoryName('');
  };

  const handleStartRenameCategory = (category: TaskCategory) => {
    if (category.is_auto) return;
    setRenamingCategoryId(category.id);
    setRenameDraft(category.name);
  };

  const handleCommitRenameCategory = async () => {
    if (!renamingCategoryId) return;
    const nextName = renameDraft.trim();
    if (!nextName) { setRenamingCategoryId(null); return; }
    await renameCategory.mutateAsync({ id: renamingCategoryId, name: nextName });
    setRenamingCategoryId(null);
    setRenameDraft('');
  };

  const handleToggleColorMenu = (categoryId: string) => {
    setColorMenuCategoryId((prev) => {
      if (prev === categoryId) { setColorMenuPosition(null); return null; }
      const button = colorButtonRefs.current[categoryId] ?? null;
      if (button) {
        const rect = button.getBoundingClientRect();
        const off = 12;
        setColorMenuPosition({
          x: Math.min(window.innerWidth - 180, rect.right + off),
          y: Math.max(off, rect.top - off),
        });
      } else {
        setColorMenuPosition(null);
      }
      return categoryId;
    });
  };

  const handleSelectCategoryColor = async (categoryId: string, colorId: string | null) => {
    await updateCategoryColor.mutateAsync({ id: categoryId, color: colorId });
    setColorMenuCategoryId(null);
    setColorMenuPosition(null);
  };

  const handleAddTask = async () => {
    if (!widgetId) return;
    const title = newTaskTitle.trim();
    if (!title) return;
    // Clear the input BEFORE awaiting the mutation: the LLM-classify +
    // INSERT takes 1-3s and the user wants to type the next task name
    // immediately, not wait for the previous one to commit. The optimistic
    // temp-row already gives them visual confirmation.
    setNewTaskTitle('');
    try {
      await createTask.mutateAsync({ title });
    } catch (err) {
      console.warn('Failed to create micro task', err);
    }
  };

  const handleCreateGroup = async () => {
    if (!widgetId) return;
    await createGroup.mutateAsync({ name: 'Новая группа', order: maxEntryOrder + 1 });
  };

  const handleCommitGroupName = async (group: MicroTaskGroup) => {
    const nextName = editingGroupName.trim();
    setEditingGroupId(null);
    setEditingGroupName('');
    if (!nextName || nextName === group.name) return;
    await updateGroup.mutateAsync({ id: group.id, name: nextName });
  };

  const handleDeleteGroup = async (group: MicroTaskGroup) => {
    if (!widgetId) return;
    const gTasks = groupTasksMap.get(group.id) ?? [];
    const expandedEntries: Array<{ kind: 'group'; group: MicroTaskGroup } | { kind: 'task'; task: MicroTaskRecord }> = [];
    listEntries.forEach((entry) => {
      if (entry.kind === 'group' && entry.group.id === group.id) {
        gTasks.forEach((t) => expandedEntries.push({ kind: 'task', task: t }));
        return;
      }
      expandedEntries.push(entry);
    });
    const groupUpdates: MicroTaskGroupOrderUpdatePayload[] = [];
    const taskUpdates: MicroTaskGroupTaskUpdatePayload[] = [];
    expandedEntries.forEach((entry, index) => {
      const order = index + 1;
      if (entry.kind === 'group') groupUpdates.push({ id: entry.group.id, order });
      else taskUpdates.push({ id: entry.task.id, order, group_id: null, group_order: null });
    });
    gTasks.forEach((t) => {
      const match = expandedEntries.findIndex((e) => e.kind === 'task' && e.task.id === t.id);
      if (match === -1) taskUpdates.push({ id: t.id, order: t.order, group_id: null, group_order: null });
    });
    reorderItemsMutation.mutate({ taskUpdates, groupUpdates });
    await deleteGroupMutation.mutateAsync(group.id);
  };

  const handleSaveGroupTemplate = async (group: MicroTaskGroup) => {
    const gTasks = groupTasksMap.get(group.id) ?? [];
    const items = gTasks.map((t, i) => ({
      title: t.title,
      category_ids: t.categories?.map((c) => c.id) ?? [],
      order: i + 1,
    }));
    await createGroupTemplate.mutateAsync({ name: group.name, items });
  };

  const handleCreateGroupFromTemplate = async (template: { id: string; name: string }) => {
    if (!widgetId || !user) return;
    const order = maxEntryOrder + 1;
    const groupData = await createGroup.mutateAsync({ name: template.name, order });
    const items = await listMicroTaskGroupTemplateItems(template.id);
    const baseOrder = await fetchNextMicroTaskOrder(widgetId);
    const payloads = buildTemplateTaskPayloads({
      items: items.map((item) => ({ title: item.title, category_ids: item.category_ids, order: item.order })),
      baseOrder,
      groupId: groupData.id,
    });
    for (const payload of payloads) {
      const insertPayload = Object.assign({}, payload.insert, { widget_id: widgetId, user_id: user.id });
      const { data, error } = await createMicroTask(insertPayload);
      if (error) throw error;
      if (payload.categoryIds?.length) await attachCategoriesToTask(data.id, payload.categoryIds, user.id);
    }
    await queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
    await queryClient.invalidateQueries({ queryKey: ['microTaskGroups', widgetId] });
  };

  const handleToggleDone = async (task: MicroTaskRecord) => {
    const willBeDone = !task.is_done;

    // E2E mode: no supabase, so reorder the local seed directly. Mirrors
    // the production semantics (complete → float to top of section via
    // reorderTasksByCompletion) so the Bug F scroll-jump e2e test
    // exercises the same UI behaviour.
    if (e2eMode) {
      if (willBeDone) pinScrollDuringCompletion(task.id);
      setE2eTasks((prev) => {
        if (!willBeDone) {
          return prev.map((t) => (t.id === task.id ? { ...t, is_done: false } : t));
        }
        const reordered = reorderTasksByCompletion(prev, task.id, true);
        if (!reordered) {
          return prev.map((t) => (t.id === task.id ? { ...t, is_done: true } : t));
        }
        // Re-assign `order` so buildFlatList (sorts by order) reflects the
        // new sequence.
        return reordered.map((t, i) => ({ ...t, order: i + 1 }));
      });
      return;
    }

    if (task.timer_state === 'running' && willBeDone) {
      await toggleTimer.mutateAsync({ id: task.id, isRunning: true });
    }
    await updateTask.mutateAsync({ id: task.id, is_done: willBeDone });
    if (!willBeDone) return;
    // Pin the viewport across the completion reorder so the page doesn't
    // jump when the completed task floats up off-screen (Bug F). See
    // pinScrollDuringCompletion + Phase 7.4 in the plan.
    pinScrollDuringCompletion(task.id);
    if (task.group_id) {
      const gTasks = groupTasksMap.get(task.group_id) ?? [];
      const nextGroupTasks = reorderTasksByCompletion(gTasks, task.id, willBeDone);
      if (nextGroupTasks) {
        const taskUpdates = nextGroupTasks.map((entry, i) => ({
          id: entry.id,
          order: entry.order,
          group_id: task.group_id ?? null,
          group_order: i + 1,
        }));
        reorderItemsMutation.mutate({ taskUpdates, groupUpdates: [] });
      }
      return;
    }
    const nextUngrouped = reorderTasksByCompletion(ungroupedTasks, task.id, willBeDone);
    if (nextUngrouped) {
      const queue = [...nextUngrouped];
      const nextEntries = listEntries.map((entry) =>
        entry.kind === 'task' ? { ...entry, task: queue.shift()! } : entry,
      );
      const taskUpdates: MicroTaskGroupTaskUpdatePayload[] = [];
      const groupUpdates: MicroTaskGroupOrderUpdatePayload[] = [];
      nextEntries.forEach((entry, index) => {
        const order = index + 1;
        if (entry.kind === 'group') groupUpdates.push({ id: entry.group.id, order });
        else taskUpdates.push({ id: entry.task.id, order, group_id: null, group_order: null });
      });
      reorderItemsMutation.mutate({ taskUpdates, groupUpdates });
    }
  };

  const handleToggleTimer = async (task: MicroTaskRecord) => {
    const wasRunning = task.timer_state === 'running';
    const previousOptimisticId = optimisticRunningId;
    setOptimisticRunningId(wasRunning ? null : task.id);
    try {
      await toggleTimer.mutateAsync({ id: task.id, isRunning: wasRunning });
    } catch {
      setOptimisticRunningId(previousOptimisticId ?? null);
    }
  };

  const handleDelete = async (task: MicroTaskRecord) => {
    if (task.timer_state === 'running') {
      await toggleTimer.mutateAsync({ id: task.id, isRunning: true });
    }
    await deleteTask.mutateAsync(task.id);
  };

  const handleArchiveTask = async (task: MicroTaskRecord) => {
    if (!task.is_done || archiveTask.isPending) return;
    await archiveTask.mutateAsync(task.id);
  };

  const handleStartEditingTime = async (task: MicroTaskRecord) => {
    if (editingTimeTaskId === task.id) return;
    if (task.timer_state === 'running') {
      try { await toggleTimer.mutateAsync({ id: task.id, isRunning: true }); } catch { /* ignore */ }
    }
    setEditingTimeTaskId(task.id);
    setTimeDraft(formatDuration(computeTaskSeconds(task, effectiveRunningId === task.id)));
    setIsTimeInvalid(false);
  };

  const handleCommitEditingTime = async (task: MicroTaskRecord) => {
    if (!editingTimeTaskId || editingTimeTaskId !== task.id) return;
    const seconds = parseDurationInput(timeDraft);
    if (seconds === null) { setIsTimeInvalid(true); return; }
    setIsTimeSaving(true);
    try {
      await updateTask.mutateAsync({ id: task.id, elapsed_seconds: seconds, timer_state: 'paused', last_started_at: null });
      setEditingTimeTaskId(null);
      setTimeDraft('');
    } finally {
      setIsTimeSaving(false);
      setIsTimeInvalid(false);
    }
  };

  const handleAttachCategory = async (task: MicroTaskRecord, categoryId: string) => {
    if (!categoryId) return;
    await attachCategoryToTask.mutateAsync({ taskId: task.id, categoryId });
    const nextIds = Array.from(new Set([...(task.categories ?? []).map((c) => c.id), categoryId]));
    await setCategoryBuffer.mutateAsync(nextIds);
  };

  const handleDetachCategory = async (task: MicroTaskRecord, categoryId: string) => {
    await detachCategoryFromTask.mutateAsync({ taskId: task.id, categoryId });
    const nextIds = task.categories?.filter((c) => c.id !== categoryId).map((c) => c.id) ?? [];
    await setCategoryBuffer.mutateAsync(nextIds);
  };

  const colorMenuCategory = colorMenuCategoryId
    ? taskCategories.find((c) => c.id === colorMenuCategoryId)
    : null;

  const ready = e2eMode || Boolean(widgetId);

  const renderTaskCard = useCallback(
    (task: MicroTaskRecord, itemId: string) => {
      const isTaskRunning = effectiveRunningId === task.id;
      const seconds = taskSecondsMap.get(task.id) ?? computeTaskSeconds(task, isTaskRunning);
      const isDragging = dragState?.draggedId === itemId;
      const isTransferSource = transferState?.sourceTaskId === task.id;
      const isTransferTarget =
        transferState !== null &&
        transferState.hoveredTargetId === task.id &&
        transferState.sourceTaskId !== task.id;
      // While dragging time off this row, the timer label tracks the
      // committed seconds minus what the user is requesting (clamped to
      // what's actually available). For running tasks we add the live
      // delta back so the per-second tick continues to flow.
      let timeLabelOverride: string | undefined;
      if (isTransferSource && transferState) {
        const liveSec = computeAvailableSecondsOnSource(
          transferState.sourceCommittedSeconds,
          transferState.sourceTimerState,
          transferState.sourceLastStartedAt,
          Date.now(),
        );
        const requestedSec = Math.min(
          transferRequestedMinutes * 60,
          liveSec,
        );
        const previewSec = Math.max(0, liveSec - requestedSec);
        timeLabelOverride = formatDuration(previewSec);
      } else if (isTransferTarget && transferEffectiveMinutes > 0) {
        // Visual reciprocal — hovering target shows the boosted value.
        timeLabelOverride = formatDuration(seconds + transferEffectiveMinutes * 60);
      }
      return (
        <MicroTaskCard
          key={task.id}
          dataTaskId={task.id}
          task={task}
          seconds={seconds}
          isRunning={isTaskRunning}
          isDragging={isDragging}
          cardRef={(el) => registerRef(itemId, el)}
          onPointerDown={(e) => handlePointerDown(itemId, e)}
          onToggleTimer={() => handleToggleTimer(task)}
          onToggleDone={() => handleToggleDone(task)}
          onDelete={() => handleDelete(task)}
          onArchive={() => handleArchiveTask(task)}
          isArchiving={archiveTask.isPending && archiveTask.variables === task.id}
          onTimeClick={() => handleStartEditingTime(task)}
          onTimerPointerDown={(e) => transferDrag.beginPress(task.id, e)}
          timeLabelOverride={timeLabelOverride}
          isTransferSource={isTransferSource}
          isTransferTarget={isTransferTarget}
          onTimeChange={(value) => { setTimeDraft(value); setIsTimeInvalid(false); }}
          onTimeCommit={() => handleCommitEditingTime(task)}
          onTimeCancel={() => { setEditingTimeTaskId(null); setTimeDraft(''); setIsTimeInvalid(false); setIsTimeSaving(false); }}
          isEditing={editingTask?.id === task.id}
          editValue={editingTask?.id === task.id ? editingTask.value : ''}
          onEditStart={() => setEditingTask({ id: task.id, value: task.title })}
          onEditChange={(value) => setEditingTask((prev) => prev && prev.id === task.id ? { ...prev, value } : prev)}
          onEditCommit={async () => {
            if (!editingTask) return;
            const trimmed = editingTask.value.trim();
            if (trimmed && trimmed !== task.title) await updateTask.mutateAsync({ id: task.id, title: trimmed });
            setEditingTask(null);
          }}
          onEditCancel={() => setEditingTask(null)}
          taskCategories={taskCategories}
          onAttachCategory={(categoryId) => handleAttachCategory(task, categoryId)}
          onDetachCategory={(categoryId) => handleDetachCategory(task, categoryId)}
          onAcknowledgeIntroduction={() => {
            // Idempotent on the server side; we also skip locally if the
            // task already has a timestamp set so we don't spam mutations.
            if (task.id.startsWith('temp-')) return;
            if (task.categories_introduced_at) return;
            acknowledgeIntroduction.mutate(task.id);
          }}
          isEditingTime={editingTimeTaskId === task.id}
          timeDraft={editingTimeTaskId === task.id ? timeDraft : ''}
          isTimeInvalid={isTimeInvalid}
          isTimeSaving={isTimeSaving}
        />
      );
    },
    [effectiveRunningId, taskSecondsMap, computeTaskSeconds, editingTask, editingTimeTaskId, timeDraft, isTimeInvalid, isTimeSaving, taskCategories, archiveTask.isPending, archiveTask.variables, dragState, registerRef, handlePointerDown, transferDrag, transferState, transferEffectiveMinutes, transferRequestedMinutes, acknowledgeIntroduction],
  );

  return (
    <section ref={(el) => { dropZoneRef.current = el; }} className="flex flex-col gap-4 rounded-[2.5rem] border border-white/10 bg-background/40 px-4 py-4">
      {/* Header: taxonomy + group buttons + timers */}
      <header className="flex flex-col gap-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            ref={managerRefs.setReference}
            onClick={() => setIsManagerOpen((prev) => !prev)}
            disabled={!widgetId}
            className={clsx(
              'inline-flex w-fit items-center gap-1 rounded-full border border-white/20 px-2.5 py-1 text-xs transition',
              widgetId ? 'hover:border-white/40 hover:text-white' : 'opacity-50',
            )}
            aria-label="Управление тегами и категориями"
          >
            <span aria-hidden="true"><TagIcon className="h-4 w-4 text-white/70" /></span>
            <span aria-hidden="true">⚙️</span>
          </button>
          <button
            type="button"
            ref={groupMenuRefs.setReference}
            onClick={() => setIsGroupMenuOpen((prev) => !prev)}
            disabled={!widgetId}
            className={clsx(
              'inline-flex w-fit items-center gap-2 rounded-full border border-white/20 px-2.5 py-1 text-xs transition',
              widgetId ? 'hover:border-white/40 hover:text-white' : 'opacity-50',
            )}
          >
            Группа микрозадач
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <DndContext sensors={timerSensors} onDragEnd={handleTimerDragEnd}>
            <SortableContext items={extraTimerViews.map(({ settings }) => settings.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {extraTimerViews.map(({ settings, metrics }) => (
                  <SortableTimerPill
                    key={settings.id}
                    settings={settings}
                    metrics={metrics}
                    label={describeTimerTags(settings, tagMap)}
                    onSelect={() => setActiveTimerMenuId(settings.id)}
                    buttonRef={(node) => { timerButtonRefs.current[settings.id] = node; }}
                    isActive={activeTimerMenuId === settings.id}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {canAddTimer && (
            <button type="button" onClick={handleAddTimer} aria-label="Добавить таймер"
              className="flex items-center gap-1 rounded-2xl border border-dashed border-white/30 px-3 py-1.5 text-xs text-muted transition hover:border-white/60 hover:text-white">
              <span aria-hidden="true">⏱</span><span aria-hidden="true">+</span>
            </button>
          )}
          <TimerPill key="primary" elapsed={primaryTimerView.elapsed} percent={primaryTimerView.percent}
            colorClass={primaryTimerView.colorPreset.iconClass} percentClass={primaryTimerView.colorPreset.percentClass}
            isPrimary isActive={activeTimerMenuId === timersState.primary.id}
            label={describeTimerTags(timersState.primary, tagMap)}
            onClick={() => setActiveTimerMenuId(timersState.primary.id)}
            buttonRef={(node) => { timerButtonRefs.current[timersState.primary.id] = node; }}
          />
        </div>
      </header>

      {/* Group Menu Popover */}
      {isGroupMenuOpen && (
        <FloatingPortal>
          <div ref={groupMenuRefs.setFloating} style={{ position: groupMenuStrategy, top: groupMenuY ?? 0, left: groupMenuX ?? 0, zIndex: 1300 }}
            className="w-[22rem] rounded-2xl border border-white/10 bg-background/95 p-4 text-xs text-text shadow-2xl backdrop-blur">
            <div className="flex gap-3">
              <div className="flex-1">
                <input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} placeholder="Поиск групп"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none placeholder:text-white/50" />
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {filteredTemplates.length === 0 && <p className="px-2 py-2 text-xs text-muted">Нет сохранённых групп.</p>}
                  {filteredTemplates.map((template) => (
                    <div key={template.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5">
                      <button type="button" onClick={() => handleCreateGroupFromTemplate(template)} className="flex-1 text-left text-xs text-white/80 hover:text-white">{template.name}</button>
                      <button type="button" onClick={() => { if (window.confirm(`Удалить группу «${template.name}»?`)) deleteGroupTemplate.mutate(template.id); }}
                        className="text-xs text-white/50 hover:text-rose-300" aria-label={`Удалить шаблон ${template.name}`}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button type="button" onClick={handleCreateGroup} className="rounded-xl border border-white/20 px-3 py-2 text-xs text-white/80 transition hover:border-white/40 hover:text-white">+ Новая</button>
              </div>
            </div>
          </div>
        </FloatingPortal>
      )}

      {/* Timer Menu Popover */}
      {activeTimerSettings && (
        <FloatingPortal>
          <div ref={timerMenuRefs.setFloating} style={{ position: timerMenuStrategy, top: timerMenuY ?? 0, left: timerMenuX ?? 0, zIndex: 1200 }}
            className="w-[19rem] rounded-2xl border border-white/10 bg-background/95 p-4 text-xs text-text shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.6rem] uppercase text-muted">Время</p>
                <p className="text-lg font-semibold">{formatDuration(activeTimerMetrics?.elapsed ?? 0)}</p>
              </div>
              <div className="text-right">
                <p className="text-[0.6rem] uppercase text-muted">Доля</p>
                <p className="text-base font-semibold">{activeTimerMetrics?.percent ?? 0}%</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Выбрать цвет таймера"
                  className={clsx('rounded-2xl border border-white/20 px-3 py-1 text-sm transition hover:border-white/40', activeTimerMetrics?.colorPreset.iconClass)}
                  ref={(node) => { timerColorButtonRefs.current[activeTimerSettings.id] = node; }}
                  onClick={() => setTimerColorMenuId((prev) => prev === activeTimerSettings.id ? null : activeTimerSettings.id)}>⏱</button>
                {!activeTimerIsPrimary && (
                  <button type="button" onClick={() => { handleRemoveTimer(activeTimerSettings.id); setActiveTimerMenuId(null); delete timerButtonRefs.current[activeTimerSettings.id]; }}
                    aria-label="Удалить таймер" className="rounded-full border border-white/20 px-2 py-1 text-sm text-muted transition hover:border-rose-400 hover:text-rose-300">−</button>
                )}
              </div>
            </div>
            <div className="mt-3">
              <p className="text-[0.6rem] uppercase text-muted">Теги</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeTimerSettings.tagIds.length === 0 && <p className="text-muted">Все теги</p>}
                {activeTimerSettings.tagIds.map((tagId) => (
                  <span key={tagId} className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[0.7rem]">
                    {tagMap.get(tagId) ?? 'Тег удалён'}
                    <button type="button" aria-label={`Убрать тег ${tagMap.get(tagId) ?? ''}`} className="text-muted transition hover:text-rose-400"
                      onClick={() => handleTimerTagRemove(activeTimerSettings.id, tagId)}>✕</button>
                  </span>
                ))}
              </div>
              <div className="mt-2">
                <TaxonomySelect placeholder="Добавить тег" ariaLabel="Добавить тег в таймер"
                  options={activeTimerAvailableTags.map((tag) => ({ value: tag.id, label: tag.name }))}
                  disabled={activeTimerAvailableTags.length === 0} className="w-full"
                  onSelectOption={(option) => handleTimerTagAdd(activeTimerSettings.id, option.value)} />
              </div>
              <p className="mt-1 text-[0.6rem] text-muted">Без тегов таймер учитывает все задачи.</p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[0.6rem] uppercase text-muted">Режим</span>
              <button type="button" onClick={() => handleTimerModeToggle(activeTimerSettings.id)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-text transition hover:border-white/40">
                {activeTimerSettings.mode === 'only' ? 'Только выбранные' : 'Кроме выбранных'}
              </button>
            </div>
          </div>
        </FloatingPortal>
      )}

      {/* Timer Color Menu */}
      {timerColorMenuTimer && (
        <FloatingPortal>
          <div ref={timerColorMenuRefs.setFloating} style={{ position: timerColorMenuStrategy, top: timerColorMenuX ?? 0, left: timerColorMenuY ?? 0, zIndex: 1300 }}
            className="grid grid-cols-6 gap-2 rounded-2xl border border-white/10 bg-background/95 p-3 shadow-2xl backdrop-blur">
            {CATEGORY_COLOR_PRESETS.map((preset) => (
              <button key={preset.id} type="button"
                className={clsx('flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 transition hover:border-white/30', timerColorMenuTimer.colorId === preset.id && 'ring-2 ring-accent/40')}
                aria-label={`Цвет таймера: ${preset.label}`}
                onClick={() => { handleTimerColorSelect(timerColorMenuTimer.id, preset.id === 'neutral' ? null : preset.id); setTimerColorMenuId(null); }}>
                <TagIcon className={clsx('h-4 w-4', preset.iconClass)} />
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}

      {isLoading && <p className="text-sm text-muted">Загружаем микрозадачи…</p>}
      {isError && <p className="text-sm text-rose-400">Не удалось загрузить задачи: {error?.message ?? 'неизвестная ошибка'}</p>}

      {/* Taxonomy Manager Popover */}
      {isManagerOpen && (
        <FloatingPortal>
          <div ref={managerRefs.setFloating} style={{ position: managerStrategy, top: managerY ?? 0, left: managerX ?? 0, zIndex: 1000 }}
            data-testid="taxonomy-manager" className="w-[360px] rounded-2xl border border-white/10 bg-background/95 p-4 text-xs text-text shadow-2xl backdrop-blur">
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[0.6rem] uppercase tracking-[0.2em] text-muted">Теги</h3>
                <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); handleCreateTag(); }}>
                  <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Новый тег"
                    className="flex-1 rounded-full border border-white/20 bg-transparent px-3 py-1 text-text outline-none placeholder:text-muted" />
                  <button type="submit" className="rounded-full bg-accent/20 px-3 py-1 text-accent transition hover:bg-accent/30">+</button>
                </form>
              </div>
              <div className="flex flex-wrap gap-2">
                {tags.length === 0 && <p className="text-muted">Теги не созданы</p>}
                {tags.filter((t) => !t.archived_at).map((tag) => (
                  <span key={tag.id} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1">
                    <span>{tag.name}</span>
                    <button type="button" onClick={() => archiveTag.mutateAsync(tag.id)} className="text-white/50 transition hover:text-white/80" aria-label={`Архивировать тег ${tag.name}`} title="Архивировать"><ArchiveIcon className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => deleteTag.mutateAsync(tag.id)} className="text-muted transition hover:text-rose-400" aria-label={`Удалить тег ${tag.name}`} title="Удалить совсем">✕</button>
                  </span>
                ))}
              </div>
            </section>

            {/*
              Archived section: collapsible block sandwiched between Tags
              and Categories per UX request. Hidden when nothing is archived
              to keep the main view focused on active items.
            */}
            {(tags.some((t) => t.archived_at) || taskCategories.some((c) => c.archived_at)) && (
              <section className="mt-4 border-t border-white/10 pt-3">
                <details>
                  <summary className="cursor-pointer text-[0.6rem] uppercase tracking-[0.2em] text-muted hover:text-white">
                    Архив
                  </summary>
                  {tags.some((t) => t.archived_at) && (
                    <div className="mt-2">
                      <p className="mb-1 text-[0.6rem] uppercase tracking-[0.2em] text-muted">Архивные теги</p>
                      <div className="flex flex-wrap gap-2">
                        {tags.filter((t) => t.archived_at).map((tag) => (
                          <span key={tag.id} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-muted line-through">
                            <span>{tag.name}</span>
                            <button type="button" onClick={() => unarchiveTag.mutateAsync(tag.id)} className="text-muted no-underline transition hover:text-emerald-300" aria-label={`Восстановить тег ${tag.name}`} title="Восстановить">↩</button>
                            <button type="button" onClick={() => deleteTag.mutateAsync(tag.id)} className="text-muted no-underline transition hover:text-rose-400" aria-label={`Удалить тег ${tag.name}`} title="Удалить совсем">✕</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {taskCategories.some((c) => c.archived_at) && (
                    <div className="mt-3">
                      <p className="mb-1 text-[0.6rem] uppercase tracking-[0.2em] text-muted">Архивные категории</p>
                      <div className="flex flex-col gap-1.5">
                        {taskCategories.filter((c) => c.archived_at).map((category) => (
                          <div key={category.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5">
                            <span className="text-muted line-through">
                              {category.name}
                              {category.is_auto && <span className="ml-2 text-[0.65rem] uppercase">auto</span>}
                            </span>
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => unarchiveCategory.mutateAsync(category.id)} className="rounded-full p-1 text-muted transition hover:text-emerald-300" aria-label="Восстановить категорию" title="Восстановить">↩</button>
                              <button type="button" onClick={() => deleteCategory.mutateAsync(category.id)} className="rounded-full p-1 text-muted transition hover:text-rose-400" aria-label="Удалить категорию" title="Удалить совсем">✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </details>
              </section>
            )}

            <section className="mt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[0.6rem] uppercase tracking-[0.2em] text-muted">Категории</h3>
                <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); handleCreateCategory(); }}>
                  <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Новая категория"
                    className="flex-1 rounded-full border border-white/20 bg-transparent px-3 py-1 text-text outline-none placeholder:text-muted" />
                  <button type="submit" className="rounded-full bg-accent/20 px-3 py-1 text-accent transition hover:bg-accent/30">+</button>
                </form>
              </div>
              <div className="max-h-[40rem] space-y-3 overflow-y-auto pr-1">
                {taskCategories.length === 0 && <p className="text-muted">Категории не созданы</p>}
                {taskCategories.filter((c) => !c.archived_at).map((category) => {
                  const availableTags = tags.filter(
                    (tag) => !tag.archived_at && !category.tags?.some((existing) => existing.id === tag.id),
                  );
                  const colorPreset = getCategoryColorPreset(category.color);
                  return (
                    <div key={category.id} data-testid={`category-card-${category.id}`} className="relative overflow-visible rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        {renamingCategoryId === category.id ? (
                          <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} onBlur={handleCommitRenameCategory}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCommitRenameCategory(); } else if (e.key === 'Escape') { setRenamingCategoryId(null); setRenameDraft(''); } }}
                            className="flex-1 rounded-full border border-white/20 bg-white/80 px-3 py-1 text-sm text-black outline-none" autoFocus />
                        ) : (
                          <div className="flex-1 text-sm font-semibold text-white">
                            {category.name}
                            {category.is_auto && <span className="ml-2 text-[0.65rem] uppercase text-muted">auto</span>}
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          {!category.is_auto && (
                            <button type="button" onClick={() => handleStartRenameCategory(category)} className="rounded-full p-1 text-muted transition hover:text-white" aria-label="Переименовать">✎</button>
                          )}
                          <button type="button" onClick={() => archiveCategory.mutateAsync(category.id)} className="rounded-full p-1 text-white/50 transition hover:text-white/80" aria-label="Архивировать категорию" title="Архивировать"><ArchiveIcon className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => deleteCategory.mutateAsync(category.id)} className="rounded-full p-1 text-muted transition hover:text-rose-400" aria-label="Удалить категорию" title="Удалить совсем">✕</button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {category.tags?.length ? category.tags.map((tag) => (
                          <span key={tag.id} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs">
                            {tag.name}
                            <button type="button" onClick={() => detachTagFromCategory.mutateAsync({ categoryId: category.id, tagId: tag.id })}
                              className="text-muted transition hover:text-rose-400" aria-label={`Удалить связанный тег ${tag.name}`}>✕</button>
                          </span>
                        )) : <p className="text-muted">Нет тегов</p>}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1">
                          <TaxonomySelect placeholder="Добавить тег" ariaLabel={`Добавить тег в категорию ${category.name}`}
                            options={availableTags.map((tag) => ({ value: tag.id, label: tag.name }))} disabled={availableTags.length === 0}
                            className="w-full" enableSearch onSelectOption={(option) => attachTagToCategory.mutateAsync({ categoryId: category.id, tagId: option.value })} />
                        </div>
                        <div className="relative" data-taxonomy-dropdown="true">
                          <button type="button" onClick={() => handleToggleColorMenu(category.id)}
                            className={clsx('flex h-8 w-8 items-center justify-center rounded-xl border text-sm transition', 'border-white/15 bg-white/5 hover:border-white/40')}
                            aria-label="Выбрать цвет категории" ref={(el) => { colorButtonRefs.current[category.id] = el; }}>
                            <TagIcon className={clsx('h-3.5 w-3.5', colorPreset.iconClass)} />
                          </button>
                        </div>
                      </div>
                      {/*
                        Description editor: collapsed = single line with truncation,
                        on focus expands to up to 4 rows, saves on blur. Lives here
                        (inside the category card) per UX preference, not in the
                        color popover.
                      */}
                      <div className="mt-2">
                        <CategoryDescriptionEditor
                          key={`${category.id}-${category.description ?? ''}`}
                          initial={category.description ?? ''}
                          onSave={(value) => {
                            const trimmed = value.trim();
                            const next = trimmed.length > 0 ? trimmed : null;
                            if (next === (category.description ?? null)) return;
                            updateCategoryDescription.mutate({ id: category.id, description: next });
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

          </div>
        </FloatingPortal>
      )}

      {/* Category Color Menu (description editor moved into the category card itself, see below) */}
      {colorMenuCategory && colorMenuPosition && (
        <FloatingPortal>
          <div ref={colorMenuRef} className="fixed z-[2000] w-40 rounded-2xl border border-white/10 bg-background/95 p-3 text-[0.65rem] text-text shadow-2xl backdrop-blur"
            style={{ top: colorMenuPosition.y, left: colorMenuPosition.x }}>
            <p className="px-1 text-[0.55rem] uppercase tracking-[0.2em] text-muted">Цвет</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {CATEGORY_COLOR_PRESETS.map((preset) => (
                <button key={preset.id} type="button" onClick={() => handleSelectCategoryColor(colorMenuCategory.id, preset.id === 'neutral' ? null : preset.id)}
                  className={clsx('flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 transition hover:border-white/30', colorMenuCategory.color === preset.id && 'ring-2 ring-accent/40')}
                  aria-label={`Цвет: ${preset.label}`}>
                  <TagIcon className={clsx('h-4 w-4', preset.iconClass)} />
                </button>
              ))}
            </div>
          </div>
        </FloatingPortal>
      )}

      {/* Main Task List */}
      {ready && (
        <div className="flex flex-col gap-3" data-task-list>
          {flatList.length === 0 && (
            <p className="rounded-2xl border border-dashed border-white/20 px-4 py-6 text-center text-xs text-muted">
              Добавьте первую микрозадачу
            </p>
          )}
          {(() => {
            const elements: React.ReactNode[] = [];
            let inGroup: string | null = null;
            let groupTaskIndex = 0;
            const draggingGroupId = dragState && isGroupId(dragState.draggedId) ? extractId(dragState.draggedId) : null;
            const isDraggingGroup = !!draggingGroupId;
            const draggedTask = dragState && isTaskId(dragState.draggedId)
              ? taskById.get(extractId(dragState.draggedId))
              : null;

            const renderDropPreview = () => {
              if (draggedTask) {
                return (
                  <div key="drop-preview" className="opacity-50 pointer-events-none">
                    {renderTaskCard(draggedTask, dragState!.draggedId)}
                  </div>
                );
              }
              if (isDraggingGroup) {
                const group = groupById.get(draggingGroupId!);
                if (!group) return null;
                const groupTasks = tasks.filter((t) => t.group_id === draggingGroupId)
                  .sort((a, b) => (a.group_order ?? a.order) - (b.group_order ?? b.order));
                return (
                  <div key="drop-preview" className="opacity-50 pointer-events-none flex flex-col gap-3">
                    <GroupHeader
                      group={group}
                      isEditing={false}
                      editValue=""
                      onEditStart={() => {}}
                      onEditChange={() => {}}
                      onEditCommit={() => {}}
                      onEditCancel={() => {}}
                      onSaveTemplate={() => {}}
                      onDeleteGroup={() => {}}
                    />
                    {groupTasks.map((task, idx) => (
                      <div key={task.id} className="pl-5 relative">
                        <span
                          className="pointer-events-none absolute left-2 w-px bg-white/15"
                          style={{
                            top: idx === 0 ? 0 : '-0.375rem',
                            bottom: idx === groupTasks.length - 1 ? 0 : '-0.375rem',
                          }}
                        />
                        {idx === 0 && (
                          <span className="pointer-events-none absolute left-2 top-0 h-px w-3 bg-white/15" />
                        )}
                        {idx === groupTasks.length - 1 && (
                          <span className="pointer-events-none absolute left-2 bottom-0 h-px w-3 bg-white/15" />
                        )}
                        {renderTaskCard(task, `preview-${task.id}`)}
                      </div>
                    ))}
                  </div>
                );
              }
              return null;
            };

            for (let fi = 0; fi < flatList.length; fi++) {
              const itemId = flatList[fi];

              if (isGendId(itemId)) {
                const gendGroupId = extractId(itemId);
                const isGendOfDraggedGroup = draggingGroupId === gendGroupId;
                const isDropHere = dragState?.dropTarget?.id === itemId && dragState?.dropTarget?.position === 'before';
                if (isDropHere) {
                  elements.push(
                    <div key={`${itemId}-preview`} className="pl-5 relative">
                      <span className="pointer-events-none absolute left-2 w-px bg-white/15" style={{ top: '-0.375rem', bottom: 0 }} />
                      <span className="pointer-events-none absolute left-2 bottom-0 h-px w-3 bg-white/15" />
                      {renderDropPreview()}
                    </div>,
                  );
                }
                elements.push(
                  <div
                    key={itemId}
                    ref={(el) => registerRef(itemId, el)}
                    className={clsx('h-1', isGendOfDraggedGroup && 'hidden')}
                  />,
                );
                inGroup = null;
                groupTaskIndex = 0;
                continue;
              }

              if (isGroupId(itemId)) {
                const groupId = extractId(itemId);
                const group = groupById.get(groupId);
                if (!group) continue;
                inGroup = groupId;
                groupTaskIndex = 0;
                const isDropHere = dragState?.dropTarget?.id === itemId && dragState?.dropTarget?.position === 'before';
                const isBeingDragged = draggingGroupId === groupId;

                elements.push(
                  <div key={itemId} className={clsx(isBeingDragged && 'hidden')}>
                    {isDropHere && renderDropPreview()}
                    <GroupHeader
                      group={group}
                      headerRef={(el) => registerRef(itemId, el)}
                      onPointerDown={(e) => handlePointerDown(itemId, e)}
                      isEditing={editingGroupId === group.id}
                      editValue={editingGroupId === group.id ? editingGroupName : group.name}
                      onEditStart={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }}
                      onEditChange={(value) => setEditingGroupName(value)}
                      onEditCommit={() => handleCommitGroupName(group)}
                      onEditCancel={() => { setEditingGroupId(null); setEditingGroupName(''); }}
                      onSaveTemplate={() => handleSaveGroupTemplate(group)}
                      onDeleteGroup={() => handleDeleteGroup(group)}
                    />
                  </div>,
                );
              } else if (isTaskId(itemId)) {
                const taskId = extractId(itemId);
                const task = taskById.get(taskId);
                if (!task) continue;
                const isDraggedItem = dragState?.draggedId === itemId;
                const isInDraggedGroup = draggingGroupId && task.group_id === draggingGroupId;
                const isDropHere = dragState?.dropTarget?.id === itemId && dragState?.dropTarget?.position === 'before';

                const isFirst = inGroup !== null && groupTaskIndex === 0;
                const nextItem = flatList[fi + 1];
                const isNaturallyLast = inGroup !== null && (!nextItem || !isTaskId(nextItem));
                const gendHasPreview = isNaturallyLast && nextItem && isGendId(nextItem)
                  && dragState?.dropTarget?.id === nextItem && dragState?.dropTarget?.position === 'before';
                const isLast = isNaturallyLast && !gendHasPreview;

                elements.push(
                  <div
                    key={itemId}
                    className={clsx(
                      (isDraggedItem || isInDraggedGroup) && 'hidden',
                      inGroup && 'pl-5 relative',
                    )}
                  >
                    {isDropHere && renderDropPreview()}
                    {inGroup && (
                      <>
                        <span
                          className="pointer-events-none absolute left-2 w-px bg-white/15"
                          style={{
                            top: isFirst ? 0 : '-0.375rem',
                            bottom: isLast ? 0 : '-0.375rem',
                          }}
                        />
                        {isFirst && (
                          <span className="pointer-events-none absolute left-2 top-0 h-px w-3 bg-white/15" />
                        )}
                        {isLast && (
                          <span className="pointer-events-none absolute left-2 bottom-0 h-px w-3 bg-white/15" />
                        )}
                      </>
                    )}
                    {renderTaskCard(task, itemId)}
                  </div>,
                );

                if (inGroup) groupTaskIndex++;
              }
            }
            if (dragState?.dropTarget?.position === 'after') {
              elements.push(renderDropPreview());
            }
            return elements;
          })()}
        </div>
      )}


      {/* Cross-widget drop preview: ghost micro task at the bottom while a goal is dragged over */}
      {crossDragCtx?.dragGoal && crossDragCtx.hoveredZoneId === widgetId && (
        <div
          aria-hidden
          className="pointer-events-none flex items-center gap-3 rounded-3xl border border-dashed border-accent/60 bg-accent/5 px-4 py-3 text-sm text-text opacity-60"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/30 text-[0.65rem]" />
          <span className="flex-1 truncate">{crossDragCtx.dragGoal.title}</span>
          <span className="w-20 text-center font-mono text-sm text-muted tabular-nums">00:00:00</span>
        </div>
      )}

      {/* Add task input */}
      <div className="flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-accent/50 bg-accent/10 px-4 py-1">
          <input value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddTask(); }}
            placeholder="Новая микрозадача" className="w-36 bg-transparent text-sm text-text outline-none placeholder:text-muted" />
          <button type="button" onClick={handleAddTask} className="text-xl text-accent transition hover:text-accent/80" aria-label="Добавить задачу">+</button>
        </div>
      </div>
      {transferState && (
        <TimeTransferOverlay
          pointerX={transferState.pointerX}
          pointerY={transferState.pointerY}
          requestedMinutes={transferRequestedMinutes}
          validity={transferValidity}
        />
      )}
    </section>
  );
}

/**
 * Description textarea with focus-based expand/collapse.
 *
 *  - Collapsed (not focused): single visible row, content truncated with overflow:hidden.
 *  - Focused: auto-resizes between 1 and 4 rows based on content length.
 *  - Saves on blur (only if value changed) — debounced via parent's `onSave`.
 *
 * Why a local component (not a shared one): used in exactly one place
 * (the category color popover), and the auto-resize behaviour is tightly
 * coupled to the popover's width. Lifting it would just add export ceremony.
 */
function CategoryDescriptionEditor({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Sync external initial → local draft when the popover switches to a
  // different category (parent re-mounts via key={category.id}, so this
  // effect just covers the rare same-category external update case).
  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  // Auto-resize: when focused or content changes, snap height to scrollHeight
  // capped at 4 lines. When unfocused, force back to single-row height so the
  // popover stays compact.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const computedStyle = window.getComputedStyle(el);
    const lineHeight = parseFloat(computedStyle.lineHeight) || 16;
    const verticalPad =
      parseFloat(computedStyle.paddingTop) + parseFloat(computedStyle.paddingBottom);
    if (focused) {
      // Reset to auto first to get an accurate scrollHeight measurement.
      el.style.height = 'auto';
      const max = lineHeight * 4 + verticalPad;
      el.style.height = `${Math.min(max, el.scrollHeight)}px`;
    } else {
      el.style.height = `${lineHeight + verticalPad}px`;
    }
  }, [focused, draft]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      placeholder="Опиши, что попадает в эту категорию (помогает голосовой команде)"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (draft !== initial) onSave(draft);
      }}
      className="mt-1 w-full resize-none overflow-hidden rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[0.7rem] leading-tight text-text outline-none transition focus:border-white/30"
    />
  );
}
