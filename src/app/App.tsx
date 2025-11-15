import { AppProviders } from './AppProviders';
import { DashboardShell } from '../widgets/DashboardShell';

export function App() {
  return (
    <AppProviders>
      <DashboardShell />
    </AppProviders>
  );
}
