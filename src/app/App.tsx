import { AppProviders } from './AppProviders';
import { DashboardShell } from '../widgets/DashboardShell';
import { MicroTasksWidget } from '../widgets/microTasks/MicroTasksWidget';
import { QuickSwitcherOverlay } from '../features/quickSwitcher/QuickSwitcherOverlay';
import { DesktopSettings } from '../features/quickSwitcher/DesktopSettings';

export function App() {
  // The Electron tray app opens dedicated BrowserWindows at this URL
  // with a hash: `#overlay` for the quick-switcher HUD, `#settings` for
  // the tiny preferences window. A regular browser can also visit these
  // hashes for local development without Electron.
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  let rootView = <DashboardShell />;
  if (hash.includes('overlay')) rootView = <QuickSwitcherOverlay />;
  else if (hash.includes('settings')) rootView = <DesktopSettings />;
  else if (hash.includes('e2e')) rootView = <MicroTasksWidget widgetId={null} />;
  return <AppProviders>{rootView}</AppProviders>;
}
