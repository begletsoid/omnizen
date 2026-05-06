/**
 * Floating toast in top-right corner that announces voice-driven mutations.
 * Lives in its own file because react-refresh wants components and non-component
 * exports separated (we keep the hook in useVoiceRealtime.ts).
 */

import type { VoiceToast } from './useVoiceRealtime';

export function VoiceToastView({
  toast,
  onDismiss,
}: {
  toast: VoiceToast | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  const isError = toast.kind === 'error';
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'fixed right-4 top-4 z-[10000] max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur',
        isError
          ? 'border-rose-400/40 bg-rose-500/15 text-rose-50'
          : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-50',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Закрыть"
        className="absolute right-2 top-1.5 text-xs text-muted hover:text-text"
      >
        ✕
      </button>
      <p className="font-medium pr-5">{toast.text}</p>
      {toast.detail && (
        <p className="mt-1 text-xs text-muted line-clamp-2">{toast.detail}</p>
      )}
    </div>
  );
}
