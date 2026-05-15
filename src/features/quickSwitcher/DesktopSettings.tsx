/**
 * Tiny preferences window for the desktop tray app (#settings route).
 * Intentionally minimal — the only setting today is "launch with
 * system". Closing this window does NOT quit the app; the overlay keeps
 * running in the tray until the user picks Exit there.
 *
 * Wording is "system" (not "Windows") because the same toggle maps to
 * macOS login items when we port — see `desktop:set-autostart` in
 * electron/main.ts (Electron's setLoginItemSettings is cross-platform).
 */

import { useEffect, useState } from 'react';

type DesktopBridge = {
  getAutostart?: () => Promise<boolean>;
  setAutostart?: (enabled: boolean) => Promise<boolean>;
};

function bridge(): DesktopBridge | undefined {
  return (window as unknown as { omnizenDesktop?: DesktopBridge }).omnizenDesktop;
}

export function DesktopSettings() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const b = bridge();
    if (!b?.getAutostart) {
      setAutostart(false);
      return;
    }
    b.getAutostart()
      .then((v) => setAutostart(Boolean(v)))
      .catch(() => setAutostart(false));
  }, []);

  const toggle = async () => {
    const b = bridge();
    if (!b?.setAutostart || autostart === null || saving) return;
    const next = !autostart;
    setSaving(true);
    // Optimistic — reconcile with whatever the OS reports back.
    setAutostart(next);
    try {
      const confirmed = await b.setAutostart(next);
      setAutostart(Boolean(confirmed));
    } catch {
      setAutostart(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex h-screen w-screen flex-col gap-4 bg-background px-6 py-5 text-text">
      <h1 className="text-sm font-semibold tracking-wide text-text">
        Быстрый переключатель
      </h1>

      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={autostart ?? false}
          disabled={autostart === null || saving}
          onChange={() => void toggle()}
        />
        <span>Запускать при запуске системы</span>
      </label>

      <p className="mt-auto text-xs leading-relaxed text-muted">
        Оверлей продолжает работать в трее даже после закрытия этого окна.
        Полностью выйти можно через меню иконки в трее.
      </p>
    </main>
  );
}
