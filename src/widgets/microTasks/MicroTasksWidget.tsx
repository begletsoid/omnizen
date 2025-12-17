type SortableTimerPillProps = {
  settings: TimerSettings;
  metrics: { elapsed: number; percent: number; colorPreset: CategoryColorPreset };
  label: string;
  onSelect: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
  isActive: boolean;
};

function SortableTimerPill({
  settings,
  metrics,
  label,
  onSelect,
  buttonRef,
  isActive,
}: SortableTimerPillProps) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: settings.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'transform 120ms ease-out' : transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2" {...attributes} {...listeners}>
      <TimerPill
        elapsed={metrics.elapsed}
        percent={metrics.percent}
        colorClass={metrics.colorPreset.iconClass}
        onClick={onSelect}
        buttonRef={buttonRef}
        label={label}
        isPrimary={false}
        isActive={isActive}
      />
    </div>
  );
}
type CategoryColorPreset = {
  id: string;
  label: string;
  iconClass: string;
  chipClass: string;
  cardClass: string;
};

const describeTimerTags = (timer: TimerSettings, tagMap: Map<string, string>) => {
  if (!timer.tagIds.length) return 'Все теги';
  const names = timer.tagIds.map((tagId) => tagMap.get(tagId)).filter((name): name is string => Boolean(name));
  if (!names.length) return 'Все теги';
  return timer.mode === 'only' ? `Только: ${names.join(', ')}` : `Кроме: ${names.join(', ')}`;
};

const CATEGORY_COLOR_PRESETS: CategoryColorPreset[] = [
  {
    id: 'neutral',
    label: 'Нейтральный',
    iconClass: 'text-white/60',
    chipClass: 'bg-white/10 border-white/20 text-white',
    cardClass: 'border border-white/10 bg-white/5',
  },
  {
    id: 'rose',
    label: 'Розовый',
    iconClass: 'text-rose-300',
    chipClass: 'bg-rose-500/15 border-rose-400/40 text-rose-100',
    cardClass: 'border border-rose-400/30 bg-rose-500/5',
  },
  {
    id: 'amber',
    label: 'Жёлтый',
    iconClass: 'text-amber-300',
    chipClass: 'bg-amber-500/15 border-amber-400/40 text-amber-100',
    cardClass: 'border border-amber-400/30 bg-amber-500/5',
  },
  {
    id: 'emerald',
    label: 'Зелёный',
    iconClass: 'text-emerald-300',
    chipClass: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100',
    cardClass: 'border border-emerald-400/30 bg-emerald-500/5',
  },
  {
    id: 'sky',
    label: 'Синий',
    iconClass: 'text-sky-300',
    chipClass: 'bg-sky-500/15 border-sky-400/40 text-sky-100',
    cardClass: 'border border-sky-400/30 bg-sky-500/5',
  },
  {
    id: 'violet',
    label: 'Сиреневый',
    iconClass: 'text-violet-300',
    chipClass: 'bg-violet-500/15 border-violet-400/40 text-violet-100',
    cardClass: 'border border-violet-400/30 bg-violet-500/5',
  },
  {
    id: 'pink',
    label: 'Розово-фиолетовый',
    iconClass: 'text-pink-300',
    chipClass: 'bg-pink-500/15 border-pink-400/40 text-pink-100',
    cardClass: 'border border-pink-400/30 bg-pink-500/5',
  },
];

const CATEGORY_COLOR_MAP = CATEGORY_COLOR_PRESETS.reduce<Record<string, CategoryColorPreset>>(
  (acc, preset) => {
    acc[preset.id] = preset;
    return acc;
  },
  {},
);

function getCategoryColorPreset(colorId?: string | null) {
  if (!colorId) return CATEGORY_COLOR_PRESETS[0];
  return CATEGORY_COLOR_MAP[colorId] ?? CATEGORY_COLOR_PRESETS[0];
}

const getReferenceElement = (reference: ReferenceType | null): Element | null => {
  if (!reference) return null;
  if (reference instanceof Element) {
    return reference;
  }
  return reference.contextElement ?? null;
};

const referenceContainsNode = (reference: ReferenceType | null, target: Node): boolean => {
  const element = getReferenceElement(reference);
  return element ? element.contains(target) : false;
};

type TimerMode = 'only' | 'exclude';

type TimerSettings = {
  id: string;
  tagIds: string[];
  mode: TimerMode;
  colorId?: string | null;
};

type TimersState = {
  primary: TimerSettings;
  extras: TimerSettings[];
};

type TimersConfigPayload = {
  version: number;
  primary: TimerSettings;
  extras: TimerSettings[];
};

const MAX_EXTRA_TIMERS = 4;
const TIMERS_CONFIG_KEY = 'microTaskTimers';
const TIMERS_CONFIG_VERSION = 2;
const DEFAULT_PRIMARY_TIMER: TimerSettings = {
  id: 'primary',
  tagIds: [],
  mode: 'only',
  colorId: null,
};

const createDefaultTimersState = (): TimersState => ({
  primary: { ...DEFAULT_PRIMARY_TIMER },
  extras: [],
});

const sanitizeTagIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      )
    : [];

const migrateLegacyTimerSettings = (raw: Record<string, unknown>) => {
  if ('tagIds' in raw) return raw;
  if ('categoryIds' in raw) {
    return { ...raw, tagIds: sanitizeTagIds(raw.categoryIds) };
  }
  return { ...raw, tagIds: [] };
};

const normalizeTimerSettings = (raw: unknown, fallbackId: string): TimerSettings => {
  if (!raw || typeof raw !== 'object') {
    return { id: fallbackId, tagIds: [], mode: 'only', colorId: null };
  }
  const migrated = migrateLegacyTimerSettings(raw as Record<string, unknown>) as Partial<
    TimerSettings
  >;
  const tagIds = sanitizeTagIds(migrated.tagIds);
  const mode: TimerMode = migrated.mode === 'exclude' ? 'exclude' : 'only';
  const id = typeof migrated.id === 'string' ? migrated.id : fallbackId;
  const colorId =
    typeof migrated.colorId === 'string' || migrated.colorId === null ? migrated.colorId : null;
  return { id, tagIds, mode, colorId };
};

const normalizeTimersState = (config: unknown): TimersState => {
  if (!config || typeof config !== 'object') {
    return createDefaultTimersState();
  }
  const payload = config as Partial<TimersConfigPayload>;
  const primary = normalizeTimerSettings(
    payload.primary ? migrateLegacyTimerSettings(payload.primary as any) : null,
    'primary',
  );
  const extrasSource = Array.isArray(payload.extras) ? payload.extras : [];
  const extras: TimerSettings[] = extrasSource.slice(0, MAX_EXTRA_TIMERS).map((entry) => {
    const fallbackId =
      typeof (entry as TimerSettings)?.id === 'string' ? (entry as TimerSettings).id : nanoid();
    return normalizeTimerSettings(migrateLegacyTimerSettings(entry as any), fallbackId);
  });
  return {
    primary: { ...primary, id: 'primary' },
    extras,
  };
};

const serializeTimersState = (state: TimersState): TimersConfigPayload => ({
  version: TIMERS_CONFIG_VERSION,
  primary: state.primary,
  extras: state.extras,
});

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
import { nanoid } from 'nanoid';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  type ReferenceType,
} from '@floating-ui/react';
import clsx from 'clsx';

import {
  useAttachCategoryToTask,
  useAttachTagToCategory,
  useCreateMicroTask,
  useCreateTaskCategory,
  useCreateTaskTag,
  useArchiveMicroTask,
  useDeleteMicroTask,
  useDeleteTaskCategory,
  useDeleteTaskTag,
  useDetachCategoryFromTask,
  useDetachTagFromCategory,
  useMicroTasks,
  useRenameTaskCategory,
  useReorderMicroTasks,
  useSetTaskCategoryBuffer,
  useTaskCategories,
  useTaskTags,
  useToggleMicroTaskTimer,
  useUpdateMicroTask,
  useUpdateTaskCategoryColor,
} from '../../features/microTasks/hooks';
import type { MicroTaskRecord, TaskCategory } from '../../features/microTasks/types';
import {
  buildMicroTaskOrderUpdates,
  formatDuration,
  normalizeTimerState,
  parseDurationInput,
} from '../../features/microTasks/utils';

const TAXONOMY_DROPDOWN_SELECTOR = '[data-taxonomy-dropdown="true"]';

type MicroTasksWidgetProps = {
  widgetId: string | null;
  config?: Record<string, unknown> | null;
  onUpdateConfig?: (patch: Record<string, unknown>) => void;
};

export function MicroTasksWidget({ widgetId, config, onUpdateConfig }: MicroTasksWidgetProps) {
  const { data: rawTasks = [], isLoading, isError, error } = useMicroTasks(widgetId);
  const { data: tags = [] } = useTaskTags();
  const { data: taskCategories = [] } = useTaskCategories();
  const createTask = useCreateMicroTask(widgetId);
  const updateTask = useUpdateMicroTask(widgetId);
  const deleteTask = useDeleteMicroTask(widgetId);
  const reorderTasks = useReorderMicroTasks(widgetId);
  const toggleTimer = useToggleMicroTaskTimer(widgetId);
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
  const updateCategoryColor = useUpdateTaskCategoryColor();

  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

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
    if (!nextName) {
      setRenamingCategoryId(null);
      return;
    }
    await renameCategory.mutateAsync({ id: renamingCategoryId, name: nextName });
    setRenamingCategoryId(null);
    setRenameDraft('');
  };

  const handleAttachTagToCategory = async (categoryId: string, tagId: string) => {
    if (!tagId) return;
    await attachTagToCategory.mutateAsync({ categoryId, tagId });
  };

  const handleDetachTagFromCategory = async (categoryId: string, tagId: string) => {
    await detachTagFromCategory.mutateAsync({ categoryId, tagId });
  };

  const handleDeleteCategory = async (categoryId: string) => {
    await deleteCategory.mutateAsync(categoryId);
  };

  const handleDeleteTag = async (tagId: string) => {
    await deleteTag.mutateAsync(tagId);
  };

  const handleToggleColorMenu = (categoryId: string) => {
    setColorMenuCategoryId((prev) => {
      if (prev === categoryId) {
        setColorMenuPosition(null);
        return null;
      }
      const button = colorButtonRefs.current[categoryId] ?? null;
      if (button) {
        const rect = button.getBoundingClientRect();
        const offset = 12;
        const posX = Math.min(window.innerWidth - 180, rect.right + offset);
        const posY = Math.max(offset, rect.top - offset);
        setColorMenuPosition({ x: posX, y: posY });
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const timerSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const [reorderedTasks, setReorderedTasks] = useState<MicroTaskRecord[] | null>(null);
  const [optimisticRunningId, setOptimisticRunningId] = useState<string | null>(null);
  const visibleCategories = taskCategories;
  const canManageTaxonomy = Boolean(widgetId);
  const [now, setNow] = useState(Date.now());
  const [editingTask, setEditingTask] = useState<{ id: string; value: string } | null>(null);
  const [editingTimeTaskId, setEditingTimeTaskId] = useState<string | null>(null);
  const [timeDraft, setTimeDraft] = useState<string>('');
  const [isTimeInvalid, setIsTimeInvalid] = useState(false);
  const [isTimeSaving, setIsTimeSaving] = useState(false);
  const [colorMenuCategoryId, setColorMenuCategoryId] = useState<string | null>(null);
  const [colorMenuPosition, setColorMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const colorButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const colorMenuRef = useRef<HTMLDivElement | null>(null);
  const timersFromConfig = useMemo(() => {
    const raw =
      config && typeof config === 'object' && TIMERS_CONFIG_KEY in config
        ? (config as Record<string, unknown>)[TIMERS_CONFIG_KEY]
        : null;
    return normalizeTimersState(raw);
  }, [config]);
  const [timersState, setTimersState] = useState<TimersState>(timersFromConfig);
  useEffect(() => {
    setTimersState(timersFromConfig);
  }, [timersFromConfig]);
  const applyTimersUpdate = useCallback(
    (updater: (current: TimersState) => TimersState) => {
      setTimersState((current) => {
        const next = updater(current);
        if (onUpdateConfig) {
          onUpdateConfig({ [TIMERS_CONFIG_KEY]: serializeTimersState(next) });
        }
        return next;
      });
    },
    [onUpdateConfig],
  );
  const [activeTimerMenuId, setActiveTimerMenuId] = useState<string | null>(null);
  const timerButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const timerColorButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [timerColorMenuId, setTimerColorMenuId] = useState<string | null>(null);
  const timerMenuFloating = useFloating({
    open: Boolean(activeTimerMenuId),
    onOpenChange: (open) => {
      if (!open) setActiveTimerMenuId(null);
    },
    placement: 'bottom-end',
    middleware: [offset(8), flip(), shift()],
  });
  const {
    refs: timerMenuRefs,
    strategy: timerMenuStrategy,
    x: timerMenuX,
    y: timerMenuY,
  } = timerMenuFloating;
  const activeTimerSettings =
    activeTimerMenuId === timersState.primary.id
      ? timersState.primary
      : timersState.extras.find((timer) => timer.id === activeTimerMenuId) ?? null;
  const activeTimerIsPrimary = activeTimerSettings?.id === timersState.primary.id;
  const activeTimerAvailableTags = activeTimerSettings
    ? tags.filter((tag) => !activeTimerSettings.tagIds.includes(tag.id))
    : [];
  const scrollRestoreRef = useRef<number | null>(null);
  const handleTimerDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!active?.id || !over?.id || active.id === over.id) return;
      applyTimersUpdate((prev) => {
        const currentIndex = prev.extras.findIndex((timer) => timer.id === active.id);
        const overIndex = prev.extras.findIndex((timer) => timer.id === over.id);
        if (currentIndex === -1 || overIndex === -1) {
          return prev;
        }
        const nextExtras = arrayMove(prev.extras, currentIndex, overIndex);
        return { ...prev, extras: nextExtras };
      });
    },
    [applyTimersUpdate],
  );

  useEffect(() => {
    if (!activeTimerMenuId) return;
    const reference = timerButtonRefs.current[activeTimerMenuId];
    if (reference) {
      timerMenuRefs.setReference(reference);
    }
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

  const timerColorMenuFloating = useFloating({
    open: Boolean(timerColorMenuId),
    onOpenChange: (open) => {
      if (!open) setTimerColorMenuId(null);
    },
    placement: 'top-end',
    middleware: [offset(8), flip(), shift()],
  });
  const {
    refs: timerColorMenuRefs,
    strategy: timerColorMenuStrategy,
    x: timerColorMenuX,
    y: timerColorMenuY,
  } = timerColorMenuFloating;

  const timerColorMenuTimer =
    timerColorMenuId === timersState.primary.id
      ? timersState.primary
      : timersState.extras.find((timer) => timer.id === timerColorMenuId) ?? null;

  useEffect(() => {
    if (!timerColorMenuId) return;
    const reference = timerColorButtonRefs.current[timerColorMenuId];
    if (reference) {
      timerColorMenuRefs.setReference(reference);
    }
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
        (activeButton && activeButton.contains(target as Node))
      ) {
        return;
      }
      setColorMenuCategoryId(null);
      setColorMenuPosition(null);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [colorMenuCategoryId]);

  useEffect(() => {
    if (!reorderedTasks || !rawTasks.length) return;
    if (reorderedTasks.length !== rawTasks.length) return;
    const isSynced = reorderedTasks.every(
      (task, index) =>
        task.id === rawTasks[index]?.id && task.is_done === rawTasks[index]?.is_done,
    );
    if (isSynced) {
      setReorderedTasks(null);
    }
  }, [rawTasks, reorderedTasks]);

  useEffect(() => {
    if (scrollRestoreRef.current == null) return;
    const target = scrollRestoreRef.current;
    scrollRestoreRef.current = null;
    if (typeof document !== 'undefined') {
      document.documentElement.scrollTop = target;
      document.body.scrollTop = target;
    }
  }, [reorderedTasks]);

  const tasks = useMemo<MicroTaskRecord[]>(
    () =>
      (reorderedTasks ?? rawTasks)
        .map((task) => ({
          ...task,
          elapsed_seconds:
            typeof task.elapsed_seconds === 'number' && Number.isFinite(task.elapsed_seconds)
              ? task.elapsed_seconds
              : 0,
          timer_state: normalizeTimerState(task.timer_state),
          last_started_at: task.last_started_at ?? null,
          archived_at: task.archived_at ?? null,
        }))
        .filter((task) => !task.archived_at),
    [rawTasks, reorderedTasks],
  );
  const runningTask = tasks.find((task) => task.timer_state === 'running');
  const effectiveRunningId = optimisticRunningId ?? runningTask?.id ?? null;

  useEffect(() => {
    if (!optimisticRunningId) return;
    if (runningTask?.id === optimisticRunningId) {
      setOptimisticRunningId(null);
    }
  }, [optimisticRunningId, runningTask?.id]);

  useEffect(() => {
    if (!effectiveRunningId) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [effectiveRunningId]);

  const computeTaskSeconds = useCallback(
    (task: MicroTaskRecord, isRunningOverride?: boolean) => {
      let seconds =
        typeof task.elapsed_seconds === 'number' && Number.isFinite(task.elapsed_seconds)
          ? task.elapsed_seconds
          : 0;
      const isRunning = isRunningOverride ?? (task.timer_state === 'running');
      if (isRunning && task.last_started_at) {
        seconds += Math.max(
          0,
          Math.floor((now - new Date(task.last_started_at).getTime()) / 1000),
        );
      }
      return seconds;
    },
    [now],
  );

  const timedTasks = useMemo(
    () =>
      tasks.map((task) => ({
        task,
        seconds: computeTaskSeconds(task, effectiveRunningId === task.id),
      })),
    [tasks, computeTaskSeconds, effectiveRunningId],
  );

  const taskTagIdsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    tasks.forEach((task) => {
      const ids = new Set<string>();
      task.categories?.forEach((category) => {
        category.tags?.forEach((tag) => ids.add(tag.id));
        if (category.source_tag_id) {
          ids.add(category.source_tag_id);
        }
      });
      map.set(task.id, Array.from(ids));
    });
    return map;
  }, [tasks]);

  const taskSecondsMap = useMemo(() => {
    const map = new Map<string, number>();
    timedTasks.forEach(({ task, seconds }) => {
      map.set(task.id, seconds);
    });
    return map;
  }, [timedTasks]);

  const totalElapsed = useMemo(
    () => timedTasks.reduce((acc, entry) => acc + entry.seconds, 0),
    [timedTasks],
  );

  const computeTimerElapsedValue = useCallback(
    (timer: TimerSettings) => {
      if (!timer.tagIds.length) return totalElapsed;
      const tagSet = new Set(timer.tagIds);
      return timedTasks.reduce((sum, entry) => {
        const tagIds = taskTagIdsMap.get(entry.task.id) ?? [];
        const hasMatch = tagIds.some((tagId) => tagSet.has(tagId));
        const include = timer.mode === 'only' ? hasMatch : !hasMatch;
        return include ? sum + entry.seconds : sum;
      }, 0);
    },
    [timedTasks, totalElapsed, taskTagIdsMap],
  );

  const resolveTimerColorPreset = useCallback(
    (timer: TimerSettings) => {
      if (timer.colorId) {
        const preset = CATEGORY_COLOR_MAP[timer.colorId];
        if (preset) return preset;
      }
      return getCategoryColorPreset();
    },
    [],
  );

  const buildTimerMetrics = useCallback(
    (timer: TimerSettings) => {
      const elapsed = computeTimerElapsedValue(timer);
      const percent =
        totalElapsed > 0 ? Math.min(100, Math.round((elapsed / totalElapsed) * 100)) : 0;
      const colorPreset = resolveTimerColorPreset(timer);
      return { elapsed, percent, colorPreset };
    },
    [computeTimerElapsedValue, resolveTimerColorPreset, totalElapsed],
  );

  const activeTimerMetrics = activeTimerSettings ? buildTimerMetrics(activeTimerSettings) : null;

  const tagMap = useMemo(() => {
    const map = new Map<string, string>();
    tags.forEach((tag) => map.set(tag.id, tag.name));
    return map;
  }, [tags]);

  const extraTimerViews = useMemo(
    () => timersState.extras.map((timer) => ({ settings: timer, metrics: buildTimerMetrics(timer) })),
    [timersState.extras, buildTimerMetrics],
  );
  const primaryTimerView = useMemo(
    () => buildTimerMetrics(timersState.primary),
    [timersState.primary, buildTimerMetrics],
  );
  const canAddTimer = timersState.extras.length < MAX_EXTRA_TIMERS;

  const updateTimerSettings = useCallback(
    (timerId: string, updater: (timer: TimerSettings) => TimerSettings) => {
      applyTimersUpdate((prev) => {
        if (timerId === prev.primary.id) {
          return { ...prev, primary: updater(prev.primary) };
        }
        if (!prev.extras.some((timer) => timer.id === timerId)) {
          return prev;
        }
        return {
          ...prev,
          extras: prev.extras.map((timer) => (timer.id === timerId ? updater(timer) : timer)),
        };
      });
    },
    [applyTimersUpdate],
  );

  const handleTimerModeToggle = (timerId: string) => {
    updateTimerSettings(timerId, (timer) => ({
      ...timer,
      mode: timer.mode === 'only' ? 'exclude' : 'only',
    }));
  };

  const handleTimerTagAdd = (timerId: string, tagId: string) => {
    updateTimerSettings(timerId, (timer) =>
      timer.tagIds.includes(tagId)
        ? timer
        : { ...timer, tagIds: [...timer.tagIds, tagId] },
    );
  };

  const handleTimerTagRemove = (timerId: string, tagId: string) => {
    updateTimerSettings(timerId, (timer) => ({
      ...timer,
      tagIds: timer.tagIds.filter((id) => id !== tagId),
    }));
  };

  const handleAddTimer = () => {
    applyTimersUpdate((prev) => {
      if (prev.extras.length >= MAX_EXTRA_TIMERS) return prev;
      const nextTimer: TimerSettings = { id: nanoid(), tagIds: [], mode: 'only', colorId: null };
      return { ...prev, extras: [...prev.extras, nextTimer] };
    });
  };

  const handleTimerColorSelect = (timerId: string, colorId: string | null) => {
    updateTimerSettings(timerId, (timer) => ({
      ...timer,
      colorId,
    }));
    setTimerColorMenuId(null);
  };

  const handleRemoveTimer = (timerId: string) => {
    applyTimersUpdate((prev) => ({
      ...prev,
      extras: prev.extras.filter((timer) => timer.id !== timerId),
    }));
    delete timerButtonRefs.current[timerId];
    if (activeTimerMenuId === timerId) {
      setActiveTimerMenuId(null);
    }
  };

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const handleAddTask = async () => {
    if (!widgetId) return;
    const title = newTaskTitle.trim();
    if (!title) return;
    await createTask.mutateAsync({ title });
    setNewTaskTitle('');
  };

  const handleToggleDone = async (task: MicroTaskRecord) => {
    const willBeDone = !task.is_done;
    if (task.timer_state === 'running' && willBeDone) {
      await toggleTimer.mutateAsync({ id: task.id, isRunning: true });
    }
    const previousReordered = reorderedTasks;
    const baseList = reorderedTasks ?? rawTasks;
    const nextList = reorderTasksByCompletion(baseList, task.id, willBeDone);
    if (willBeDone && nextList) {
      scrollRestoreRef.current = window.scrollY;
      setReorderedTasks(nextList);
    }
    if (!willBeDone) {
      setReorderedTasks(null);
    }

    try {
      await updateTask.mutateAsync({ id: task.id, is_done: willBeDone });
      if (willBeDone && nextList) {
        reorderTasks.mutate(buildMicroTaskOrderUpdates(nextList));
      }
    } catch (error) {
      setReorderedTasks(previousReordered ?? null);
      throw error;
    }
  };

  const startEditingTask = (task: MicroTaskRecord) => {
    setEditingTask({ id: task.id, value: task.title });
  };

  const cancelEditingTask = () => setEditingTask(null);

  const commitEditingTask = async () => {
    if (!editingTask) return;
    const source = tasks.find((task) => task.id === editingTask.id);
    if (!source) {
      setEditingTask(null);
      return;
    }
    const trimmed = editingTask.value.trim();
    if (!trimmed || trimmed === source.title) {
      setEditingTask(null);
      return;
    }
    await updateTask.mutateAsync({ id: source.id, title: trimmed });
    setEditingTask(null);
  };

  const handleToggleTimer = async (task: MicroTaskRecord) => {
    const wasRunning = task.timer_state === 'running';
    const previousOptimisticId = optimisticRunningId;
    if (wasRunning) {
      setOptimisticRunningId(null);
    } else {
      setOptimisticRunningId(task.id);
    }
    try {
      await toggleTimer.mutateAsync({ id: task.id, isRunning: wasRunning });
    } catch (error) {
      setOptimisticRunningId(previousOptimisticId ?? null);
      throw error;
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
      try {
        await toggleTimer.mutateAsync({ id: task.id, isRunning: true });
      } catch {
        // ignore toggle errors here; editing can still continue
      }
    }
    setEditingTimeTaskId(task.id);
    const isTaskRunning = effectiveRunningId === task.id;
    setTimeDraft(formatDuration(computeTaskSeconds(task, isTaskRunning)));
    setIsTimeInvalid(false);
  };

  const handleCancelEditingTime = () => {
    setEditingTimeTaskId(null);
    setTimeDraft('');
    setIsTimeInvalid(false);
    setIsTimeSaving(false);
  };

  const handleChangeTimeDraft = (value: string) => {
    setTimeDraft(value);
    setIsTimeInvalid(false);
  };

  const handleCommitEditingTime = async (task: MicroTaskRecord) => {
    if (!editingTimeTaskId || editingTimeTaskId !== task.id) return;
    const seconds = parseDurationInput(timeDraft);
    if (seconds === null) {
      setIsTimeInvalid(true);
      return;
    }
    setIsTimeSaving(true);
    try {
      await updateTask.mutateAsync({
        id: task.id,
        elapsed_seconds: seconds,
        timer_state: 'paused',
        last_started_at: null,
      });
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
    const nextIds = Array.from(
      new Set([...(task.categories ?? []).map((category) => category.id), categoryId]),
    );
    await setCategoryBuffer.mutateAsync(nextIds);
  };

  const handleDetachCategory = async (task: MicroTaskRecord, categoryId: string) => {
    await detachCategoryFromTask.mutateAsync({ taskId: task.id, categoryId });
    const nextIds = task.categories?.filter((category) => category.id !== categoryId).map(
      (category) => category.id,
    ) ?? [];
    await setCategoryBuffer.mutateAsync(nextIds);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tasks.findIndex((task) => task.id === active.id);
    const newIndex = tasks.findIndex((task) => task.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(tasks, oldIndex, newIndex);
    const updates = buildMicroTaskOrderUpdates(reordered);
    reorderTasks.mutate(updates);
  };

  useEffect(() => {
    if (activeTimerMenuId && !activeTimerSettings) {
      setActiveTimerMenuId(null);
    }
  }, [activeTimerMenuId, activeTimerSettings]);

  const ready = Boolean(widgetId);
  const colorMenuCategory = colorMenuCategoryId
    ? taskCategories.find((category) => category.id === colorMenuCategoryId)
    : null;

  return (
    <section className="flex flex-col gap-4 rounded-[2.5rem] border border-white/10 bg-background/40 px-4 py-4">
      <header className="flex flex-col gap-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          ref={managerRefs.setReference}
          onClick={() => setIsManagerOpen((prev) => !prev)}
          disabled={!canManageTaxonomy}
          className={clsx(
            'flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-xs transition',
            canManageTaxonomy ? 'hover:border-white/40 hover:text-white' : 'opacity-50',
          )}
          aria-label="Управление тегами и категориями"
        >
          <span aria-hidden="true">
            <TagIcon className="h-4 w-4 text-white/70" />
          </span>
          <span aria-hidden="true">⚙️</span>
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <DndContext sensors={timerSensors} onDragEnd={handleTimerDragEnd}>
              <SortableContext
                items={extraTimerViews.map(({ settings }) => settings.id)}
                strategy={horizontalListSortingStrategy}
              >
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {extraTimerViews.map(({ settings, metrics }) => (
                    <SortableTimerPill
                      key={settings.id}
                      settings={settings}
                      metrics={metrics}
                      label={describeTimerTags(settings, tagMap)}
                      onSelect={() => setActiveTimerMenuId(settings.id)}
                      buttonRef={(node) => {
                        timerButtonRefs.current[settings.id] = node;
                      }}
                      isActive={activeTimerMenuId === settings.id}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {canAddTimer && (
              <button
                type="button"
                onClick={handleAddTimer}
                aria-label="Добавить таймер"
                className="flex items-center gap-1 rounded-2xl border border-dashed border-white/30 px-3 py-1.5 text-xs text-muted transition hover:border-white/60 hover:text-white"
              >
                <span aria-hidden="true">⏱</span>
                <span aria-hidden="true">+</span>
              </button>
            )}
          </div>
          <TimerPill
            key="primary"
            elapsed={primaryTimerView.elapsed}
            percent={primaryTimerView.percent}
            colorClass={primaryTimerView.colorPreset.iconClass}
            percentClass={primaryTimerView.colorPreset.percentClass}
            isPrimary
            isActive={activeTimerMenuId === timersState.primary.id}
            label={describeTimerTags(timersState.primary, tagMap)}
            onClick={() => setActiveTimerMenuId(timersState.primary.id)}
            buttonRef={(node) => {
              timerButtonRefs.current[timersState.primary.id] = node;
            }}
          />
        </div>
      </header>

      {activeTimerSettings && (
        <FloatingPortal>
          <div
            ref={timerMenuRefs.setFloating}
            style={{
              position: timerMenuStrategy,
              top: timerMenuY ?? 0,
              left: timerMenuX ?? 0,
              zIndex: 1200,
            }}
            className="w-[19rem] rounded-2xl border border-white/10 bg-background/95 p-4 text-xs text-text shadow-2xl backdrop-blur"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.6rem] uppercase text-muted">Время</p>
                <p className="text-lg font-semibold">
                  {formatDuration(activeTimerMetrics?.elapsed ?? 0)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[0.6rem] uppercase text-muted">Доля</p>
                <p className="text-base font-semibold">{activeTimerMetrics?.percent ?? 0}%</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Выбрать цвет таймера"
                  className={clsx(
                    'rounded-2xl border border-white/20 px-3 py-1 text-sm transition hover:border-white/40',
                    activeTimerMetrics?.colorPreset.iconClass,
                  )}
                  ref={(node) => {
                    timerColorButtonRefs.current[activeTimerSettings.id] = node;
                  }}
                  onClick={() =>
                    setTimerColorMenuId((prev) =>
                      prev === activeTimerSettings.id ? null : activeTimerSettings.id,
                    )
                  }
                >
                  ⏱
                </button>
                {!activeTimerIsPrimary && (
                  <button
                    type="button"
                    onClick={() => handleRemoveTimer(activeTimerSettings.id)}
                    aria-label="Удалить таймер"
                    className="rounded-full border border-white/20 px-2 py-1 text-sm text-muted transition hover:border-rose-400 hover:text-rose-300"
                  >
                    −
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3">
              <p className="text-[0.6rem] uppercase text-muted">Теги</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeTimerSettings.tagIds.length === 0 && (
                  <p className="text-muted">Все теги</p>
                )}
                {activeTimerSettings.tagIds.map((tagId) => {
                  const tag = tagMap.get(tagId);
                  return (
                    <span
                      key={tagId}
                      className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[0.7rem]"
                    >
                      {tag ?? 'Тег удалён'}
                      <button
                        type="button"
                        aria-label={`Убрать тег ${tag ?? ''}`}
                        className="text-muted transition hover:text-rose-400"
                        onClick={() => handleTimerTagRemove(activeTimerSettings.id, tagId)}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
              <div className="mt-2">
                <TaxonomySelect
                  placeholder="Добавить тег"
                  ariaLabel="Добавить тег в таймер"
                  options={activeTimerAvailableTags.map((tag) => ({
                    value: tag.id,
                    label: tag.name,
                  }))}
                  disabled={activeTimerAvailableTags.length === 0}
                  className="w-full"
                  onSelectOption={(option) => {
                    handleTimerTagAdd(activeTimerSettings.id, option.value);
                  }}
                />
              </div>
              <p className="mt-1 text-[0.6rem] text-muted">
                Без тегов таймер учитывает все задачи.
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[0.6rem] uppercase text-muted">Режим</span>
              <button
                type="button"
                onClick={() => handleTimerModeToggle(activeTimerSettings.id)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-text transition hover:border-white/40"
              >
                {activeTimerSettings.mode === 'only' ? 'Только выбранные' : 'Кроме выбранных'}
              </button>
            </div>
          </div>
        </FloatingPortal>
      )}
      {timerColorMenuTimer && (
        <FloatingPortal>
          <div
            ref={timerColorMenuRefs.setFloating}
            style={{
              position: timerColorMenuStrategy,
              top: timerColorMenuY ?? 0,
              left: timerColorMenuX ?? 0,
              zIndex: 1300,
            }}
            className="grid grid-cols-6 gap-2 rounded-2xl border border-white/10 bg-background/95 p-3 shadow-2xl backdrop-blur"
          >
            {CATEGORY_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={clsx(
                  'flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 transition hover:border-white/30',
                  timerColorMenuTimer.colorId === preset.id && 'ring-2 ring-accent/40',
                )}
                aria-label={`Цвет таймера: ${preset.label}`}
                onClick={() =>
                  handleTimerColorSelect(
                    timerColorMenuTimer.id,
                    preset.id === 'neutral' ? null : preset.id,
                  )
                }
              >
                <TagIcon className={clsx('h-4 w-4', preset.iconClass)} />
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}

      {isLoading && <p className="text-sm text-muted">Загружаем микрозадачи…</p>}
      {isError && (
        <p className="text-sm text-rose-400">
          Не удалось загрузить задачи: {error?.message ?? 'неизвестная ошибка'}
        </p>
      )}

      {isManagerOpen && (
        <FloatingPortal>
          <div
            ref={managerRefs.setFloating}
            style={{
              position: managerStrategy,
              top: managerY ?? 0,
              left: managerX ?? 0,
              zIndex: 1000,
            }}
            data-testid="taxonomy-manager"
            className="w-[360px] rounded-2xl border border-white/10 bg-background/95 p-4 text-xs text-text shadow-2xl backdrop-blur"
          >
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[0.6rem] uppercase tracking-[0.2em] text-muted">Теги</h3>
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreateTag();
                  }}
                >
                  <input
                    value={newTagName}
                    onChange={(event) => setNewTagName(event.target.value)}
                    placeholder="Новый тег"
                    className="flex-1 rounded-full border border-white/20 bg-transparent px-3 py-1 text-text outline-none placeholder:text-muted"
                  />
                  <button
                    type="submit"
                    className="rounded-full bg-accent/20 px-3 py-1 text-accent transition hover:bg-accent/30"
                  >
                    +
                  </button>
                </form>
              </div>
              <div className="flex flex-wrap gap-2">
                {tags.length === 0 && <p className="text-muted">Теги не созданы</p>}
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1"
                  >
                    <span>{tag.name}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteTag(tag.id)}
                      className="text-muted transition hover:text-rose-400"
                      aria-label={`Удалить тег ${tag.name}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </section>

            <section className="mt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[0.6rem] uppercase tracking-[0.2em] text-muted">Категории</h3>
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreateCategory();
                  }}
                >
                  <input
                    value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)}
                    placeholder="Новая категория"
                    className="flex-1 rounded-full border border-white/20 bg-transparent px-3 py-1 text-text outline-none placeholder:text-muted"
                  />
                  <button
                    type="submit"
                    className="rounded-full bg-accent/20 px-3 py-1 text-accent transition hover:bg-accent/30"
                  >
                    +
                  </button>
                </form>
              </div>

              <div className="max-h-[40rem] space-y-3 overflow-y-auto pr-1">
                {visibleCategories.length === 0 && (
                  <p className="text-muted">Категории не созданы</p>
                )}
                {visibleCategories.map((category) => {
                  const availableTags = tags.filter(
                    (tag) => !category.tags?.some((existing) => existing.id === tag.id),
                  );
                  const colorPreset = getCategoryColorPreset(category.color);
                  const canUseColorPicker = true;
                  return (
                    <div
                      key={category.id}
                      data-testid={`category-card-${category.id}`}
                      className="relative overflow-visible rounded-2xl border border-white/10 bg-white/5 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        {renamingCategoryId === category.id ? (
                          <input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onBlur={handleCommitRenameCategory}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                handleCommitRenameCategory();
                              } else if (event.key === 'Escape') {
                                setRenamingCategoryId(null);
                                setRenameDraft('');
                              }
                            }}
                            className="flex-1 rounded-full border border-white/20 bg-white/80 px-3 py-1 text-sm text-black outline-none"
                            autoFocus
                          />
                        ) : (
                          <div className="flex-1 text-sm font-semibold text-white">
                            {category.name}
                            {category.is_auto && (
                              <span className="ml-2 text-[0.65rem] uppercase text-muted">auto</span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          {!category.is_auto && (
                            <button
                              type="button"
                              onClick={() => handleStartRenameCategory(category)}
                              className="rounded-full p-1 text-muted transition hover:text-white"
                              aria-label="Переименовать"
                            >
                              ✎
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(category.id)}
                            className="rounded-full p-1 text-muted transition hover:text-rose-400"
                            aria-label="Удалить категорию"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {category.tags?.length ? (
                          category.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs"
                            >
                              {tag.name}
                              <button
                                type="button"
                                onClick={() => handleDetachTagFromCategory(category.id, tag.id)}
                                className="text-muted transition hover:text-rose-400"
                                aria-label={`Удалить связанный тег ${tag.name}`}
                              >
                                ✕
                              </button>
                            </span>
                          ))
                        ) : (
                          <p className="text-muted">Нет тегов</p>
                        )}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex-1">
                          <TaxonomySelect
                            placeholder="Добавить тег"
                            ariaLabel={`Добавить тег в категорию ${category.name}`}
                            options={availableTags.map((tag) => ({ value: tag.id, label: tag.name }))}
                            disabled={availableTags.length === 0}
                            className="w-full"
                            enableSearch
                            onSelectOption={(option) => handleAttachTagToCategory(category.id, option.value)}
                          />
                        </div>
                        <div className="relative" data-taxonomy-dropdown="true">
                          <button
                            type="button"
                            onClick={() => {
                              if (!canUseColorPicker) return;
                              handleToggleColorMenu(category.id);
                            }}
                            disabled={!canUseColorPicker}
                            className={clsx(
                              'flex h-8 w-8 items-center justify-center rounded-xl border text-sm transition',
                              canUseColorPicker
                                ? 'border-white/15 bg-white/5 hover:border-white/40'
                                : 'border-white/10 bg-white/5/50 opacity-60 cursor-not-allowed',
                            )}
                            aria-label="Выбрать цвет категории"
                            ref={(el) => {
                              colorButtonRefs.current[category.id] = el;
                            }}
                          >
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
      {colorMenuCategory && colorMenuPosition && (
        <FloatingPortal>
          <div
            ref={colorMenuRef}
            className="fixed z-[2000] w-40 rounded-2xl border border-white/10 bg-background/95 p-3 text-[0.65rem] text-text shadow-2xl backdrop-blur"
            style={{
              top: colorMenuPosition.y,
              left: colorMenuPosition.x,
            }}
          >
            <p className="px-1 text-[0.55rem] uppercase tracking-[0.2em] text-muted">Цвет</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {CATEGORY_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    handleSelectCategoryColor(
                      colorMenuCategory.id,
                      preset.id === 'neutral' ? null : preset.id,
                    )
                  }
                  className={clsx(
                    'flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 transition hover:border-white/30',
                    colorMenuCategory.color === preset.id && 'ring-2 ring-accent/40',
                  )}
                  aria-label={`Цвет: ${preset.label}`}
                >
                  <TagIcon className={clsx('h-4 w-4', preset.iconClass)} />
                </button>
              ))}
            </div>
          </div>
        </FloatingPortal>
      )}

      {ready && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-3">
              {tasks.length === 0 && (
                <p className="rounded-2xl border border-dashed border-white/20 px-4 py-6 text-center text-xs text-muted">
                  Добавьте первую микрозадачу
                </p>
              )}
              {tasks.map((task) => {
                const isTaskRunning = effectiveRunningId === task.id;
                const seconds =
                  taskSecondsMap.get(task.id) ?? computeTaskSeconds(task, isTaskRunning);
                return (
                  <MicroTaskCard
                    key={task.id}
                    task={task}
                    seconds={seconds}
                    isRunning={isTaskRunning}
                    onToggleTimer={() => handleToggleTimer(task)}
                    onToggleDone={() => handleToggleDone(task)}
                    onDelete={() => handleDelete(task)}
                    onArchive={() => handleArchiveTask(task)}
                    isArchiving={archiveTask.isPending && archiveTask.variables === task.id}
                    onTimeClick={() => handleStartEditingTime(task)}
                    onTimeChange={handleChangeTimeDraft}
                    onTimeCommit={() => handleCommitEditingTime(task)}
                    onTimeCancel={handleCancelEditingTime}
                    isEditing={editingTask?.id === task.id}
                    editValue={editingTask?.id === task.id ? editingTask.value : ''}
                    onEditStart={() => startEditingTask(task)}
                    onEditChange={(value) =>
                      setEditingTask((prev) =>
                        prev && prev.id === task.id ? { ...prev, value } : prev,
                      )
                    }
                    onEditCommit={commitEditingTask}
                    onEditCancel={cancelEditingTask}
                    taskCategories={taskCategories}
                    onAttachCategory={(categoryId) => handleAttachCategory(task, categoryId)}
                    onDetachCategory={(categoryId) => handleDetachCategory(task, categoryId)}
                    isEditingTime={editingTimeTaskId === task.id}
                    timeDraft={editingTimeTaskId === task.id ? timeDraft : ''}
                    isTimeInvalid={isTimeInvalid}
                    isTimeSaving={isTimeSaving}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-accent/50 bg-accent/10 px-4 py-1">
          <input
            value={newTaskTitle}
            onChange={(event) => setNewTaskTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleAddTask();
            }}
            placeholder="Новая микрозадача"
            className="w-36 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={handleAddTask}
            className="text-xl text-accent transition hover:text-accent/80"
            aria-label="Добавить задачу"
          >
            +
          </button>
        </div>
      </div>
    </section>
  );
}

type MicroTaskCardProps = {
  task: MicroTaskRecord;
  seconds: number;
  isRunning: boolean;
  onToggleTimer: () => void;
  onToggleDone: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onTimeClick: () => void;
  onTimeChange: (value: string) => void;
  onTimeCommit: () => void;
  onTimeCancel: () => void;
  isEditing: boolean;
  editValue: string;
  onEditStart: () => void;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  taskCategories: TaskCategory[];
  onAttachCategory: (categoryId: string) => Promise<void>;
  onDetachCategory: (categoryId: string) => Promise<void>;
  isArchiving: boolean;
  isEditingTime: boolean;
  timeDraft: string;
  isTimeInvalid: boolean;
  isTimeSaving: boolean;
};

type TimerPillProps = {
  elapsed: number;
  percent: number;
  colorClass: string;
  onClick: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
  label: string;
  isPrimary?: boolean;
  isActive: boolean;
};

const TimerPill = ({
  elapsed,
  percent,
  colorClass,
  onClick,
  buttonRef,
  label,
  isPrimary = false,
  isActive,
}: TimerPillProps) => (
  <button
    type="button"
    ref={buttonRef}
    onClick={onClick}
    className={clsx(
      'rounded-2xl border border-white/15 px-3 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
      isPrimary
        ? 'min-w-[5rem] border-white/25 bg-white/5'
        : 'min-w-[6.5rem] px-4.5 py-2.5',
      isActive && 'ring-2 ring-accent/40',
    )}
    aria-label={label}
    title={label}
  >
    <div className="flex items-baseline gap-2 font-mono tabular-nums">
      <span
        className={clsx(
          isPrimary ? 'text-2xl font-semibold leading-tight' : 'text-lg font-semibold',
          colorClass,
        )}
      >
        {formatDuration(elapsed)}
      </span>
      <span className="text-xs font-medium text-white/60 whitespace-nowrap">{percent}%</span>
    </div>
  </button>
);

function MicroTaskCard({
  task,
  seconds,
  isRunning,
  onToggleTimer,
  onToggleDone,
  onDelete,
  onArchive,
  onTimeClick,
  onTimeChange,
  onTimeCommit,
  onTimeCancel,
  isEditing,
  editValue,
  onEditStart,
  onEditChange,
  onEditCommit,
  onEditCancel,
  taskCategories,
  onAttachCategory,
  onDetachCategory,
  isArchiving,
  isEditingTime,
  timeDraft,
  isTimeInvalid,
  isTimeSaving,
}: MicroTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'transform 120ms ease-out' : transition,
  };

  const timeLabel = formatDuration(seconds);
  const [isCategoriesPopoverOpen, setIsCategoriesPopoverOpen] = useState(false);
  const { refs: categoryRefs, strategy, x, y } = useFloating({
    open: isCategoriesPopoverOpen,
    onOpenChange: setIsCategoriesPopoverOpen,
    placement: 'bottom-end',
    middleware: [offset(10), flip(), shift()],
  });

  useEffect(() => {
    if (!isCategoriesPopoverOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        referenceContainsNode(categoryRefs.reference.current, target) ||
        categoryRefs.floating.current?.contains(target) ||
        (target instanceof HTMLElement && target.closest(TAXONOMY_DROPDOWN_SELECTOR))
      ) {
        return;
      }
      setIsCategoriesPopoverOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCategoriesPopoverOpen, categoryRefs.reference, categoryRefs.floating]);

  const availableCategories = taskCategories.filter(
    (category) => !task.categories?.some((attached) => attached.id === category.id),
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter') {
      onEditCommit();
    } else if (event.key === 'Escape') {
      onEditCancel();
    }
  };

  const latestColoredCategory = [...(task.categories ?? [])]
    .reverse()
    .find((category) => category.color);
  const colorPreset = latestColoredCategory
    ? getCategoryColorPreset(latestColoredCategory.color)
    : getCategoryColorPreset();

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center gap-3 rounded-3xl px-4 py-3 text-sm text-text',
        colorPreset.cardClass,
        isDragging && 'ring-2 ring-accent/50',
      )}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        onClick={onToggleDone}
        className={clsx(
          'flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem]',
          task.is_done ? 'border-emerald-400 bg-emerald-400/20 text-emerald-200' : 'border-white/30',
        )}
        aria-label={task.is_done ? 'Вернуть в активные' : 'Отметить как выполненную'}
      >
        {task.is_done ? '✓' : ''}
      </button>
      {isEditing ? (
        <textarea
          style={{ maxWidth: 450 }}
          value={editValue}
          rows={1}
          onChange={(event) => onEditChange(event.target.value)}
          onInput={(event) => {
            const target = event.currentTarget;
            target.style.height = 'auto';
            target.style.height = `${target.scrollHeight}px`;
          }}
          onBlur={onEditCommit}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1 rounded-2xl bg-white/80 px-3 py-1 text-black outline-none resize-none"
        />
      ) : (
        <button
          type="button"
          className={clsx(
            'flex-1 max-w-[450px] cursor-text select-none whitespace-normal break-words text-left',
            task.is_done ? 'text-muted line-through' : 'text-text',
          )}
          onClick={onEditStart}
        >
          {task.title}
        </button>
      )}
      <button
        type="button"
        onClick={onToggleTimer}
        className={clsx(
          'flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition',
          isRunning ? 'border-amber-300 text-amber-200' : 'border-white/30 text-white',
        )}
        aria-label={isRunning ? 'Пауза' : 'Старт'}
      >
        {isRunning ? '❚❚' : '▶'}
      </button>
      {isEditingTime ? (
        <input
          value={timeDraft}
          onChange={(event) => onTimeChange(event.target.value)}
          onBlur={() => {
            void onTimeCommit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void onTimeCommit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onTimeCancel();
            }
          }}
          disabled={isTimeSaving}
          autoFocus
          className={clsx(
            'w-24 rounded-lg border bg-white/80 px-2 py-1 text-center font-mono text-sm text-black outline-none',
            isTimeInvalid ? 'border-rose-400' : 'border-transparent',
            isTimeSaving && 'opacity-60',
          )}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            void onTimeClick();
          }}
          className="w-24 text-center font-mono text-base text-text tabular-nums transition hover:text-white/80"
          aria-label={`Редактировать время задачи ${task.title}`}
        >
          {timeLabel}
        </button>
      )}
      <button
        type="button"
        ref={categoryRefs.setReference}
        onClick={() => setIsCategoriesPopoverOpen((prev) => !prev)}
        className={clsx(
          'flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs ring-1 ring-white/20 transition',
          colorPreset.iconClass,
        )}
        aria-label="Категории задачи"
      >
        <TagIcon className="h-3.5 w-3.5" />
      </button>
      {isCategoriesPopoverOpen && (
        <FloatingPortal>
          <div
            ref={categoryRefs.setFloating}
            style={{
              position: strategy,
              top: y ?? 0,
              left: x ?? 0,
              zIndex: 1200,
            }}
            data-testid="task-category-popover"
            className="w-64 rounded-2xl border border-white/10 bg-background/95 p-3 text-xs text-text shadow-xl backdrop-blur"
          >
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted">
              Категории задачи
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {task.categories?.length ? (
                task.categories.map((category) => {
                  const preset = getCategoryColorPreset(category.color);
                  return (
                    <span
                      key={category.id}
                      className={clsx(
                        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs',
                        preset.chipClass,
                      )}
                    >
                      {category.name}
                      <button
                        type="button"
                        onClick={() => {
                          void onDetachCategory(category.id);
                        }}
                        className="text-white/80 transition hover:text-rose-300"
                        aria-label={`Удалить категорию ${category.name}`}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })
              ) : (
                <p className="text-muted">Категории не выбраны</p>
              )}
            </div>
            <div className="mt-3">
              <TaxonomySelect
                placeholder="Добавить категорию"
                ariaLabel="Добавить категорию"
                options={availableCategories.map((category) => ({
                  value: category.id,
                  label: category.name,
                }))}
                disabled={availableCategories.length === 0}
                className="w-full"
                enableSearch
                onSelectOption={(option) => {
                  void onAttachCategory(option.value);
                }}
              />
            </div>
          </div>
        </FloatingPortal>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-muted transition hover:text-rose-300"
          aria-label="Удалить задачу"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={onArchive}
          disabled={!task.is_done || isArchiving}
          className={clsx(
            'rounded-full border px-3 py-1 text-xs transition',
            task.is_done
              ? 'border-emerald-400/40 text-emerald-200 hover:border-emerald-300 hover:text-emerald-100'
              : 'border-white/10 text-muted opacity-60',
            isArchiving && 'opacity-60',
          )}
          aria-label="Архивировать задачу"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7h16" />
            <path d="M5 7v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7" />
            <path d="M3 7l2-3h14l2 3" />
            <path d="M10 11h4" />
          </svg>
        </button>
      </div>
    </article>
  );
}

type TaxonomySelectOption = {
  value: string;
  label: string;
};

type TaxonomySelectProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder: string;
  options: TaxonomySelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  enableSearch?: boolean;
  searchPlaceholder?: string;
  emptyStateLabel?: string;
  onSelectOption?: (option: TaxonomySelectOption) => void | Promise<void>;
  clearOnSelect?: boolean;
};

function TaxonomySelect({
  value,
  onChange,
  placeholder,
  options,
  disabled,
  ariaLabel,
  className,
  enableSearch = false,
  searchPlaceholder = 'Поиск…',
  emptyStateLabel = 'Нет доступных вариантов',
  onSelectOption,
  clearOnSelect = true,
}: TaxonomySelectProps) {
  const [internalValue, setInternalValue] = useState('');
  const currentValue = value ?? internalValue;
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [floatingWidth, setFloatingWidth] = useState<number | null>(null);
  const selectId = useId();
  const listId = `${selectId}-listbox`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(8), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
    placement: 'bottom-start',
  });

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) ||
        refs.floating.current?.contains(target) ||
        (target instanceof HTMLElement && target.closest(TAXONOMY_DROPDOWN_SELECTOR))
      ) {
        return;
      }
      setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, refs.floating]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const referenceEl = getReferenceElement(refs.reference.current);
    const nextWidth = Math.max(referenceEl?.getBoundingClientRect().width ?? 0, 256);
    setFloatingWidth(nextWidth);
    if (enableSearch) {
      setSearchQuery('');
    }
  }, [isOpen, enableSearch, refs.reference]);

  const filteredOptions = useMemo(() => {
    if (!enableSearch) return options;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }, [options, searchQuery, enableSearch]);

  const selectedOption = options.find((option) => option.value === currentValue);
  const inputDisplayValue =
    isOpen && enableSearch ? searchQuery : selectedOption?.label ?? '';
  const inputPlaceholder =
    isOpen && enableSearch ? searchPlaceholder : placeholder;

  const commitValue = (nextValue: string) => {
    if (onChange) onChange(nextValue);
    else setInternalValue(nextValue);
  };

  const handleSelect = async (option: TaxonomySelectOption) => {
    if (disabled) return;
    commitValue(option.value);
    if (onSelectOption) {
      try {
        await onSelectOption(option);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
      }
    }
    if (clearOnSelect) {
      commitValue('');
    }
    setIsOpen(false);
    setSearchQuery('');
  };

  const openDropdown = () => {
    if (disabled) return;
    setIsOpen(true);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!enableSearch) return;
    if (!isOpen) {
      openDropdown();
    }
    setSearchQuery(event.target.value);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
    }
    if ((event.key === 'Enter' || event.key === 'ArrowDown') && !isOpen) {
      event.preventDefault();
      openDropdown();
    }
  };

  const assignReference = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    refs.setReference(node);
  };

  return (
    <div
      ref={assignReference}
      data-taxonomy-dropdown="true"
      className={clsx('relative', className)}
    >
      <div
        className={clsx(
          'flex items-center rounded-full border border-white/20 px-3 py-1.5 transition focus-within:ring-2 focus-within:ring-accent/40',
          disabled
            ? 'cursor-not-allowed bg-white/5 text-muted opacity-60'
            : 'bg-white/10 text-text hover:border-white/40',
        )}
        onMouseDown={(event) => {
          if (event.target === inputRef.current) return;
          event.preventDefault();
          if (disabled) return;
          openDropdown();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-label={ariaLabel ?? placeholder}
          placeholder={inputPlaceholder}
          value={inputDisplayValue}
          onFocus={openDropdown}
          onClick={() => {
            if (!isOpen) openDropdown();
          }}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          readOnly={!enableSearch}
          disabled={disabled}
          autoComplete="off"
          className={clsx(
            'flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted',
            disabled && 'cursor-not-allowed text-muted',
          )}
        />
        <button
          type="button"
          aria-label={isOpen ? 'Свернуть список' : 'Развернуть список'}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            if (disabled) return;
            setIsOpen((prev) => !prev);
            inputRef.current?.focus();
          }}
          className={clsx(
            'ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[0.65rem] transition',
            disabled ? 'text-muted/50' : isOpen ? 'rotate-180 text-accent' : 'text-muted',
          )}
        >
          ▾
        </button>
      </div>
      {isOpen && !disabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            data-taxonomy-dropdown="true"
            style={{ ...floatingStyles, width: floatingWidth ?? undefined }}
            className="z-[1200] mt-2 max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-background/90 p-2 text-sm text-text shadow-2xl backdrop-blur"
          >
            <ul
              role="listbox"
              id={listId}
              aria-labelledby={selectId}
              className="max-h-56 overflow-y-auto pr-1"
            >
              {filteredOptions.map((option) => (
                <li key={option.value} className="py-0.5">
                  <button
                    type="button"
                    role="option"
                    aria-selected={currentValue === option.value}
                    onClick={() => {
                      void handleSelect(option);
                    }}
                    className={clsx(
                      'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition',
                      currentValue === option.value
                        ? 'bg-accent/20 text-accent'
                        : 'text-text hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <span>{option.label}</span>
                    {currentValue === option.value && <span aria-hidden="true">✓</span>}
                  </button>
                </li>
              ))}
              {filteredOptions.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-muted">{emptyStateLabel}</li>
              )}
            </ul>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 7.5V6a3 3 0 0 1 3-3h4.5a3 3 0 0 1 2.12.88l7.5 7.5a3 3 0 0 1 0 4.24l-4.5 4.5a3 3 0 0 1-4.24 0l-7.5-7.5A3 3 0 0 1 3 7.5Z" />
      <path d="M7 8h.01" />
    </svg>
  );
}

