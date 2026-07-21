import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Graphs from './pages/Graphs';
import Stats from './pages/Stats';
import Transactions from './pages/Transactions';
import Budgets from './pages/Budgets';
import Settings from './pages/Settings';
import ManageData from './pages/ManageData';
import SyncSettings from './pages/SyncSettings';
import AppearanceSettings, { applyTheme } from './pages/AppearanceSettings';
import CurrencySettings from './pages/CurrencySettings';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';

import { SettingsProvider, useAppearanceSettings } from './context/SettingsContext';
import { AuthProvider } from './context/AuthContext';

import { fetchExchangeRates } from './utils/exchange';
import { useData } from './context/DataContext';

function ThemeInit({ children }) {
  const { activeTheme, customHex, baseCurrency } = useAppearanceSettings();
  const { setExchangeRates } = useData();
  
  useEffect(() => {
    if (activeTheme) {
      applyTheme(activeTheme, customHex);
    }
  }, [activeTheme, customHex]);

  useEffect(() => {
    async function loadRates() {
      const rates = await fetchExchangeRates(baseCurrency);
      if (setExchangeRates) {
        setExchangeRates(rates);
      }
    }
    loadRates();
  }, [baseCurrency, setExchangeRates]);

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <ThemeInit>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }>
                <Route index element={<Dashboard />} />
                <Route path="graphs" element={<Graphs />} />
                <Route path="stats" element={<Stats />} />
                <Route path="transactions" element={<Transactions />} />
                <Route path="budgets" element={<Budgets />} />
                <Route path="settings" element={<Settings />} />
                <Route path="settings/:type" element={<ManageData />} />
                <Route path="settings/sync" element={<SyncSettings />} />
                <Route path="settings/appearance" element={<AppearanceSettings />} />
                <Route path="settings/currency" element={<CurrencySettings />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ThemeInit>
      </SettingsProvider>
    </AuthProvider>
  );
}
