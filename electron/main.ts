/**
 * Omnizen desktop quick-switcher — Electron main process.
 *
 * This is a TRAY APP, not a browser wrapper. There is no main window and
 * no dashboard mirror. The only UI surfaces are:
 *   - overlayWindow: frameless, transparent, always-on-top. Hidden until
 *     the user holds the mouse XButton1; auto-sized to its content via an
 *     IPC `resize` message from the renderer (no fixed height → no empty
 *     space, no clipping). Shown immediately on press, hidden on release.
 *   - settingsWindow: a tiny window with a single "start with system"
 *     toggle. Opened from the tray or by launching the app again.
 *   - tray: the app's only persistent presence. Right-click → Exit.
 *
 * Lifecycle: single-instance. Launching the shortcut again just opens the
 * settings window (the overlay keeps running in the background). The app
 * only quits via the tray's Exit item.
 *
 * Mouse hook: a worker_threads Worker installs a Windows WH_MOUSE_LL hook
 * via koffi and CONSUMES XButton1 so it never reaches other apps.
 */

import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, session, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

/**
 * Append-only debug log for things that have no other visible surface
 * in a packaged tray app (no stdout console). Location:
 * `%APPDATA%\OmniZen\desktop.log` on Windows. Lazy because it depends
 * on `app.getPath('userData')` being available — guard with try/catch.
 */
function dlog(msg: string): void {
  try {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'desktop.log'),
      `[${new Date().toISOString()}] ${msg}\n`,
    );
  } catch {
    /* if we can't log we can't log */
  }
}

/**
 * loadURL with automatic retry on transient network failures. At system
 * cold boot (autostart) the network/VPN often isn't ready yet — the
 * first `loadURL` against netlify fails (`did-fail-load`), the window
 * is left blank (black for a transparent overlay), and nothing ever
 * recovers. With retry we keep trying with exponential backoff capped
 * at 30s, indefinitely, so the moment connectivity is up the page
 * loads and the user can use the app without restarting it.
 *
 * Retry resets to 0 on the first successful `did-finish-load`.
 */
function loadWithRetry(win: BrowserWindow, url: string, label: string): void {
  let attempt = 0;
  const tryOnce = async () => {
    if (win.isDestroyed()) return;
    // Wipe Chromium's negative DNS cache before every attempt. Without
    // this, an offline start poisons the resolver — even after VPN/
    // network comes up the retries keep failing on the cached
    // NAME_NOT_RESOLVED until the app is restarted.
    try {
      await session.fromPartition(SESSION_PARTITION).clearHostResolverCache();
    } catch {
      /* ignore */
    }
    if (win.isDestroyed()) return;
    win.loadURL(url).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      dlog(`[${label}] loadURL rejected: ${msg}`);
    });
  };
  const wc = win.webContents;
  wc.on('did-start-loading', () => dlog(`[${label}] did-start-loading`));
  wc.on('did-stop-loading', () => dlog(`[${label}] did-stop-loading url=${wc.getURL()}`));
  wc.on('did-fail-load', (_e, code, desc, failedURL, isMainFrame) => {
    // Sub-frame failures and Chromium's internal aborts (-3 ABORTED,
    // happens during our own reload) are not real network failures.
    if (!isMainFrame || code === -3) return;
    if (win.isDestroyed()) return;
    attempt += 1;
    const delay = Math.min(2_000 * 2 ** (attempt - 1), 30_000);
    dlog(`[${label}] did-fail-load code=${code} desc=${desc} url=${failedURL} → retry #${attempt} in ${delay}ms`);
    setTimeout(() => { void tryOnce(); }, delay);
  });
  wc.on('did-finish-load', () => {
    if (attempt > 0) dlog(`[${label}] recovered after ${attempt} retries; url=${wc.getURL()}`);
    else dlog(`[${label}] did-finish-load url=${wc.getURL()}`);
    attempt = 0;
  });
  void tryOnce();
}

/**
 * The overlay window is the user's only feedback that the app works.
 * If its webContents got stuck on `about:blank` or a `chrome-error://`
 * page (typically after a cold-boot offline start that the retry chain
 * didn't recover), pressing XButton1 should itself act as a recovery
 * trigger — clear DNS, kick a fresh load, then show. Saves the user
 * from "помог только перезапуск".
 */
async function ensureOverlayLoaded(win: BrowserWindow, url: string, label: string): Promise<void> {
  if (win.isDestroyed()) return;
  const current = win.webContents.getURL();
  const broken =
    !current ||
    current === 'about:blank' ||
    current.startsWith('chrome-error://') ||
    win.webContents.isCrashed?.();
  if (!broken) return;
  dlog(`[${label}] forcing reload before show — current url="${current}"`);
  try {
    await session.fromPartition(SESSION_PARTITION).clearHostResolverCache();
  } catch {
    /* ignore */
  }
  win.loadURL(url).catch(() => undefined);
}

// Branding. setName/AppUserModelId make Windows show "OmniZen" (not the
// dev temp/electron name) in the taskbar, tray, and notifications.
app.setName('OmniZen');
if (process.platform === 'win32') app.setAppUserModelId('com.omnizen.desktop');
// Tray-only on macOS: keep the app out of the Dock and the cmd-tab
// switcher. No-op on other platforms.
if (process.platform === 'darwin') app.setActivationPolicy?.('accessory');

const SESSION_PARTITION = 'persist:omnizen';
const DEV_URL = 'http://localhost:5173/';
const PROD_URL = 'https://omnizen.netlify.app/';
const OMNIZEN_URL = process.env.OMNIZEN_URL ?? (app.isPackaged ? PROD_URL : DEV_URL);

// Overlay window width is fixed; height tracks content. We never let it
// exceed this fraction of the work area (then it scrolls instead).
const OVERLAY_WIDTH = 520;
const OVERLAY_MAX_HEIGHT_FRAC = 0.85;
// Pull the stack a touch above the exact vertical center.
const ABOVE_CENTER_OFFSET = 140;

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let mouseWorker: Worker | null = null;
let overlayVisible = false;
// Remember the last content height the renderer reported so a re-show
// positions the window correctly before the renderer re-measures.
let lastOverlayContentHeight = 320;

function computeOverlayBounds(contentHeight: number) {
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  const maxH = Math.round(wa.height * OVERLAY_MAX_HEIGHT_FRAC);
  const height = Math.max(80, Math.min(Math.ceil(contentHeight), maxH));
  const width = OVERLAY_WIDTH;
  const x = Math.round(wa.x + (wa.width - width) / 2);
  let y = Math.round(wa.y + (wa.height - height) / 2 - ABOVE_CENTER_OFFSET);
  if (y < wa.y + 8) y = wa.y + 8;
  return { x, y, width, height };
}

function applyOverlayBounds(contentHeight: number): void {
  if (!overlayWindow) return;
  lastOverlayContentHeight = contentHeight;
  overlayWindow.setBounds(computeOverlayBounds(contentHeight));
}

function createOverlayWindow(): void {
  const bounds = computeOverlayBounds(lastOverlayContentHeight);
  overlayWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // `closable: false` made `win.close()` a no-op, which blocked
    // `app.quit()` from ever completing (Tray → "Выход" did nothing).
    // The frame is hidden anyway, so the user can't accidentally close
    // the window — removing the flag is harmless.
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      partition: SESSION_PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  // ── Renderer diagnostics ──
  // The overlay window is transparent and has no chrome, so a blank /
  // crashed / errored renderer looks identical to "nothing happens".
  // Pipe its console + failure events to the main stdout / debug log so
  // we can see what the page is actually doing.
  const wc = overlayWindow.webContents;
  wc.on('console-message', (_e, level, message) => {
    console.log(`[overlay-renderer] (${level}) ${message}`);
  });
  wc.on('render-process-gone', (_e, details) => {
    console.log(`[overlay-renderer] render-process-gone ${JSON.stringify(details)}`);
  });

  // Auto-retry on cold-boot network failures (VPN not up yet, etc.).
  loadWithRetry(overlayWindow, `${OMNIZEN_URL}#overlay`, 'overlay');

  // Block keyboard-driven back/forward (Alt+Left) inside the overlay;
  // XButton1 is already consumed by the global hook before it arrives.
  overlayWindow.webContents.on('will-navigate', (event, url) => {
    const current = overlayWindow?.webContents.getURL();
    if (current && new URL(url).origin !== new URL(current).origin) {
      event.preventDefault();
    }
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function showOverlay(): void {
  if (!overlayWindow || overlayVisible) {
    console.log(`[overlay] showOverlay skipped (win=${!!overlayWindow} visible=${overlayVisible})`);
    return;
  }
  overlayVisible = true;
  const b = computeOverlayBounds(lastOverlayContentHeight);
  console.log(`[overlay] show @ ${JSON.stringify(b)}`);
  // Recover from a broken renderer state (cold-boot offline → page
  // failed to load → about:blank or error page). Fire-and-forget; the
  // load will happen in parallel with the window becoming visible so
  // the user doesn't have to wait.
  void ensureOverlayLoaded(overlayWindow, `${OMNIZEN_URL}#overlay`, 'overlay');
  overlayWindow.setBounds(b);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.show();
  overlayWindow.moveTop();
  overlayWindow.focus();
  overlayWindow.webContents.send('quick-switcher:open');
}

function hideOverlay(): void {
  if (!overlayWindow || !overlayVisible) return;
  overlayVisible = false;
  overlayWindow.webContents.send('quick-switcher:close');
  // Slightly faster than the exit animation so we don't yank the window
  // before it finishes; 150ms tracks the sped-up close keyframe.
  setTimeout(() => {
    if (overlayWindow && !overlayVisible) overlayWindow.hide();
  }, 160);
}

function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 380,
    height: 220,
    title: 'OmniZen — настройки',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#05060a',
    webPreferences: {
      partition: SESSION_PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  // The loaded Omnizen page sets its own document.title (that's the
  // "App TMP"-style name the user saw in the taskbar). Lock the window
  // title to our brand so the taskbar/Alt-Tab label reads "OmniZen".
  settingsWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });
  settingsWindow.setTitle('OmniZen — настройки');
  settingsWindow.webContents.once('did-finish-load', () => {
    settingsWindow?.setTitle('OmniZen — настройки');
  });
  loadWithRetry(settingsWindow, `${OMNIZEN_URL}#settings`, 'settings');
  settingsWindow.on('closed', () => {
    // Closing settings does NOT quit — the overlay keeps running and the
    // app stays alive in the tray.
    settingsWindow = null;
  });
}

let loginWindow: BrowserWindow | null = null;
function createLoginWindow(): void {
  if (loginWindow) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }
  // The full Omnizen app (no hash → DashboardShell). The user signs in
  // here; the Supabase session is written to the shared `persist:omnizen`
  // partition, so the overlay window (same partition) then has a user.
  // This is NOT an always-open dashboard — it's an on-demand login
  // surface the user closes after signing in.
  loginWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'OmniZen — вход',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#05060a',
    webPreferences: {
      partition: SESSION_PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loginWindow.setMenuBarVisibility(false);
  loginWindow.on('page-title-updated', (e) => e.preventDefault());
  loginWindow.setTitle('OmniZen — вход');
  loadWithRetry(loginWindow, OMNIZEN_URL, 'login');
  loginWindow.on('closed', () => {
    loginWindow = null;
  });
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('OmniZen — быстрый переключатель');
  const menu = Menu.buildFromTemplate([
    { label: 'Войти в OmniZen…', click: () => createLoginWindow() },
    { label: 'Настройки…', click: () => createSettingsWindow() },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        // Force-destroy any open windows before quit. `app.quit()` alone
        // sometimes gets stuck waiting for windows to close cleanly
        // (esp. our transparent/frameless overlay). Destroy is a hard
        // tear-down that ignores closable/preventDefault, so quit
        // proceeds to before-quit (stop mouse-hook worker) and exits.
        dlog('tray exit clicked');
        for (const w of BrowserWindow.getAllWindows()) {
          try { w.destroy(); } catch { /* ignore */ }
        }
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => createSettingsWindow());
}

type MouseHookMessage =
  | { type: 'ready' }
  | { type: 'thread-id'; value: number }
  | { type: 'down' }
  | { type: 'up' }
  | { type: 'error'; message: string }
  | { type: 'callback-error'; message: string };

function installMouseHook(): void {
  // The worker is currently Windows-only (loads user32.dll via koffi).
  // On macOS it would throw at top level; the rest of the app — tray,
  // settings window, overlay UI — works fine without it. The macOS
  // CGEventTap port lives in `mouseHook.macos.worker.ts` (see
  // docs/macos-port.md) and isn't implemented yet.
  if (process.platform !== 'win32') {
    dlog(`installMouseHook: platform=${process.platform}, skipping (Windows-only hook; macOS port pending)`);
    return;
  }
  const workerPath = path.join(__dirname, 'mouseHook.worker.js');
  mouseWorker = new Worker(workerPath);

  mouseWorker.on('message', (m: MouseHookMessage) => {
    switch (m.type) {
      case 'ready':
        console.log('[mouseHook] WH_MOUSE_LL installed');
        break;
      case 'down':
        // No delay — the overlay appears the instant the button goes
        // down (it's consumed globally anyway, so there's no native
        // "Back" to preserve via a short-click heuristic).
        showOverlay();
        break;
      case 'up':
        hideOverlay();
        break;
      case 'error':
        console.error('[mouseHook] fatal:', m.message);
        break;
      case 'callback-error':
        console.warn('[mouseHook] callback threw:', m.message);
        break;
    }
  });
  mouseWorker.on('error', (err) => console.error('[mouseHook] worker error:', err));
  mouseWorker.on('exit', (code) => {
    if (code !== 0) console.warn(`[mouseHook] worker exited with code ${code}`);
    mouseWorker = null;
  });
}

// True when the process was launched by the OS login item (autostart),
// not by the user double-clicking the shortcut. On Windows we tag the
// login-item command with `--autostart`; macOS also exposes
// `wasOpenedAtLogin`. Used to stay fully headless on autostart.
const startedByAutostart =
  process.argv.includes('--autostart') ||
  app.getLoginItemSettings().wasOpenedAtLogin === true;
dlog(`startup argv=${JSON.stringify(process.argv)} startedByAutostart=${startedByAutostart} isPackaged=${app.isPackaged}`);

/**
 * Register/clear the OS login item with an EXPLICIT path + args so it
 * launches the real app headlessly — not a bare `electron.exe` (which
 * showed Electron's default welcome screen and never ran our main.js).
 *
 *  - Packaged: path = OmniZen.exe, args = ['--autostart'].
 *  - Dev:      path = electron.exe, args = [<main.js>, '--autostart'].
 *              (Dev autostart still can't render the overlay — there's
 *              no Vite server at login — but at least we never register
 *              a broken bare-electron command. The Settings UI disables
 *              the toggle outside the packaged build.)
 *  - macOS:    also `openAsHidden: true`.
 */
function loginItemArgs(): string[] {
  return app.isPackaged
    ? ['--autostart']
    : [path.join(__dirname, 'main.js'), '--autostart'];
}

function applyLoginItem(enabled: boolean): void {
  const args = loginItemArgs();
  dlog(`applyLoginItem(${enabled}) execPath=${process.execPath} args=${JSON.stringify(args)} isPackaged=${app.isPackaged} appName=${app.getName()}`);
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // macOS-only flag, ignored on Windows
    path: process.execPath,
    args,
  });
  // Read back via BOTH variants to see where Electron actually wrote.
  const withCustom = app.getLoginItemSettings({ path: process.execPath, args }).openAtLogin;
  const withDefault = app.getLoginItemSettings().openAtLogin;
  dlog(`  → openAtLogin (custom path/args): ${withCustom}; (default no args): ${withDefault}`);
}

/**
 * Read the current login-item state. We MUST pass the same `path`+`args`
 * we wrote with — otherwise Electron's Windows backend compares against
 * `process.execPath` + empty args, sees a mismatch, and returns
 * `openAtLogin: false` even when the registry entry exists. That was the
 * "checkbox flicks on and immediately off" bug.
 */
function getLoginItemState(): boolean {
  return app.getLoginItemSettings({
    path: process.execPath,
    args: loginItemArgs(),
  }).openAtLogin;
}

function registerIpc(): void {
  ipcMain.on('quick-switcher:request-close', () => hideOverlay());
  ipcMain.on('desktop:open-login', () => createLoginWindow());

  ipcMain.on('quick-switcher:resize', (_e, contentHeight: number) => {
    // Guard against transient 0/tiny measurements (renderer not laid out
    // yet, or list momentarily empty). A sub-120px overlay is effectively
    // invisible — that was why the overlay "stopped opening". Ignore
    // those and keep the last good height.
    if (
      typeof contentHeight === 'number' &&
      Number.isFinite(contentHeight) &&
      contentHeight >= 120
    ) {
      applyOverlayBounds(contentHeight);
    }
  });

  // Autostart toggle — registers an explicit headless command (see
  // applyLoginItem). "system" wording (not "Windows") for portability.
  // Both get + set use `getLoginItemState()` which queries with the
  // matching path/args (see comment there).
  ipcMain.handle('desktop:get-autostart', () => getLoginItemState());
  ipcMain.handle('desktop:set-autostart', (_e, enabled: boolean) => {
    applyLoginItem(Boolean(enabled));
    return getLoginItemState();
  });
  // The Settings UI disables the autostart toggle outside the packaged
  // build (dev autostart can't render the overlay — no Vite at login).
  ipcMain.handle('desktop:is-packaged', () => app.isPackaged);
}

// ── Single instance ──────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running the overlay+tray. This launch's
  // only job was to surface settings — the primary instance does that
  // via the 'second-instance' handler below — so we exit.
  app.quit();
} else {
  app.on('second-instance', () => {
    // Launching the shortcut again: open settings if it isn't already.
    createSettingsWindow();
  });

  app.whenReady().then(() => {
    session.fromPartition(SESSION_PARTITION);
    createOverlayWindow();
    createTray();
    installMouseHook();
    registerIpc();
    // Headless on autostart: tray + hook + hidden overlay only, ZERO
    // windows. Only a manual launch (double-click of the shortcut)
    // surfaces the settings window so the user can reach settings/login
    // without hunting for the tray icon.
    if (!startedByAutostart) createSettingsWindow();
  });

  // Tray app: never quit just because all windows closed.
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });

  app.on('before-quit', () => {
    if (mouseWorker) mouseWorker.postMessage({ type: 'stop' });
  });
}
