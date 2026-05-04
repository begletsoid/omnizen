import { useEffect, useRef } from 'react';

import type { MicroTaskRecord } from '../../../features/microTasks/types';

type UseDuplicateOnDParams = {
  /** Disable in tests / non-interactive contexts. */
  enabled?: boolean;
  /**
   * Called on key press to find the task under the cursor. Returning null
   * (no row hovered, or hovered group header, etc.) is a no-op — no toast
   * needed, the user just pressed D outside any row.
   */
  resolveTaskAtPointer: () => MicroTaskRecord | null;
  /**
   * Fire-and-forget; the parent owns the actual mutation. Returning a
   * promise is fine — the hook doesn't wait on it (we want the keypress to
   * feel instant; if the mutation throws the parent's onError handles it).
   */
  onDuplicate: (task: MicroTaskRecord) => void | Promise<unknown>;
};

/** Detect "D" (latin) or "В" (Cyrillic on the same physical key on RU layout). */
function isDuplicateKey(e: KeyboardEvent): boolean {
  // Modifiers reserved for browser/OS shortcuts (Ctrl+D = bookmark, Cmd+D, Alt+D = url-bar).
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.repeat) return false; // hold-to-spam is almost always accidental
  const key = e.key;
  return key === 'd' || key === 'D' || key === 'в' || key === 'В';
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  // JSDOM doesn't always reflect contentEditable through the property; check
  // the attribute too so tests and older runtimes behave the same as Chrome.
  const ce = target.getAttribute('contenteditable');
  if (ce === 'true' || ce === '' || ce === 'plaintext-only') return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Press D over a task row to duplicate that row (title + categories +
 * goal_id, with a fresh timer at zero). Hover detection happens on the
 * caller side — we just trigger the action when the key fires outside any
 * editable focus.
 */
export function useDuplicateOnD({
  enabled = true,
  resolveTaskAtPointer,
  onDuplicate,
}: UseDuplicateOnDParams): void {
  // Stable refs so the effect doesn't re-bind on every render; otherwise
  // listeners thrash and a press that lands between unmount and re-mount
  // would be missed.
  const resolveRef = useRef(resolveTaskAtPointer);
  resolveRef.current = resolveTaskAtPointer;
  const onDuplicateRef = useRef(onDuplicate);
  onDuplicateRef.current = onDuplicate;

  useEffect(() => {
    if (!enabled) return;
    function handler(e: KeyboardEvent) {
      if (!isDuplicateKey(e)) return;
      if (isEditable(e.target)) return;
      const task = resolveRef.current();
      if (!task) return;
      e.preventDefault();
      onDuplicateRef.current(task);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}

// Exported for unit tests so we can assert the matcher rules in isolation
// without spinning up a window/JSDOM loop.
export const __test__ = { isDuplicateKey, isEditable };
