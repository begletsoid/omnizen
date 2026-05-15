/**
 * Single row in the quick-switcher overlay. Visually descended from
 * `MicroTaskCard` but stripped to four interactive elements:
 *
 *   [ 1 ]   Title (truncated)                  [▶/❚❚]   00:42:13
 *
 * Hidden vs MicroTaskCard: done checkbox, delete, archive, tag popover,
 * group/order controls. The user is in a "switch focus" mode here, not
 * a "tidy up the board" mode — those controls are noise.
 *
 * Click on the timer-area = toggle running. The `data-time-transfer-source`
 * attribute + onPointerDown wiring lets `useTimeTransferDrag` activate a
 * cross-task time transfer on >6px drag, same mechanic as the dashboard.
 */

import clsx from 'clsx';

import type { MicroTaskRecord } from '../microTasks/types';
import { formatDuration } from '../microTasks/utils';
import { getCategoryColorPreset } from '../../widgets/microTasks/utils/constants';

/** `#rrggbb` → `rgba(r,g,b,a)`. Preset hexes are always 6-digit. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type OverlayTaskRowProps = {
  task: MicroTaskRecord;
  /** 1-based index — appears in the leading numeric chip and is the
   *  keyboard shortcut (1-9) that toggles this task. */
  index: number;
  /** Live seconds — recomputed each tick by the overlay using `computeTaskSeconds`. */
  seconds: number;
  isRunning: boolean;
  /** Override for the time label during an active time-transfer drag,
   *  so the row shows e.g. "committed - 5 min" preview. */
  timeLabelOverride?: string;
  isTransferSource: boolean;
  isTransferTarget: boolean;
  onToggleTimer: () => void;
  onTimerPointerDown: (e: React.PointerEvent) => void;
  /** Clicking the number badge marks the task done. */
  onComplete: () => void;
  /** True once the badge was clicked — show a checkmark instead of the
   *  number while the completion animation plays. */
  isCompleting: boolean;
};

export function OverlayTaskRow({
  task,
  index,
  seconds,
  isRunning,
  timeLabelOverride,
  isTransferSource,
  isTransferTarget,
  onToggleTimer,
  onTimerPointerDown,
  onComplete,
  isCompleting,
}: OverlayTaskRowProps) {
  const timeLabel = timeLabelOverride ?? formatDuration(seconds);
  const latestColoredCategory = [...(task.categories ?? [])]
    .reverse()
    .find((category) => category.color);
  const colorPreset = getCategoryColorPreset(latestColoredCategory?.color);

  return (
    <article
      data-task-id={task.id}
      className={clsx(
        'relative isolate rounded-2xl',
        isTransferSource && 'ring-1 ring-amber-300/40',
        isTransferTarget && 'ring-2 ring-emerald-400/60',
      )}
    >
      {/* Two stacked layers. Layer 1 is an opaque near-black base so the
          white text stays readable over ANY desktop (incl. a white app
          behind the transparent window). Layer 2 is a STRONG category
          color wash — much heavier than the dashboard's faint 5% tint,
          because over a white background that subtle version was
          indistinguishable. We use the preset's raw hex at ~62% fill +
          ~85% border so red/amber/green/etc. read clearly while the dark
          base keeps contrast for the text. */}
      <div aria-hidden className="absolute inset-0 rounded-2xl bg-background" />
      <div
        aria-hidden
        className="absolute inset-0 rounded-2xl border"
        style={{
          backgroundColor: hexToRgba(colorPreset.hex, 0.62),
          borderColor: hexToRgba(colorPreset.hex, 0.85),
        }}
      />

      <div className="relative flex items-center gap-3 px-3 py-2 text-sm text-text">
        {/* Numeric pill = the keyboard shortcut (bottom-up: bottom row is
            "1"). Also clickable: clicking it marks the task done — the
            number swaps to an animated checkmark while the row completes
            and fades out. */}
        <button
          type="button"
          onClick={onComplete}
          disabled={isCompleting}
          aria-label={`Отметить выполненной задачу ${task.title}`}
          className={clsx(
            'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full font-mono text-xs transition',
            isCompleting
              ? 'bg-emerald-500/90 text-white qs-check-pop'
              : index <= 9
                ? 'bg-white/15 text-white hover:bg-white/25'
                : 'bg-white/5 text-muted hover:bg-white/15',
          )}
        >
          {isCompleting ? '✓' : index}
        </button>

        <span
          className={clsx(
            'flex-1 truncate text-left',
            isRunning ? 'text-text' : 'text-text/85',
          )}
          title={task.title}
        >
          {task.title}
        </span>

        <button
          type="button"
          onClick={onToggleTimer}
          className={clsx(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition',
            isRunning
              ? 'border-amber-300 text-amber-200'
              : 'border-white/30 text-white',
          )}
          aria-label={isRunning ? 'Пауза' : 'Старт'}
        >
          {isRunning ? '❚❚' : '▶'}
        </button>

        <button
          type="button"
          data-time-transfer-source={task.id}
          onPointerDown={onTimerPointerDown}
          className={clsx(
            'w-24 shrink-0 rounded-md text-center font-mono text-base tabular-nums transition',
            isTransferSource ? 'text-amber-200' : 'text-text',
          )}
          aria-label={`Время задачи ${task.title}`}
        >
          {timeLabel}
        </button>
      </div>
    </article>
  );
}
