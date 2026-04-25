import { FloatingPortal } from '@floating-ui/react';
import clsx from 'clsx';

import {
  formatTransferDuration,
  type TransferValidity,
} from '../../../features/microTasks/transferUtils';

type TimeTransferOverlayProps = {
  pointerX: number;
  pointerY: number;
  /**
   * Minutes the user is *requesting* — what we want to display in the
   * preview, even if validity is `too_much` (it'd be confusing if the
   * preview silently snapped to the clamped value).
   */
  requestedMinutes: number;
  validity: TransferValidity;
};

const VALIDITY_CLASSES: Record<TransferValidity, string> = {
  ok: 'border-emerald-400/60 bg-background/90 text-emerald-100',
  too_much: 'border-rose-400/70 bg-background/90 text-rose-100',
  zero: 'border-white/30 bg-background/70 text-muted opacity-60',
  no_target: 'border-white/30 bg-background/80 text-text/80',
  same_task: 'border-white/30 bg-background/70 text-muted opacity-60',
};

/**
 * Floating "MM:00" preview that follows the cursor while a time-transfer
 * drag is active. Render it from MicroTasksWidget so it lives outside any
 * row's overflow-clipping container.
 */
export function TimeTransferOverlay({
  pointerX,
  pointerY,
  requestedMinutes,
  validity,
}: TimeTransferOverlayProps) {
  return (
    <FloatingPortal>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: pointerX + 14,
          top: pointerY - 18,
          pointerEvents: 'none',
          zIndex: 1500,
        }}
        className={clsx(
          'select-none rounded-xl border px-3 py-1.5 font-mono text-base tabular-nums shadow-2xl backdrop-blur transition-colors',
          VALIDITY_CLASSES[validity],
        )}
        data-testid="time-transfer-overlay"
        data-validity={validity}
      >
        {formatTransferDuration(requestedMinutes)}
      </div>
    </FloatingPortal>
  );
}
