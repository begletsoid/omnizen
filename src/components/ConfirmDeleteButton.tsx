import { useEffect, useState, type CSSProperties } from 'react';
import clsx from 'clsx';

type State = 'idle' | 'armed-disabled' | 'armed-active';

type Props = {
  onConfirm: () => void;
  label?: string;
  /** Tailwind size (h-4 w-4 by default). */
  className?: string;
  /** Custom style override for the outer button. */
  style?: CSSProperties;
};

/**
 * Two-step delete: a single click turns the ✕ into a trash icon which is
 * disabled for 2 s, then becomes clickable for another 3 s, then auto-reverts.
 * Prevents accidental destructive actions without adding native confirm()
 * dialogs.
 */
export function ConfirmDeleteButton({ onConfirm, label = 'Удалить', className, style }: Props) {
  const [state, setState] = useState<State>('idle');

  useEffect(() => {
    if (state === 'armed-disabled') {
      const t = setTimeout(() => setState('armed-active'), 2000);
      return () => clearTimeout(t);
    }
    if (state === 'armed-active') {
      const t = setTimeout(() => setState('idle'), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [state]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (state === 'idle') {
      setState('armed-disabled');
      return;
    }
    if (state === 'armed-active') {
      onConfirm();
      setState('idle');
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={state === 'armed-disabled'}
      aria-label={
        state === 'idle'
          ? label
          : state === 'armed-disabled'
            ? 'Подтверждение — подождите'
            : 'Подтвердить удаление'
      }
      title={
        state === 'idle'
          ? label
          : state === 'armed-disabled'
            ? 'Подождите…'
            : 'Нажмите, чтобы удалить'
      }
      style={style}
      className={clsx(
        'flex items-center justify-center transition',
        state === 'idle' && 'text-muted hover:text-rose-300',
        state === 'armed-disabled' && 'cursor-not-allowed text-muted/30',
        state === 'armed-active' && 'animate-pulse text-rose-400 hover:text-rose-200',
        className ?? 'h-4 w-4',
      )}
    >
      {state === 'idle' ? (
        <span aria-hidden>✕</span>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
      )}
    </button>
  );
}
