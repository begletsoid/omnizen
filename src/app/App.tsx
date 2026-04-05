import { AppProviders } from './AppProviders';
import { DashboardShell } from '../widgets/DashboardShell';
import { MicroTasksWidget } from '../widgets/microTasks/MicroTasksWidget';

export function App() {
  const e2eMode = typeof window !== 'undefined' && window.location.hash.includes('e2e');
  return (
    <AppProviders>
      {e2eMode ? <MicroTasksWidget widgetId={null} /> : <DashboardShell />}
    </AppProviders>
  );
}
