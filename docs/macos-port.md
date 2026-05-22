# OmniZen — macOS port plan

Handoff doc for picking up the desktop app's macOS port on a Mac after
the Windows version is done. Read `CLAUDE.md` first for project-wide
context.

## What ships on Windows today

- Electron 42 tray app: see `electron/main.ts`. Single-instance lock;
  tray icon ("o" wordmark in `electron/assets/`); on-demand login and
  settings windows on a shared `persist:omnizen` session partition;
  headless autostart via `--autostart` flag; network-resilient loads
  via `loadWithRetry`.
- **Global mouse hook**: `electron/mouseHook.worker.ts` uses **koffi**
  (FFI) to set up a Windows `WH_MOUSE_LL` low-level hook in a worker
  thread that owns its own message pump (`GetMessageA` blocking loop).
  On XButton1 mouse-down/-up: posts `{type:'down'|'up'}` to main and
  **returns `1` to consume the event** so Chrome/IDEs/etc. don't see
  the back button. Main wires `down→showOverlay`, `up→hideOverlay`.
- Autostart: `applyLoginItem` registers `process.execPath` with
  `args: ['--autostart']` via `app.setLoginItemSettings`. Read state
  with matching `path`+`args` (otherwise the args-mismatch trap returns
  false even when registered). On Windows the registry value name is
  the **`appUserModelId`** (`com.omnizen.desktop`), not `app.getName()`.

## What macOS needs

### 1. Global mouse hook → CGEventTap

Replace the Win32 `WH_MOUSE_LL` worker with a Core Graphics Event Tap
on macOS. Same intent: capture XButton1 (the "back" mouse button) at the
system level, consume it, post to the Electron main process.

- **API:** `CGEventTapCreate`, `CGEventTapEnable`, `CFMachPortCreateRunLoopSource`,
  `CFRunLoopAddSource`, `CFRunLoopRun`. Inspect button via
  `CGEventGetIntegerValueField(event, kCGMouseEventButtonNumber)`.
- **macOS mouse-button numbers:** 0=left, 1=right, 2=middle, **3=back
  (XButton1)**, 4=forward (XButton2).
- **Events to listen for:** `kCGEventOtherMouseDown` (25) and
  `kCGEventOtherMouseUp` (26) — buttons > 2 fire as "other".
  Subscribe via `CGEventMaskBit(kCGEventOtherMouseDown) | CGEventMaskBit(kCGEventOtherMouseUp)`.
- **Consume:** return `NULL` from the tap callback. Pass-through: return
  the `CGEventRef` parameter unchanged.
- **Permissions:** event taps require **Accessibility** permission
  (System Settings → Privacy & Security → Accessibility). First launch
  must prompt:
  - Check with `AXIsProcessTrusted()`.
  - On the JS side, also exposed via `systemPreferences.isTrustedAccessibilityClient(true)`
    from Electron — pass `prompt: true` to trigger the system dialog.
- **Thread:** the tap requires a CFRunLoop on the same thread that
  owns it. Mirror the Windows worker pattern: a `worker_threads.Worker`
  that loads `CoreGraphics.framework` and `ApplicationServices.framework`
  via koffi, creates the tap, adds it to the worker's CFRunLoop, and
  blocks in `CFRunLoopRun`. Forward `down`/`up` to main via
  `parentPort.postMessage`.
- **Self-disable recovery:** macOS auto-disables the tap if the callback
  exceeds the budget. Listen for the `kCGEventTapDisabledByTimeout` /
  `kCGEventTapDisabledByUserInput` event types in the callback and
  call `CGEventTapEnable(tap, true)` to re-arm.
- **File layout:** create `electron/mouseHook.macos.worker.ts`. In
  `electron/main.ts`'s `installMouseHook`, branch on `process.platform`
  to pick the right worker script path. Keep the message protocol
  identical (`{type:'ready'|'down'|'up'|'error'|'callback-error'}`).

### 2. macOS-specific main.ts adjustments

- `app.setActivationPolicy('accessory')` — keeps the app out of the
  Dock and the cmd-tab list (tray-only behavior). Already
  cross-platform-safe, just call unconditionally near startup.
- Tray icon: on macOS the tray (status item) uses a 22×22 **template**
  image (monochrome, auto-inverted by the system). The current
  colored "o" png will work but won't look native. Optionally add
  `electron/assets/tray.template.png` + `tray.template@2x.png` for
  proper light/dark adaptation. `nativeImage.createFromPath` honors
  the `.template.png` naming convention.
- Tray click on macOS may need `tray.on('click', () => createSettingsWindow())`
  to also work with the left click (Windows behavior already added).
- Window icon: electron-builder generates `.icns` from `electron/assets/icon.png`
  during the mac target build; no extra work.
- `app.setLoginItemSettings({ openAsHidden: true })` already passed —
  it's the macOS-specific flag and is honored there (no-op elsewhere).
  Detect autostart via `app.getLoginItemSettings().wasOpenedAsHidden`
  (also already wired alongside the `--autostart` arg check).

### 3. dmg packaging

- `electron-builder.json` already has `mac: { target: dmg, arch: [arm64, x64] }`
  and `icon: electron/assets/icon.png`.
- On the Mac, after the hook port is in place:
  ```bash
  npm install         # native deps prebuild for darwin
  npm run electron:compile
  npm run electron:build
  ```
  Output: `release/OmniZen-<version>-{arm64,x64}.dmg`.
- **Code signing:** not required for personal use. Unsigned `.dmg`s
  trigger Gatekeeper on first open — the user has to right-click → Open
  once to whitelist. For broader distribution we'd need an Apple
  developer cert + `notarize` step; out of scope for now.

### 4. Permissions UX

First-launch flow on macOS:

1. App starts, tray icon appears. Try to install the hook worker.
2. Worker calls `AXIsProcessTrusted()` → returns `false` on first run.
3. Worker posts `{type:'error', message:'no-accessibility'}` to main.
4. Main opens the settings window with a clear message: "Чтобы
   перехватывать боковую кнопку мыши глобально, OmniZen нужны права
   Accessibility…" + a button that opens the right preference pane via
   `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')`.
5. User flips the toggle in System Settings. We re-check periodically
   (or watch `systemPreferences.subscribeNotification('NSAccessibilityClientWasAddedNotification')`
   if available) and re-install the hook once granted.

## Reuse from Windows

These are platform-agnostic and don't need touching:

- All `src/**` TypeScript/React frontend code.
- `electron/main.ts` window/tray/IPC scaffolding, `applyLoginItem`,
  `loadWithRetry`, `dlog`, `startedByAutostart` detection.
- `electron/preload.ts` and the `omnizenDesktop` bridge surface.
- `electron/assets/` icons (`icon.png` for the app, `tray.png` for the
  tray — fine; consider adding a template variant).
- `electron-builder.json` (mac target is already configured).

## Quick start on Mac

```bash
# Get the code
git clone https://github.com/begletsoid/omnizen.git
cd omnizen

# Install + smoke
npm install
npm run check          # 264+ tests should pass

# Run dev (will work for everything except the mouse hook)
npm run electron:dev   # Tray icon appears; settings window opens; XButton1
                       # does nothing yet on macOS because the hook is
                       # Windows-only until ported.

# After implementing electron/mouseHook.macos.worker.ts:
npm run electron:build # → release/OmniZen-<version>.dmg
```

## Known gotchas

- Event tap creation returns NULL silently when Accessibility is missing;
  always check the return value and surface a clear error to the user.
- A koffi callback executing too slowly (>1s-ish) gets the tap
  auto-disabled — the same low-latency principle as Windows applies.
  Use `parentPort.postMessage` (microseconds) and return immediately.
- Some Bluetooth mice on macOS don't expose distinct "back" buttons
  cleanly — the OS may emit them as a different button number depending
  on driver. Log `buttonNumber` from `CGEventGetIntegerValueField` first,
  confirm the value, then hardcode.
- Right-clicking the tray on macOS shows a menu the same way as Windows
  (`tray.setContextMenu`). Left-click should also work — wire it.
