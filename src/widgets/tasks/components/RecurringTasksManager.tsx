import { useEffect, useState } from 'react';
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useFloating,
  type ReferenceType,
} from '@floating-ui/react';

import {
  useRecurringGoals,
  useCreateRecurringGoal,
  useDeleteRecurringGoal,
  useUpdateRecurringGoal,
} from '../../../features/tasks/hooks';
import { isValidCron } from '../../../features/tasks/cronUtils';
import type { RecurringGoalRecord } from '../../../features/tasks/types';

const getReferenceElement = (ref: ReferenceType | null): Element | null => {
  if (!ref) return null;
  if (ref instanceof Element) return ref;
  return ref.contextElement ?? null;
};

type RecurringTasksManagerProps = {
  widgetId: string | null;
};

export function RecurringTasksManager({ widgetId }: RecurringTasksManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newValue, setNewValue] = useState(0);
  const [newHours, setNewHours] = useState(1);
  const [newCron, setNewCron] = useState('0 9 * * 1');

  const { data: recurringGoals = [] } = useRecurringGoals(widgetId);
  const createMutation = useCreateRecurringGoal(widgetId);
  const deleteMutation = useDeleteRecurringGoal(widgetId);
  const updateMutation = useUpdateRecurringGoal(widgetId);

  const { refs, strategy, x, y } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',
    middleware: [offset(12), flip(), shift()],
  });

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      const refEl = getReferenceElement(refs.reference.current);
      if ((refEl && refEl.contains(t)) || refs.floating.current?.contains(t)) return;
      setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, refs.reference, refs.floating]);

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await createMutation.mutateAsync({
      title,
      value: newValue,
      expected_hours: newHours,
      cron_expression: newCron,
    });
    setNewTitle('');
    setNewValue(0);
    setNewHours(1);
    setNewCron('0 9 * * 1');
  };

  const handleFieldUpdate = async (rg: RecurringGoalRecord, field: string, value: string | number) => {
    await updateMutation.mutateAsync({ id: rg.id, [field]: value });
  };

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        onClick={() => setIsOpen((p) => !p)}
        disabled={!widgetId}
        className="inline-flex w-fit items-center gap-1 rounded-full border border-white/20 px-2.5 py-1 text-xs transition hover:border-white/40 hover:text-white disabled:opacity-50"
        aria-label="Периодические задачи"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
        </svg>
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ position: strategy, top: y ?? 0, left: x ?? 0, zIndex: 1300 }}
            className="w-[26rem] rounded-2xl border border-white/10 bg-background/95 p-4 text-xs text-text shadow-2xl backdrop-blur"
          >
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted mb-3">Периодические задачи</p>

            {recurringGoals.length === 0 && (
              <p className="text-muted mb-3">Нет периодических задач</p>
            )}

            <div className="max-h-60 space-y-2 overflow-y-auto mb-3">
              {recurringGoals.map((rg) => (
                <div key={rg.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <input
                    value={rg.title}
                    onChange={(e) => handleFieldUpdate(rg, 'title', e.target.value)}
                    className="flex-1 bg-transparent text-xs text-white outline-none"
                  />
                  <input
                    type="number"
                    min={0}
                    value={rg.value}
                    onChange={(e) => handleFieldUpdate(rg, 'value', parseInt(e.target.value) || 0)}
                    className="w-10 rounded bg-white/5 px-1 py-0.5 text-center text-xs text-text outline-none"
                    title="Ценность"
                  />
                  <span className="text-muted">/</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={rg.expected_hours}
                    onChange={(e) => handleFieldUpdate(rg, 'expected_hours', parseFloat(e.target.value) || 0)}
                    className="w-10 rounded bg-white/5 px-1 py-0.5 text-center text-xs text-text outline-none"
                    title="Часы"
                  />
                  <input
                    value={rg.cron_expression}
                    onChange={(e) => handleFieldUpdate(rg, 'cron_expression', e.target.value)}
                    className={`w-24 rounded bg-white/5 px-1 py-0.5 text-center text-xs outline-none ${isValidCron(rg.cron_expression) ? 'text-text' : 'text-rose-400'}`}
                    title="Cron-выражение"
                  />
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(rg.id)}
                    className="text-muted transition hover:text-rose-400"
                    aria-label="Удалить"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Новая периодическая задача"
                className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-muted"
              />
              <input
                type="number"
                min={0}
                value={newValue}
                onChange={(e) => setNewValue(parseInt(e.target.value) || 0)}
                className="w-10 rounded bg-white/5 px-1 py-0.5 text-center text-xs text-text outline-none"
                title="Ценность"
              />
              <span className="text-muted">/</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={newHours}
                onChange={(e) => setNewHours(parseFloat(e.target.value) || 0)}
                className="w-10 rounded bg-white/5 px-1 py-0.5 text-center text-xs text-text outline-none"
                title="Часы"
              />
              <input
                value={newCron}
                onChange={(e) => setNewCron(e.target.value)}
                className={`w-24 rounded bg-white/5 px-1 py-0.5 text-center text-xs outline-none ${isValidCron(newCron) ? 'text-text' : 'text-rose-400'}`}
                title="Cron"
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!newTitle.trim() || !isValidCron(newCron)}
                className="rounded-full bg-accent/20 px-2 py-1 text-accent transition hover:bg-accent/30 disabled:opacity-50"
              >
                +
              </button>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
