import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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
  appearance: { theme: 'purple', customHex: '#6366f1', baseCurrency: 'PKR', displayMode: 'unified' },
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

const FILTER_KEY_BY_REF = {
  category: 'excludedCategories',
  payee: 'excludedPayees',
  account: 'excludedAccounts'
};
const FILTERED_PAGES = ['dashboard', 'graphs', 'stats', 'transactions'];

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  // Mirrors `settings` so a writer can read the newest value synchronously.
  // React batches state updates, so two setters called back to back in one
  // handler both saw the same pre-update `settings` and the second overwrote
  // the first — which is exactly how picking a custom range lost the range and
  // kept only the period.
  const settingsRef = useRef(settings);

  const commit = useCallback((next) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      const record = await db.settingsStore.getItem('appsettings1234');
      if (record && record.config) {
        const config = record.config;
        commit({
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
  }, [commit]);

  useEffect(() => {
    reloadSettings().then(() => setIsLoaded(true));
  }, [reloadSettings]);

  const updateSettings = useCallback(async (update) => {
    const newSettings = typeof update === 'function' ? update(settingsRef.current) : update;
    // An updater that decides nothing needs to change should not cost a write
    // to IndexedDB and a sync round trip.
    if (newSettings === settingsRef.current) return;
    commit(newSettings);
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
      syncAll().catch(err => console.warn('Background sync failed after settings update:', err));
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  }, [commit]);

  const getPageSettings = useCallback((page) => {
    return settings[page] || DEFAULT_SETTINGS[page];
  }, [settings]);

  // Saved filters exclude values by NAME, so renaming a category (or payee, or
  // account) would otherwise leave a filter excluding something that no longer
  // exists — and quietly stop excluding the thing the user actually picked.
  const renameInFilters = useCallback((refKind, oldName, newName) => {
    const key = FILTER_KEY_BY_REF[refKind];
    if (!key || !oldName || !newName || oldName === newName) return;

    return updateSettings((current) => {
      let changed = false;
      const next = { ...current };

      for (const page of FILTERED_PAGES) {
        const pageSettings = current[page];
        const excluded = pageSettings?.filters?.[key];
        if (!excluded || !excluded.has(oldName)) continue;

        const updated = new Set(excluded);
        updated.delete(oldName);
        updated.add(newName);
        next[page] = {
          ...pageSettings,
          filters: { ...pageSettings.filters, [key]: updated }
        };
        changed = true;
      }

      return changed ? next : current;
    });
  }, [updateSettings]);

  // `newPageSettings` may be a value or an updater receiving the current page
  // settings. Either way the merge happens against the newest state, not the
  // snapshot the calling component happened to render with.
  const setPageSettings = useCallback((page, newPageSettings) => {
    return updateSettings((current) => {
      const currentPage = current[page] || DEFAULT_SETTINGS[page] || {};
      const resolved = typeof newPageSettings === 'function'
        ? newPageSettings(currentPage)
        : newPageSettings;
      return { ...current, [page]: resolved };
    });
  }, [updateSettings]);

  if (!isLoaded) return null;

  return (
    <SettingsContext.Provider value={{
      getPageSettings,
      setPageSettings,
      settings,
      updateSettings,
      reloadSettings,
      renameInFilters
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

  const setSelectedPeriod = (period) => setPageSettings(pageName, (cur) => ({ ...cur, period }));
  const setCustomRange = (range) => setPageSettings(pageName, (cur) => ({ ...cur, customRange: range }));
  const setFilterState = (filters) => setPageSettings(pageName, (cur) => ({ ...cur, filters }));
  // Applied together, so the period can never land without the range it refers to.
  const setCustomPeriodRange = (range) =>
    setPageSettings(pageName, (cur) => ({ ...cur, customRange: range, period: 'Custom Range' }));

  // Extra setters for specific pages
  const setWidgets = (widgets) => setPageSettings(pageName, (cur) => ({ ...cur, widgets }));
  const setActiveGraphs = (active) => setPageSettings(pageName, (cur) => ({ ...cur, active }));
  const setActiveStats = (active) => setPageSettings(pageName, (cur) => ({ ...cur, active }));

  return {
    selectedPeriod: pageSettings.period,
    setSelectedPeriod,
    customRange: pageSettings.customRange || { start: null, end: null },
    setCustomRange,
    setCustomPeriodRange,
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

// Actions that operate across every page's settings at once.
export const useSettingsMaintenance = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettingsMaintenance must be used within SettingsProvider");
  return { renameInFilters: context.renameInFilters };
};

export const useAppearanceSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useAppearanceSettings must be used within SettingsProvider");
  
  const { getPageSettings, setPageSettings } = context;
  const appearance = getPageSettings('appearance');
  
  const setTheme = (themeId, hex = appearance.customHex) => {
    setPageSettings('appearance', (cur) => ({ ...cur, theme: themeId, customHex: hex }));
  };
  
  const setBaseCurrency = (code) => {
    setPageSettings('appearance', (cur) => ({ ...cur, baseCurrency: code }));
  };

  const setDisplayMode = (mode) => {
    setPageSettings('appearance', (cur) => ({ ...cur, displayMode: mode }));
  };
  
  return {
    activeTheme: appearance.theme,
    customHex: appearance.customHex,
    setTheme,
    baseCurrency: appearance.baseCurrency || 'PKR',
    setBaseCurrency,
    displayMode: appearance.displayMode || 'unified',
    setDisplayMode
  };
};

export const useSecuritySettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSecuritySettings must be used within SettingsProvider");
  
  const { getPageSettings, setPageSettings, reloadSettings } = context;
  const security = getPageSettings('security');
  
  const setE2EE = async (enabled) => {
    return await setPageSettings('security', (cur) => ({ ...cur, e2eeEnabled: enabled, hasPromptedE2ee: true }));
  };

  const dismissE2EEPrompt = async () => {
    return await setPageSettings('security', (cur) => ({ ...cur, hasPromptedE2ee: true }));
  };
  
  return {
    isE2eeEnabled: security.e2eeEnabled,
    hasPromptedE2ee: security.hasPromptedE2ee || false,
    setE2EE,
    dismissE2EEPrompt,
    reloadSettings
  };
};

