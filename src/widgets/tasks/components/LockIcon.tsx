import clsx from 'clsx';

type LockIconProps = {
  locked: boolean;
  onToggle: () => void;
};

export function LockIcon({ locked, onToggle }: LockIconProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'flex h-5 w-5 items-center justify-center rounded text-[0.6rem] transition-all',
        locked
          ? 'text-rose-400 opacity-100'
          : 'text-rose-400/40 opacity-0 group-hover:opacity-50 hover:!opacity-100',
      )}
      aria-label={locked ? 'Разблокировать задачу' : 'Заблокировать задачу'}
    >
      {locked ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M14.5 1A4.5 4.5 0 0010 5.5V9H3a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-1V5.5a3 3 0 116 0v2.75a.75.75 0 001.5 0V5.5A4.5 4.5 0 0014.5 1z" />
        </svg>
      )}
    </button>
  );
}
