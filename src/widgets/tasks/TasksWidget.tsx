import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useGoals,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useArchiveGoal,
  useAttachCategoryToGoal,
  useDetachCategoryFromGoal,
  useRecurringGoals,
  useUpdateRecurringGoal,
  useReorderGoals,
} from '../../features/tasks/hooks';
import { useTaskCategories } from '../../features/microTasks/hooks';
import { useBootstrapDashboard } from '../../features/dashboards/hooks';
import { useAuthStore } from '../../stores/authStore';
import { placeCompletedGoalOrder, sortGoals } from '../../features/tasks/utils';
import { findPendingTriggers } from '../../features/tasks/cronUtils';
import type { GoalRecord } from '../../features/tasks/types';
import type { TaskCategory } from '../../features/microTasks/types';
import { TaskCard } from './components/TaskCard';
import { RecurringTasksManager } from './components/RecurringTasksManager';
import { useCrossWidgetDrag } from './CrossWidgetDragContext';

const DRAG_ACTIVATION_DISTANCE = 6;
const EMPTY_CATEGORIES: TaskCategory[] = [];

type DropTarget = { id: string; position: 'before' | 'after' };
type DragState = { draggedId: string; dropTarget: DropTarget | null };

export type TasksWidgetProps = {
  widgetId: string | null;
  config?: Record<string, unknown> | null;
  onUpdateConfig?: (patch: Record<string, unknown>) => void;
};

export function TasksWidget({ widgetId }: TasksWidgetProps) {
  const { data: goals = [], isLoading, isError, error } = useGoals(widgetId);
  const { data: taskCategoriesData } = useTaskCategories();
  const taskCategories = taskCategoriesData ?? EMPTY_CATEGORIES;

  const createGoal = useCreateGoal(widgetId);
  const updateGoal = useUpdateGoal(widgetId);
  const deleteGoal = useDeleteGoal(widgetId);
  const archiveGoal = useArchiveGoal(widgetId);
  const attachCategory = useAttachCategoryToGoal();
  const detachCategory = useDetachCategoryFromGoal();
  const reorderGoalsMutation = useReorderGoals(widgetId);

  const { data: recurringGoals = [] } = useRecurringGoals(widgetId);
  const updateRecurringGoal = useUpdateRecurringGoal(widgetId);
  const cronCheckedRef = useRef(false);

  // Need the user's micro-tasks widget id to mirror the cron-fired goal as a
  // micro-task. Listen to the same dashboard bootstrap that DashboardShell
  // uses so we hit the same React Query cache (no extra network call).
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const { data: bootstrap } = useBootstrapDashboard(userId);
  const microTasksWidgetId = useMemo(
    () => bootstrap?.widgets.find((w) => w.type === 'tasks')?.id ?? null,
    [bootstrap?.widgets],
  );

  useEffect(() => {
    if (cronCheckedRef.current || !widgetId || recurringGoals.length === 0) return;
    cronCheckedRef.current = true;

    const pending = findPendingTriggers(recurringGoals);
    if (pending.length === 0) return;

    void (async () => {
      for (const { recurringGoal, triggerTime } of pending) {
        const newGoal = await createGoal.mutateAsync({
          title: recurringGoal.title,
          value: recurringGoal.value,
          expected_hours: recurringGoal.expected_hours,
          is_recurring: true,
        });
        await updateRecurringGoal.mutateAsync({
          id: recurringGoal.id,
          last_triggered_at: triggerTime.toISOString(),
        });
        // Mirror the new goal into micro-tasks. The MicroTasksWidget already
        // listens for `cross-widget-drop` (used by manual goal→tasks drags);
        // dispatching the same event here gives the cron-fired goal the
        // exact behaviour the user gets when they manually drag.
        if (microTasksWidgetId && newGoal?.id) {
          window.dispatchEvent(
            new CustomEvent('cross-widget-drop', {
              detail: {
                targetWidgetId: microTasksWidgetId,
                goal: { id: newGoal.id, title: newGoal.title, categories: [] },
              },
            }),
          );
        }
      }
    })();
  }, [widgetId, recurringGoals, createGoal, updateRecurringGoal, microTasksWidgetId]);

  const [editingGoal, setEditingGoal] = useState<{ id: string; value: string } | null>(null);
  const [newTitle, setNewTitle] = useState('');

  // React Query returns a new snapshot object on every render but its .mutate /
  // .mutateAsync are stable refs bound to the underlying mutation instance.
  // Capture those stable refs so our useCallback handlers don't regenerate each
  // render — otherwise TaskCard's React.memo skips re-renders and we get stale
  // closures pointing at old snapshots (e.g. archive button firing the handler
  // but a stale guard short-circuits).
  const createGoalAsync = createGoal.mutateAsync;
  const updateGoalMutate = updateGoal.mutate;
  const updateGoalAsync = updateGoal.mutateAsync;
  const deleteGoalAsync = deleteGoal.mutateAsync;
  const archiveGoalMutate = archiveGoal.mutate;
  const reorderGoalsMutate = reorderGoalsMutation.mutate;
  const attachCategoryAsync = attachCategory.mutateAsync;
  const detachCategoryAsync = detachCategory.mutateAsync;

  const handleAddGoal = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || !widgetId) return;
    await createGoalAsync({ title });
    setNewTitle('');
  }, [newTitle, widgetId, createGoalAsync]);

  // Latest goals snapshot readable from inside stable handlers.
  const goalsRef = useRef(goals);
  useEffect(() => { goalsRef.current = goals; }, [goals]);

  const handleToggleDone = useCallback((goal: GoalRecord) => {
    const newDone = !goal.is_done;
    if (!newDone) {
      updateGoalMutate({ id: goal.id, is_done: false });
      return;
    }
    const currentGoals = goalsRef.current;
    const goalsWithDone = currentGoals.map((g) => (g.id === goal.id ? { ...g, is_done: true } : g));
    const newOrder = placeCompletedGoalOrder(goalsWithDone, goal.id);
    updateGoalMutate({ id: goal.id, is_done: true });
    if (newOrder.length > 0) reorderGoalsMutate(newOrder);
  }, [updateGoalMutate, reorderGoalsMutate]);

  const handleToggleLock = useCallback(async (goal: GoalRecord) => {
    await updateGoalAsync({ id: goal.id, is_locked: !goal.is_locked });
  }, [updateGoalAsync]);

  const handleValueChange = useCallback(async (goal: GoalRecord, value: number) => {
    await updateGoalAsync({ id: goal.id, value });
  }, [updateGoalAsync]);

  const handleExpectedHoursChange = useCallback(async (goal: GoalRecord, expectedHours: number) => {
    await updateGoalAsync({ id: goal.id, expected_hours: expectedHours });
  }, [updateGoalAsync]);

  const handleDelete = useCallback(async (goal: GoalRecord) => {
    await deleteGoalAsync(goal.id);
  }, [deleteGoalAsync]);

  const handleArchive = useCallback((goal: GoalRecord) => {
    // No isPending guard: React Query serialises calls internally and archive is
    // idempotent on the server (archived_at = now()). Repeated clicks on the
    // same goal are harmless, and stale-snapshot issues disappear.
    if (!goal.is_done) return;
    archiveGoalMutate(goal.id);
  }, [archiveGoalMutate]);

  const handleSort = useCallback(() => {
    const currentGoals = goalsRef.current;
    if (currentGoals.length < 2) return;
    const sorted = sortGoals(currentGoals);
    reorderGoalsMutate(sorted.map((g) => g.id));
  }, [reorderGoalsMutate]);

  const crossDrag = useCrossWidgetDrag();

  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!widgetId) return;
    crossDrag.registerDropZone(widgetId, sectionRef.current);
    return () => crossDrag.registerDropZone(widgetId, null);
  }, [widgetId, crossDrag]);

  const itemRefsMap = useRef(new Map<string, HTMLElement>());
  const registerItemRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) itemRefsMap.current.set(id, el);
    else itemRefsMap.current.delete(id);
  }, []);

  const [dragState, setDragState] = useState<DragState | null>(null);

  const reorderMutate = reorderGoalsMutation.mutate;

  const displayGoals = useMemo(() => {
    if (!dragState || !dragState.dropTarget) return goals;
    const { draggedId, dropTarget } = dragState;
    const draggedIdx = goals.findIndex((g) => g.id === draggedId);
    if (draggedIdx === -1) return goals;
    const rest = goals.filter((g) => g.id !== draggedId);
    const restTargetIdx = rest.findIndex((g) => g.id === dropTarget.id);
    if (restTargetIdx === -1) return goals;
    const insertAt = dropTarget.position === 'before' ? restTargetIdx : restTargetIdx + 1;
    const dragged = goals[draggedIdx];
    return [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)];
  }, [goals, dragState]);

  const handleDragStart = useCallback((goal: GoalRecord, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const currentGoals = goals;
    const currentWidgetId = widgetId;
    let activated = false;
    let rafId: number | null = null;
    let latestX = startX;
    let latestY = startY;

    const findDropTarget = (pointerY: number): DropTarget | null => {
      const items: { id: string; hitY: number }[] = [];
      for (const g of currentGoals) {
        if (g.id === goal.id) continue;
        const el = itemRefsMap.current.get(g.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        items.push({ id: g.id, hitY: rect.top + rect.height / 2 });
      }
      if (items.length === 0) return null;
      if (pointerY <= items[0].hitY) return { id: items[0].id, position: 'before' };
      if (pointerY >= items[items.length - 1].hitY) return { id: items[items.length - 1].id, position: 'after' };
      for (let i = 0; i < items.length - 1; i++) {
        if (pointerY >= items[i].hitY && pointerY < items[i + 1].hitY) {
          return { id: items[i + 1].id, position: 'before' };
        }
      }
      return { id: items[0].id, position: 'before' };
    };

    const processFrame = () => {
      rafId = null;
      if (!activated) {
        const dx = latestX - startX;
        const dy = latestY - startY;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_ACTIVATION_DISTANCE) return;
        activated = true;
        crossDrag.startDrag(goal, latestX, latestY);
      }
      crossDrag.updateDrag(latestX, latestY);
      const zone = crossDrag.findDropZone(latestX, latestY);
      const nextTarget = zone === currentWidgetId ? findDropTarget(latestY) : null;
      setDragState((prev) => {
        if (
          prev &&
          prev.draggedId === goal.id &&
          prev.dropTarget?.id === nextTarget?.id &&
          prev.dropTarget?.position === nextTarget?.position
        ) {
          return prev;
        }
        return { draggedId: goal.id, dropTarget: nextTarget };
      });
    };

    const onMove = (ev: PointerEvent) => {
      latestX = ev.clientX;
      latestY = ev.clientY;
      if (rafId === null) rafId = requestAnimationFrame(processFrame);
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (!activated) {
        setDragState(null);
        return;
      }

      const payload = crossDrag.endDrag();
      const finalZone = payload ? crossDrag.findDropZone(ev.clientX, ev.clientY) : null;
      const finalDropTarget = finalZone === currentWidgetId ? findDropTarget(ev.clientY) : null;
      setDragState(null);

      if (!payload) return;

      if (finalZone && finalZone !== currentWidgetId) {
        window.dispatchEvent(new CustomEvent('cross-widget-drop', {
          detail: { goal: payload.goal, targetWidgetId: finalZone },
        }));
        return;
      }

      if (!finalDropTarget) return;
      const rest = currentGoals.filter((g) => g.id !== goal.id);
      const restTargetIdx = rest.findIndex((g) => g.id === finalDropTarget.id);
      if (restTargetIdx === -1) return;
      const insertAt = finalDropTarget.position === 'before' ? restTargetIdx : restTargetIdx + 1;
      const newOrder = [
        ...rest.slice(0, insertAt).map((g) => g.id),
        goal.id,
        ...rest.slice(insertAt).map((g) => g.id),
      ];
      reorderMutate(newOrder);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [goals, widgetId, crossDrag, reorderMutate]);

  const handleAttachCategory = useCallback(async (goal: GoalRecord, categoryId: string) => {
    await attachCategoryAsync({ goalId: goal.id, categoryId });
  }, [attachCategoryAsync]);

  const handleDetachCategory = useCallback(async (goal: GoalRecord, categoryId: string) => {
    await detachCategoryAsync({ goalId: goal.id, categoryId });
  }, [detachCategoryAsync]);

  return (
    <section
      ref={sectionRef}
      className="flex flex-col gap-4 rounded-[2.5rem] border border-white/10 bg-background/40 px-4 py-4"
    >
      <header className="flex items-center gap-2">
        <RecurringTasksManager widgetId={widgetId} />
        <button
          type="button"
          onClick={handleSort}
          disabled={goals.length < 2 || reorderGoalsMutation.isPending}
          className="inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs text-muted transition hover:text-white disabled:opacity-40"
          aria-label="Сортировать задачи"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-4 w-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 7.5h13.5M3 12h9m-9 4.5h5.25m5.25-9 3-3m0 0 3 3m-3-3v12"
            />
          </svg>
        </button>
      </header>

      {isLoading && <p className="text-sm text-muted">Загружаем задачи...</p>}
      {isError && <p className="text-sm text-rose-400">Ошибка: {error?.message ?? 'неизвестная'}</p>}

      <div className="flex flex-col gap-3">
        {goals.length === 0 && !isLoading && (
          <p className="rounded-2xl border border-dashed border-white/20 px-4 py-6 text-center text-xs text-muted">
            Добавьте первую задачу
          </p>
        )}
        {displayGoals.map((goal) => (
          <TaskCard
            key={goal.id}
            goal={goal}
            onDragStart={(e) => handleDragStart(goal, e)}
            registerRef={(el) => registerItemRef(goal.id, el)}
            isDragging={dragState?.draggedId === goal.id && dragState.dropTarget !== null}
            elapsedSeconds={goal.elapsed_seconds ?? 0}
            isEditing={editingGoal?.id === goal.id}
            editValue={editingGoal?.id === goal.id ? editingGoal.value : ''}
            onEditStart={() => setEditingGoal({ id: goal.id, value: goal.title })}
            onEditChange={(v) => setEditingGoal((prev) => prev?.id === goal.id ? { ...prev, value: v } : prev)}
            onEditCommit={async () => {
              if (!editingGoal) return;
              const trimmed = editingGoal.value.trim();
              if (trimmed && trimmed !== goal.title) await updateGoal.mutateAsync({ id: goal.id, title: trimmed });
              setEditingGoal(null);
            }}
            onEditCancel={() => setEditingGoal(null)}
            onToggleDone={() => handleToggleDone(goal)}
            onToggleLock={() => handleToggleLock(goal)}
            onDelete={() => handleDelete(goal)}
            onArchive={() => handleArchive(goal)}
            onValueChange={(v) => handleValueChange(goal, v)}
            onExpectedHoursChange={(v) => handleExpectedHoursChange(goal, v)}
            taskCategories={taskCategories}
            onAttachCategory={(catId) => handleAttachCategory(goal, catId)}
            onDetachCategory={(catId) => handleDetachCategory(goal, catId)}
            isArchiving={archiveGoal.isPending && archiveGoal.variables === goal.id}
          />
        ))}
      </div>

      <div className="flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-accent/50 bg-accent/10 px-4 py-1">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddGoal(); }}
            placeholder="Новая задача"
            className="w-[13.5rem] bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
          <button type="button" onClick={() => void handleAddGoal()} className="text-xl text-accent transition hover:text-accent/80" aria-label="Добавить задачу">+</button>
        </div>
      </div>
    </section>
  );
}
