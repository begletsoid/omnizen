import { useEffect, useState } from 'react';
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useFloating,
  type ReferenceType,
} from '@floating-ui/react';
import clsx from 'clsx';

import type { GoalRecord } from '../../../features/tasks/types';
import type { TaskCategory } from '../../../features/microTasks/types';
import { formatDuration } from '../../../features/microTasks/utils';
import { computeEfficiency } from '../../../features/tasks/utils';
import { getCategoryColorPreset, TAXONOMY_DROPDOWN_SELECTOR } from '../../microTasks/utils/constants';
import { TagIcon, ArchiveIcon } from '../../microTasks/components/Icons';
import { TaxonomySelect } from '../../microTasks/components/TaxonomySelect';
import { LockIcon } from './LockIcon';

const getReferenceElement = (ref: ReferenceType | null): Element | null => {
  if (!ref) return null;
  if (ref instanceof Element) return ref;
  return ref.contextElement ?? null;
};

export type TaskCardProps = {
  goal: GoalRecord;
  elapsedSeconds: number;
  isEditing: boolean;
  editValue: string;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onToggleDone: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onValueChange: (v: number) => void;
  onExpectedHoursChange: (v: number) => void;
  taskCategories: TaskCategory[];
  onAttachCategory: (categoryId: string) => Promise<void>;
  onDetachCategory: (categoryId: string) => Promise<void>;
  isArchiving: boolean;
  onCrossWidgetDragStart?: (e: React.PointerEvent) => void;
};

export function TaskCard({
  goal,
  elapsedSeconds,
  isEditing,
  editValue,
  onEditStart,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onToggleDone,
  onToggleLock,
  onDelete,
  onArchive,
  onValueChange,
  onExpectedHoursChange,
  taskCategories,
  onAttachCategory,
  onDetachCategory,
  isArchiving,
  onCrossWidgetDragStart,
}: TaskCardProps) {
  const [isCatOpen, setIsCatOpen] = useState(false);
  const { refs: catRefs, strategy: catStrategy, x: catX, y: catY } = useFloating({
    open: isCatOpen,
    onOpenChange: setIsCatOpen,
    placement: 'bottom-end',
    middleware: [offset(10), flip(), shift()],
  });

  useEffect(() => {
    if (!isCatOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      const refEl = getReferenceElement(catRefs.reference.current);
      if (
        (refEl && refEl.contains(t)) ||
        catRefs.floating.current?.contains(t) ||
        (t instanceof HTMLElement && t.closest(TAXONOMY_DROPDOWN_SELECTOR))
      ) return;
      setIsCatOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCatOpen, catRefs.reference, catRefs.floating]);

  const availableCats = taskCategories.filter(
    (c) => !goal.categories?.some((a) => a.id === c.id),
  );

  const latestColor = [...(goal.categories ?? [])].reverse().find((c) => c.color);
  const colorPreset = getCategoryColorPreset(latestColor?.color);
  const eff = computeEfficiency(goal.value, goal.expected_hours);

  return (
    <article
      onPointerDown={onCrossWidgetDragStart}
      className={clsx(
        'group flex items-center gap-3 rounded-3xl px-4 py-3 text-sm text-text touch-none',
        goal.is_recurring && !goal.is_done && 'ring-1 ring-rose-500/40',
        colorPreset.cardClass,
      )}
    >
      <LockIcon locked={goal.is_locked} onToggle={onToggleLock} />

      <button
        type="button"
        onClick={onToggleDone}
        className={clsx(
          'flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem]',
          goal.is_done
            ? 'border-emerald-400 bg-emerald-400/20 text-emerald-200'
            : 'border-white/30',
        )}
        aria-label={goal.is_done ? 'Вернуть в активные' : 'Отметить как выполненную'}
      >
        {goal.is_done ? '✓' : ''}
      </button>

      {isEditing ? (
        <textarea
          style={{ maxWidth: 450 }}
          value={editValue}
          rows={1}
          onChange={(e) => onEditChange(e.target.value)}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onBlur={onEditCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEditCommit();
            if (e.key === 'Escape') onEditCancel();
          }}
          autoFocus
          className="flex-1 rounded-2xl bg-white/80 px-3 py-1 text-black outline-none resize-none"
        />
      ) : (
        <button
          type="button"
          className={clsx(
            'flex-1 max-w-[450px] cursor-text select-none whitespace-normal break-words text-left',
            goal.is_done ? 'text-muted line-through' : 'text-text',
          )}
          onClick={onEditStart}
        >
          {goal.title}
        </button>
      )}

      <span className="w-20 text-center font-mono text-sm text-muted tabular-nums">
        {formatDuration(elapsedSeconds)}
      </span>

      <div className="flex items-center gap-1 text-xs">
        <span className="text-[0.6rem] text-muted">💰</span>
        <input
          type="number"
          min={0}
          value={goal.value}
          onChange={(e) => onValueChange(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-10 rounded bg-white/5 px-1 py-0.5 text-center text-xs text-text outline-none focus:bg-white/10 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-muted">/</span>
        <span className="text-[0.6rem] text-muted">🕐</span>
        <input
          type="number"
          min={0}
          step={0.5}
          value={goal.expected_hours}
          onChange={(e) => onExpectedHoursChange(Math.max(0, parseFloat(e.target.value) || 0))}
          className="w-10 rounded bg-white/5 px-1 py-0.5 text-center text-xs text-text outline-none focus:bg-white/10 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-muted">=</span>
        <span className="w-8 text-center font-semibold text-white/70">{eff}</span>
      </div>

      <button
        type="button"
        ref={catRefs.setReference}
        onClick={() => setIsCatOpen((p) => !p)}
        className={clsx(
          'flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs ring-1 ring-white/20 transition',
          colorPreset.iconClass,
        )}
        aria-label="Категории задачи"
      >
        <TagIcon className="h-3.5 w-3.5" />
      </button>

      {isCatOpen && (
        <FloatingPortal>
          <div
            ref={catRefs.setFloating}
            style={{ position: catStrategy, top: catY ?? 0, left: catX ?? 0, zIndex: 1200 }}
            data-testid="goal-category-popover"
            className="w-64 rounded-2xl border border-white/10 bg-background/95 p-3 text-xs text-text shadow-xl backdrop-blur"
          >
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted">Категории задачи</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {goal.categories?.length ? (
                goal.categories.map((cat) => {
                  const preset = getCategoryColorPreset(cat.color);
                  return (
                    <span key={cat.id} className={clsx('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs', preset.chipClass)}>
                      {cat.name}
                      <button type="button" onClick={() => { void onDetachCategory(cat.id); }} className="text-white/80 transition hover:text-rose-300" aria-label={`Удалить категорию ${cat.name}`}>✕</button>
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
                options={availableCats.map((c) => ({ value: c.id, label: c.name }))}
                disabled={availableCats.length === 0}
                className="w-full"
                enableSearch
                onSelectOption={(opt) => { void onAttachCategory(opt.value); }}
              />
            </div>
          </div>
        </FloatingPortal>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={onDelete} className="text-xs text-muted transition hover:text-rose-300" aria-label="Удалить задачу">✕</button>
        <button
          type="button"
          onClick={onArchive}
          disabled={!goal.is_done || isArchiving}
          className={clsx(
            'rounded-full border px-3 py-1 text-xs transition',
            goal.is_done
              ? 'border-emerald-400/40 text-emerald-200 hover:border-emerald-300 hover:text-emerald-100'
              : 'border-white/10 text-muted opacity-60',
            isArchiving && 'opacity-60',
          )}
          aria-label="Архивировать задачу"
        >
          <ArchiveIcon />
        </button>
      </div>
    </article>
  );
}
