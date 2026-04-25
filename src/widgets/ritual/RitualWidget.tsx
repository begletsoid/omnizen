import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

/**
 * Always re-measure droppable rects. Default `WhileDragging` caches rects at
 * dragStart and never updates — but since we commit reorders live inside
 * onDragOver, the positions change mid-drag and dnd-kit needs to see them.
 */
const SORTABLE_MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always },
} as const;
import { CSS } from '@dnd-kit/utilities';
import { nanoid } from 'nanoid';
import clsx from 'clsx';

import {
  RITUAL_MAX_SETS,
  type RitualAnswer,
  type RitualConfig,
  type RitualSet,
  type RitualState,
  type RitualStep,
  type RitualStepType,
  type TrioValue,
} from '../../features/ritual/types';
import { getSetState, getTodayKey, normaliseRitualState } from '../../features/ritual/utils';
import { ConfirmDeleteButton } from '../../components/ConfirmDeleteButton';

type RitualWidgetProps = {
  widgetId: string | null;
  config?: Record<string, unknown> | null;
  onUpdateConfig?: (patch: Record<string, unknown>) => void;
};

const STEP_TYPE_LABELS: Record<RitualStepType, string> = {
  reminder: 'Напоминание',
  scale: 'Шкала 0–10',
  trio: 'Да / ~ / Нет',
};

/**
 * Drop animation disabled (`dropAnimation={null}`) on both overlays — see
 * dnd-kit issues #833 and #743. With DragOverlay + useSortable the overlay
 * reads its animation target rect from dnd-kit's OWN droppable cache, not
 * the DOM, and that cache was populated at drag start with the OLD index.
 * Result: the ghost flies to the old slot, then the sortable CSS transition
 * slides the item to the new slot — reads as a jump on release. flushSync
 * does NOT help here (confirmed). Letting the sortable transition handle
 * the final settle is smoother than trying to animate the overlay.
 */

const TRIO_OPTIONS: Array<{ value: TrioValue; label: string }> = [
  { value: 'yes', label: 'Да' },
  { value: 'mid', label: '~' },
  { value: 'no', label: 'Нет' },
];

function readConfig(config: Record<string, unknown> | null | undefined): RitualConfig {
  return (config ?? {}) as RitualConfig;
}

function makeStep(type: RitualStepType = 'reminder'): RitualStep {
  return { id: nanoid(), type, prompt: '' };
}

function makeSet(name: string): RitualSet {
  return { id: nanoid(), name, steps: [] };
}

export function RitualWidget({ config, onUpdateConfig }: RitualWidgetProps) {
  const cfg = readConfig(config);
  const sets = useMemo(() => cfg.sets ?? [], [cfg.sets]);
  const storedState = cfg.state;
  const collapsed = Boolean(cfg.collapsed);
  const today = getTodayKey();

  const state = useMemo(
    () => normaliseRitualState(storedState, sets, today),
    [storedState, sets, today],
  );

  // If normaliseRitualState adjusted the stored state (new day, or invalid
  // active set), persist the cleaned version so refreshing doesn't reshuffle.
  const persistedRef = useRef<string>('');
  useEffect(() => {
    const signature = `${state.dayKey}:${state.activeSetId}:${Object.keys(state.answers).length}`;
    if (persistedRef.current === signature) return;
    persistedRef.current = signature;
    if (!storedState || storedState.dayKey !== state.dayKey || storedState.activeSetId !== state.activeSetId) {
      onUpdateConfig?.({ state });
    }
  }, [state, storedState, onUpdateConfig]);

  const updateConfig = useCallback(
    (patch: Partial<RitualConfig>) => {
      onUpdateConfig?.(patch as Record<string, unknown>);
    },
    [onUpdateConfig],
  );

  const updateSets = useCallback(
    (next: RitualSet[]) => {
      updateConfig({ sets: next });
    },
    [updateConfig],
  );

  const updateState = useCallback(
    (next: RitualState) => {
      updateConfig({ state: next });
    },
    [updateConfig],
  );

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const activeSet = sets.find((s) => s.id === state.activeSetId) ?? sets[0] ?? null;
  const activeSetState = activeSet ? getSetState(state, activeSet.id) : null;
  const currentIndex = activeSetState?.stepIndex ?? 0;
  const currentStep = activeSet?.steps[currentIndex] ?? null;
  const isDone = activeSet ? currentIndex >= activeSet.steps.length && activeSet.steps.length > 0 : false;
  const progress =
    activeSet && activeSet.steps.length > 0
      ? Math.min(1, currentIndex / activeSet.steps.length)
      : 0;

  const [editMode, setEditMode] = useState(false);

  // Navigation
  const switchSet = useCallback(
    (setId: string) => {
      updateState({ ...state, activeSetId: setId });
    },
    [state, updateState],
  );

  const goNext = useCallback(() => {
    if (!activeSet) return;
    const cur = getSetState(state, activeSet.id);
    const next = Math.min(activeSet.steps.length, cur.stepIndex + 1);
    updateState({
      ...state,
      answers: { ...state.answers, [activeSet.id]: { ...cur, stepIndex: next } },
    });
  }, [activeSet, state, updateState]);

  const goBack = useCallback(() => {
    if (!activeSet) return;
    const cur = getSetState(state, activeSet.id);
    const next = Math.max(0, cur.stepIndex - 1);
    updateState({
      ...state,
      answers: { ...state.answers, [activeSet.id]: { ...cur, stepIndex: next } },
    });
  }, [activeSet, state, updateState]);

  const restart = useCallback(() => {
    if (!activeSet) return;
    updateState({
      ...state,
      answers: { ...state.answers, [activeSet.id]: { stepIndex: 0, values: {} } },
    });
  }, [activeSet, state, updateState]);

  const setAnswer = useCallback(
    (value: RitualAnswer) => {
      if (!activeSet || !currentStep) return;
      const cur = getSetState(state, activeSet.id);
      updateState({
        ...state,
        answers: {
          ...state.answers,
          [activeSet.id]: { ...cur, values: { ...cur.values, [currentStep.id]: value } },
        },
      });
    },
    [activeSet, currentStep, state, updateState],
  );

  // Set/step management (edit mode)
  const addSet = useCallback(() => {
    if (sets.length >= RITUAL_MAX_SETS) return;
    const newSet = makeSet(`Сет ${sets.length + 1}`);
    updateSets([...sets, newSet]);
    updateState({ ...state, activeSetId: newSet.id });
  }, [sets, state, updateSets, updateState]);

  const renameSet = useCallback(
    (setId: string, name: string) => {
      updateSets(sets.map((s) => (s.id === setId ? { ...s, name } : s)));
    },
    [sets, updateSets],
  );

  const removeSet = useCallback(
    (setId: string) => {
      const remaining = sets.filter((s) => s.id !== setId);
      updateSets(remaining);
      if (state.activeSetId === setId) {
        updateState({ ...state, activeSetId: remaining[0]?.id ?? null });
      }
    },
    [sets, state, updateSets, updateState],
  );

  const replaceSteps = useCallback(
    (next: RitualStep[]) => {
      if (!activeSet) return;
      updateSets(sets.map((s) => (s.id === activeSet.id ? { ...s, steps: next } : s)));
    },
    [activeSet, sets, updateSets],
  );

  const addStep = useCallback(() => {
    if (!activeSet) return;
    replaceSteps([...activeSet.steps, makeStep('reminder')]);
  }, [activeSet, replaceSteps]);

  const updateStep = useCallback(
    (stepId: string, patch: Partial<RitualStep>) => {
      if (!activeSet) return;
      replaceSteps(activeSet.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
    },
    [activeSet, replaceSteps],
  );

  const removeStep = useCallback(
    (stepId: string) => {
      if (!activeSet) return;
      replaceSteps(activeSet.steps.filter((s) => s.id !== stepId));
    },
    [activeSet, replaceSteps],
  );

  // Commit-during-drag: reorder a LOCAL copy inside onDragOver so the UI is
  // always in its final layout by the time the user releases. Sync from the
  // prop only when the PROP changes — never when draggingSetId changes.
  // If we synced on draggingSetId too, there's a one-frame window at drop
  // where the prop is still stale (server cache hasn't propagated yet) and
  // draggingSetId is already null, so the sync clobbers localSets back to
  // the old order for a single render. That's the "flash to old position"
  // users report. Keep draggingSetId in a ref to read inside the effect
  // without adding it to deps.
  const [localSets, setLocalSets] = useState<RitualSet[]>(sets);
  const [draggingSetId, setDraggingSetId] = useState<string | null>(null);
  const draggingSetIdRef = useRef<string | null>(null);
  useEffect(() => {
    draggingSetIdRef.current = draggingSetId;
  }, [draggingSetId]);

  useEffect(() => {
    if (draggingSetIdRef.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalSets(sets);
  }, [sets]);

  const handleSetDragStart = useCallback((event: DragStartEvent) => {
    setDraggingSetId(String(event.active.id));
  }, []);
  const handleSetDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocalSets((current) => {
      const fromIdx = current.findIndex((s) => s.id === active.id);
      const toIdx = current.findIndex((s) => s.id === over.id);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return current;
      return arrayMove(current, fromIdx, toIdx);
    });
  }, []);
  const handleSetDragEnd = useCallback(() => {
    // Persist whatever order we ended up with locally. If nothing changed,
    // updateSets is effectively a no-op via cache equality.
    setLocalSets((current) => {
      const sameOrder =
        current.length === sets.length &&
        current.every((s, i) => s.id === sets[i]?.id);
      if (!sameOrder) updateSets(current);
      return current;
    });
    setDraggingSetId(null);
  }, [sets, updateSets]);
  const handleSetDragCancel = useCallback(() => {
    // User aborted — revert local to server truth.
    setLocalSets(sets);
    setDraggingSetId(null);
  }, [sets]);
  const draggingSet = draggingSetId ? localSets.find((s) => s.id === draggingSetId) ?? null : null;

  // Bootstrap: if there are no sets at all, create a default one on first edit entry.
  const handleToggleEdit = useCallback(() => {
    if (!editMode && sets.length === 0) {
      const initial = makeSet('Утро');
      updateSets([initial]);
      updateState({ ...state, activeSetId: initial.id });
    }
    setEditMode((prev) => !prev);
  }, [editMode, sets.length, state, updateSets, updateState]);

  const toggleCollapsed = useCallback(() => {
    updateConfig({ collapsed: !collapsed });
  }, [collapsed, updateConfig]);

  // "Today the ritual is still pending" — true when at least one set has any
  // steps defined and no set has been walked through to completion yet today.
  // Used to highlight the collapsed card so the user sees a visual nudge on
  // each new ritual day (day rolls over at 4:30 AM, see getTodayKey).
  const hasAnyRitualContent = useMemo(
    () => sets.some((s) => s.steps.length > 0),
    [sets],
  );
  const hasAnyCompletionToday = useMemo(() => {
    if (state.dayKey !== today) return false;
    return sets.some((set) => {
      if (set.steps.length === 0) return false;
      const st = state.answers[set.id];
      return Boolean(st && st.stepIndex >= set.steps.length);
    });
  }, [state.dayKey, state.answers, sets, today]);
  const showCollapsedReminder =
    collapsed && hasAnyRitualContent && !hasAnyCompletionToday;

  return (
    <section
      className={clsx(
        'flex w-[24rem] max-w-full flex-col gap-3 rounded-[2.5rem] border bg-background/40 px-4 py-4 transition',
        collapsed ? 'h-auto' : 'h-[24rem]',
        showCollapsedReminder
          ? 'border-emerald-400/60 shadow-[0_0_24px_-6px_rgba(16,185,129,0.55)] ring-1 ring-emerald-400/40'
          : 'border-white/10',
      )}
    >
      <header className="flex items-center gap-2">
        {collapsed ? (
          showCollapsedReminder ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-emerald-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
              Сегодня
            </span>
          ) : null
        ) : (
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            measuring={SORTABLE_MEASURING}
            onDragStart={handleSetDragStart}
            onDragOver={handleSetDragOver}
            onDragEnd={handleSetDragEnd}
            onDragCancel={handleSetDragCancel}
          >
            <SetTabs
              sets={localSets}
              activeSetId={activeSet?.id ?? null}
              editMode={editMode}
              onSwitch={switchSet}
              onRename={renameSet}
              onRemove={removeSet}
              onAdd={addSet}
            />
            <DragOverlay dropAnimation={null}>
              {draggingSet ? (
                <SetTabChip set={draggingSet} active={draggingSet.id === activeSet?.id} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
        {!collapsed && (
          <button
            type="button"
            onClick={handleToggleEdit}
            aria-pressed={editMode}
            aria-label={editMode ? 'Выйти из режима редактирования' : 'Редактировать'}
            className={clsx(
              'ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition',
              editMode
                ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-100'
                : 'border-white/20 text-muted hover:text-text',
            )}
          >
            {editMode ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
                aria-hidden
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
                aria-hidden
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Развернуть' : 'Свернуть'}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
          className={clsx(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition hover:text-text',
            collapsed ? 'ml-auto' : '',
            showCollapsedReminder
              ? 'border-emerald-400/50 text-emerald-200 hover:border-emerald-300/70'
              : 'border-white/20 text-muted hover:border-white/40',
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={clsx('h-3 w-3 transition-transform', collapsed && '-rotate-180')}
            aria-hidden
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      </header>

      {!collapsed && !editMode && activeSet && activeSet.steps.length > 0 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className={clsx('h-full rounded-full bg-emerald-400 transition-[width] duration-200', isDone && 'bg-emerald-300')}
            style={{ width: `${(isDone ? 1 : progress) * 100}%` }}
          />
        </div>
      )}

      {!collapsed && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {editMode ? (
            <EditView
              activeSet={activeSet}
              onAddStep={addStep}
              onUpdateStep={updateStep}
              onRemoveStep={removeStep}
              onReplaceSteps={replaceSteps}
            />
          ) : sets.length === 0 ? (
            <EmptyState onEdit={handleToggleEdit} />
          ) : !activeSet || activeSet.steps.length === 0 ? (
            <p className="m-auto text-center text-sm text-muted">
              В этом сете пока нет шагов. Нажмите ✏️, чтобы добавить.
            </p>
          ) : isDone ? (
            <DoneView onRestart={restart} />
          ) : currentStep ? (
            <StepView
              step={currentStep}
              value={activeSetState?.values[currentStep.id]}
              onChange={setAnswer}
              onBack={currentIndex > 0 ? goBack : undefined}
              onNext={goNext}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

function SetTabs({
  sets,
  activeSetId,
  editMode,
  onSwitch,
  onRename,
  onRemove,
  onAdd,
}: {
  sets: RitualSet[];
  activeSetId: string | null;
  editMode: boolean;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
      <SortableContext items={sets.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
        {sets.map((s) => (
          <SetTab
            key={s.id}
            set={s}
            active={s.id === activeSetId}
            editMode={editMode}
            onSwitch={() => onSwitch(s.id)}
            onRename={(name) => onRename(s.id, name)}
            onRemove={() => onRemove(s.id)}
          />
        ))}
      </SortableContext>
      {editMode && sets.length < RITUAL_MAX_SETS && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded-full border border-dashed border-white/20 px-2 py-0.5 text-xs text-muted transition hover:border-white/40 hover:text-text"
          aria-label="Добавить сет"
        >
          +
        </button>
      )}
    </div>
  );
}

/**
 * Static tab chip rendered inside DragOverlay so the floating ghost keeps its
 * natural size while the pointer moves (no stretch to match hover target).
 */
function SetTabChip({ set, active }: { set: RitualSet; active: boolean }) {
  return (
    <div
      className={clsx(
        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-xl',
        active
          ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100'
          : 'border-white/10 bg-background/95 text-muted',
      )}
    >
      <span className="max-w-[8rem] truncate">{set.name}</span>
    </div>
  );
}

function SetTab({
  set,
  active,
  editMode,
  onSwitch,
  onRename,
  onRemove,
}: {
  set: RitualSet;
  active: boolean;
  editMode: boolean;
  onSwitch: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(set.name);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!editing) setDraft(set.name);
  }, [editing, set.name]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== set.name) onRename(trimmed);
    setEditing(false);
  };

  const handleTabClick = () => {
    // Active tab → rename; inactive tab → switch. Never both.
    if (editMode && active) {
      setEditing(true);
    } else if (!active) {
      onSwitch();
    }
  };

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: set.id,
    disabled: !editMode || editing,
  });
  // Original reserves its slot but is invisible during drag — the DragOverlay
  // renders SetTabChip as the floating ghost (fixed shape, no stretch).
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={clsx(
        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition',
        editMode && !editing && 'cursor-grab',
        active
          ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100'
          : 'border-white/10 text-muted hover:text-text',
      )}
    >
      {editing ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(set.name);
              setEditing(false);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          autoFocus
          className="w-20 bg-transparent outline-none"
        />
      ) : (
        <button type="button" onClick={handleTabClick} className="max-w-[8rem] truncate">
          {set.name}
        </button>
      )}
      {editMode && !editing && (
        <ConfirmDeleteButton onConfirm={onRemove} label={`Удалить сет ${set.name}`} />
      )}
    </div>
  );
}

function EmptyState({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="m-auto flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-muted">
        Нет сетов. Создайте первый сет вопросов/напоминаний — например, утренний ритуал.
      </p>
      <button
        type="button"
        onClick={onEdit}
        className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-100 hover:border-emerald-300"
      >
        Создать
      </button>
    </div>
  );
}

function DoneView({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="m-auto flex flex-col items-center gap-3">
      <div className="text-5xl text-emerald-400" aria-hidden>
        ✓
      </div>
      <p className="text-sm text-muted">Готово на сегодня.</p>
      <button
        type="button"
        onClick={onRestart}
        aria-label="Пройти заново"
        title="Пройти заново"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-muted transition hover:border-white/40 hover:text-text"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <polyline points="3 4 3 11 10 11" />
        </svg>
      </button>
    </div>
  );
}

function StepView({
  step,
  value,
  onChange,
  onBack,
  onNext,
}: {
  step: RitualStep;
  value: RitualAnswer | undefined;
  onChange: (value: RitualAnswer) => void;
  onBack: (() => void) | undefined;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-between gap-3 py-2">
      {/* Prompt area: fixed vertical slot so different-length prompts don't shift
          the page. Truncates to 5 lines with an ellipsis if it doesn't fit. */}
      <div className="flex min-h-[7rem] flex-1 items-center justify-center">
        <p className="line-clamp-5 whitespace-pre-wrap text-center text-lg leading-relaxed text-text">
          {step.prompt || '—'}
        </p>
      </div>
      {/* Input area: also fixed slot so scale/trio/reminder widget heights agree. */}
      <div className="flex min-h-[5rem] items-center justify-center">
        {step.type === 'scale' && <ScaleInput value={typeof value === 'number' ? value : 5} onChange={onChange} />}
        {step.type === 'trio' && <TrioInput value={value as TrioValue | undefined} onChange={onChange} />}
      </div>
      <Nav onBack={onBack} onNext={onNext} />
    </div>
  );
}

function ScaleInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <div className="text-center text-4xl font-semibold tabular-nums text-text">
        {value.toFixed(1).replace('.', ',')}
      </div>
      <input
        type="range"
        min={0}
        max={10}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-400"
        aria-label="Оценка от 0 до 10"
      />
      <div className="flex justify-between text-[0.65rem] text-muted">
        <span>0</span>
        <span>5</span>
        <span>10</span>
      </div>
    </div>
  );
}

function TrioInput({
  value,
  onChange,
}: {
  value: TrioValue | undefined;
  onChange: (v: TrioValue) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {TRIO_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            className={clsx(
              'rounded-full border px-4 py-1.5 text-sm transition',
              selected
                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                : 'border-white/20 text-muted hover:border-white/40 hover:text-text',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Nav({ onBack, onNext }: { onBack?: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={onBack}
        disabled={!onBack}
        aria-label="Назад"
        className={clsx(
          'flex h-7 w-7 items-center justify-center rounded-full border text-xs transition',
          onBack ? 'border-white/20 text-muted hover:text-text' : 'border-white/5 text-muted/30 cursor-not-allowed',
        )}
      >
        ←
      </button>
      <button
        type="button"
        onClick={onNext}
        className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-100 transition hover:border-emerald-300"
      >
        ✓ Далее
      </button>
    </div>
  );
}

function EditView({
  activeSet,
  onAddStep,
  onUpdateStep,
  onRemoveStep,
  onReplaceSteps,
}: {
  activeSet: RitualSet | null;
  onAddStep: () => void;
  onUpdateStep: (id: string, patch: Partial<RitualStep>) => void;
  onRemoveStep: (id: string) => void;
  onReplaceSteps: (next: RitualStep[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const steps = useMemo(() => activeSet?.steps ?? [], [activeSet?.steps]);

  // Commit-during-drag: same pattern as the sets in RitualWidget above.
  // Critical: sync from the prop ONLY when the prop changes. Reading
  // draggingId through a ref avoids the one-frame clobber at drop time
  // when draggingId flips to null before React Query propagates the new
  // steps into props — a useEffect depending on draggingId would fire in
  // that gap and reset localSteps to the stale old order, which is what
  // users saw as "jumps back to original position".
  const [localSteps, setLocalSteps] = useState<RitualStep[]>(steps);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  useEffect(() => {
    draggingIdRef.current = draggingId;
  }, [draggingId]);

  useEffect(() => {
    if (draggingIdRef.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalSteps(steps);
  }, [steps]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  }, []);
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocalSteps((current) => {
      const fromIdx = current.findIndex((s) => s.id === active.id);
      const toIdx = current.findIndex((s) => s.id === over.id);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return current;
      return arrayMove(current, fromIdx, toIdx);
    });
  }, []);
  const handleDragEnd = useCallback(() => {
    setLocalSteps((current) => {
      const sameOrder =
        current.length === steps.length &&
        current.every((s, i) => s.id === steps[i]?.id);
      if (!sameOrder) onReplaceSteps(current);
      return current;
    });
    setDraggingId(null);
  }, [steps, onReplaceSteps]);
  const handleDragCancel = useCallback(() => {
    setLocalSteps(steps);
    setDraggingId(null);
  }, [steps]);
  const draggingStep = draggingId
    ? localSteps.find((s) => s.id === draggingId) ?? null
    : null;

  if (!activeSet) {
    return <p className="m-auto text-sm text-muted">Создайте сет выше, чтобы добавлять шаги.</p>;
  }

  return (
    <div className="flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
      {localSteps.length === 0 && (
        <p className="py-4 text-center text-xs text-muted">Добавьте первый шаг.</p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        measuring={SORTABLE_MEASURING}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={localSteps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {localSteps.map((step) => (
            <StepEditRow
              key={step.id}
              step={step}
              onUpdate={(patch) => onUpdateStep(step.id, patch)}
              onRemove={() => onRemoveStep(step.id)}
            />
          ))}
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {draggingStep ? <StepGhost step={draggingStep} /> : null}
        </DragOverlay>
      </DndContext>
      <button
        type="button"
        onClick={onAddStep}
        className="mt-1 rounded-xl border border-dashed border-white/20 py-1.5 text-xs text-muted transition hover:border-white/40 hover:text-text"
      >
        + шаг
      </button>
    </div>
  );
}

/**
 * Fixed-shape ghost rendered by DragOverlay so dragging a short row over a
 * tall row (or vice versa) doesn't stretch the preview to match the hover
 * slot. Mirrors the row layout but with a single-line truncated prompt.
 */
function StepGhost({ step }: { step: RitualStep }) {
  return (
    <div className="grid w-full grid-cols-[8.5rem_1fr_1rem] items-center gap-2 rounded-xl border border-white/30 bg-background/95 px-2 py-1.5 text-xs text-text opacity-95 shadow-2xl">
      <span className="truncate rounded-md bg-white/5 px-2 py-1 text-[0.7rem] text-muted">
        {STEP_TYPE_LABELS[step.type]}
      </span>
      <span className="truncate px-2">{step.prompt || '—'}</span>
      <span />
    </div>
  );
}

function StepTypeDropdown({
  value,
  onChange,
}: {
  value: RitualStepType;
  onChange: (type: RitualStepType) => void;
}) {
  const [open, setOpen] = useState(false);
  // stopPropagation on pointerdown prevents the outer row's drag sensor from
  // treating a click on this dropdown as a drag start.
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="relative w-fit">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onPointerDown={stopDrag}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Тип шага"
        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[0.7rem] text-text transition hover:border-white/30"
      >
        <span>{STEP_TYPE_LABELS[value]}</span>
        <span aria-hidden className="text-muted">▾</span>
      </button>
      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul
            role="menu"
            onPointerDown={stopDrag}
            className="absolute left-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-xl border border-white/10 bg-background/95 p-1 text-xs text-text shadow-2xl backdrop-blur"
          >
            {(Object.entries(STEP_TYPE_LABELS) as Array<[RitualStepType, string]>).map(([key, label]) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                  onPointerDown={stopDrag}
                  className={clsx(
                    'flex w-full items-center rounded-lg px-2 py-1 text-left transition hover:bg-white/10',
                    key === value && 'bg-emerald-500/15 text-emerald-100',
                  )}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StepEditRow({
  step,
  onUpdate,
  onRemove,
}: {
  step: RitualStep;
  onUpdate: (patch: Partial<RitualStep>) => void;
  onRemove: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [step.prompt, resizeTextarea]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });
  // DragOverlay renders StepGhost as the floating preview. The original row
  // reserves its natural height (so the slot doesn't collapse) but is
  // invisible during drag — otherwise a tall textarea row visible through a
  // short target creates the "stretched preview" artefact.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  const stopDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={clsx(
        'grid cursor-grab grid-cols-[8.5rem_1fr_1rem] items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-text',
      )}
    >
      <StepTypeDropdown value={step.type} onChange={(type) => onUpdate({ type })} />
      <textarea
        ref={textareaRef}
        value={step.prompt}
        onChange={(e) => onUpdate({ prompt: e.target.value })}
        onInput={resizeTextarea}
        onPointerDown={stopDrag}
        placeholder="Вопрос или напоминание"
        rows={1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-form-type="other"
        data-lpignore="true"
        data-1p-ignore="true"
        className="min-h-[1.75rem] min-w-0 cursor-text resize-none overflow-hidden rounded-md bg-white/5 px-2 py-1 text-xs text-text outline-none placeholder:text-muted focus:bg-white/10"
      />
      <button
        type="button"
        onClick={onRemove}
        onPointerDown={stopDrag}
        aria-label="Удалить шаг"
        className="mt-0.5 flex h-5 w-5 cursor-pointer items-center justify-center text-muted transition hover:text-rose-300"
      >
        ✕
      </button>
    </div>
  );
}
