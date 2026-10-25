import { useEffect } from 'react';
import { useRoute } from './lib/router';
import { ChartPage } from './pages/ChartPage';
import { MultiChartPage } from './pages/MultiChartPage';
import { IndicatorsPage } from './pages/IndicatorsPage';
import { BacktestPage } from './pages/BacktestPage';
import { JournalPage } from './pages/JournalPage';
import { AccountPage } from './pages/AccountPage';
import { Toast } from './components/Toast';
import { CommandPalette } from './components/CommandPalette';
import { Shortcuts } from './components/Shortcuts';
import { session } from './lib/api';
import { syncFromCloud } from './lib/settings';
import { syncScripts } from './indicators/runtime';
import { startAlerts, syncAlertsFromCloud } from './lib/alerts';
import { syncJournalFromCloud } from './lib/journal';
import { InstallModal } from './components/InstallModal';

const TITLES: Record<string, string> = { chart: 'Trade', multi: 'Layouts', indicators: 'Scripts', backtest: 'Backtest', journal: 'Journal', account: 'Account' };

export function App() {
  const r = useRoute();
  useEffect(() => {
    startAlerts();
    if (session.get().token) { syncFromCloud(); syncScripts(); syncAlertsFromCloud(); syncJournalFromCloud(); }
  }, []);
  useEffect(() => { document.title = `FlowCharts — ${TITLES[r] || 'Trade'}`; }, [r]);
  return (
    <>
      {r === 'multi' ? <MultiChartPage /> : r === 'indicators' ? <IndicatorsPage /> : r === 'backtest' ? <BacktestPage /> : r === 'journal' ? <JournalPage /> : r === 'account' ? <AccountPage /> : <ChartPage />}
      <CommandPalette />
      <Shortcuts />
      <InstallModal />
      <Toast />
    </>
  );
}
