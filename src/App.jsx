import { useEffect, useRef, useState, Suspense } from 'react';
import { lazyWithReload } from './utils/staleChunk';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';
import { applyTheme } from './utils/theme';

// Loaded on demand. The chart pages pull in recharts and the settings screens
// are rarely the first thing opened, so keeping them out of the initial bundle
// gets the app on screen sooner.
const Graphs = lazyWithReload(() => import('./pages/Graphs'));
const Stats = lazyWithReload(() => import('./pages/Stats'));
const Budgets = lazyWithReload(() => import('./pages/Budgets'));
const Settings = lazyWithReload(() => import('./pages/Settings'));
const ManageData = lazyWithReload(() => import('./pages/ManageData'));
const SyncSettings = lazyWithReload(() => import('./pages/SyncSettings'));
const AppearanceSettings = lazyWithReload(() => import('./pages/AppearanceSettings'));
const CurrencySettings = lazyWithReload(() => import('./pages/CurrencySettings'));
const SecuritySettings = lazyWithReload(() => import('./pages/SecuritySettings'));
const AutomationSettings = lazyWithReload(() => import('./pages/AutomationSettings'));
const ClaudeChat = lazyWithReload(() => import('./pages/ClaudeChat'));

function RouteFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <div
        className="spinner"
        style={{ borderColor: 'var(--border-color)', borderTopColor: 'var(--accent-color)', width: '32px', height: '32px', borderWidth: '3px' }}
      />
    </div>
  );
}

import { SettingsProvider, useAppearanceSettings } from './context/SettingsContext';
import { AuthProvider } from './context/AuthContext';

import { loadExchangeRates } from './utils/exchange';
import { useData } from './context/DataContext';

function ThemeInit({ children }) {
  const { activeTheme, customHex, baseCurrency, rateSource } = useAppearanceSettings();
  const { setExchangeRates, setExchangeRateInfo, accounts, rateReloadKey } = useData();
  // The currencies actually held, as a stable key, so Elevate is only asked
  // about pairs that matter and an account edit doesn't refetch needlessly.
  const currencyKey = [...new Set((accounts || []).map(a => a.currency || 'USD'))].sort().join(',');
  const [visibleTick, setVisibleTick] = useState(0);

  useEffect(() => {
    if (activeTheme) {
      applyTheme(activeTheme, customHex);
    }
  }, [activeTheme, customHex]);

  // Elevate's rate moves through the day; re-check when the app comes back
  // to the foreground (the fetch itself is cached for 10 minutes).
  useEffect(() => {
    if (rateSource !== 'elevate') return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') setVisibleTick(t => t + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [rateSource]);

  const lastReloadKey = useRef(rateReloadKey);
  useEffect(() => {
    let cancelled = false;
    const force = lastReloadKey.current !== rateReloadKey;
    lastReloadKey.current = rateReloadKey;
    loadExchangeRates({
      baseCurrency,
      source: rateSource,
      currencies: currencyKey ? currencyKey.split(',') : [],
      force
    }).then(({ rates, info }) => {
      if (cancelled) return;
      setExchangeRates(rates);
      setExchangeRateInfo({ ...info, loadedAt: Date.now() });
    });
    return () => { cancelled = true; };
  }, [baseCurrency, rateSource, currencyKey, rateReloadKey, visibleTick, setExchangeRates, setExchangeRateInfo]);

  return children;
}

export default function App() {
  return (
    <ThemeInit>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <Layout />
              </Suspense>
            </ProtectedRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="graphs" element={<Graphs />} />
            <Route path="stats" element={<Stats />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="budgets" element={<Budgets />} />
            <Route path="claude" element={<ClaudeChat />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/:type" element={<ManageData />} />
            <Route path="settings/sync" element={<SyncSettings />} />
            <Route path="settings/appearance" element={<AppearanceSettings />} />
            <Route path="settings/currency" element={<CurrencySettings />} />
            <Route path="settings/security" element={<SecuritySettings />} />
            <Route path="settings/automation" element={<AutomationSettings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeInit>
  );
}
