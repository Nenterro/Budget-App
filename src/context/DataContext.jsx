import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Shield, AlertTriangle } from 'lucide-react';
import * as db from '../store/db';
import { pb, syncAll, syncSettings, setupRealtimeSync, connectPocketBase } from '../store/sync';
import { isUnlocked, tryRestoreSession, deriveKey, verifyPinWithData, hasCachedPin } from '../utils/crypto';
import PinPad from '../components/PinPad';
import { useSecuritySettings } from './SettingsContext';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [payees, setPayees] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [exchangeRates, setExchangeRates] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const txs = await db.getTransactions();
      setTransactions(txs);
      
      let accts = await db.getItems(db.accountsStore);
      setAccounts(accts);

      let cats = await db.getItems(db.categoriesStore);
      setCategories(cats);

      let pys = await db.getItems(db.payeesStore);
      setPayees(pys);

      let bdgts = await db.getItems(db.budgetsStore);
      setBudgets(bdgts);
    } catch (err) {
      console.error("Failed to load local database:", err);
    }
  }, []);

  const [unlocked, setUnlocked] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const [pinInput, setPinInput] = useState('');

  const { isE2eeEnabled, hasPromptedE2ee, setE2EE, dismissE2EEPrompt, reloadSettings } = useSecuritySettings();
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingPin, setOnboardingPin] = useState('');
  const [onboardingConfirmPin, setOnboardingConfirmPin] = useState('');
  const [isProcessingOnboarding, setIsProcessingOnboarding] = useState(false);

  useEffect(() => {
    if (pb.authStore.isValid && !isE2eeEnabled && !hasPromptedE2ee && !needsPin && !unlocked && onboardingStep === 0) {
      setOnboardingStep(1);
    }
  }, [pb.authStore.isValid, isE2eeEnabled, hasPromptedE2ee, needsPin, unlocked, onboardingStep]);

  const handleSkipOnboarding = async () => {
    await dismissE2EEPrompt();
    setOnboardingStep(0);
  };

  const handleOnboardingPinComplete = async (enteredPin) => {
    if (onboardingStep === 2) {
      setOnboardingPin(enteredPin);
      setOnboardingStep(3);
    } else if (onboardingStep === 3) {
      if (enteredPin !== onboardingPin) {
        alert("PINs do not match. Please try again.");
        setOnboardingPin('');
        setOnboardingConfirmPin('');
        setOnboardingStep(2);
        return;
      }

      setIsProcessingOnboarding(true);
      try {
        await deriveKey(enteredPin);
        await setE2EE(true);
        setUnlocked(true);

        const stores = [db.transactionsStore, db.accountsStore, db.categoriesStore, db.payeesStore, db.settingsStore, db.budgetsStore];
        for (const store of stores) {
          const keys = await store.keys();
          for (const key of keys) {
            const item = await store.getItem(key);
            if (item) {
              item.pendingSync = true;
              await store.setItem(key, item);
            }
          }
        }

        await syncAll();
        await loadData();
        setOnboardingStep(0);
      } catch (err) {
        console.error(err);
        alert("Failed to setup encryption.");
      } finally {
        setIsProcessingOnboarding(false);
      }
    }
  };

  // ─── Main Initialization ───
  // The correct order is:
  // 1. Connect to PocketBase
  // 2. Pull remote settings FIRST (so we know E2EE state from cloud)
  // 3. Reload SettingsContext from the now-updated localforage
  // 4. Determine E2EE state
  // 5. If E2EE: try restore cached PIN → if no cached PIN, prompt user
  // 6. After unlock: full syncAll → loadData
  // 7. Setup realtime subscriptions
  useEffect(() => {
    let unsub = null;
    let isMounted = true;

    async function init() {
      // Load whatever local data exists first (may be empty on fresh device)
      await loadData();
      setIsLoading(false);

      const activeUrl = await connectPocketBase();
      if (!activeUrl || !pb.authStore.isValid) return;

      // Step 1: Sync settings from PocketBase FIRST
      await syncSettings();

      // Step 2: Reload SettingsContext so it picks up the remote settings
      if (reloadSettings) {
        await reloadSettings();
      }

      // Step 3: Re-read E2EE state from the now-accurate local settings
      const settingsRecord = await db.settingsStore.getItem('appsettings1234');
      const e2eeEnabled = settingsRecord?.config?.security?.e2eeEnabled || false;

      // Also check if remote has encrypted payloads (in case settings config doesn't reflect it)
      let remoteHasEncrypted = false;
      if (!e2eeEnabled) {
        try {
          const usersId = pb.authStore.model?.id;
          const collections = ['transactions', 'accounts', 'categories', 'payees', 'budgets'];
          for (const coll of collections) {
            const items = await pb.collection(coll).getList(1, 1, {
              filter: usersId ? `users = "${usersId}" && encrypted_payload != ""` : `encrypted_payload != ""`
            });
            if (items.totalItems > 0) {
              remoteHasEncrypted = true;
              break;
            }
          }
        } catch (e) {
          // If the filter query fails (field may not exist), ignore
        }

        if (remoteHasEncrypted) {
          // Update local settings to reflect E2EE is actually enabled
          const updatedRecord = {
            ...(settingsRecord || { id: 'appsettings1234' }),
            config: {
              ...(settingsRecord?.config || {}),
              security: { ...(settingsRecord?.config?.security || {}), e2eeEnabled: true, hasPromptedE2ee: true }
            },
            pendingSync: true
          };
          await db.settingsStore.setItem('appsettings1234', updatedRecord);
          if (reloadSettings) await reloadSettings();
        }
      }

      const finalE2ee = e2eeEnabled || remoteHasEncrypted;

      if (finalE2ee) {
        // Try to restore from cached PIN (localStorage)
        const restored = await tryRestoreSession();
        if (restored && isMounted) {
          setUnlocked(true);
          // Full sync now that we can decrypt
          await syncAll();
          await loadData();
          unsub = setupRealtimeSync((collection) => {
            loadData();
            if (collection === 'settings' && reloadSettings) reloadSettings();
          });
        } else if (isMounted) {
          // No cached PIN — prompt user
          setNeedsPin(true);
        }
      } else {
        // No E2EE — just sync everything
        await syncAll();
        await loadData();
        unsub = setupRealtimeSync((collection) => {
          loadData();
          if (collection === 'settings' && reloadSettings) reloadSettings();
        });
      }
    }

    init();

    return () => {
      isMounted = false;
      if (unsub) unsub();
    };
  }, [loadData, reloadSettings]);


  const addTransaction = async (tx) => {
    if (Array.isArray(tx)) {
      const savedTxs = await Promise.all(tx.map(t => db.saveTransaction(t)));
      setTransactions(prev => [...savedTxs, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date)));
    } else {
      const savedTx = await db.saveTransaction(tx);
      setTransactions(prev => [savedTx, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date)));
    }
    syncAll();
  };

  const updateTransaction = async (tx) => {
    const savedTx = await db.saveTransaction(tx);
    setTransactions(prev => {
      const idx = prev.findIndex(p => p.id === savedTx.id);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = savedTx;
        return copy.sort((a, b) => new Date(b.date) - new Date(a.date));
      }
      return [savedTx, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date));
    });
    syncAll();
  };

  const deleteTransaction = async (id) => {
    await db.deleteTransaction(id);
    setTransactions(prev => prev.filter(t => t.id !== id));
    syncAll();
  };

  const updateDataItem = async (store, item, setType) => {
    const saved = await db.saveItem(store, item);
    setType(prev => {
      const idx = prev.findIndex(p => p.id === saved.id);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = saved;
        return copy;
      }
      return [...prev, saved];
    });
    syncAll();
  };

  const deleteDataItem = async (store, id, setType) => {
    await db.deleteItem(store, id);
    setType(prev => prev.filter(p => p.id !== id));
    syncAll();
  };

  const handlePinSubmit = async (enteredPin) => {
    if (enteredPin.length === 4) {
      const isValid = await verifyPinWithData(enteredPin);
      if (!isValid) {
        alert("Incorrect PIN. Access Denied.");
        setPinInput('');
        return;
      }

      setUnlocked(true);
      setNeedsPin(false);
      
      // Now that we can decrypt, do a full sync and reload settings
      await syncAll();
      if (reloadSettings) await reloadSettings();
      await loadData();
      setupRealtimeSync((collection) => {
        loadData();
        if (collection === 'settings' && reloadSettings) reloadSettings();
      });
    }
  };

  return (
    <DataContext.Provider value={{ 
      transactions, accounts, categories, payees, budgets, exchangeRates, setExchangeRates, isLoading, loadData,
      addTransaction, updateTransaction, deleteTransaction,
      saveAccount: async (item) => {
        const isNew = !item.id;
        await updateDataItem(db.accountsStore, item, setAccounts);
        if (isNew) {
          const hasInvestments = categories.some(c => c.name.toLowerCase() === 'investments');
          if (!hasInvestments) {
            await updateDataItem(db.categoriesStore, { name: 'Investments', color: '#10b981', iconName: 'TrendingUp' }, setCategories);
          }
        }
      },
      deleteAccount: (id) => deleteDataItem(db.accountsStore, id, setAccounts),
      saveCategory: (item) => updateDataItem(db.categoriesStore, item, setCategories),
      deleteCategory: (id) => deleteDataItem(db.categoriesStore, id, setCategories),
      savePayee: (item) => updateDataItem(db.payeesStore, item, setPayees),
      deletePayee: (id) => deleteDataItem(db.payeesStore, id, setPayees),
      saveBudget: (item) => updateDataItem(db.budgetsStore, item, setBudgets),
      deleteBudget: (id) => deleteDataItem(db.budgetsStore, id, setBudgets),
    }}>
      {children}
      {/* First Time Onboarding Modal */}
      {onboardingStep > 0 && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(20,20,25,0.95)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" style={{ padding: '32px', borderRadius: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '340px', width: '90%', textAlign: 'center', gap: '16px', position: 'relative' }}>
            {onboardingStep === 1 ? (
              <>
                <div style={{ padding: '16px', background: 'rgba(99,102,241,0.15)', borderRadius: '50%', color: 'var(--accent-color)' }}>
                  <Shield size={36} />
                </div>
                <h2 style={{ margin: 0, fontSize: '20px' }}>Protect Your Privacy</h2>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  End-to-End Encryption protects your financial data with a 4-digit PIN.
                </p>

                <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', display: 'flex', gap: '10px', alignItems: 'flex-start', textAlign: 'left' }}>
                  <AlertTriangle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    <strong>Warning:</strong> Skipping encryption stores your data in plain text, allowing the server owner to view your records.
                  </span>
                </div>

                <button 
                  onClick={() => setOnboardingStep(2)} 
                  className="submit-btn bg-primary" 
                  style={{ width: '100%', marginTop: '8px' }}
                >
                  Set Up 4-Digit PIN
                </button>

                <button 
                  onClick={handleSkipOnboarding} 
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Skip for Now
                </button>
              </>
            ) : (
              <>
                <PinPad 
                  value={onboardingStep === 2 ? onboardingPin : onboardingConfirmPin}
                  onChange={onboardingStep === 2 ? setOnboardingPin : setOnboardingConfirmPin}
                  onSubmit={handleOnboardingPinComplete}
                  title={onboardingStep === 2 ? 'Set Encryption PIN' : 'Confirm PIN'}
                  subtitle={onboardingStep === 2 ? 'Enter a 4-digit PIN to encrypt your data.' : 'Re-enter your 4-digit PIN to confirm.'}
                />
                {isProcessingOnboarding && (
                  <p style={{ marginTop: '12px', color: 'var(--accent-color)', fontSize: '14px' }}>
                    Encrypting & Syncing...
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {needsPin && !unlocked && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(20,20,25,0.95)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" style={{ padding: '32px', borderRadius: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <PinPad 
              value={pinInput}
              onChange={setPinInput}
              onSubmit={handlePinSubmit}
              title="Enter E2EE PIN"
              subtitle="Your data is encrypted. Enter your 4-digit PIN to sync and unlock."
            />
          </div>
        </div>
      )}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
