import type { CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';

import { formatDuration } from '../../../features/microTasks/utils';

type TimerPillProps = {
  elapsed: number;
  percent: number;
  colorClass: string;
  percentClass?: string;
  onClick: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
  label: string;
  isPrimary?: boolean;
  isActive: boolean;
};

export function TimerPill({
  elapsed,
  percent,
  colorClass,
  percentClass,
  onClick,
  buttonRef,
  label,
  isPrimary = false,
  isActive,
}: TimerPillProps) {
  return (
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
            isPrimary
              ? 'text-2xl font-semibold leading-tight'
              : 'text-lg font-semibold',
            colorClass,
          )}
        >
          {formatDuration(elapsed)}
        </span>
        <span
          className={clsx(
            'text-xs font-medium whitespace-nowrap',
            percentClass ?? 'text-white/60',
          )}
        >
          {percent}%
        </span>
      </div>
    </button>
  );
}

type TimerSettings = {
  id: string;
  tagIds: string[];
  mode: 'only' | 'exclude';
  colorId?: string | null;
};

type SortableTimerPillProps = {
  settings: TimerSettings;
  metrics: { elapsed: number; percent: number; colorPreset: { iconClass: string } };
  label: string;
  onSelect: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
  isActive: boolean;
};

export function SortableTimerPill({
  settings,
  metrics,
  label,
  onSelect,
  buttonRef,
  isActive,
}: SortableTimerPillProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: settings.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'transform 120ms ease-out' : transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2"
      {...attributes}
      {...listeners}
    >
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
