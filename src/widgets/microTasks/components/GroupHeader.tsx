import type { Ref } from 'react';
import clsx from 'clsx';

import type { MicroTaskGroup } from '../../../features/microTasks/types';
import { SaveIcon } from './Icons';

export type GroupHeaderProps = {
  group: MicroTaskGroup;
  isDragging?: boolean;
  isOverlay?: boolean;
  headerRef?: Ref<HTMLDivElement>;
  onPointerDown?: (e: React.PointerEvent) => void;
  isEditing: boolean;
  editValue: string;
  onEditStart: () => void;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onSaveTemplate: () => void;
  onDeleteGroup: () => void;
};

export function GroupHeader({
  group,
  isDragging = false,
  isOverlay = false,
  headerRef,
  onPointerDown,
  isEditing,
  editValue,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onEditStart,
  onSaveTemplate,
  onDeleteGroup,
}: GroupHeaderProps) {
  return (
    <div
      ref={headerRef}
      onPointerDown={onPointerDown}
      data-group-header
      data-group-header-id={group.id}
      className={clsx(
        'flex items-center gap-2 px-1 text-xs text-white/80 touch-none',
        isDragging && !isOverlay && 'opacity-40',
        isOverlay && 'shadow-xl rounded-xl bg-background/90 px-3 py-2 ring-2 ring-accent/50',
      )}
    >
      {isEditing ? (
        <input
          value={editValue}
          onChange={(event) => onEditChange(event.target.value)}
          onBlur={onEditCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onEditCommit();
            if (event.key === 'Escape') onEditCancel();
          }}
          autoFocus
          className="w-48 rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onEditStart}
          className="text-left text-xs font-semibold text-white/90"
        >
          {group.name}
        </button>
      )}
      <button
        type="button"
        onClick={onSaveTemplate}
        className="text-xs text-white/50 transition hover:text-white/70"
        aria-label="Сохранить группу как шаблон"
      >
        <SaveIcon className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDeleteGroup}
        className="text-xs text-white/60 transition hover:text-rose-300"
        aria-label="Удалить группу"
      >
        ✕
      </button>
    </div>
  );
}
