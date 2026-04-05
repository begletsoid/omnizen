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
} from '../../features/tasks/hooks';
import { useTaskCategories } from '../../features/microTasks/hooks';
import { sortGoals } from '../../features/tasks/utils';
import { findPendingTriggers } from '../../features/tasks/cronUtils';
import type { GoalRecord } from '../../features/tasks/types';
import { TaskCard } from './components/TaskCard';
import { RecurringTasksManager } from './components/RecurringTasksManager';
import { useCrossWidgetDrag } from './CrossWidgetDragContext';

export type TasksWidgetProps = {
  widgetId: string | null;
  config?: Record<string, unknown> | null;
  onUpdateConfig?: (patch: Record<string, unknown>) => void;
};

export function TasksWidget({ widgetId }: TasksWidgetProps) {
  const { data: rawGoals = [], isLoading, isError, error } = useGoals(widgetId);
  const { data: taskCategories = [] } = useTaskCategories();

  const createGoal = useCreateGoal(widgetId);
  const updateGoal = useUpdateGoal(widgetId);
  const deleteGoal = useDeleteGoal(widgetId);
  const archiveGoal = useArchiveGoal(widgetId);
  const attachCategory = useAttachCategoryToGoal();
  const detachCategory = useDetachCategoryFromGoal();

  const { data: recurringGoals = [] } = useRecurringGoals(widgetId);
  const updateRecurringGoal = useUpdateRecurringGoal(widgetId);
  const cronCheckedRef = useRef(false);

  useEffect(() => {
    if (cronCheckedRef.current || !widgetId || recurringGoals.length === 0) return;
    cronCheckedRef.current = true;

    const pending = findPendingTriggers(recurringGoals);
    if (pending.length === 0) return;

    void (async () => {
      for (const { recurringGoal, triggerTime } of pending) {
        await createGoal.mutateAsync({
          title: recurringGoal.title,
          value: recurringGoal.value,
          expected_hours: recurringGoal.expected_hours,
          is_recurring: true,
        });
        await updateRecurringGoal.mutateAsync({
          id: recurringGoal.id,
          last_triggered_at: triggerTime.toISOString(),
        });
      }
    })();
  }, [widgetId, recurringGoals, createGoal, updateRecurringGoal]);

  const [editingGoal, setEditingGoal] = useState<{ id: string; value: string } | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const goals = useMemo(() => sortGoals(rawGoals), [rawGoals]);

  const handleAddGoal = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || !widgetId) return;
    await createGoal.mutateAsync({ title });
    setNewTitle('');
  }, [newTitle, widgetId, createGoal]);

  const handleToggleDone = useCallback(async (goal: GoalRecord) => {
    await updateGoal.mutateAsync({ id: goal.id, is_done: !goal.is_done });
  }, [updateGoal]);

  const handleToggleLock = useCallback(async (goal: GoalRecord) => {
    await updateGoal.mutateAsync({ id: goal.id, is_locked: !goal.is_locked });
  }, [updateGoal]);

  const handleValueChange = useCallback(async (goal: GoalRecord, value: number) => {
    await updateGoal.mutateAsync({ id: goal.id, value });
  }, [updateGoal]);

  const handleExpectedHoursChange = useCallback(async (goal: GoalRecord, expectedHours: number) => {
    await updateGoal.mutateAsync({ id: goal.id, expected_hours: expectedHours });
  }, [updateGoal]);

  const handleDelete = useCallback(async (goal: GoalRecord) => {
    await deleteGoal.mutateAsync(goal.id);
  }, [deleteGoal]);

  const handleArchive = useCallback(async (goal: GoalRecord) => {
    if (!goal.is_done || archiveGoal.isPending) return;
    await archiveGoal.mutateAsync(goal.id);
  }, [archiveGoal]);

  const crossDrag = useCrossWidgetDrag();
  const crossDragRef = useRef(crossDrag);
  crossDragRef.current = crossDrag;

  const handleCrossWidgetDragStart = useCallback((goal: GoalRecord, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) >= 6) {
        crossDragRef.current.startDrag(goal, ev.clientX, ev.clientY);
        window.removeEventListener('pointermove', onMove);
        const onMoveActive = (ev2: PointerEvent) => crossDragRef.current.updateDrag(ev2.clientX, ev2.clientY);
        const onUp = () => {
          const cd = crossDragRef.current;
          const payload = cd.endDrag();
          if (payload) {
            const zone = cd.findDropZone(payload.pointerX, payload.pointerY);
            if (zone) {
              window.dispatchEvent(new CustomEvent('cross-widget-drop', { detail: { goal: payload.goal, targetWidgetId: zone } }));
            }
          }
          window.removeEventListener('pointermove', onMoveActive);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMoveActive);
        window.addEventListener('pointerup', onUp);
      }
    };
    const onUpEarly = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUpEarly);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUpEarly);
  }, []);

  const handleAttachCategory = useCallback(async (goal: GoalRecord, categoryId: string) => {
    await attachCategory.mutateAsync({ goalId: goal.id, categoryId });
  }, [attachCategory]);

  const handleDetachCategory = useCallback(async (goal: GoalRecord, categoryId: string) => {
    await detachCategory.mutateAsync({ goalId: goal.id, categoryId });
  }, [detachCategory]);

  return (
    <section className="flex flex-col gap-4 rounded-[2.5rem] border border-white/10 bg-background/40 px-4 py-4">
      <header className="flex items-center gap-2">
        <RecurringTasksManager widgetId={widgetId} />
      </header>

      {isLoading && <p className="text-sm text-muted">Загружаем задачи...</p>}
      {isError && <p className="text-sm text-rose-400">Ошибка: {error?.message ?? 'неизвестная'}</p>}

      <div className="flex flex-col gap-3">
        {goals.length === 0 && !isLoading && (
          <p className="rounded-2xl border border-dashed border-white/20 px-4 py-6 text-center text-xs text-muted">
            Добавьте первую задачу
          </p>
        )}
        {goals.map((goal) => (
          <TaskCard
            key={goal.id}
            goal={goal}
            onCrossWidgetDragStart={(e) => handleCrossWidgetDragStart(goal, e)}
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
            className="w-36 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
          <button type="button" onClick={() => void handleAddGoal()} className="text-xl text-accent transition hover:text-accent/80" aria-label="Добавить задачу">+</button>
        </div>
      </div>
    </section>
  );
}
