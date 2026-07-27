import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as db from '../store/db';
import { syncAll } from '../store/sync';

const SettingsContext = createContext(null);

const DEFAULT_FILTER_STATE = {
  excludedCategories: new Set(),
  excludedPayees: new Set(),
  excludedAccounts: new Set(),
  minAmount: '',
  maxAmount: ''
};

const DEFAULT_WIDGETS = [
  { id: '1', type: 'recent_transactions' },
  { id: '2', type: 'top_payees' },
  { id: '3', type: 'top_categories' }
];

const DEFAULT_STATS = [
  { id: '1', type: 'total_income' },
  { id: '2', type: 'total_expense' },
  { id: '3', type: 'net_savings' },
  { id: '4', type: 'savings_rate' }
];

const DEFAULT_SETTINGS = {
  dashboard: { period: 'This Month', customRange: { start: null, end: null }, filters: { ...DEFAULT_FILTER_STATE }, widgets: DEFAULT_WIDGETS },
  graphs: { period: 'All Time', customRange: { start: null, end: null }, filters: { ...DEFAULT_FILTER_STATE }, active: [] },
  stats: { period: 'This Month', customRange: { start: null, end: null }, filters: { ...DEFAULT_FILTER_STATE }, active: DEFAULT_STATS },
  transactions: { period: 'All Time', customRange: { start: null, end: null }, filters: { ...DEFAULT_FILTER_STATE } },
  appearance: { theme: 'purple', customHex: '#6366f1', baseCurrency: 'USD', displayMode: 'unified' },
  security: { e2eeEnabled: false, hasPromptedE2ee: false }
};

const serializeFilters = (filters) => ({
  ...filters,
  excludedCategories: Array.from(filters?.excludedCategories || []),
  excludedPayees: Array.from(filters?.excludedPayees || []),
  excludedAccounts: Array.from(filters?.excludedAccounts || [])
});

const deserializeFilters = (saved) => ({
  ...DEFAULT_FILTER_STATE,
  ...saved,
  excludedCategories: new Set(saved?.excludedCategories || []),
  excludedPayees: new Set(saved?.excludedPayees || []),
  excludedAccounts: new Set(saved?.excludedAccounts || [])
});

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const record = await db.settingsStore.getItem('appsettings1234');
        if (record && record.config) {
          const config = record.config;
          setSettings({
            dashboard: { ...DEFAULT_SETTINGS.dashboard, ...config.dashboard, filters: deserializeFilters(config.dashboard?.filters) },
            graphs: { ...DEFAULT_SETTINGS.graphs, ...config.graphs, filters: deserializeFilters(config.graphs?.filters) },
            stats: { ...DEFAULT_SETTINGS.stats, ...config.stats, filters: deserializeFilters(config.stats?.filters) },
            transactions: { ...DEFAULT_SETTINGS.transactions, ...config.transactions, filters: deserializeFilters(config.transactions?.filters) },
            appearance: { ...DEFAULT_SETTINGS.appearance, ...config.appearance },
            security: { ...DEFAULT_SETTINGS.security, ...config.security }
          });
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
      setIsLoaded(true);
    }
    loadSettings();
  }, []);

  const updateSettings = useCallback(async (newSettings) => {
    setSettings(newSettings);
    try {
      const configToSave = {
        dashboard: { ...newSettings.dashboard, filters: serializeFilters(newSettings.dashboard.filters) },
        graphs: { ...newSettings.graphs, filters: serializeFilters(newSettings.graphs.filters) },
        stats: { ...newSettings.stats, filters: serializeFilters(newSettings.stats.filters) },
        transactions: { ...newSettings.transactions, filters: serializeFilters(newSettings.transactions.filters) },
        appearance: { ...newSettings.appearance },
        security: { ...newSettings.security }
      };

      const existingRecord = await db.settingsStore.getItem('appsettings1234');
      const record = {
        ...(existingRecord || {}),
        id: 'appsettings1234',
        config: configToSave,
        updatedAt: new Date().toISOString(),
        pendingSync: true
      };
      
      await db.settingsStore.setItem('appsettings1234', record);
      // Trigger sync instantly so settings go to PocketBase
      syncAll();
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  }, []);

  const getPageSettings = useCallback((page) => {
    return settings[page] || DEFAULT_SETTINGS[page];
  }, [settings]);

  const setPageSettings = useCallback((page, newPageSettings) => {
    return updateSettings({
      ...settings,
      [page]: newPageSettings
    });
  }, [settings, updateSettings]);

  if (!isLoaded) return null;

  return (
    <SettingsContext.Provider value={{
      getPageSettings,
      setPageSettings,
      settings,
      updateSettings
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const usePageSettings = (pageName) => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("usePageSettings must be used within SettingsProvider");

  const { getPageSettings, setPageSettings } = context;
  const pageSettings = getPageSettings(pageName);

  const setSelectedPeriod = (period) => setPageSettings(pageName, { ...pageSettings, period });
  const setCustomRange = (range) => setPageSettings(pageName, { ...pageSettings, customRange: range });
  const setFilterState = (filters) => setPageSettings(pageName, { ...pageSettings, filters });
  
  // Extra setters for specific pages
  const setWidgets = (widgets) => setPageSettings(pageName, { ...pageSettings, widgets });
  const setActiveGraphs = (active) => setPageSettings(pageName, { ...pageSettings, active });
  const setActiveStats = (active) => setPageSettings(pageName, { ...pageSettings, active });

  return {
    selectedPeriod: pageSettings.period,
    setSelectedPeriod,
    customRange: pageSettings.customRange,
    setCustomRange,
    filterState: pageSettings.filters,
    setFilterState,
    
    // Additional returns
    activeWidgets: pageSettings.widgets || [],
    setWidgets,
    activeGraphs: pageSettings.active || [],
    setActiveGraphs,
    activeStats: pageSettings.active || [],
    setActiveStats
  };
};

export const useAppearanceSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useAppearanceSettings must be used within SettingsProvider");
  
  const { getPageSettings, setPageSettings } = context;
  const appearance = getPageSettings('appearance');
  
  const setTheme = (themeId, hex = appearance.customHex) => {
    setPageSettings('appearance', { ...appearance, theme: themeId, customHex: hex });
  };
  
  const setBaseCurrency = (code) => {
    setPageSettings('appearance', { ...appearance, baseCurrency: code });
  };

  const setDisplayMode = (mode) => {
    setPageSettings('appearance', { ...appearance, displayMode: mode });
  };
  
  return {
    activeTheme: appearance.theme,
    customHex: appearance.customHex,
    setTheme,
    baseCurrency: appearance.baseCurrency || 'USD',
    setBaseCurrency,
    displayMode: appearance.displayMode || 'unified',
    setDisplayMode
  };
};

export const useSecuritySettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSecuritySettings must be used within SettingsProvider");
  
  const { getPageSettings, setPageSettings } = context;
  const security = getPageSettings('security');
  
  const setE2EE = async (enabled) => {
    return await setPageSettings('security', { ...security, e2eeEnabled: enabled, hasPromptedE2ee: true });
  };

  const dismissE2EEPrompt = async () => {
    return await setPageSettings('security', { ...security, hasPromptedE2ee: true });
  };
  
  return {
    isE2eeEnabled: security.e2eeEnabled,
    hasPromptedE2ee: security.hasPromptedE2ee || false,
    setE2EE,
    dismissE2EEPrompt
  };
};

