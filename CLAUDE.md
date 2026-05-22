# Omnizen — project memory for Claude Code

Auto-loaded by Claude Code at session start in this repo. Keeps long-running
context in git so any new session (any machine: Windows/macOS) starts from
the same baseline.

## What this is

Personal dashboard web app **plus** an Electron desktop tray app that
provides a global mouse-button-triggered quick-switcher overlay for the
user's micro-tasks.

- Web: `https://omnizen.netlify.app` (auto-deployed from `master`).
- Desktop wrapper: `electron/` — Windows working today, macOS port pending.

## Stack

- **Frontend:** React 19 + Vite + TypeScript (`src/`).
- **State:** Zustand stores + TanStack React Query (cache + mutations).
- **Backend:** Supabase (db + auth + storage + RPC). Client in
  `src/lib/supabaseClient.ts`. Migrations in `supabase/migrations/`.
- **Serverless:** Netlify Functions in `netlify/functions/`. Voice
  pipeline lives in `netlify/functions/_voice/`.
- **Desktop:** Electron 42 + koffi (FFI to user32.dll on Windows for the
  global WH_MOUSE_LL hook). Source in `electron/`.
- **Tests:** Vitest unit/integration, smoke (`scripts/smoke.ts`),
  Playwright e2e (rarely run).

## Daily commands

- `npm run check` — lint + vitest + smoke + build. Must be green before
  any push.
- `npm run smoke` — fast end-to-end DB sanity (creates+deletes test user).
- `supabase db push` — apply migrations to the linked Supabase project.
- `npm run dev` — Vite dev server on localhost:5173.
- `npm run electron:compile` — compile `electron/` TypeScript to
  `dist-electron/` (CommonJS) + copy assets.
- `npm run electron:dev` — Vite + Electron with HMR.
- `npm run electron:build` — package Windows `.exe` to
  `release/win-unpacked/`. NSIS installer step fails on non-Developer-Mode
  Windows (known winCodeSign symlink issue); the unpacked exe is the
  shipped artifact + a manual desktop shortcut.

## User policy (do not ignore)

These are persistent rules from the project owner.

- **Respond in Russian.** All chat messages.
- **Never push or deploy without an explicit command for THIS round of
  changes.** Each "push" approval is instance-specific to the work
  currently described. Local commits also should not be made without
  an explicit ask.
- **Do not show full code blocks in chat unless asked.** Describe what
  was changed/run, not the lines themselves.
- **Tests policy:** smoke obligatory for every new RPC; do not skip
  failing tests.

## Key code regions

- `src/features/microTasks/` — micro-task domain (api/hooks/types).
  Categories, tags, archive (`archived_at`), time-transfer, category
  intro chip preview, LLM-driven category classification (`classifyMicrotaskCategories`).
- `src/features/quickSwitcher/` — desktop overlay UI:
  `QuickSwitcherOverlay`, `OverlayTaskRow`, `DesktopSettings`.
- `src/widgets/microTasks/MicroTasksWidget.tsx` — dashboard widget.
  Uses `usePointerDnd` (`hooks/usePointerDnd.ts`) and the canonical
  `buildFlatList` flatten in `utils/dndUtils.ts`.
- `src/widgets/microTasks/hooks/useTimeTransferDrag.ts` — drag-to-transfer
  time between tasks (also used by overlay).
- `netlify/functions/_voice/` — voice pipeline (STT/LLM/intent registry).
  `intents.ts` is the cross-cutting registry.
- `netlify/functions/classify-microtask.ts` — JWT-auth endpoint used by
  `useCreateMicroTask` to pick categories for manually-typed titles.
- `electron/main.ts` — tray-only Electron main. Single-instance lock,
  tray icon ("o" wordmark in `electron/assets/`), settings + login + overlay
  BrowserWindows on a shared `persist:omnizen` partition, autostart via
  `applyLoginItem`, headless detection via `--autostart` flag,
  `loadWithRetry` for cold-boot network resilience, debug log at
  `%APPDATA%\OmniZen\desktop.log` (Windows) via `dlog`.
- `electron/mouseHook.worker.ts` — Win32 `WH_MOUSE_LL` hook via koffi in
  a worker_threads message pump. Consumes XButton1 globally
  (`return 1`) so it doesn't propagate to Chrome / IDEs / etc.

## Current state

- Master is deployed on Netlify and contains voice phases 1-3 plus the
  desktop quick-switcher (commit `a71b0ae` — *desktop quick-switcher
  (Electron tray) + LLM categories for all micro-tasks*).
- Subsequent fixes (autostart headless, login-item args mismatch, Exit
  destroys windows, network retry) live on the `voice-microtask-quick-start`
  branch and may or may not be merged depending on the current session.
  Check `git log --oneline master..voice-microtask-quick-start` to see.
- Windows `.exe` at `release/win-unpacked/OmniZen.exe` (gitignored; build
  output). Manually-created desktop shortcut points at it.

## Known caveats

- Packaged `.exe` loads frontend from `https://omnizen.netlify.app`
  (`OMNIZEN_URL = app.isPackaged ? PROD_URL : DEV_URL`). New overlay UI
  requires deploying `master` to Netlify before it appears in the
  packaged app. To make the desktop app self-contained (no internet):
  switch Vite to `base: './'`, load via `file://`, and rework Supabase
  redirect URLs / origin handling. Not done yet.
- Windows login-item registry value name is the **`appUserModelId`**
  (`com.omnizen.desktop`) — NOT `app.getName()`. Standard `reg query /v OmniZen`
  finds nothing; query without `/v` to list. Old dev-session bug may
  leave a stale `electron.app.Electron` entry; delete with:
  `reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "electron.app.Electron" /f`
- `.claude/` is git-ignored — it's Claude Code's per-agent worktrees.
- macOS port: see `docs/macos-port.md`.

## Plans

Long-form iterative plans (voice phases, desktop phases, fixes) live in
the project owner's home: `~/.claude/plans/ancient-percolating-fairy.md`.
That file is **not** in the repo and **not** synced between machines.
Use it as historical context only; new work should be designed in-session
or as fresh plan files.
