/**
 * The quick-switcher overlay window. Rendered when:
 *   - location.hash === '#overlay' (Electron's hidden second BrowserWindow
 *     loads omnizen with this hash; the main process toggles visibility
 *     via IPC), OR
 *   - we're in a browser tab with the same hash, for dev/test (no Electron).
 *
 * The overlay shows every active micro-task of the user, flattened across
 * widgets, numbered 1..N. While visible:
 *   - Click ▶/❚❚ on a row → toggle that task's timer.
 *   - Press 1-9 on the keyboard → same as clicking row N.
 *   - Drag the time on row A onto row B → transfer minutes (reuses
 *     `useTimeTransferDrag` from MicroTasksWidget).
 *
 * Visibility lifecycle: we mount once and never unmount; instead we flip
 * a `phase` between `hidden`, `entering`, `visible`, `exiting`. CSS
 * keyframes drive the open/close animation off the phase change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuthStore } from '../../stores/authStore';
import { useTimeTransferDrag } from '../../widgets/microTasks/hooks/useTimeTransferDrag';
import type { MicroTaskRecord } from '../microTasks/types';

import { OverlayTaskRow } from './OverlayTaskRow';
import {
  useActiveMicroTasks,
  useMarkAnyMicroTaskDone,
  useToggleAnyMicroTaskTimer,
  useTransferAnyMicroTaskTime,
} from './hooks';

type Phase = 'hidden' | 'entering' | 'visible' | 'exiting';

// Open/close animation durations — another ~30% faster on top of the
// previous pass. MUST stay in sync with the keyframe durations in
// `global.css` (`qs-overlay-in` / `qs-overlay-out`).
const ENTER_MS = 123;
const EXIT_MS = 100;

// How long the checkmark sits before the row collapses, and how long
// the collapse/fade itself takes.
const COMPLETE_HOLD_MS = 1500;
const COMPLETE_EXIT_MS = 200;

// Per-tick recomputation interval for live timer display. 1s is enough
// granularity for HH:MM:SS labels; we don't need finer than that.
const TIMER_TICK_MS = 1000;

type OmnizenDesktopBridge = {
  isDesktop: boolean;
  onOpen: (fn: () => void) => () => void;
  onClose: (fn: () => void) => () => void;
  requestClose: () => void;
  resize?: (contentHeight: number) => void;
  openLogin?: () => void;
};

declare global {
  interface Window {
    omnizenDesktop?: OmnizenDesktopBridge;
  }
}

export function QuickSwitcherOverlay() {
  const user = useAuthStore((state) => state.user);
  const { data: tasks } = useActiveMicroTasks();
  const toggleTimer = useToggleAnyMicroTaskTimer();
  const transferTime = useTransferAnyMicroTaskTime();
  const markDone = useMarkAnyMicroTaskDone();

  // Tasks whose number badge was clicked: showing the ✓ (completing) or
  // playing the collapse/fade-out (exiting). Tracked by id so the row
  // can render the right state and the list can reflow afterwards.
  const [completingIds, setCompletingIds] = useState<ReadonlySet<string>>(new Set());
  const [exitingIds, setExitingIds] = useState<ReadonlySet<string>>(new Set());

  const [phase, setPhase] = useState<Phase>(
    // When loaded inside Electron's overlay window the renderer is
    // mounted hidden; we only become visible when the main process
    // sends an `open` event. In a regular browser tab we open
    // immediately so devs can see the UI without rigging Electron.
    typeof window !== 'undefined' && window.omnizenDesktop?.isDesktop ? 'hidden' : 'visible',
  );

  // Force the document tree to be fully transparent. Omnizen's
  // `global.css` sets `background-color: var(--color-bg)` on body, which
  // paints a dark fill behind everything — fine for the dashboard, fatal
  // for an overlay window that's supposed to float over arbitrary apps
  // with no visible chrome. We use setProperty with the `important`
  // priority so we don't have to fight the existing rule's specificity.
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const rootEl = document.getElementById('root');
    root.style.setProperty('background', 'transparent', 'important');
    root.style.setProperty('background-color', 'transparent', 'important');
    body.style.setProperty('background', 'transparent', 'important');
    body.style.setProperty('background-color', 'transparent', 'important');
    if (rootEl) {
      rootEl.style.setProperty('background', 'transparent', 'important');
      rootEl.style.setProperty('background-color', 'transparent', 'important');
    }
    // No teardown — the overlay window only ever shows this view.
  }, []);

  // The Electron main process is the source of truth for visibility:
  // long-press of XButton1 sends `quick-switcher:open`; release sends
  // `quick-switcher:close`. We subscribe via the preload-exposed bridge.
  useEffect(() => {
    const bridge = window.omnizenDesktop;
    if (!bridge) return;
    const offOpen = bridge.onOpen(() => {
      setPhase('entering');
      window.setTimeout(() => setPhase('visible'), ENTER_MS);
    });
    const offClose = bridge.onClose(() => {
      setPhase('exiting');
      window.setTimeout(() => setPhase('hidden'), EXIT_MS);
    });
    return () => {
      offOpen();
      offClose();
    };
  }, []);

  // Live timer tick — recompute "now" every second so running timers
  // visibly advance while the overlay is open. We pause the tick when
  // hidden so the React tree isn't churning in the background.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase === 'hidden') return;
    const id = window.setInterval(() => setNow(Date.now()), TIMER_TICK_MS);
    return () => window.clearInterval(id);
  }, [phase]);

  const activeTasks = useMemo(() => tasks ?? [], [tasks]);

  const getTaskById = useCallback(
    (id: string): MicroTaskRecord | undefined => activeTasks.find((task) => task.id === id),
    [activeTasks],
  );

  const transferDrag = useTimeTransferDrag({
    getTaskById,
    onCommit: async ({ fromTaskId, toTaskId, seconds }) => {
      await transferTime.mutateAsync({ fromTaskId, toTaskId, seconds });
    },
    disabled: phase === 'hidden',
  });

  const computeSeconds = useCallback(
    (task: MicroTaskRecord): number => {
      let seconds =
        typeof task.elapsed_seconds === 'number' && Number.isFinite(task.elapsed_seconds)
          ? task.elapsed_seconds
          : 0;
      if (task.timer_state === 'running' && task.last_started_at) {
        seconds += Math.max(0, Math.floor((now - new Date(task.last_started_at).getTime()) / 1000));
      }
      return seconds;
    },
    [now],
  );

  // Number-key shortcut. Hotkeys are assigned BOTTOM-UP: pressing `1`
  // toggles the bottom-most task, `2` the one above it, etc. (the user's
  // hand rests near the mouse and the bottom of the list is the active
  // work area). So digit `d` maps to `activeTasks[len - d]`. We skip the
  // shortcut during a time-transfer drag — those digits feed the drag's
  // "minutes to move" buffer instead.
  useEffect(() => {
    if (phase !== 'visible' && phase !== 'entering') return;
    function onKey(e: KeyboardEvent) {
      if (transferDrag.state) return; // drag owns the digits
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key.length !== 1) return;
      const code = e.key.charCodeAt(0);
      if (code < 49 || code > 57) return; // '1'-'9'
      const digit = code - 48; // 1..9
      const task = activeTasks[activeTasks.length - digit];
      if (!task) return;
      e.preventDefault();
      toggleTimer.mutate({ task });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, activeTasks, toggleTimer, transferDrag.state]);

  // Completing a task via its number badge: show ✓ (1.5s) → collapse/
  // fade-out (200ms) → mutate done (optimistically removes it, so the
  // list reflows and the bottom-up numbers recompute automatically).
  const handleComplete = useCallback(
    (task: MicroTaskRecord) => {
      setCompletingIds((prev) => {
        if (prev.has(task.id)) return prev;
        const next = new Set(prev);
        next.add(task.id);
        return next;
      });
      window.setTimeout(() => {
        setExitingIds((prev) => {
          const next = new Set(prev);
          next.add(task.id);
          return next;
        });
        window.setTimeout(() => {
          markDone.mutate({ task });
          // The optimistic cache update drops the row; clear our local
          // tracking so the Sets don't grow unbounded across a session.
          setCompletingIds((prev) => {
            if (!prev.has(task.id)) return prev;
            const next = new Set(prev);
            next.delete(task.id);
            return next;
          });
          setExitingIds((prev) => {
            if (!prev.has(task.id)) return prev;
            const next = new Set(prev);
            next.delete(task.id);
            return next;
          });
        }, COMPLETE_EXIT_MS);
      }, COMPLETE_HOLD_MS);
    },
    [markDone],
  );

  // The window auto-sizes to its content (no fixed height → no empty
  // space, no clipping). After every render that can change the list
  // height we measure the list and ask main to resize the window. A
  // ResizeObserver catches add/remove + completion-collapse reflows.
  const listRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    const el = listRef.current;
    const bridge = window.omnizenDesktop;
    if (!el || !bridge?.resize) return;
    // `offsetHeight` is the untransformed layout height. We deliberately
    // do NOT use getBoundingClientRect().height here: that includes the
    // entrance animation's transform, so the reported height changed
    // every frame and the main process kept re-centering the window —
    // that was the "jerk up at the end" the user saw. offsetHeight is
    // stable from the first frame, so the window is sized exactly once.
    const report = () => {
      const h = el.offsetHeight;
      // Skip transient zero/tiny measurements (pre-layout, or list
      // momentarily empty) — main also floors at 120, but not reporting
      // garbage keeps the window from flickering to a sliver.
      if (h >= 40) bridge.resize?.(h);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTasks, phase]);

  // The work area is the BOTTOM of the list: when there are more tasks
  // than fit, we start scrolled to the bottom and the user can only
  // scroll up. Anchor to bottom whenever the overlay (re)appears or the
  // task set changes while visible.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (phase === 'hidden') return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [phase, activeTasks]);

  // No auth: the overlay window's session partition has no Supabase
  // login (there's no main window to sign in through anymore). Show a
  // VISIBLE prompt instead of an invisible empty window — otherwise the
  // button press looks like "nothing happens". The button asks main to
  // open a login window on the shared partition; once signed in there,
  // this overlay (same partition) gets the user.
  if (!user) {
    return (
      <main className="flex h-screen w-screen items-start justify-center bg-transparent pt-6">
        <div className="rounded-2xl border border-white/20 bg-neutral-950/95 px-5 py-4 text-sm text-text shadow-2xl">
          <p className="font-semibold">OmniZen — вход не выполнен</p>
          <p className="mt-1 text-xs text-muted">
            Войдите в аккаунт, чтобы видеть микрозадачи в оверлее.
          </p>
          <button
            type="button"
            onClick={() => window.omnizenDesktop?.openLogin?.()}
            className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:bg-accent/80"
          >
            Открыть окно входа
          </button>
        </div>
      </main>
    );
  }

  const rootClass = (() => {
    switch (phase) {
      case 'hidden':
        return 'pointer-events-none opacity-0';
      case 'entering':
        return 'qs-overlay-entering';
      case 'visible':
        return 'opacity-100';
      case 'exiting':
        return 'qs-overlay-exiting pointer-events-none';
    }
  })();

  // The overlay has no wrapping card — the Electron window is already
  // transparent and auto-sized to this list (see the resize effect), so
  // there's no empty space and the top row is never clipped. Tasks
  // render top→bottom in the SAME order as the dashboard widget. The
  // scroll container only scrolls when the list exceeds 85% of the
  // screen; its bar is hidden (`qs-noscrollbar`) but the wheel works,
  // and it starts at the bottom (work area / hotkeys 1-3).
  return (
    <main
      className="h-screen w-screen overflow-hidden bg-transparent"
      data-testid="quick-switcher-root"
    >
      <div ref={scrollRef} className="qs-noscrollbar h-full overflow-y-auto">
        <ul
          ref={listRef}
          className={`mx-auto flex w-[480px] max-w-[calc(100vw-32px)] flex-col gap-1.5 p-2 transition-opacity ${rootClass}`}
        >
          {activeTasks.map((task, idx) => {
            const isRunning = task.timer_state === 'running';
            const seconds = computeSeconds(task);
            const isTransferSource = transferDrag.state?.sourceTaskId === task.id;
            const isTransferTarget = transferDrag.state?.hoveredTargetId === task.id;
            // Hotkeys count from the bottom (bottom row = "1"), so the
            // badge value is `length - idx` for a top-down render index.
            const hotkeyNumber = activeTasks.length - idx;
            const isExiting = exitingIds.has(task.id);
            // While dragging, show the source minus the requested
            // minutes — matches MicroTasksWidget's preview behavior.
            let timeLabelOverride: string | undefined;
            if (isTransferSource && transferDrag.state) {
              const requestedSec = Math.min(transferDrag.effectiveMinutes * 60, seconds);
              timeLabelOverride = formatSecondsShort(Math.max(0, seconds - requestedSec));
            } else if (isTransferTarget && transferDrag.effectiveMinutes > 0) {
              timeLabelOverride = formatSecondsShort(seconds + transferDrag.effectiveMinutes * 60);
            }
            return (
              <li key={task.id} className={isExiting ? 'qs-row-exit' : undefined}>
                <OverlayTaskRow
                  task={task}
                  index={hotkeyNumber}
                  seconds={seconds}
                  isRunning={isRunning}
                  timeLabelOverride={timeLabelOverride}
                  isTransferSource={isTransferSource}
                  isTransferTarget={isTransferTarget}
                  onToggleTimer={() => toggleTimer.mutate({ task })}
                  onTimerPointerDown={(e) => transferDrag.beginPress(task.id, e)}
                  onComplete={() => handleComplete(task)}
                  isCompleting={completingIds.has(task.id)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}

// Local short-format duration helper. Matches `formatDuration` from
// `features/microTasks/utils.ts` but inlined to avoid a dependency
// cycle through the widget folder during a future refactor.
function formatSecondsShort(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`;
  return `${pad(minutes)}:${pad(secs)}`;
}
