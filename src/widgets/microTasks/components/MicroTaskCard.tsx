import { useEffect, useRef, useState, type Ref } from 'react';
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useFloating,
  type ReferenceType,
} from '@floating-ui/react';
import clsx from 'clsx';

import type { MicroTaskRecord, TaskCategory } from '../../../features/microTasks/types';
import { formatDuration } from '../../../features/microTasks/utils';
import { getCategoryColorPreset, TAXONOMY_DROPDOWN_SELECTOR } from '../utils/constants';
import { TagIcon, ArchiveIcon } from './Icons';
import { TaxonomySelect } from './TaxonomySelect';

const getReferenceElement = (reference: ReferenceType | null): Element | null => {
  if (!reference) return null;
  if (reference instanceof Element) return reference;
  return reference.contextElement ?? null;
};

const referenceContainsNode = (reference: ReferenceType | null, target: Node): boolean => {
  const element = getReferenceElement(reference);
  return element ? element.contains(target) : false;
};

export type MicroTaskCardProps = {
  task: MicroTaskRecord;
  seconds: number;
  isRunning: boolean;
  dataTaskId?: string;
  isDragging?: boolean;
  isOverlay?: boolean;
  cardRef?: Ref<HTMLElement>;
  onPointerDown?: (e: React.PointerEvent) => void;
  onToggleTimer: () => void;
  onToggleDone: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onTimeClick: () => void;
  /**
   * Pointer-down on the timer button. Provided when the parent runs the
   * time-transfer drag mechanic — it arms a press that may either turn into
   * a transfer drag (>6px movement) or fall through to onTimeClick.
   */
  onTimerPointerDown?: (e: React.PointerEvent) => void;
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
  /**
   * Called once after the auto-assigned categories intro is shown for this
   * task — either when the 2-second timer expires, or when the user removes
   * all chips during the preview. Parent persists the timestamp so other
   * devices don't replay the preview.
   */
  onAcknowledgeIntroduction?: () => void;
  isArchiving: boolean;
  isEditingTime: boolean;
  timeDraft: string;
  isTimeInvalid: boolean;
  isTimeSaving: boolean;
  /**
   * Override for the timer label, used during a time-transfer drag to show
   * the source's "live preview" minus the dragged minutes. Falls back to the
   * formatted `seconds` when undefined.
   */
  timeLabelOverride?: string;
  /** Currently the source of an in-flight transfer drag — gets a tinted timer. */
  isTransferSource?: boolean;
  /** Currently the hovered drop target during a transfer drag. */
  isTransferTarget?: boolean;
};

export function MicroTaskCard({
  task,
  seconds,
  isRunning,
  dataTaskId,
  isDragging = false,
  isOverlay = false,
  cardRef,
  onPointerDown,
  onToggleTimer,
  onToggleDone,
  onDelete,
  onArchive,
  onTimeClick,
  onTimerPointerDown,
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
  onAcknowledgeIntroduction,
  isArchiving,
  isEditingTime,
  timeDraft,
  isTimeInvalid,
  isTimeSaving,
  timeLabelOverride,
  isTransferSource = false,
  isTransferTarget = false,
}: MicroTaskCardProps) {
  const timeLabel = timeLabelOverride ?? formatDuration(seconds);
  const [isCategoriesPopoverOpen, setIsCategoriesPopoverOpen] = useState(false);
  const {
    refs: categoryRefs,
    strategy,
    x,
    y,
  } = useFloating({
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
        (target instanceof HTMLElement &&
          target.closest(TAXONOMY_DROPDOWN_SELECTOR))
      ) {
        return;
      }
      setIsCategoriesPopoverOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCategoriesPopoverOpen, categoryRefs.reference, categoryRefs.floating]);

  const availableCategories = taskCategories.filter(
    (category) =>
      !category.archived_at &&
      !task.categories?.some((attached) => attached.id === category.id),
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter') onEditCommit();
    else if (event.key === 'Escape') onEditCancel();
  };

  const latestColoredCategory = [...(task.categories ?? [])]
    .reverse()
    .find((category) => category.color);
  const colorPreset = getCategoryColorPreset(latestColoredCategory?.color);

  // "Auto-assigned categories" intro: when a task lands in the UI with
  // categories the user didn't pick (LLM/buffer-driven), overlay a chip
  // preview on top of the right-hand controls for ~1.5s so they can see
  // what got attached — and ✕ the wrong ones inline. The controls stay
  // mounted underneath (opacity:0) so they reserve their natural width
  // and the play/pause button to the left never shifts.
  //
  // Why the ref: `onAcknowledgeIntroduction` is a fresh inline lambda from
  // MicroTasksWidget on every parent re-render (the running timer ticks
  // each second). If we depended on it in the effect, the cleanup would
  // tear down the setTimeout before the 1.5s wall, and the chips would
  // stay visible forever. Storing it in a ref lets us call the latest
  // function from inside the timer without re-running the effect.
  const INTRO_DURATION_MS = 1500;
  const [hasAckedLocal, setHasAckedLocal] = useState(false);
  const introCategories = task.categories ?? [];
  const needsIntro =
    !task.categories_introduced_at &&
    !task.id.startsWith('temp-') &&
    introCategories.length > 0;
  const showIntro = needsIntro && !hasAckedLocal;

  const onAcknowledgeIntroductionRef = useRef(onAcknowledgeIntroduction);
  useEffect(() => {
    onAcknowledgeIntroductionRef.current = onAcknowledgeIntroduction;
  });

  useEffect(() => {
    if (!showIntro) return;
    const timer = window.setTimeout(() => {
      setHasAckedLocal(true);
      onAcknowledgeIntroductionRef.current?.();
    }, INTRO_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [showIntro]);

  const handleIntroChipDetach = async (categoryId: string) => {
    const wasLast = introCategories.length <= 1;
    try {
      await onDetachCategory(categoryId);
    } finally {
      if (wasLast) {
        setHasAckedLocal(true);
        onAcknowledgeIntroductionRef.current?.();
        // Open the editor so the user can pick a different category
        // immediately instead of hunting for the tag button.
        setIsCategoriesPopoverOpen(true);
      }
    }
  };

  return (
    <article
      ref={cardRef}
      {...(dataTaskId ? { 'data-task-id': dataTaskId } : {})}
      onPointerDown={onPointerDown}
      className={clsx(
        'flex items-center gap-3 rounded-3xl px-4 py-3 text-sm text-text touch-none',
        colorPreset.cardClass,
        isDragging && !isOverlay && 'opacity-40',
        isOverlay && 'shadow-2xl ring-2 ring-accent/50',
      )}
    >
      <button
        type="button"
        onClick={onToggleDone}
        className={clsx(
          'flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem]',
          task.is_done
            ? 'border-emerald-400 bg-emerald-400/20 text-emerald-200'
            : 'border-white/30',
        )}
        aria-label={
          task.is_done ? 'Вернуть в активные' : 'Отметить как выполненную'
        }
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

      <div className="ml-auto flex items-center gap-3">
        {/* Timer button is always visible — even during the intro preview,
            so the user can start/pause the new task immediately. The chip
            preview only replaces the other right-hand controls. */}
        <button
          type="button"
          onClick={onToggleTimer}
          className={clsx(
            'flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition',
            isRunning
              ? 'border-amber-300 text-amber-200'
              : 'border-white/30 text-white',
          )}
          aria-label={isRunning ? 'Пауза' : 'Старт'}
        >
          {isRunning ? '❚❚' : '▶'}
        </button>

        {/* The controls block is ALWAYS rendered so it reserves its
            natural width — this keeps the play/pause button to the left
            anchored at a stable x-coordinate regardless of mode. During
            intro the controls fade to opacity:0 and the chips overlay on
            top via absolute positioning. */}
        <div className="relative">
          <div
            className={clsx(
              'flex items-center gap-3 transition-opacity duration-200',
              showIntro ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
            aria-hidden={showIntro || undefined}
          >
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
                data-time-transfer-source={task.id}
                onPointerDown={(e) => {
                  // Hand off to the transfer-drag hook. Browsers don't fire a
                  // click after a pointermove > ~5-10px, so a real drag naturally
                  // suppresses click; a tap-and-release without movement still
                  // fires onClick → onTimeClick below.
                  onTimerPointerDown?.(e);
                }}
                onClick={() => {
                  void onTimeClick();
                }}
                className={clsx(
                  'w-24 rounded-md text-center font-mono text-base tabular-nums transition hover:text-white/80',
                  isTransferSource ? 'text-amber-200' : 'text-text',
                  isTransferTarget && 'bg-emerald-500/10 ring-2 ring-emerald-400/60',
                )}
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
                <ArchiveIcon />
              </button>
            </div>
          </div>

          {showIntro && (
            <div
              data-testid="task-category-intro"
              className="absolute inset-0 flex flex-wrap items-center justify-end gap-2"
              style={{
                // Fade-in (0-12% of duration) → hold → fade-out (88-100%).
                // The animation ends exactly when the 1500ms setTimeout fires
                // and swaps the chips for the controls, so the transition
                // doesn't snap — the chips dissolve and the controls fade in.
                animation: `mt-card-intro-cycle ${INTRO_DURATION_MS}ms ease-in-out forwards`,
              }}
            >
              {introCategories.map((category) => {
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
                        void handleIntroChipDetach(category.id);
                      }}
                      className="text-white/80 transition hover:text-rose-300"
                      aria-label={`Удалить категорию ${category.name}`}
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {isCategoriesPopoverOpen && (
        <FloatingPortal>
          <div
            ref={categoryRefs.setFloating}
            style={{ position: strategy, top: y ?? 0, left: x ?? 0, zIndex: 1200 }}
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
    </article>
  );
}
