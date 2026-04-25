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
import { TagIcon } from './components/Icons';
import { usePointerDnd } from './hooks/usePointerDnd';
import { useTimeTransferDrag } from './hooks/useTimeTransferDrag';
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

export function MicroTasksWidget({
  widgetId,
  config,
  onUpdateConfig,
}: MicroTasksWidgetProps) {
  const e2eMode = typeof window !== 'undefined' && window.location.hash.includes('e2e');
  const [e2eTasks, setE2eTasks] = useState<MicroTaskRecord[]>(() => e2eMode ? buildE2eSeed().tasks : []);
  const [e2eGroups, setE2eGroups] = useState<MicroTaskGroup[]>(() => e2eMode ? buildE2eSeed().groups : []);

  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  const crossDragCtx = (() => { try { return useCrossWidgetDrag(); } catch { return null; } })();
  const dropZoneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!crossDragCtx || !widgetId) return;
    crossDragCtx.registerDropZone(widgetId, dropZoneRef.current);
    return () => crossDragCtx.registerDropZone(widgetId, null);
  }, [crossDragCtx, widgetId]);

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
  const attachCategoryToTask = useAttachCategoryToTask();
  const detachCategoryFromTask = useDetachCategoryFromTask();
  const setCategoryBuffer = useSetTaskCategoryBuffer();
  const createTag = useCreateTaskTag();
  const deleteTag = useDeleteTaskTag();
  const createCategory = useCreateTaskCategory();
  const renameCategory = useRenameTaskCategory();
  const deleteCategory = useDeleteTaskCategory();
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
    await createTask.mutateAsync({ title });
    setNewTaskTitle('');
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
    if (task.timer_state === 'running' && willBeDone) {
      await toggleTimer.mutateAsync({ id: task.id, isRunning: true });
    }
    await updateTask.mutateAsync({ id: task.id, is_done: willBeDone });
    if (!willBeDone) return;
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
          isEditingTime={editingTimeTaskId === task.id}
          timeDraft={editingTimeTaskId === task.id ? timeDraft : ''}
          isTimeInvalid={isTimeInvalid}
          isTimeSaving={isTimeSaving}
        />
      );
    },
    [effectiveRunningId, taskSecondsMap, computeTaskSeconds, editingTask, editingTimeTaskId, timeDraft, isTimeInvalid, isTimeSaving, taskCategories, archiveTask.isPending, archiveTask.variables, dragState, registerRef, handlePointerDown, transferDrag, transferState, transferEffectiveMinutes, transferRequestedMinutes],
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
                {tags.map((tag) => (
                  <span key={tag.id} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1">
                    <span>{tag.name}</span>
                    <button type="button" onClick={() => deleteTag.mutateAsync(tag.id)} className="text-muted transition hover:text-rose-400" aria-label={`Удалить тег ${tag.name}`}>✕</button>
                  </span>
                ))}
              </div>
            </section>
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
                {taskCategories.map((category) => {
                  const availableTags = tags.filter((tag) => !category.tags?.some((existing) => existing.id === tag.id));
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
                          <button type="button" onClick={() => deleteCategory.mutateAsync(category.id)} className="rounded-full p-1 text-muted transition hover:text-rose-400" aria-label="Удалить категорию">✕</button>
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
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </FloatingPortal>
      )}

      {/* Category Color Menu */}
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
