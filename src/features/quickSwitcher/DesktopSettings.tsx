/**
 * Tiny preferences window for the desktop tray app (#settings route).
 * Intentionally minimal — the only setting today is "launch with
 * system". Closing this window does NOT quit the app; the overlay keeps
 * running in the tray until the user picks Exit there.
 *
 * Wording is "system" (not "Windows") because the same toggle maps to
 * macOS login items when we port — see `desktop:set-autostart` in
 * electron/main.ts (Electron's setLoginItemSettings is cross-platform).
 *
 * The autostart toggle is disabled outside the packaged build: dev
 * autostart can't render the overlay (no Vite dev server at login), and
 * registering it from dev would create a broken login item.
 */

import { useEffect, useState } from 'react';

type DesktopBridge = {
  getAutostart?: () => Promise<boolean>;
  setAutostart?: (enabled: boolean) => Promise<boolean>;
  isPackaged?: () => Promise<boolean>;
};

function bridge(): DesktopBridge | undefined {
  return (window as unknown as { omnizenDesktop?: DesktopBridge }).omnizenDesktop;
}

export function DesktopSettings() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  // null = unknown yet; true/false once the main process answers.
  const [packaged, setPackaged] = useState<boolean | null>(null);

  useEffect(() => {
    const b = bridge();
    if (!b?.getAutostart) {
      setAutostart(false);
      setPackaged(false);
      return;
    }
    b.getAutostart()
      .then((v) => setAutostart(Boolean(v)))
      .catch(() => setAutostart(false));
    if (b.isPackaged) {
      b.isPackaged()
        .then((v) => setPackaged(Boolean(v)))
        .catch(() => setPackaged(false));
    } else {
      setPackaged(false);
    }
  }, []);

  const toggle = async () => {
    const b = bridge();
    if (!b?.setAutostart || autostart === null || saving || packaged === false) return;
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

  const toggleDisabled = autostart === null || saving || packaged !== true;

  return (
    <main className="flex h-screen w-screen flex-col gap-4 bg-background px-6 py-5 text-text">
      <h1 className="text-sm font-semibold tracking-wide text-text">
        Быстрый переключатель
      </h1>

      <label
        className={`flex items-center gap-3 text-sm ${
          toggleDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        }`}
      >
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={autostart ?? false}
          disabled={toggleDisabled}
          onChange={() => void toggle()}
        />
        <span>Запускать при запуске системы</span>
      </label>

      {packaged === false && (
        <p className="text-xs leading-relaxed text-amber-300/80">
          Автозапуск доступен только в установленном приложении (не в
          режиме разработки — при входе в систему нет dev-сервера).
        </p>
      )}

      <p className="mt-auto text-xs leading-relaxed text-muted">
        Оверлей продолжает работать в трее даже после закрытия этого окна.
        Полностью выйти можно через меню иконки в трее.
      </p>
    </main>
  );
}
