/**
 * Global mouse hook worker thread — Windows only.
 *
 * Lives in its own `worker_threads` Worker so the Windows message pump
 * required by `WH_MOUSE_LL` doesn't fight with Electron's main thread.
 * Why a worker:
 *   - `WH_MOUSE_LL` is a low-level hook: every mouse event in the OS
 *     passes through our JS callback BEFORE it reaches the target app.
 *     If the callback ever exceeds ~300ms, Windows silently unhooks us.
 *     A dedicated worker with an empty event loop guarantees we never
 *     blow that budget regardless of what Electron's main is doing
 *     (GC, IPC, BrowserWindow operations).
 *   - The same thread that installed the hook must call GetMessage in a
 *     loop, otherwise the hook is never invoked. The worker is that
 *     thread; it blocks in GetMessageA forever (cheap — it's idle).
 *
 * We consume XButton1 (`return 1n`) so it never reaches Chrome, Claude,
 * IDEs etc. — that's the whole point of this overlay-trigger gesture.
 * Forward both press and release to the parent (Electron main) via
 * `parentPort.postMessage`, which is essentially a queue.write —
 * microseconds, fits in the callback budget.
 */

import { parentPort } from 'node:worker_threads';
import koffi from 'koffi';

if (!parentPort) throw new Error('mouseHook.worker must run as a Worker');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// POINT — { LONG x, LONG y }. On x64, alignment is natural so we don't
// need explicit packing.
const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });

// MSLLHOOKSTRUCT is the payload Windows hands to a WH_MOUSE_LL callback
// via lParam. `mouseData` carries the X-button index in its HIWORD when
// `wParam` is WM_XBUTTONDOWN / WM_XBUTTONUP. `dwExtraInfo` is a
// pointer-sized integer; we don't use it but the struct layout demands it.
const MSLLHOOKSTRUCT = koffi.struct('MSLLHOOKSTRUCT', {
  pt: POINT,
  mouseData: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
});

const MSG = koffi.struct('MSG', {
  hwnd: 'void *',
  message: 'uint32',
  wParam: 'uintptr',
  lParam: 'intptr',
  time: 'uint32',
  pt: POINT,
  lPrivate: 'uint32',
});

// HOOKPROC signature: LRESULT CALLBACK proc(int nCode, WPARAM, LPARAM).
// LRESULT on x64 is `intptr` (signed pointer-sized).
//
// IMPORTANT: lParam is declared as an OPAQUE `void *`, not
// `MSLLHOOKSTRUCT *`. koffi does NOT auto-decode pointer-to-struct
// parameters in registered callbacks — it would hand us an empty `{}`.
// We must `koffi.decode(lParam, MSLLHOOKSTRUCT)` by hand. (Verified
// empirically: with `MSLLHOOKSTRUCT *` the struct came through blank,
// so `mouseData` was undefined and XBUTTON1 never matched — the hook
// fired but did nothing.) The `__stdcall` convention is mandatory for
// Win32 callbacks.
const HOOKPROC = koffi.proto(
  'intptr __stdcall HookProc(int nCode, uintptr wParam, void *lParam)',
);

const SetWindowsHookExA = user32.func(
  'intptr __stdcall SetWindowsHookExA(int idHook, HookProc *lpfn, void *hMod, uint32 dwThreadId)',
);
const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(intptr hhk)');
// NOTE: we intentionally do NOT declare or call CallNextHookEx. Calling
// it re-entrantly (a koffi FFI call from inside a koffi-registered
// callback) on the worker thread returned a non-zero garbage LRESULT,
// which Windows interpreted as "block this event" — freezing EVERY mouse
// button system-wide (the user couldn't even click the Start menu). The
// fix is to never call it: return 0 to pass an event through, 1 to
// consume. Skipping CallNextHookEx means other low-level hooks in the
// chain don't see the event, which is acceptable for a single-user app.
const GetMessageA = user32.func(
  'int __stdcall GetMessageA(MSG *lpMsg, void *hWnd, uint32 wMsgMin, uint32 wMsgMax)',
);
const TranslateMessage = user32.func('bool __stdcall TranslateMessage(MSG *lpMsg)');
const DispatchMessageA = user32.func('intptr __stdcall DispatchMessageA(MSG *lpMsg)');
const PostThreadMessageA = user32.func(
  'bool __stdcall PostThreadMessageA(uint32 idThread, uint32 Msg, uintptr wParam, intptr lParam)',
);
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()');
const GetModuleHandleA = kernel32.func('void * __stdcall GetModuleHandleA(const char *lpModuleName)');

const WH_MOUSE_LL = 14;
const WM_XBUTTONDOWN = 0x020b;
const WM_XBUTTONUP = 0x020c;
const WM_NCXBUTTONDOWN = 0x00ab;
const WM_NCXBUTTONUP = 0x00ac;
const WM_QUIT = 0x0012;
const XBUTTON1 = 1;

let hookHandle: number | bigint = 0;

// IMPORTANT: keep `proc` in a stable lexical binding. `koffi.register`
// returns a persistent thunk that Windows will call into; if `proc` is
// garbage-collected the thunk becomes a dangling pointer and we crash
// the OS-level mouse pipeline. The const reference here is the anchor.
const proc = koffi.register(
  (nCode: number, wParam: number | bigint, lParam: unknown) => {
    try {
      // Only act on valid, action-style notifications. For anything we
      // don't explicitly want to swallow we return 0, which lets Windows
      // deliver the event to its target window normally. Returning 0 is
      // the documented "pass through" value for a low-level hook — it
      // does NOT require calling CallNextHookEx.
      if (nCode >= 0) {
        const w = Number(wParam);
        if (
          w === WM_XBUTTONDOWN ||
          w === WM_NCXBUTTONDOWN ||
          w === WM_XBUTTONUP ||
          w === WM_NCXBUTTONUP
        ) {
          // koffi hands us an opaque pointer; decode it into the struct
          // ourselves (auto-decode doesn't happen for callback params).
          const data = koffi.decode(lParam, MSLLHOOKSTRUCT) as { mouseData: number };
          // HIWORD of mouseData identifies which X button (1 or 2).
          const which = (data.mouseData >>> 16) & 0xffff;
          if (which === XBUTTON1) {
            const isDown = w === WM_XBUTTONDOWN || w === WM_NCXBUTTONDOWN;
            // Fire-and-forget post; postMessage is queue.write and never
            // blocks — fits easily in the 300ms hook budget.
            parentPort!.postMessage({ type: isDown ? 'down' : 'up' });
            return 1; // consume — XBUTTON1 reaches no other app
          }
        }
      }
      // Pass every other mouse event straight through untouched.
      return 0;
    } catch (err) {
      // Fail OPEN: never block input on error. Returning 0 keeps the
      // user's mouse fully working even if our logic throws.
      parentPort!.postMessage({ type: 'callback-error', message: String(err) });
      return 0;
    }
  },
  koffi.pointer(HOOKPROC),
);

// For LL-mouse hooks Microsoft allows hMod = NULL or the module handle
// of the current process — both are accepted for the same address space.
// We pass the current module handle to be defensive.
const hMod = GetModuleHandleA(null) as unknown as null;
hookHandle = SetWindowsHookExA(WH_MOUSE_LL, proc, hMod, 0) as number | bigint;

if (!hookHandle || hookHandle === 0 || hookHandle === 0n) {
  parentPort.postMessage({ type: 'error', message: 'SetWindowsHookExA returned NULL' });
  // Without the hook, this worker has no reason to live.
  process.exit(1);
}

parentPort.postMessage({ type: 'ready' });
// Capture the worker thread id so we can post a WM_QUIT to break out of
// the GetMessageA loop on shutdown — GetMessageA otherwise blocks forever.
const workerThreadId = GetCurrentThreadId() as unknown as number;
parentPort.postMessage({ type: 'thread-id', value: Number(workerThreadId) });

parentPort.on('message', (m: { type: string }) => {
  if (m.type === 'stop') {
    if (hookHandle) UnhookWindowsHookEx(hookHandle);
    koffi.unregister(proc);
    // Wake GetMessageA so the while loop exits naturally; process.exit
    // below is a defensive backstop if that races.
    PostThreadMessageA(Number(workerThreadId), WM_QUIT, 0, 0);
    setTimeout(() => process.exit(0), 50);
  }
});

// Blocking message pump — this is what keeps the hook alive.
//
// GetMessageA returns 0 on WM_QUIT, > 0 on a real message, < 0 on error.
// Note: the hook callback fires DIRECTLY from inside this thread's
// message pump (the OS dispatches LL events to the hook thread). We
// don't see those events as MSG records here; they're handled inline by
// `proc`. The pump only exists to keep the thread message-ready.
const msg: Record<string, unknown> = {};
let pumpResult = GetMessageA(msg, null, 0, 0) as number;
while (pumpResult > 0) {
  TranslateMessage(msg);
  DispatchMessageA(msg);
  pumpResult = GetMessageA(msg, null, 0, 0) as number;
}

if (hookHandle) UnhookWindowsHookEx(hookHandle);
koffi.unregister(proc);
process.exit(0);
