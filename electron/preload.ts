/**
 * Preload script — bridges the Electron main process and the Omnizen
 * web app. We use `contextBridge` so the renderer never gets direct
 * Node access; only this whitelisted API is exposed on `window`.
 *
 * Responsibility: relay quick-switcher events. The main process tells
 * us when the user long-pressed XButton1 (open) or released it (close);
 * React inside the overlay window subscribes and animates accordingly.
 *
 * NOTE: an earlier version of this file also `preventDefault`ed
 * `mousedown`/`auxclick`/`mouseup` for `button === 3` (XButton1). That
 * is now redundant: the global `WH_MOUSE_LL` hook installed in the main
 * process consumes XButton1 events at the Windows kernel level, so they
 * never reach Chromium's input pipeline in the first place. Removed to
 * keep the surface minimal.
 */

import { contextBridge, ipcRenderer } from 'electron';

type OpenListener = () => void;
type CloseListener = () => void;

const openListeners = new Set<OpenListener>();
const closeListeners = new Set<CloseListener>();

ipcRenderer.on('quick-switcher:open', () => {
  for (const fn of openListeners) fn();
});

ipcRenderer.on('quick-switcher:close', () => {
  for (const fn of closeListeners) fn();
});

contextBridge.exposeInMainWorld('omnizenDesktop', {
  /** True when the page is running inside the Electron wrapper. */
  isDesktop: true,
  onOpen(fn: OpenListener): () => void {
    openListeners.add(fn);
    return () => openListeners.delete(fn);
  },
  onClose(fn: CloseListener): () => void {
    closeListeners.add(fn);
    return () => closeListeners.delete(fn);
  },
  /** Allow the overlay renderer to request a close ahead of mouseup. */
  requestClose(): void {
    ipcRenderer.send('quick-switcher:request-close');
  },
  /**
   * The renderer measures its content and asks main to size the window
   * to exactly fit it (clamped to the screen). This is what removes the
   * empty-space / clipping problem — the window is never bigger or
   * smaller than the task list.
   */
  resize(contentHeight: number): void {
    ipcRenderer.send('quick-switcher:resize', Math.ceil(contentHeight));
  },
  /** Settings: read/write "launch with system" (Windows + macOS). */
  getAutostart(): Promise<boolean> {
    return ipcRenderer.invoke('desktop:get-autostart');
  },
  setAutostart(enabled: boolean): Promise<boolean> {
    return ipcRenderer.invoke('desktop:set-autostart', enabled);
  },
  /** Open a normal window with the full app so the user can sign in.
   *  The session persists in the shared partition the overlay uses. */
  openLogin(): void {
    ipcRenderer.send('desktop:open-login');
  },
});
